import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect } from 'expect';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const REGISTER = path.resolve(import.meta.dirname, '../src/register.ts');

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

function writePackage(dir: string, json: object, index: string) {
  write(path.join(dir, 'package.json'), {
    type: 'module',
    main: './index.js',
    ...json,
  });
  write(path.join(dir, 'index.js'), index);
}

/** Runs a module of the fixture with the register hook, returning its output */
async function runWithHook(entry: string): Promise<string> {
  try {
    const { stdout } = await run(
      process.execPath,
      [
        '--import',
        '@swc-node/register/esm-register',
        '--import',
        pathToFileURL(REGISTER).href,
        entry,
      ],
      { cwd: REPO_ROOT },
    );
    return stdout.trim();
  } catch (e: any) {
    return 'ERROR ' + e.stderr;
  }
}

describe('@syncbridge/syncbuild/register', function () {
  this.timeout(30000);
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-hooks-'));
    const nm = path.join(root, 'node_modules');
    /* The npm mirror's copy of @test/lib, and an incompatible one of @test/old */
    writePackage(
      path.join(nm, '@sbext', 'test__lib'),
      { name: '@sbext/test__lib', version: '1.4.0' },
      `export const where = 'sbext@1.4.0';`,
    );
    write(
      path.join(nm, '@sbext', 'test__lib', 'protocol.js'),
      `export const where = 'sbext-protocol';`,
    );
    writePackage(
      path.join(nm, '@sbext', 'test__old'),
      { name: '@sbext/test__old', version: '0.9.0' },
      `export const where = 'old';`,
    );
    /* A package of the same workspace, not on the mirror */
    writePackage(
      path.join(nm, '@test', 'sibling'),
      { name: '@test/sibling', version: '2.0.0' },
      `export const where = 'workspace@2.0.0';`,
    );
    /* A workspace package, linked, built by tsc to build/ with no
     * package.json there; the mirror has a copy too, which it wins over */
    const ws = path.join(root, 'packages', 'ws');
    write(path.join(ws, 'package.json'), {
      name: '@test/ws',
      version: '3.0.0',
      type: 'module',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
      syncbridge: {},
    });
    write(path.join(ws, 'tsconfig.json'), {
      compilerOptions: { rootDir: 'src', outDir: 'build' },
      include: ['src'],
    });
    write(
      path.join(ws, 'build', 'index.js'),
      `export const where = 'ws-build';`,
    );
    write(
      path.join(ws, 'build', 'proto.js'),
      `export const where = 'ws-build-proto';`,
    );
    fs.mkdirSync(path.join(nm, '@test'), { recursive: true });
    fs.symlinkSync(ws, path.join(nm, '@test', 'ws'), 'junction');
    writePackage(
      path.join(nm, '@sbext', 'test__ws'),
      { name: '@sbext/test__ws', version: '3.0.0' },
      `export const where = 'sbext-ws';`,
    );
    writePackage(
      path.join(root, 'engine'),
      {
        name: '@test/app',
        version: '1.0.0',
        syncbridge: {
          dependencies: {
            '@test/lib': '^1.0.0',
            '@test/sibling': '^2.0.0',
            '@test/old': '^1.0.0',
            '@test/ws': '^3.0.0',
          },
        },
      },
      `import { where as lib } from 'sb:@test/lib';
import { where as protocol } from 'sb:@test/lib/protocol.js';
import { where as sibling } from 'sb:@test/sibling';
import { where as ws } from 'sb:@test/ws';
import { where as wsProto } from 'sb:@test/ws/proto.js';
const errors = {};
for (const s of ['sb:@test/undeclared', 'sb:@test/old']) {
  try { await import(s); } catch (e) { errors[s] = e.message; }
}
console.log(JSON.stringify({ lib, protocol, sibling, ws, wsProto, errors }));
`,
    );
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should resolve sb: imports the way a worker does', async () => {
    const out = await runWithHook(path.join(root, 'engine', 'index.js'));
    const r = JSON.parse(out.split('\n').pop()!);
    /* The mirror's package, subpaths included */
    expect(r.lib).toBe('sbext@1.4.0');
    expect(r.protocol).toBe('sbext-protocol');
    /* No mirror copy: the workspace package of that name */
    expect(r.sibling).toBe('workspace@2.0.0');
    /* A workspace package, from its build, before the mirror's copy */
    expect(r.ws).toBe('ws-build');
    expect(r.wsProto).toBe('ws-build-proto');
    expect(r.errors['sb:@test/undeclared']).toMatch(
      /does not declare "@test\/undeclared" in manifest dependencies/,
    );
    expect(r.errors['sb:@test/old']).toMatch(
      /resolved to version 0\.9\.0, which does not satisfy \^1\.0\.0/,
    );
  });

  it('should refuse a second copy of a registry package', async () => {
    /* A dependency carrying its own, nested copy of @test/lib */
    const dep = path.join(root, 'node_modules', '@sbext', 'test__dep');
    writePackage(
      dep,
      {
        name: '@sbext/test__dep',
        version: '1.0.0',
        syncbridge: { dependencies: { '@test/lib': '^1.0.0' } },
      },
      `export { where } from 'sb:@test/lib';`,
    );
    writePackage(
      path.join(dep, 'node_modules', '@sbext', 'test__lib'),
      { name: '@sbext/test__lib', version: '1.5.0' },
      `export const where = 'nested';`,
    );
    const engine = path.join(root, 'engine2');
    writePackage(
      engine,
      {
        name: '@test/app2',
        version: '1.0.0',
        syncbridge: {
          dependencies: { '@test/lib': '^1.0.0', '@test/dep': '^1.0.0' },
        },
      },
      `import 'sb:@test/lib';\nimport 'sb:@test/dep';\n`,
    );
    expect(await runWithHook(path.join(engine, 'index.js'))).toMatch(
      /Two copies of "@test\/lib" are loaded/,
    );
  });
});
