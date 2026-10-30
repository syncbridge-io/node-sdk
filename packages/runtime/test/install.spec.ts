import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MANIFEST_FILE } from '@syncbridge/common';
import AdmZip from 'adm-zip';
import { expect } from 'expect';
import {
  extractPackage,
  INSTALL_STAMP_FILE,
  installDependencies,
  installStamp,
  packageManager,
} from '../src/index.js';

describe('extractPackage', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-extract-spec-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A built package's archive, its code as given */
  const archive = (file: string, code: string) => {
    const zip = new AdmZip();
    zip.addFile(
      'package.json',
      Buffer.from(JSON.stringify({ name: '@acme/a', version: '1.0.0' })),
    );
    zip.addFile(MANIFEST_FILE, Buffer.from('{}'));
    zip.addFile('index.js', Buffer.from(code));
    zip.writeZip(path.join(dir, file));
    return path.join(dir, file);
  };
  const sha256 = (file: string) =>
    createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  it('should tell, in the package, the archive it came from - another archive of the same version, another stamp', () => {
    const first = archive('a1.zip', 'export const A = 1;');
    const second = archive('a2.zip', 'export const A = 2;');
    const one = extractPackage(first, path.join(dir, 'tmp'));
    const two = extractPackage(second, path.join(dir, 'tmp'));
    expect(installStamp(one.directory)).toBe(sha256(first));
    expect(installStamp(two.directory)).toBe(sha256(second));
    expect(installStamp(one.directory)).not.toBe(installStamp(two.directory));
    expect(installStamp(path.join(dir, 'none'))).toBeUndefined();
    expect(fs.existsSync(path.join(one.directory, INSTALL_STAMP_FILE))).toBe(
      true,
    );
  });
});

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
