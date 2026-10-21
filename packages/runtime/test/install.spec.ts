import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { installDependencies, packageManager } from '../src/index.js';

describe('installDependencies', () => {
  let dir: string;
  const install = packageManager.install;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-install-spec-'));
  });

  afterEach(() => {
    packageManager.install = install;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const pkgJson = {
    name: '@acme/hl7',
    version: '2.0.0',
    dependencies: { 'hl7-standard': '^1.0.0' },
    peerDependencies: {
      '@syncbridge/common': '^2.0.0',
      '@syncbridge/builtins': '>=2.0.0 <3',
    },
    peerDependenciesMeta: { '@syncbridge/builtins': { optional: false } },
  };

  it("should not give pnpm the package's own peers - the host's - and keep its package.json as it was", async () => {
    const file = path.join(dir, 'package.json');
    const original = JSON.stringify(pkgJson, null, 2);
    fs.writeFileSync(file, original);
    let seen: any;
    packageManager.install = async ({ cwd }) => {
      seen = JSON.parse(
        fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'),
      );
    };
    await installDependencies({ path: dir } as any, pkgJson, {
      storeDir: path.join(dir, 'store'),
    });
    expect(seen.dependencies).toEqual(pkgJson.dependencies);
    expect(seen.peerDependencies).toBeUndefined();
    expect(seen.peerDependenciesMeta).toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('should remove a failed install, the package with it', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson));
    packageManager.install = async () => {
      throw new Error('pnpm failed');
    };
    await expect(
      installDependencies({ path: dir } as any, pkgJson, {
        storeDir: path.join(dir, 'store'),
      }),
    ).rejects.toThrow('pnpm failed');
    expect(fs.existsSync(dir)).toBe(false);
  });
});
