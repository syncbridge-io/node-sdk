import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { addDependency } from '../src/commands/add-dependency.js';
import { checkPackage } from '../src/commands/check-package.js';

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  );
}

const TSCONFIG = `{
  // kept by spm add
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src"]
}
`;

describe('spm add / spm check', () => {
  let root: string;
  let pkgDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-cmd-'));
    write(path.join(root, 'package-lock.json'), '{}');
    pkgDir = path.join(root, 'packages', 'prc');
    write(path.join(pkgDir, 'package.json'), {
      name: '@test/prc',
      version: '1.0.0',
      type: 'module',
      module: './index.js',
      peerDependencies: { '@syncbridge/common': '>=0.13.0' },
    });
    write(path.join(pkgDir, 'tsconfig.json'), TSCONFIG);
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `import { LIB } from 'sb:@test/lib';\nexport const x = LIB;\n`,
    );
  });

  const readManifest = () =>
    JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'syncbridge-manifest.json'), 'utf8'),
    );

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should declare the dependency, its types and the paths entry', () => {
    const r = addDependency(pkgDir, '@test/lib@^1.0.0');
    expect(r).toEqual({
      name: '@test/lib',
      range: '^1.0.0',
      changed: ['package.json', 'syncbridge-manifest.json', 'tsconfig.json'],
    });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    );
    /* Into the manifest file, the package.json having no syncbridge field */
    expect(pkg.syncbridge).toBeUndefined();
    expect(readManifest()).toEqual({
      dependencies: { '@test/lib': '^1.0.0' },
    });
    expect(pkg.devDependencies).toEqual({ '@sbext/test__lib': '^1.0.0' });
    const ts = fs.readFileSync(path.join(pkgDir, 'tsconfig.json'), 'utf8');
    expect(ts).toContain('// kept by spm add');
    expect(ts).toContain('"sb:@test/*"');
    /* Every node_modules up to the workspace root, the one with a lockfile */
    expect(ts).toContain('"./node_modules/@sbext/test__*/index.d.ts"');
    expect(ts).toContain('"../node_modules/@sbext/test__*/index.d.ts"');
    expect(ts).toContain('"../../node_modules/@sbext/test__*/index.d.ts"');
    expect(ts).not.toContain('"../../../node_modules');
  });

  it('should change nothing when run again', () => {
    addDependency(pkgDir, '@test/lib@^1.0.0');
    expect(addDependency(pkgDir, '@test/lib@^1.0.0').changed).toEqual([]);
  });

  it('should refuse a spec without a valid name or range', () => {
    expect(() => addDependency(pkgDir, '@test/lib')).toThrow(/version range/);
    expect(() => addDependency(pkgDir, 'lodash@^4')).toThrow(/scoped/);
    expect(() => addDependency(pkgDir, '@test/lib@nope!')).toThrow(
      /not a semver range/,
    );
  });

  it('should find nothing wrong once the dependency is added', () => {
    addDependency(pkgDir, '@test/lib@^1.0.0');
    expect(checkPackage(pkgDir)).toEqual({ errors: [], warnings: [] });
  });

  it('should report an sb: import that is not declared', () => {
    const { errors } = checkPackage(pkgDir);
    expect(errors).toEqual([
      expect.stringMatching(
        /src\/index\.ts: imports "sb:@test\/lib", but "@test\/lib" is not in manifest dependencies/,
      ),
    ]);
  });

  it('should report what spm add would have written', () => {
    const pkgFile = path.join(pkgDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.syncbridge = { dependencies: { '@test/lib': '^1.0.0' } };
    write(pkgFile, pkg);
    const { errors } = checkPackage(pkgDir);
    expect(errors).toEqual([
      expect.stringMatching(
        /devDependencies\["@sbext\/test__lib"\] must be "\^1\.0\.0"/,
      ),
      expect.stringMatching(/no "sb:@test\/\*" entry/),
    ]);
  });

  it('should report a package depending on itself', () => {
    const pkgFile = path.join(pkgDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.syncbridge = { dependencies: { '@test/prc': '^1.0.0' } };
    write(pkgFile, pkg);
    write(path.join(pkgDir, 'src', 'index.ts'), 'export const x = 1;\n');
    expect(checkPackage(pkgDir).errors).toEqual([
      'manifest dependencies: "@test/prc" is the package itself',
    ]);
  });

  it("should refuse the npm mirror's copy as a runtime dependency", () => {
    const pkgFile = path.join(pkgDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { '@sbext/test__lib': '^1.0.0' };
    write(pkgFile, pkg);
    write(path.join(pkgDir, 'src', 'index.ts'), 'export const x = 1;\n');
    expect(checkPackage(pkgDir).errors).toEqual([
      expect.stringMatching(
        /dependencies\["@sbext\/test__lib"\] is the npm mirror's copy .* declare "@test\/lib" in manifest dependencies instead/,
      ),
    ]);
  });

  it('should refuse a private copy of the host and a registry package from npm', () => {
    addDependency(pkgDir, '@test/lib@^1.0.0');
    const pkgFile = path.join(pkgDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.name = 'not-scoped';
    pkg.dependencies = {
      '@syncbridge/common': '^0.13.0',
      '@test/lib': '^1.0.0',
    };
    delete pkg.peerDependencies;
    write(pkgFile, pkg);
    const { errors, warnings } = checkPackage(pkgDir);
    expect(errors).toEqual([
      expect.stringMatching(/"name": .*scoped/),
      expect.stringMatching(/"@test\/lib" is a registry package/),
      expect.stringMatching(/"@syncbridge\/common" must be a peerDependency/),
    ]);
    expect(warnings).toHaveLength(1);
  });

  it('should warn about a @syncbridge package among the dependencies', () => {
    const pkgFile = path.join(pkgDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { '@syncbridge/net': '^1.0.0' };
    write(pkgFile, pkg);
    write(path.join(pkgDir, 'src', 'index.ts'), 'export const x = 1;\n');
    const { errors, warnings } = checkPackage(pkgDir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      expect.stringMatching(
        /dependencies\["@syncbridge\/net"\]: .* declare it in peerDependencies/,
      ),
    ]);
  });

  describe('a package of the same workspace', () => {
    const libDir = () => path.join(root, 'packages', 'lib');

    beforeEach(() => {
      /* Not on the npm mirror: linked by the workspace, built to build/ */
      write(path.join(libDir(), 'package.json'), {
        name: '@test/lib',
        version: '1.2.0',
        type: 'module',
        module: './index.js',
        types: './index.d.ts',
        syncbridge: {},
      });
      write(path.join(libDir(), 'tsconfig.json'), {
        compilerOptions: { rootDir: 'src', outDir: 'build' },
        include: ['src'],
      });
      write(path.join(libDir(), 'src', 'index.ts'), 'export const LIB = 1;\n');
      const link = path.join(root, 'node_modules', '@test', 'lib');
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(libDir(), link, 'junction');
    });

    it('should map its types to its build, with no @sbext devDependency', () => {
      const r = addDependency(pkgDir, '@test/lib@^1.2.0');
      expect(r.changed).toEqual(['syncbridge-manifest.json', 'tsconfig.json']);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
      );
      expect(readManifest()).toEqual({
        dependencies: { '@test/lib': '^1.2.0' },
      });
      expect(pkg.devDependencies).toBeUndefined();
      const ts = fs.readFileSync(path.join(pkgDir, 'tsconfig.json'), 'utf8');
      expect(ts).toContain(
        '"sb:@test/lib": [\n        "../lib/build/index.d.ts"',
      );
      expect(ts).not.toContain('@sbext');
      expect(addDependency(pkgDir, '@test/lib@^1.2.0').changed).toEqual([]);
    });

    it('should find nothing wrong once it is added', () => {
      addDependency(pkgDir, '@test/lib@^1.2.0');
      expect(checkPackage(pkgDir)).toEqual({ errors: [], warnings: [] });
    });

    it('should report a range its version does not satisfy', () => {
      addDependency(pkgDir, '@test/lib@^2.0.0');
      expect(checkPackage(pkgDir).errors).toEqual([
        expect.stringMatching(
          /the workspace has version 1\.2\.0, which does not satisfy \^2\.0\.0/,
        ),
      ]);
    });
  });
});
