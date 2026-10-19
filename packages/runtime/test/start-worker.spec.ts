import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type ExtensionPackage,
  normalizeAppMetadata,
} from '@syncbridge/common';
import { expect } from 'expect';
import {
  computeWorkerPlan,
  initWorker,
  loadExtensionPackage,
  startWorker,
  type WorkerProcess,
} from '../src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
/* The worker runs the TypeScript sources, so it needs the same register hook */
const EXEC_ARGV = ['--import', '@swc-node/register/esm-register'];

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** An installed library package with no classes */
function writeLib(dir: string, version: string) {
  write(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@rt/lib',
      version,
      type: 'module',
      module: 'index.js',
    }),
  );
  write(path.join(dir, 'syncbridge-manifest.json'), '{}');
  write(path.join(dir, 'index.js'), `export const LIB_VERSION = '${version}';`);
}

/**
 * An installed app package depending on `@rt/lib`. Its start runs
 * `startBody`, which sees the `@rt/lib` version it loaded.
 */
async function writeApp(dir: string, name: string, startBody: string) {
  const className = 'RtApp';
  write(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      module: 'index.js',
    }),
  );
  write(
    path.join(dir, 'index.js'),
    `import { App, AppBase } from '@syncbridge/common';
import { LIB_VERSION } from 'sb:@rt/lib';
export class ${className} extends AppBase {
  async _start(abortSignal) {
    ${startBody}
    return super._start(abortSignal);
  }
}
App({ className: '${className}' })(${className});
`,
  );
  const metadata = await normalizeAppMetadata({
    classType: 'app',
    uri: `${name}:${className}`,
    className,
    displayName: className,
    version: '1.0.0',
  } as any);
  write(
    path.join(dir, 'syncbridge-manifest.json'),
    JSON.stringify({
      dependencies: { '@rt/lib': '^1.0.0' },
      apps: [{ exportName: className, entryPoint: './index.js', ...metadata }],
    }),
  );
}

describe('startWorker', function () {
  this.timeout(60000);
  let root: string;
  const packages = new Map<string, ExtensionPackage[]>();
  let worker: WorkerProcess | undefined;

  async function install(dir: string) {
    const pkg = await loadExtensionPackage(dir);
    const list = packages.get(pkg.name) || [];
    list.push(pkg);
    list.sort((a, b) => (a.version < b.version ? 1 : -1));
    packages.set(pkg.name, list);
    return pkg;
  }

  async function start(name: string, createOnly?: boolean) {
    const app = packages.get(name)![0].apps![0];
    const plan = computeWorkerPlan({
      app,
      versionsOf: n => packages.get(n),
      isInstalled: () => true,
      hostURL: pathToFileURL(path.join(REPO_ROOT, 'package.json')).href,
    });
    return (worker = await startWorker({
      plan,
      profile: {
        id: 'rt',
        displayName: 'Runtime test',
        appUri: app.uri,
      } as any,
      dataDirectory: path.join(root, 'data-' + name.split('/')[1]),
      execArgv: EXEC_ARGV,
      env: { ...process.env, NODE_PATH: '' },
      createOnly,
    }));
  }

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runtime-worker-'));
    writeLib(path.join(root, 'rt__lib@1.0.0'), '1.0.0');
    writeLib(path.join(root, 'rt__lib@2.0.0'), '2.0.0');
    await install(path.join(root, 'rt__lib@1.0.0'));
    await install(path.join(root, 'rt__lib@2.0.0'));
  });

  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
  });

  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('should run the app with the planned versions', async () => {
    const dir = path.join(root, 'rt__ok@1.0.0');
    await writeApp(dir, '@rt/ok', `this.logger?.info('lib ' + LIB_VERSION);`);
    await install(dir);
    const w = await start('@rt/ok');
    expect(await w.waitForStatus(['started'])).toBe('started');
    expect(w.logs.map(l => l.message)).toContain('lib 1.0.0');
    await w.stop();
    expect(w.status).toBe('stopped');
  });

  it('should report an app that fails to start', async () => {
    const dir = path.join(root, 'rt__bad@1.0.0');
    await writeApp(dir, '@rt/bad', `throw new Error('no device');`);
    await install(dir);
    const w = await start('@rt/bad');
    await expect(w.waitForStatus(['started'], 3000)).rejects.toThrow(
      /The app stopped: no device/,
    );
  });

  it('should only create the app when asked, without starting it', async () => {
    const dir = path.join(root, 'rt__create@1.0.0');
    await writeApp(dir, '@rt/create', `throw new Error('no device');`);
    await install(dir);
    const w = await start('@rt/create', true);
    expect(await w.waitForStatus(['created'])).toBe('created');
    expect(w.failure).toBeUndefined();
  });

  it('should end when its host is gone, not left running', async () => {
    const dir = path.join(root, 'rt__alive@1.0.0');
    /* An app keeping its process busy, as a real one does */
    await writeApp(dir, '@rt/alive', `setInterval(() => undefined, 1000);`);
    await install(dir);
    const app = packages.get('@rt/alive')![0].apps![0];
    const optionsFile = path.join(root, 'host-options.json');
    fs.writeFileSync(
      optionsFile,
      JSON.stringify({
        plan: computeWorkerPlan({
          app,
          versionsOf: n => packages.get(n),
          isInstalled: () => true,
          hostURL: pathToFileURL(path.join(REPO_ROOT, 'package.json')).href,
        }),
        profile: { id: 'rt', displayName: 'Alive', appUri: app.uri },
        dataDirectory: path.join(root, 'data-alive'),
        execArgv: EXEC_ARGV,
        env: { ...process.env, NODE_PATH: '' },
      }),
    );
    const host = spawn(
      process.execPath,
      [
        ...EXEC_ARGV,
        path.join(import.meta.dirname, '_fixtures/worker-host.ts'),
      ],
      {
        env: { ...process.env, SBT_HOST_OPTIONS: optionsFile },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const pid = await new Promise<number>((resolve, reject) => {
      let out = '';
      host.stdout!.on('data', d => {
        out += d;
        const found = /worker (\d+)/.exec(out);
        if (found) resolve(Number(found[1]));
      });
      host.once('exit', code => reject(new Error(`The host ended: ${code}`)));
    });
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive()).toBe(true);
    /* The host crashes: no stop asked of the worker */
    host.kill('SIGKILL');
    for (let i = 0; i < 100 && alive(); i++)
      await new Promise(r => setTimeout(r, 100));
    const left = alive();
    if (left) process.kill(pid, 'SIGKILL');
    expect(left).toBe(false);
  });

  it('should run an app from its worker installation', async () => {
    const dir = path.join(root, 'rt__inst@1.0.0');
    await writeApp(
      dir,
      '@rt/inst',
      `this.logger?.info('lib ' + LIB_VERSION + ' from ' + import.meta.url);`,
    );
    await install(dir);
    const app = packages.get('@rt/inst')![0].apps![0];
    const plan = computeWorkerPlan({
      app,
      versionsOf: n => packages.get(n),
      isInstalled: () => true,
      hostURL: pathToFileURL(path.join(REPO_ROOT, 'package.json')).href,
    });
    const workerDir = path.join(root, 'workers', 'inst');
    const pnpmDir = path.dirname(
      createRequire(import.meta.url).resolve('pnpm/package.json'),
    );
    const installed = await initWorker({
      plan,
      workerDir,
      storeDir: path.join(root, 'workers', '.pnpm-store'),
      hostDir: REPO_ROOT,
      pnpm: [process.execPath, path.join(pnpmDir, 'bin', 'pnpm.mjs')],
    });
    const w = (worker = await startWorker({
      plan: installed.plan,
      profile: {
        id: 'rt',
        displayName: 'Runtime test',
        appUri: app.uri,
      } as any,
      dataDirectory: path.join(root, 'data-inst'),
      execArgv: EXEC_ARGV,
      env: { ...process.env, NODE_PATH: '' },
    }));
    expect(await w.waitForStatus(['started'])).toBe('started');
    const line = w.logs.map(l => l.message).find(m => m.startsWith('lib '));
    expect(line).toMatch(/^lib 1\.0\.0 from /);
    /* Loaded from the installation, not the package's own directory */
    expect(line).toContain(
      pathToFileURL(
        path.join(fs.realpathSync(workerDir), installed.record.depsDir),
      ).href,
    );
  });
});
