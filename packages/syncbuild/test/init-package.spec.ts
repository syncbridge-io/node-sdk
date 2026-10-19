import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { initPackage } from '../src/init-package.js';

describe('spm init', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-init-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('should create a package with an example app and its test', () => {
    const dir = path.join(root, 'monitor');
    const r = initPackage({ name: '@acme/patient-monitor', directory: dir });
    expect(r.directory).toBe(dir);
    expect(r.files.sort()).toEqual([
      '.gitignore',
      '.mocharc.cjs',
      'README.md',
      'docs/PatientMonitorApp/README.md',
      'package.json',
      'src/index.ts',
      'src/patient-monitor.app.ts',
      'syncbridge-manifest.json',
      'test/patient-monitor.app.spec.ts',
      'tsconfig-build.json',
      'tsconfig.json',
    ]);
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    expect(pkgJson).toMatchObject({
      name: '@acme/patient-monitor',
      type: 'module',
      module: './index.js',
      scripts: {
        test: 'mocha',
        build: 'spm build --tsconfig tsconfig-build.json -o build',
        verify: 'spm verify --tsconfig tsconfig-build.json',
      },
    });
    /* The manifest is in its own file, not in package.json */
    expect(pkgJson.syncbridge).toBeUndefined();
    expect(
      JSON.parse(
        fs.readFileSync(path.join(dir, 'syncbridge-manifest.json'), 'utf8'),
      ),
    ).toEqual({});
    /* The host provides common; the tools are only for development */
    expect(Object.keys(pkgJson.peerDependencies)).toEqual([
      '@syncbridge/common',
    ]);
    expect(pkgJson.dependencies).toBeUndefined();
    expect(Object.keys(pkgJson.devDependencies)).toEqual(
      expect.arrayContaining([
        '@syncbridge/common',
        '@syncbridge/syncbuild',
        '@syncbridge/testing',
        'mocha',
      ]),
    );
    expect(
      fs.readFileSync(path.join(dir, 'src/patient-monitor.app.ts'), 'utf8'),
    ).toContain('export class PatientMonitorApp extends AppBase');
    expect(
      fs.readFileSync(
        path.join(dir, 'test/patient-monitor.app.spec.ts'),
        'utf8',
      ),
    ).toContain('createTestEnv()');
  });

  it('should name the app as asked', () => {
    const dir = path.join(root, 'p');
    initPackage({ name: '@acme/x', directory: dir, app: 'GeB125' });
    expect(fs.existsSync(path.join(dir, 'src/ge-b125.app.ts'))).toBe(true);
  });

  it('should refuse a name the registry does not accept', () => {
    expect(() => initPackage({ name: 'monitor', directory: root })).toThrow(
      /scoped/,
    );
  });

  it('should write nothing over existing files', () => {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    expect(() => initPackage({ name: '@acme/x', directory: root })).toThrow(
      /already has package\.json; nothing was written/,
    );
    expect(fs.readdirSync(root)).toEqual(['package.json']);
  });
});
