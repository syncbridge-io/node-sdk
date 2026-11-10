import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect } from 'expect';
import {
  checkWorkerUpdates,
  initWorker,
  INSTALL_STAMP_FILE,
  installedWorkerPlan,
  lockedVersions,
  packageManager,
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

  it('should install the packages SyncBridge comes with too, their peers resolved in the installation, not from the host', async () => {
    /* A package the host comes with, and the host's own copy of the
     * package it peers on */
    const hostModules = path.join(host, 'node_modules', '@t');
    write(path.join(hostModules, 'net', 'package.json'), {
      name: '@t/net',
      version: '1.0.0',
      type: 'module',
      module: './index.js',
      peerDependencies: { '@t/codec': '^2.0.0' },
    });
    write(path.join(hostModules, 'net', 'index.js'), `export {};`);
    write(path.join(hostModules, 'codec', 'package.json'), {
      name: '@t/codec',
      version: '2.0.0',
      type: 'module',
    });
    /* The newer one the plan takes */
    const codec = writeExtension('@t/codec', '2.1.0');
    const app = writeExtension('@t/app', '1.0.0', {
      peerDependencies: { '@t/codec': '^2.0.0' },
    });
    const plan = planOf(
      { name: '@t/app', version: '1.0.0', path: app },
      { name: '@t/codec', version: '2.1.0', path: codec },
    );
    plan.packages['@t/net'] = {
      name: '@t/net',
      version: '1.0.0',
      path: path.join(hostModules, 'net'),
      entryPoint: path.join(hostModules, 'net', 'index.js'),
      source: 'module',
    };
    expect(workerInitState(plan, workerDir)).toBe('needs-init');

    const r = await init(plan);
    expect(r.record.packages).toEqual({
      '@t/app': '1.0.0',
      '@t/codec': '2.1.0',
      '@t/net': '1.0.0',
    });
    expect(r.record.host).toEqual({
      '@t/common': path.join(hostModules, 'common'),
    });
    const deps = path.join(workerDir, r.record.depsDir);
    const net = r.plan.packages['@t/net'];
    expect(net.source).toBe('installed');
    expect(net.path.startsWith(deps)).toBe(true);
    /* Its peer is the installation's one copy, the app's too - not the
     * host's older one */
    const codecOf = (p: string) =>
      fs.realpathSync(path.join(p, '..', '..', '@t', 'codec'));
    expect(codecOf(net.path)).toBe(r.plan.packages['@t/codec'].path);
    expect(codecOf(r.plan.packages['@t/app'].path)).toBe(
      r.plan.packages['@t/codec'].path,
    );
    expect(r.duplicates).toEqual([]);
  });

  it('should give pnpm the packages whose install scripts run, by name, as allowBuilds', async () => {
    const a = writeExtension('@t/a', '1.0.0');
    let settings: any;
    const original = packageManager.install;
    packageManager.install = async ({ cwd }) => {
      settings = JSON.parse(
        fs.readFileSync(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8'),
      );
      fs.mkdirSync(path.join(cwd, 'node_modules', '@t'), { recursive: true });
      fs.symlinkSync(a, path.join(cwd, 'node_modules', '@t', 'a'));
    };
    try {
      await init(planOf({ name: '@t/a', version: '1.0.0', path: a }), {
        allowBuilds: ['oracledb', '@pinggy/pinggy'],
      });
    } finally {
      packageManager.install = original;
    }
    expect(settings).toEqual({
      allowBuilds: { '@pinggy/pinggy': true, oracledb: true },
    });
  });

  it('should install from an updated lockfile as it is, frozen', async () => {
    const a = writeExtension('@t/a', '1.0.0');
    const plan = planOf({ name: '@t/a', version: '1.0.0', path: a });
    const updated = path.join(root, 'updated-pnpm-lock.yaml');
    write(updated, "lockfileVersion: '9.0'\n# updated\n");
    let seen: { lock: string; args?: string[] } | undefined;
    const original = packageManager.install;
    packageManager.install = async ({ cwd, args }) => {
      seen = {
        lock: fs.readFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'utf8'),
        args,
      };
      fs.mkdirSync(path.join(cwd, 'node_modules', '@t'), { recursive: true });
      fs.symlinkSync(a, path.join(cwd, 'node_modules', '@t', 'a'));
    };
    try {
      await init(plan, { updatedLockfile: updated });
    } finally {
      packageManager.install = original;
    }
    expect(seen?.lock).toContain('# updated');
    expect(seen?.args).toContain('--frozen-lockfile');
  });

  it('should need nothing for a plan of no packages on disk - classes registered directly', () => {
    const plan: WorkerPlan = {
      packages: {
        '@t/direct': {
          name: '@t/direct',
          version: '1.0.0',
          path: '',
          entryPoint: '',
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

describe('lockedVersions', () => {
  it("should read a lockfile's packages by name, those from a directory or a link not", () => {
    const lock = [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '  .:',
      '    dependencies:',
      '      hl7v2:',
      '        specifier: ^2',
      '        version: 2.3.1',
      '',
      'packages:',
      '',
      "  '@jsopen/objects@2.3.4':",
      '    resolution: {integrity: sha512-x}',
      '',
      "  '@t/app@file:../app':",
      '    resolution: {directory: ../app, type: directory}',
      '',
      '  hl7v2@2.3.1:',
      '    resolution: {integrity: sha512-y}',
      '',
      '  tslib@1.14.1:',
      '    resolution: {integrity: sha512-z}',
      '',
      '  tslib@2.9.1:',
      '    resolution: {integrity: sha512-w}',
      '',
      'snapshots:',
      '',
      '  hl7v2@2.3.1(hl7v2-dictionary@2.3.1): {}',
    ].join('\n');
    const v = lockedVersions(lock);
    expect([...v.keys()].sort()).toEqual(['@jsopen/objects', 'hl7v2', 'tslib']);
    expect([...v.get('tslib')!]).toEqual(['1.14.1', '2.9.1']);
  });
});

describe('checkWorkerUpdates', function () {
  this.timeout(60000);
  let workerDir: string;
  const original = packageManager.updateLockfile;

  const lock = (versions: Record<string, string>) =>
    [
      "lockfileVersion: '9.0'",
      '',
      'packages:',
      '',
      ...Object.entries(versions).flatMap(([n, v]) => [
        `  ${n}@${v}:`,
        '    resolution: {integrity: sha512-x}',
        '',
      ]),
    ].join('\n');

  beforeEach(() => {
    workerDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'sb-worker-updates-')),
    );
    write(path.join(workerDir, 'init.json'), {
      digest: 'd1',
      packages: {},
      depsDir: 'deps-d1',
      initializedAt: new Date().toISOString(),
      duration: 1,
    });
    write(path.join(workerDir, 'deps-d1', 'package.json'), {
      name: 'sb-worker',
    });
    write(
      path.join(workerDir, 'deps-d1', 'pnpm-lock.yaml'),
      lock({ hl7v2: '2.3.1', 'hl7v2-net': '2.3.1', tslib: '2.9.1' }),
    );
  });

  afterEach(() => {
    packageManager.updateLockfile = original;
    fs.rmSync(workerDir, { recursive: true, force: true });
  });

  it('should tell what the ranges let move, resolved in a copy - the installation untouched - and keep that lockfile', async () => {
    const before = fs.readFileSync(
      path.join(workerDir, 'deps-d1', 'pnpm-lock.yaml'),
      'utf8',
    );
    packageManager.updateLockfile = async ({ cwd, args }) => {
      expect(cwd.startsWith(workerDir)).toBe(true);
      /* Each locked package named: the peers too */
      expect(args).toEqual(['hl7v2', 'hl7v2-net', 'tslib']);
      expect(fs.existsSync(path.join(cwd, 'package.json'))).toBe(true);
      fs.writeFileSync(
        path.join(cwd, 'pnpm-lock.yaml'),
        lock({ hl7v2: '2.3.2', 'hl7v2-net': '2.3.2', tslib: '2.9.1' }),
      );
    };
    const r = await checkWorkerUpdates({ workerDir, storeDir: '/store' });
    expect(r.updates).toEqual([
      { name: 'hl7v2', from: ['2.3.1'], to: ['2.3.2'] },
      { name: 'hl7v2-net', from: ['2.3.1'], to: ['2.3.2'] },
    ]);
    expect(fs.readFileSync(r.lockfile!, 'utf8')).toContain('hl7v2@2.3.2:');
    expect(
      fs.readFileSync(
        path.join(workerDir, 'deps-d1', 'pnpm-lock.yaml'),
        'utf8',
      ),
    ).toBe(before);
    /* Its copy gone */
    expect(
      fs.readdirSync(workerDir).filter(f => f.startsWith('.check-')),
    ).toEqual([]);
  });

  it('should tell nothing, and keep no lockfile, when nothing moves', async () => {
    fs.writeFileSync(path.join(workerDir, 'updated-pnpm-lock.yaml'), 'old');
    packageManager.updateLockfile = async () => {};
    const r = await checkWorkerUpdates({ workerDir, storeDir: '/store' });
    expect(r).toEqual({ updates: [] });
    expect(fs.existsSync(path.join(workerDir, 'updated-pnpm-lock.yaml'))).toBe(
      false,
    );
  });

  it('should have nothing to update for a worker not initialized', async () => {
    fs.rmSync(path.join(workerDir, 'init.json'));
    packageManager.updateLockfile = async () => {
      throw new Error('not to be run');
    };
    expect(await checkWorkerUpdates({ workerDir, storeDir: '/store' })).toEqual(
      { updates: [] },
    );
  });
});
