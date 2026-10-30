import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect } from 'expect';
import {
  initWorker,
  INSTALL_STAMP_FILE,
  installedWorkerPlan,
  planDigest,
  readWorkerInit,
  removeStaleInstallations,
  workerInitState,
  type WorkerPlan,
} from '../src/index.js';

/** The pnpm syncbuild brings, run through Node.js */
const PNPM = [
  process.execPath,
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('pnpm/package.json')),
    'bin',
    'pnpm.mjs',
  ),
];

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  );
}

/**
 * Nothing here needs the network: the packages' npm dependencies are local
 * (file:), and what the host provides is linked.
 */
describe('initWorker', function () {
  this.timeout(60000);
  let root: string;
  let host: string;
  let workerDir: string;
  let storeDir: string;

  /** An extension package as SyncBridge stores it: no node_modules */
  function writeExtension(
    name: string,
    version: string,
    json: object = {},
  ): string {
    const dir = path.join(
      root,
      'extensions',
      `${name.slice(1).replace('/', '__')}@${version}`,
    );
    write(path.join(dir, 'package.json'), {
      name,
      version,
      type: 'module',
      module: './index.js',
      ...json,
    });
    write(path.join(dir, 'syncbridge-manifest.json'), {});
    write(path.join(dir, 'index.js'), `export const VERSION = '${version}';`);
    return dir;
  }

  function planOf(
    ...pkgs: { name: string; version: string; path: string }[]
  ): WorkerPlan {
    return {
      packages: Object.fromEntries(
        pkgs.map(p => [
          p.name,
          {
            ...p,
            entryPoint: path.join(p.path, 'index.js'),
            source: 'installed' as const,
          },
        ]),
      ),
      shared: ['@t/common'],
      hostURL: 'file://' + path.join(host, 'package.json'),
    };
  }

  const init = (plan: WorkerPlan, extra: object = {}) =>
    initWorker({
      plan,
      workerDir,
      storeDir,
      hostDir: host,
      pnpm: PNPM,
      ...extra,
    });

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'sb-worker-init-')),
    );
    host = path.join(root, 'host');
    workerDir = path.join(root, 'workers', 'w1');
    storeDir = path.join(root, 'workers', '.pnpm-store');
    /* The host's copy of a shared package */
    write(path.join(host, 'node_modules', '@t', 'common', 'package.json'), {
      name: '@t/common',
      version: '1.2.0',
      type: 'module',
      main: './index.js',
    });
    write(
      path.join(host, 'node_modules', '@t', 'common', 'index.js'),
      `export const HOST = true;`,
    );
    /* A plain npm library the extensions depend on */
    write(path.join(root, 'lib', 'package.json'), {
      name: 'tiny-lib',
      version: '1.0.0',
      main: './index.js',
    });
    write(path.join(root, 'lib', 'index.js'), `module.exports = 1;`);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('should install the plan in one project and point the plan at it', async () => {
    const a = writeExtension('@t/a', '1.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib') },
      peerDependencies: { '@t/common': '^1.0.0' },
    });
    const b = writeExtension('@t/b', '2.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib') },
    });
    const plan = planOf(
      { name: '@t/a', version: '1.0.0', path: a },
      { name: '@t/b', version: '2.0.0', path: b },
    );
    expect(workerInitState(plan, workerDir)).toBe('needs-init');

    const logs: string[] = [];
    const logger: any = { info: (m: string) => logs.push(m) };
    const r = await init(plan, { logger });
    expect(r.record).toMatchObject({
      digest: planDigest(plan),
      packages: { '@t/a': '1.0.0', '@t/b': '2.0.0' },
      depsDir: 'deps-' + planDigest(plan),
    });
    expect(readWorkerInit(workerDir)).toEqual(r.record);
    expect(workerInitState(plan, workerDir)).toBe('ready');
    expect(logs[0]).toMatch(/Initializing for @t\/a@1\.0\.0, @t\/b@2\.0\.0/);
    expect(logs.at(-1)).toMatch(/Initialized in/);
    expect(r.duplicates).toEqual([]);

    /* The plan runs the copies in the installation */
    const deps = path.join(workerDir, r.record.depsDir);
    const aCopy = r.plan.packages['@t/a'];
    expect(aCopy.path.startsWith(deps)).toBe(true);
    expect(aCopy.entryPoint).toBe(path.join(aCopy.path, 'index.js'));
    expect(fs.existsSync(aCopy.entryPoint)).toBe(true);
    expect(installedWorkerPlan(plan, workerDir)).toEqual(r.plan);

    /* One copy of the library both use */
    const libOf = (p: string) =>
      fs.realpathSync(path.join(p, '..', '..', 'tiny-lib'));
    expect(libOf(aCopy.path)).toBe(libOf(r.plan.packages['@t/b'].path));
    /* The shared peer is the host's copy */
    expect(
      fs.realpathSync(path.join(aCopy.path, '..', '..', '@t', 'common')),
    ).toBe(path.join(host, 'node_modules', '@t', 'common'));
  });

  it('should report a library the packages use in versions no range shares', async () => {
    write(path.join(root, 'lib2', 'package.json'), {
      name: 'tiny-lib',
      version: '2.0.0',
      main: './index.js',
    });
    write(path.join(root, 'lib2', 'index.js'), `module.exports = 2;`);
    const a = writeExtension('@t/a', '1.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib') },
    });
    const b = writeExtension('@t/b', '1.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib2') },
    });
    const warnings: string[] = [];
    const logger: any = {
      info: () => undefined,
      warn: (m: string) => warnings.push(m),
    };
    const r = await init(
      planOf(
        { name: '@t/a', version: '1.0.0', path: a },
        { name: '@t/b', version: '1.0.0', path: b },
      ),
      { logger },
    );
    expect(r.duplicates).toEqual([
      {
        name: 'tiny-lib',
        versions: { '1.0.0': ['@t/a'], '2.0.0': ['@t/b'] },
      },
    ]);
    expect(warnings).toEqual([
      expect.stringMatching(
        /tiny-lib is installed in 2 versions: 1\.0\.0 for @t\/a; 2\.0\.0 for @t\/b/,
      ),
    ]);
  });

  it('should need an init again when the plan changes, and keep the last one until it succeeds', async () => {
    const a1 = writeExtension('@t/a', '1.0.0');
    const plan1 = planOf({ name: '@t/a', version: '1.0.0', path: a1 });
    const first = await init(plan1);

    const a2 = writeExtension('@t/a', '1.1.0');
    const plan2 = planOf({ name: '@t/a', version: '1.1.0', path: a2 });
    expect(workerInitState(plan2, workerDir)).toBe('needs-init');

    /* A package that cannot be installed */
    const broken = planOf({
      name: '@t/a',
      version: '1.1.0',
      path: path.join(root, 'missing'),
    });
    await expect(init(broken)).rejects.toThrow();
    expect(readWorkerInit(workerDir)).toEqual(first.record);
    expect(workerInitState(plan1, workerDir)).toBe('ready');

    const second = await init(plan2);
    expect(second.record.packages).toEqual({ '@t/a': '1.1.0' });
    /* The previous installation stays until removed */
    expect(removeStaleInstallations(workerDir)).toEqual([first.record.depsDir]);
    expect(workerInitState(plan2, workerDir)).toBe('ready');
  });

  it('should need an init again for a version installed again from another archive, and run its new code', async () => {
    const a = writeExtension('@t/a', '1.0.0');
    const plan = planOf({ name: '@t/a', version: '1.0.0', path: a });
    /* Installed before archives were told: its version alone, as before */
    const unstamped = planDigest(plan);
    await init(plan);
    expect(workerInitState(plan, workerDir)).toBe('ready');

    /* The same version from another archive: placePackage replaces the
     * directory, its stamp with it */
    write(path.join(a, 'index.js'), `export const VERSION = 'fixed';`);
    write(path.join(a, INSTALL_STAMP_FILE), 'aaa\n');
    expect(planDigest(plan)).not.toBe(unstamped);
    expect(workerInitState(plan, workerDir)).toBe('needs-init');
    const again = await init(plan);
    const installed = path.join(
      workerDir,
      again.record.depsDir,
      'node_modules',
      '@t',
      'a',
      'index.js',
    );
    expect(fs.readFileSync(installed, 'utf8')).toContain("'fixed'");
    expect(workerInitState(plan, workerDir)).toBe('ready');

    /* The same archive again: nothing to do; another: an init again */
    write(path.join(a, INSTALL_STAMP_FILE), 'aaa\n');
    expect(workerInitState(plan, workerDir)).toBe('ready');
    write(path.join(a, INSTALL_STAMP_FILE), 'bbb\n');
    expect(workerInitState(plan, workerDir)).toBe('needs-init');
  });

  it('should restore the same versions when the installation is gone', async () => {
    const a = writeExtension('@t/a', '1.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib') },
    });
    const plan = planOf({ name: '@t/a', version: '1.0.0', path: a });
    const { record } = await init(plan);
    const deps = path.join(workerDir, record.depsDir);
    const lockfile = path.join(root, 'backup', 'pnpm-lock.yaml');
    write(lockfile, fs.readFileSync(path.join(deps, 'pnpm-lock.yaml'), 'utf8'));

    fs.rmSync(path.join(deps, 'node_modules'), { recursive: true });
    expect(workerInitState(plan, workerDir)).toBe('needs-restore');
    expect(installedWorkerPlan(plan, workerDir)).toBeUndefined();
    await init(plan, { frozen: true });
    expect(workerInitState(plan, workerDir)).toBe('ready');

    /* The installation's lockfile gone as well: the copy kept elsewhere */
    fs.rmSync(deps, { recursive: true });
    await expect(init(plan, { frozen: true })).rejects.toThrow(
      /no lockfile to restore/,
    );
    await init(plan, { frozen: true, lockfile });
    expect(workerInitState(plan, workerDir)).toBe('ready');
  });

  it('should link the host anew when the host is another one, the same versions kept', async () => {
    const a = writeExtension('@t/a', '1.0.0', {
      dependencies: { 'tiny-lib': 'file:' + path.join(root, 'lib') },
      peerDependencies: { '@t/common': '^1.0.0' },
    });
    const plan = planOf({ name: '@t/a', version: '1.0.0', path: a });
    const first = await init(plan);
    expect(first.record.host).toEqual({
      '@t/common': path.join(host, 'node_modules', '@t', 'common'),
    });
    expect(workerInitState(plan, workerDir, host)).toBe('ready');

    /* SyncBridge updated: its packages in another directory */
    const next = path.join(root, 'host-2');
    fs.cpSync(host, next, { recursive: true });
    expect(workerInitState(plan, workerDir, next)).toBe('needs-relink');
    expect(installedWorkerPlan(plan, workerDir, next)).toBeUndefined();
    /* Asked without the host, as before */
    expect(workerInitState(plan, workerDir)).toBe('ready');

    const relinked = await init(plan, { hostDir: next });
    expect(workerInitState(plan, workerDir, next)).toBe('ready');
    expect(relinked.record.packages).toEqual(first.record.packages);
    const aCopy = relinked.plan.packages['@t/a'];
    expect(
      fs.realpathSync(path.join(aCopy.path, '..', '..', '@t', 'common')),
    ).toBe(path.join(next, 'node_modules', '@t', 'common'));
  });

  it('should link anew an installation that did not record its host', async () => {
    const a = writeExtension('@t/a', '1.0.0');
    const plan = planOf({ name: '@t/a', version: '1.0.0', path: a });
    await init(plan);
    const file = path.join(workerDir, 'init.json');
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete old.host;
    fs.writeFileSync(file, JSON.stringify(old));
    expect(workerInitState(plan, workerDir, host)).toBe('needs-relink');
  });

  it('should need nothing for a plan of host packages only', () => {
    const plan: WorkerPlan = {
      packages: {
        '@t/net': {
          name: '@t/net',
          version: '1.0.0',
          path: '/host/node_modules/@t/net',
          entryPoint: '/host/node_modules/@t/net/index.js',
          source: 'module',
        },
      },
      shared: [],
      hostURL: 'file:///host/package.json',
    };
    expect(workerInitState(plan, workerDir)).toBe('not-needed');
    expect(installedWorkerPlan(plan, workerDir)).toBe(plan);
  });
});
