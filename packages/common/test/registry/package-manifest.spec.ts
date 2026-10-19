import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import {
  ExtensionPackage,
  MANIFEST_FILE,
  readExtensionManifest,
} from '../../src/index.js';

describe('package manifest', () => {
  describe('ExtensionPackage.assignManifest', () => {
    it('should take identity from package.json and dependencies from the manifest', () => {
      const pkg = new ExtensionPackage();
      pkg.assignManifest(
        {
          name: '@abisena/iomt-common',
          version: '1.2.0',
          description: 'IoMT',
          peerDependencies: { '@syncbridge/common': '^0.13.7' },
        },
        { dependencies: { '@syncbridge/sqb': '^0.14.0' } },
      );
      expect(pkg.name).toBe('@abisena/iomt-common');
      expect(pkg.version).toBe('1.2.0');
      expect(pkg.description).toBe('IoMT');
      expect(pkg.registryDependencies).toEqual({
        '@syncbridge/sqb': '^0.14.0',
      });
      expect(pkg.peerDependencies).toEqual({ '@syncbridge/common': '^0.13.7' });
    });

    it("should prefer the manifest's name and default the dependencies", () => {
      const pkg = new ExtensionPackage();
      pkg.assignManifest(
        { name: 'npm-name', version: '1.0.0' },
        { name: '@vendor/registry-name' },
      );
      expect(pkg.name).toBe('@vendor/registry-name');
      expect(pkg.registryDependencies).toEqual({});
      expect(pkg.peerDependencies).toEqual({});
    });
  });

  describe('readExtensionManifest', () => {
    let dir: string;
    const pkgJson = { name: '@v/p', version: '1.0.0' };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-manifest-'));
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('should read syncbridge-manifest.json', () => {
      fs.writeFileSync(
        path.join(dir, MANIFEST_FILE),
        JSON.stringify({ dependencies: { '@v/lib': '^1.0.0' }, hooks: [] }),
      );
      expect(readExtensionManifest(dir, pkgJson)).toEqual({
        manifest: { dependencies: { '@v/lib': '^1.0.0' }, hooks: [] },
        source: 'file',
        unknownFields: ['hooks'],
      });
    });

    it('should read the syncbridge field of package.json', () => {
      expect(
        readExtensionManifest(dir, {
          ...pkgJson,
          syncbridge: { name: '@v/x' },
        }),
      ).toEqual({
        manifest: { name: '@v/x' },
        source: 'package.json',
        unknownFields: [],
      });
    });

    it('should find no manifest in a package that is not an extension', () => {
      expect(readExtensionManifest(dir, pkgJson)).toBeUndefined();
    });

    it('should refuse a manifest in both places', () => {
      fs.writeFileSync(path.join(dir, MANIFEST_FILE), '{}');
      expect(() =>
        readExtensionManifest(dir, { ...pkgJson, syncbridge: {} }),
      ).toThrow(/both in syncbridge-manifest\.json/);
    });
  });
});
