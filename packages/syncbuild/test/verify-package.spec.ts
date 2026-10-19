import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { expect } from 'expect';
import { verifyPackage } from '../src/commands/verify-package.js';

const COMMON_DIR = path.resolve(import.meta.dirname, '../../common');
const COMMON_VERSION = JSON.parse(
  fs.readFileSync(path.join(COMMON_DIR, 'package.json'), 'utf8'),
).version;
/* The worker runs the runtime's TypeScript sources */
const EXEC_ARGV = ['--import', '@swc-node/register/esm-register'];

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  );
}

/**
 * A package with one app, whose start runs
 * `startBody` after `imports`. The project has @syncbridge/common in its
 * node_modules, as a developer's project does.
 */
function writePackage(
  dir: string,
  options: { imports?: string; startBody?: string; pkgJson?: object } = {},
) {
  write(path.join(dir, 'package.json'), {
    name: '@vt/prc',
    version: '1.0.0',
    type: 'module',
    module: './index.js',
    peerDependencies: { '@syncbridge/common': '>=0.13.0' },
    ...options.pkgJson,
    syncbridge: {
      ...(options.pkgJson as any)?.syncbridge,
    },
  });
  write(path.join(dir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      rootDir: 'src',
      experimentalDecorators: true,
      skipLibCheck: true,
      paths: { 'sb:@vt/*': ['./node_modules/@sbext/vt__*/index.d.ts'] },
    },
    include: ['src'],
  });
  /* Types only; at run time @syncbridge/common resolves to its sources */
  write(
    path.join(dir, 'src', 'common.d.ts'),
    `declare module '@syncbridge/common' {
  export const App: any;
  export class AppBase {
    logger?: any;
    protected _start(signal?: AbortSignal): Promise<void>;
  }
}`,
  );
  write(
    path.join(dir, 'src', 'index.ts'),
    `import { App, AppBase } from '@syncbridge/common';
${options.imports || ''}
@App({ displayName: 'Verify' })
export class VerifyApp extends AppBase {
  protected async _start(signal?: AbortSignal) {
    ${options.startBody || ''}
    await super._start(signal);
  }
}
`,
  );
  writeCommon(dir);
}

/**
 * @syncbridge/common in the node_modules of `dir`: its sources, so the
 * test needs no build of it - the spm process and the worker both run
 * TypeScript - and the types a component needs
 */
function writeCommon(dir: string) {
  write(
    path.join(dir, 'src', 'component.d.ts'),
    `declare module '@syncbridge/common' {
  export const Component: any;
  export class ComponentBase {}
}`,
  );
  const common = path.join(dir, 'node_modules', '@syncbridge', 'common');
  write(path.join(common, 'package.json'), {
    name: '@syncbridge/common',
    version: COMMON_VERSION,
    type: 'module',
    exports: './index.js',
  });
  write(
    path.join(common, 'index.js'),
    `export * from ${JSON.stringify(pathToFileURL(path.join(COMMON_DIR, 'src/index.ts')).href)};`,
  );
}

/** The npm mirror's copy of registry package @vt/lib, in the project */
function writeMirroredLib(projectDir: string) {
  const dir = path.join(projectDir, 'node_modules', '@sbext', 'vt__lib');
  write(path.join(dir, 'package.json'), {
    name: '@sbext/vt__lib',
    version: '1.0.0',
    type: 'module',
    module: './index.js',
    exports: './index.js',
  });
  /* As the mirror publishes it: the manifest syncbuild wrote */
  write(path.join(dir, 'syncbridge-manifest.json'), { name: '@vt/lib' });
  write(path.join(dir, 'index.js'), `export const LIB = 'lib 1.0.0';`);
  write(path.join(dir, 'index.d.ts'), `export declare const LIB: string;`);
}

const USES_LIB = {
  imports: `import { LIB } from 'sb:@vt/lib';`,
  startBody: `this.logger?.info(LIB);`,
  pkgJson: {
    devDependencies: { '@sbext/vt__lib': '^1.0.0' },
    syncbridge: { dependencies: { '@vt/lib': '^1.0.0' } },
  },
};

describe('spm verify', function () {
  this.timeout(120000);
  let root: string;
  let pkgDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-verify-'));
    pkgDir = path.join(root, 'prc');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const verify = () =>
    verifyPackage({
      packageDir: pkgDir,
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
    });

  it('should load the package and create its app as SyncBridge would', async () => {
    writePackage(pkgDir);
    const r = await verify();
    expect(r.apps).toEqual([
      { app: 'VerifyApp', created: true, components: [] },
    ]);
    expect(r.ok).toBe(true);
  });

  it('should not start the app: what starting needs is the environment', async () => {
    /* A device, a database or a service the sandbox does not have */
    writePackage(pkgDir, {
      startBody: `throw new Error('The database is not reachable');`,
    });
    const r = await verify();
    expect(r.ok).toBe(true);
    expect(r.apps[0].created).toBe(true);
  });

  it('should report a module the package uses without declaring it', async () => {
    writePackage(pkgDir, {
      imports: `import { hello } from 'undeclared-dep';`,
      startBody: `hello();`,
    });
    /* Installed in the project, as a devDependency or a hoisted package is */
    const dep = path.join(pkgDir, 'node_modules', 'undeclared-dep');
    write(path.join(dep, 'package.json'), {
      name: 'undeclared-dep',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    });
    write(path.join(dep, 'index.js'), `export function hello() {}`);
    write(
      path.join(pkgDir, 'src', 'dep.d.ts'),
      `declare module 'undeclared-dep' { export function hello(): void; }`,
    );
    const r = await verify();
    expect(r.ok).toBe(false);
    expect(r.apps[0].message).toMatch(
      /cannot be loaded: Cannot find (module|package) 'undeclared-dep'[\s\S]*"undeclared-dep" is not in the package's dependencies/,
    );
    /* Named after the file that imports it, not the host it was last
     * looked up in */
    expect(r.apps[0].message).toMatch(
      /(imported from|resolved in) \S*extensions\S*index\.js/,
    );
    expect(r.apps[0].message).not.toMatch(/host[/\\]package\.json/);
  });

  it("should load a registry package from the project's npm mirror copy", async () => {
    writePackage(pkgDir, USES_LIB);
    writeMirroredLib(pkgDir);
    const logs: string[] = [];
    const r = await verifyPackage({
      packageDir: pkgDir,
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
      logger: m => logs.push(m),
    });
    expect(r.ok).toBe(true);
    expect(logs).toContain(
      'Using @vt/lib@1.0.0 from ' +
        path.join('node_modules', '@sbext', 'vt__lib'),
    );
  });

  it('should install registry packages given with --with first', async () => {
    writePackage(pkgDir, USES_LIB);
    writeMirroredLib(pkgDir);
    const zip = new AdmZip();
    zip.addFile(
      'package.json',
      Buffer.from(
        JSON.stringify({
          name: '@vt/lib',
          version: '1.1.0',
          type: 'module',
          module: './index.js',
        }),
      ),
    );
    zip.addFile('syncbridge-manifest.json', Buffer.from('{}'));
    zip.addFile('index.js', Buffer.from(`export const LIB = 'lib 1.1.0';`));
    const file = path.join(root, 'vt-lib-1.1.0.zip');
    zip.writeZip(file);
    const logs: string[] = [];
    const r = await verifyPackage({
      packageDir: pkgDir,
      with: [file],
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
      logger: m => logs.push(m),
    });
    expect(r.ok).toBe(true);
    expect(logs).toContain(`Installed @vt/lib@1.1.0 from ${file}`);
    /* The project's copy is not needed, so not used */
    expect(logs.some(l => l.startsWith('Using @vt/lib'))).toBe(false);
  });

  it('should pack and install a registry package of the same workspace', async () => {
    /* @vt/lib is a package of the workspace, linked into the project and
     * built to build/ by the project's own tsc; the mirror's copy is there
     * as well, and not used */
    const libDir = path.join(root, 'lib');
    write(path.join(libDir, 'package.json'), {
      name: '@vt/lib',
      version: '1.0.0',
      type: 'module',
      module: './index.js',
      types: './index.d.ts',
      peerDependencies: { '@syncbridge/common': '>=0.13.0' },
      syncbridge: {},
    });
    write(path.join(libDir, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: 'src',
        outDir: 'build',
        skipLibCheck: true,
      },
      include: ['src'],
    });
    write(
      path.join(libDir, 'src', 'index.ts'),
      `export const LIB: string = 'workspace lib';`,
    );
    write(
      path.join(libDir, 'build', 'index.js'),
      `export const LIB = 'workspace lib';`,
    );
    write(
      path.join(libDir, 'build', 'index.d.ts'),
      `export declare const LIB: string;`,
    );
    writePackage(pkgDir, {
      ...USES_LIB,
      pkgJson: { syncbridge: { dependencies: { '@vt/lib': '^1.0.0' } } },
    });
    const tsFile = path.join(pkgDir, 'tsconfig.json');
    const ts = JSON.parse(fs.readFileSync(tsFile, 'utf8'));
    ts.compilerOptions.paths = { 'sb:@vt/lib': ['../lib/build/index.d.ts'] };
    write(tsFile, ts);
    writeMirroredLib(pkgDir);
    fs.mkdirSync(path.join(pkgDir, 'node_modules', '@vt'), { recursive: true });
    fs.symlinkSync(
      libDir,
      path.join(pkgDir, 'node_modules', '@vt', 'lib'),
      'junction',
    );

    const logs: string[] = [];
    const r = await verifyPackage({
      packageDir: pkgDir,
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
      logger: m => logs.push(m),
    });
    expect(r.apps[0].message).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(logs).toContain(
      'Packing workspace dependency @vt/lib@1.0.0 from ' +
        path.join('..', 'lib'),
    );
    expect(logs).toContain('Installed @vt/lib@1.0.0');
    expect(logs.some(l => l.startsWith('Using @vt/lib'))).toBe(false);
  });

  it('should install an npm package of the same workspace from the workspace', async () => {
    /* @vt/util is an npm package of the workspace, not published yet: the
     * package is verified before the release publishes it */
    const utilDir = path.join(root, 'util');
    write(path.join(utilDir, 'package.json'), {
      name: '@vt/util',
      version: '2.1.0',
      type: 'module',
      exports: './index.js',
    });
    write(path.join(utilDir, 'index.js'), `export const UTIL = 'util 2.1.0';`);
    writePackage(pkgDir, {
      imports: `import { UTIL } from '@vt/util';`,
      startBody: `this.logger?.info(UTIL);`,
      pkgJson: { dependencies: { '@vt/util': '^2.0.0' } },
    });
    write(
      path.join(pkgDir, 'src', 'util.d.ts'),
      `declare module '@vt/util' { export const UTIL: string; }`,
    );
    fs.mkdirSync(path.join(pkgDir, 'node_modules', '@vt'), { recursive: true });
    fs.symlinkSync(
      utilDir,
      path.join(pkgDir, 'node_modules', '@vt', 'util'),
      'junction',
    );

    const logs: string[] = [];
    const r = await verifyPackage({
      packageDir: pkgDir,
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
      logger: m => logs.push(m),
    });
    expect(r.apps[0].message).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(logs).toContain(
      'Using workspace package @vt/util@2.1.0 from ' + path.join('..', 'util'),
    );
  });

  it('should load the classes of a package of components alone', async () => {
    writePackage(pkgDir);
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({ displayName: 'Link' })
export class Link extends ComponentBase {}
`,
    );
    const r = await verify();
    expect(r.apps).toEqual([
      {
        app: '@vt/prc',
        created: true,
        loadOnly: true,
        components: ['@vt/prc:Link'],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it('should say why a package of components alone cannot be loaded', async () => {
    writePackage(pkgDir);
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';
// @ts-ignore
import 'undeclared-dep';

@Component({ displayName: 'Link' })
export class Link extends ComponentBase {}
`,
    );
    /* Installed in the project, not declared */
    const dep = path.join(pkgDir, 'node_modules', 'undeclared-dep');
    write(path.join(dep, 'package.json'), {
      name: 'undeclared-dep',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    });
    write(path.join(dep, 'index.js'), ``);
    const r = await verify();
    expect(r.ok).toBe(false);
    expect(r.apps[0].message).toMatch(
      /"undeclared-dep" is not in the package's dependencies/,
    );
  });

  it('should load an app it cannot create with its default values, telling why', async () => {
    writePackage(pkgDir);
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `import { App, AppBase } from '@syncbridge/common';

@App({ displayName: 'Bridge' })
export class BridgeApp extends AppBase {
  @App.UseComponent({ required: true, uri: '@vt/net:TcpLink' })
  declare readonly peer: any;
}
`,
    );
    const r = await verify();
    expect(r.apps).toEqual([
      {
        app: '@vt/prc',
        created: true,
        loadOnly: true,
        notCreated: ['BridgeApp'],
        components: ['@vt/prc:BridgeApp'],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it('should pack a peer of the same workspace the host provides, not link its sources', async () => {
    /* @vt/base: an extension package of the workspace SyncBridge provides,
     * linked from its sources, whose entry point is not built there */
    const baseDir = path.join(root, 'base');
    write(path.join(baseDir, 'package.json'), {
      name: '@vt/base',
      version: '1.0.0',
      type: 'module',
      module: './index.js',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
      peerDependencies: { '@syncbridge/common': '>=0.13.0' },
      syncbridge: {},
    });
    write(path.join(baseDir, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: 'src',
        declaration: true,
        skipLibCheck: true,
      },
      include: ['src'],
    });
    write(
      path.join(baseDir, 'src', 'index.ts'),
      `export const BASE: string = 'base';`,
    );
    writeCommon(baseDir);
    writePackage(pkgDir, {
      pkgJson: {
        peerDependencies: {
          '@syncbridge/common': '>=0.13.0',
          '@vt/base': '^1.0.0',
        },
      },
    });
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';
// @ts-ignore
import { BASE } from '@vt/base';

@Component({ displayName: BASE })
export class Link extends ComponentBase {}
`,
    );
    fs.mkdirSync(path.join(pkgDir, 'node_modules', '@vt'), { recursive: true });
    fs.symlinkSync(
      baseDir,
      path.join(pkgDir, 'node_modules', '@vt', 'base'),
      'junction',
    );
    /* What packing the package imports: the built copy, as SyncBridge's */
    write(path.join(baseDir, 'index.js'), `export const BASE = 'base';`);
    const logs: string[] = [];
    const r = await verifyPackage({
      packageDir: pkgDir,
      execArgv: EXEC_ARGV,
      permissionModel: false,
      timeout: 10000,
      keep: true,
      logger: m => logs.push(m),
    });
    /* The host's copy is the installed one, not the sources */
    const hostCopy = fs.realpathSync(
      path.join(r.sandbox!, 'host', 'node_modules', '@vt', 'base'),
    );
    /* Its peers are the host's, as beside it in SyncBridge's node_modules -
     * not copies installed for it */
    const peerOfCopy = fs.realpathSync(
      path.join(hostCopy, 'node_modules', '@syncbridge', 'common'),
    );
    const hostCommon = fs.realpathSync(
      path.join(r.sandbox!, 'host', 'node_modules', '@syncbridge', 'common'),
    );
    fs.rmSync(r.sandbox!, { recursive: true, force: true });
    expect(r.apps[0].message).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(hostCopy).not.toBe(fs.realpathSync(baseDir));
    expect(hostCopy).toContain(path.join('extensions', ''));
    expect(peerOfCopy).toBe(hostCommon);
    expect(logs).toContain(
      'Packing @vt/base@1.0.0 from ' +
        path.join('..', 'base') +
        ', as SyncBridge provides it',
    );
  });

  describe('a profile with components SyncBridge provides', () => {
    /* Like @syncbridge/net: an npm package of the project that SyncBridge
     * registers at its start, not a registry package */
    function writeProvidedNet() {
      const dir = path.join(pkgDir, 'node_modules', '@vt', 'net');
      write(path.join(dir, 'package.json'), {
        name: '@vt/net',
        version: '1.4.0',
        type: 'module',
        exports: './index.js',
        /* What the engine has in its node_modules */
        peerDependencies: { '@vt/sock': '^1.0.0' },
      });
      const sock = path.join(pkgDir, 'node_modules', '@vt', 'sock');
      write(path.join(sock, 'package.json'), {
        name: '@vt/sock',
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      });
      write(path.join(sock, 'index.js'), `export const SOCK = 1;`);
      write(
        path.join(dir, 'index.js'),
        `import { Component, ComponentBase } from '@syncbridge/common';
import { SOCK } from '@vt/sock';
export class TcpLink extends ComponentBase {}
Component({ className: 'TcpLink', displayName: 'TCP link' })(TcpLink);
`,
      );
    }

    function writeLinkedPackage() {
      writePackage(pkgDir);
      write(
        path.join(pkgDir, 'src', 'index.ts'),
        `import { App, AppBase } from '@syncbridge/common';

@App({ displayName: 'Verify' })
export class VerifyApp extends AppBase {
  @App.UseComponent({ required: true, uri: '@vt/net:TcpLink' })
  declare readonly link: any;
}
`,
      );
    }

    const profile = (file: string) =>
      write(path.join(root, 'profiles', file), {
        appUri: '@vt/prc:VerifyApp',
        components: { link: { uri: '@vt/net:TcpLink' } },
      });

    it('should register the package from the project, as SyncBridge does', async () => {
      writeLinkedPackage();
      writeProvidedNet();
      profile('a.json');
      const logs: string[] = [];
      const r = await verifyPackage({
        packageDir: pkgDir,
        profile: path.join(root, 'profiles', 'a.json'),
        execArgv: EXEC_ARGV,
        permissionModel: false,
        timeout: 10000,
        logger: m => logs.push(m),
      });
      expect(r.apps[0].message).toBeUndefined();
      expect(r.apps[0].components).toEqual(['link']);
      expect(logs).toContain(
        'Using @vt/net@1.4.0 from the project, as SyncBridge provides it',
      );
    });

    it('should create one app per profile of a directory', async () => {
      writeLinkedPackage();
      writeProvidedNet();
      profile('a.json');
      profile('b.json');
      const r = await verifyPackage({
        packageDir: pkgDir,
        profile: path.join(root, 'profiles'),
        execArgv: EXEC_ARGV,
        permissionModel: false,
        timeout: 10000,
      });
      expect(r.ok).toBe(true);
      expect(r.apps).toHaveLength(2);
    });

    it('should pack and install the package when it is of the same workspace', async () => {
      /* Linked into the project from its sources, not built there */
      writeLinkedPackage();
      const netDir = path.join(root, 'net');
      write(path.join(netDir, 'package.json'), {
        name: '@vt/net',
        version: '1.4.0',
        type: 'module',
        module: './index.js',
        exports: './index.js',
        peerDependencies: { '@syncbridge/common': '>=0.13.0' },
        syncbridge: {},
      });
      write(path.join(netDir, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          rootDir: 'src',
          experimentalDecorators: true,
          skipLibCheck: true,
        },
        include: ['src'],
      });
      write(
        path.join(netDir, 'src', 'index.ts'),
        `import { Component, ComponentBase } from '@syncbridge/common';

@Component({ className: 'TcpLink', displayName: 'TCP link' })
export class TcpLink extends ComponentBase {}
`,
      );
      writeCommon(netDir);
      fs.mkdirSync(path.join(pkgDir, 'node_modules', '@vt'), {
        recursive: true,
      });
      fs.symlinkSync(
        netDir,
        path.join(pkgDir, 'node_modules', '@vt', 'net'),
        'junction',
      );
      profile('a.json');
      const logs: string[] = [];
      const r = await verifyPackage({
        packageDir: pkgDir,
        profile: path.join(root, 'profiles', 'a.json'),
        execArgv: EXEC_ARGV,
        permissionModel: false,
        timeout: 10000,
        logger: m => logs.push(m),
      });
      expect(r.apps[0].message).toBeUndefined();
      expect(r.apps[0].components).toEqual(['link']);
      expect(logs).toContain(
        'Packing workspace dependency @vt/net@1.4.0 from ' +
          path.join('..', 'net'),
      );
    });

    it('should say when the project does not have the package', async () => {
      writeLinkedPackage();
      profile('a.json');
      await expect(
        verifyPackage({
          packageDir: pkgDir,
          profile: path.join(root, 'profiles', 'a.json'),
          execArgv: EXEC_ARGV,
          permissionModel: false,
          timeout: 10000,
        }),
      ).rejects.toThrow(/uses @vt\/net, which the project does not have/);
    });
  });
});
