import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect } from 'expect';
import type { WorkerPlan } from '../src/plan.js';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const LOADER = path.resolve(import.meta.dirname, '../src/loader.ts');

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * The layout of the Docker image: the engine with its node_modules in one
 * directory, installed extensions in another that Node's lookup never
 * connects to the engine's.
 */
function createLayout(root: string) {
  const host = path.join(root, 'engine');
  write(path.join(host, 'package.json'), '{"name":"engine","type":"module"}');
  for (const name of ['hostdep', 'shareddep']) {
    write(
      path.join(host, 'node_modules', name, 'package.json'),
      `{"name":"${name}","type":"module","exports":{".":"./index.js","./sub":"./sub.js"}}`,
    );
    write(
      path.join(host, 'node_modules', name, 'index.js'),
      `export const where = 'host';`,
    );
    write(
      path.join(host, 'node_modules', name, 'sub.js'),
      `export const where = 'host-sub';`,
    );
  }

  const installed = path.join(root, 'installed_extensions');
  const a = path.join(installed, 'vendor__a@1.0.0');
  write(path.join(a, 'package.json'), '{"name":"@vendor/a","type":"module"}');
  /* A private copy of a shared package, which must not be the one loaded */
  write(
    path.join(a, 'node_modules', 'shareddep', 'package.json'),
    '{"name":"shareddep","type":"module"}',
  );
  write(
    path.join(a, 'node_modules', 'shareddep', 'index.js'),
    `export const where = 'private';`,
  );
  write(
    path.join(a, 'index.js'),
    `import { createRequire } from 'node:module';
import { where as b } from 'sb:@vendor/b';
import { where as bProtocol } from 'sb:@vendor/b/protocol.js';
import { where as hostdep } from 'hostdep';
import { where as shared } from 'shareddep';
import { where as sharedSub } from 'shareddep/sub';
const require = createRequire(import.meta.url);
let required;
try { required = require('sb:@vendor/b').where; } catch (e) { required = e.message; }
let unplanned;
try { await import('sb:@vendor/c'); } catch (e) { unplanned = e.message; }
console.log(JSON.stringify({ b, bProtocol, hostdep, shared, sharedSub, required, unplanned }));
`,
  );
  const b = path.join(installed, 'vendor__b@2.1.0');
  write(path.join(b, 'package.json'), '{"name":"@vendor/b","type":"module"}');
  write(path.join(b, 'index.js'), `export const where = 'b@2.1.0';`);
  write(path.join(b, 'protocol.js'), `export const where = 'b-protocol';`);

  const plan: WorkerPlan = {
    packages: {
      '@vendor/a': {
        name: '@vendor/a',
        version: '1.0.0',
        path: a,
        entryPoint: path.join(a, 'index.js'),
        source: 'installed',
      },
      '@vendor/b': {
        name: '@vendor/b',
        version: '2.1.0',
        path: b,
        entryPoint: path.join(b, 'index.js'),
        source: 'installed',
      },
    },
    shared: ['shareddep'],
    hostURL: pathToFileURL(path.join(host, 'package.json')).href,
  };
  const planFile = path.join(root, 'worker-plan.json');
  write(planFile, JSON.stringify(plan));
  return { entry: path.join(a, 'index.js'), planFile };
}

describe('loader', function () {
  this.timeout(30000);
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-loader-'));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should resolve an extension the way the worker plan says', async () => {
    const { entry, planFile } = createLayout(root);
    const { stdout } = await run(
      process.execPath,
      [
        '--import',
        '@swc-node/register/esm-register',
        '--import',
        pathToFileURL(LOADER).href,
        entry,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, SB_WORKER_PLAN: planFile, NODE_PATH: '' },
      },
    );
    const r = JSON.parse(stdout.trim().split('\n').pop()!);
    /* sb: specifiers go to the planned version, subpaths included */
    expect(r.b).toBe('b@2.1.0');
    expect(r.bProtocol).toBe('b-protocol');
    expect(r.required).toBe('b@2.1.0');
    /* A bare specifier the extension cannot resolve falls back to the host */
    expect(r.hostdep).toBe('host');
    /* A shared package is the host's, even with a private copy beside it */
    expect(r.shared).toBe('host');
    expect(r.sharedSub).toBe('host-sub');
    /* A registry package outside the plan is refused, not looked up */
    expect(r.unplanned).toMatch(/"sb:@vendor\/c" is not in this worker's plan/);
  });
});
