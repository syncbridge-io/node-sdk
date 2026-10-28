import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { aliasRange, pnpmfileSource, usesPnpm } from '../src/pnpm-hook.js';

describe('aliasRange', () => {
  it('should keep a range with no spaces', () => {
    for (const r of ['^2.0.1', '~1.2.0', '2.x', '*', '>=2.0.0'])
      expect(aliasRange(r)).toBe(r);
  });

  it('should write a bounded range spaceless, as the same range', () => {
    expect(aliasRange('>=2.0.1 <3')).toBe('^2.0.1');
    expect(aliasRange('>=2.0.1 <3.0.0')).toBe('^2.0.1');
    expect(aliasRange('>=2.0.1 <3.0.0-0')).toBe('^2.0.1');
    expect(aliasRange('>=1.2.0 <1.3.0')).toBe('~1.2.0');
    expect(aliasRange('>=0.4.2 <0.5.0')).toBe('^0.4.2');
  });

  it('should take any other from its lowest version up to the next major', () => {
    expect(aliasRange('>=2.1.0 <2.5.0')).toBe('^2.1.0');
    expect(aliasRange('^1.0.0 || ^2.0.0')).toBe('^1.0.0');
  });
});

describe("spm's pnpm hook", () => {
  let dir: string;
  let readPackage: (pkg: any, context: any) => any;
  const logged: string[] = [];
  const context = { log: (m: string) => logged.push(m) };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-pnpmfile-'));
    const file = path.join(dir, '.pnpmfile.cjs');
    fs.writeFileSync(file, pnpmfileSource());
    readPackage = createRequire(file)(file).hooks.readPackage;
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("should give a mirror package's module peers to it from the mirror, the SDK and the rest left", () => {
    const pkg = readPackage(
      {
        name: '@sbext/syncbridge__hl7',
        peerDependencies: {
          '@syncbridge/builtins': '>=2.0.1 <3',
          '@syncbridge/common': '^2.3.1',
          hl7v2: '>=2.2.0 <3',
        },
        peerDependenciesMeta: { '@syncbridge/builtins': { optional: false } },
      },
      context,
    );
    expect(pkg).toEqual({
      name: '@sbext/syncbridge__hl7',
      peerDependencies: {
        '@syncbridge/common': '^2.3.1',
        hl7v2: '>=2.2.0 <3',
      },
      peerDependenciesMeta: {},
      dependencies: {
        '@syncbridge/builtins': 'npm:@sbext/syncbridge__builtins@^2.0.1',
      },
    });
    expect(logged.at(-1)).toContain('@syncbridge/builtins >=2.0.1 <3');
  });

  it('should give a module the mirror names by its own name under the name it is imported by too', () => {
    expect(
      readPackage(
        {
          name: '@sbext/acme__driver',
          dependencies: {
            '@sbext/syncbridge__builtins': '^2.1.0',
            '@sbext/acme__lib': '^1.0.0',
            '@syncbridge/hl7': '^2.0.0',
            lodash: '^4.0.0',
          },
        },
        context,
      ).dependencies,
    ).toEqual({
      '@sbext/syncbridge__builtins': '^2.1.0',
      '@sbext/acme__lib': '^1.0.0',
      '@syncbridge/builtins': 'npm:@sbext/syncbridge__builtins@^2.1.0',
      '@syncbridge/hl7': 'npm:@sbext/syncbridge__hl7@^2.0.0',
      lodash: '^4.0.0',
    });
  });

  it("should leave every package not the mirror's as it is", () => {
    const pkg = {
      name: '@acme/app',
      peerDependencies: { '@syncbridge/hl7': '^2.0.0' },
      devDependencies: {
        '@syncbridge/hl7': 'npm:@sbext/syncbridge__hl7@^2.0.0',
      },
    };
    expect(readPackage(structuredClone(pkg), context)).toEqual(pkg);
  });
});

describe('usesPnpm', () => {
  it('should tell a workspace by its lockfile, its workspace file or its packageManager', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-pnpm-'));
    try {
      expect(usesPnpm(root)).toBe(false);
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
      );
      expect(usesPnpm(root)).toBe(true);
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), '');
      expect(usesPnpm(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
