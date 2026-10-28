import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { packLocales } from '../src/builder/pack-locales.js';

function write(file: string, content: object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
}

describe("locales/ extending a registry dependency's classes", () => {
  let root: string;
  let pkgDir: string;
  let depDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-locales-'));
    pkgDir = path.join(root, 'device');
    depDir = path.join(root, 'common');
    /* The dependency's locales/ as packed: its "@extends" taken in */
    write(path.join(depDir, 'locales', 'tr.json'), {
      IomtBaseApp: {
        displayName: 'Temel uygulama',
        description: 'Cihazdan HBYS’ye.',
        variables: {
          host: { label: 'Sunucu' },
          'tests.code': { label: 'Kod' },
        },
      },
      TestConfigurationVariables: {
        variables: { code: { label: 'Kod' }, unit: { label: 'Birim' } },
      },
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** An app built on the dependency's base: its settings as its code has them */
  const manifest = (): any => ({
    dependencies: { '@acme/common': '^1.0.0' },
    apps: [
      {
        className: 'DashApp',
        displayName: 'Dash',
        description: 'From the device to the HIS.',
        variables: {
          host: { label: 'Host' },
          tests: {
            label: 'Tests',
            variables: { code: { label: 'Code' }, unit: { label: 'Unit' } },
          },
          breath: {
            label: 'Breath channels',
            variables: { code: { label: 'Code' }, unit: { label: 'Unit' } },
          },
        },
      },
    ],
  });

  const pack = (m: any, warnings: string[] = []) =>
    packLocales(pkgDir, m, 'en', w => warnings.push(w), {
      dependencyDir: name => (name === '@acme/common' ? depDir : undefined),
    });

  it("should take a dependency's base class's texts, and a class of settings' for a group of its own", () => {
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      DashApp: {
        '@extends': '@acme/common:IomtBaseApp',
        displayName: 'Dash monitörü',
        variables: {
          tests: { label: 'Testler' },
          breath: {
            '@extends': '@acme/common:TestConfigurationVariables',
            label: 'Nefes kanalları',
          },
        },
      },
    });
    const m = manifest();
    const warnings: string[] = [];
    const r = pack(m, warnings);
    expect(r.errors).toEqual([]);
    const [app] = m.apps as any[];
    expect(app.displayName).toEqual({ en: 'Dash', tr: 'Dash monitörü' });
    expect(app.description).toEqual({
      en: 'From the device to the HIS.',
      tr: 'Cihazdan HBYS’ye.',
    });
    expect(app.variables.host.label).toEqual({ en: 'Host', tr: 'Sunucu' });
    expect(app.variables.tests.variables.code.label).toEqual({
      en: 'Code',
      tr: 'Kod',
    });
    expect(app.variables.breath.variables.unit.label).toEqual({
      en: 'Unit',
      tr: 'Birim',
    });
    /* What neither tells: told as lacking */
    expect(warnings).toEqual([
      expect.stringMatching(
        /lacks 1 text, shown in en meanwhile: DashApp's tests\.unit label$/,
      ),
    ]);
  });

  it('should tell what it cannot take: an undeclared dependency, one not installed, a class not of the package, a loop', () => {
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      DashApp: {
        '@extends': '@acme/other:Base',
        variables: {
          tests: { '@extends': 'Nowhere' },
          breath: { '@extends': 7 },
        },
      },
    });
    const m = manifest();
    m.dependencies['@acme/gone'] = '^1.0.0';
    expect(pack(m).errors).toEqual([
      "locales/tr.json: DashApp's breath @extends names no class",
      'locales/tr.json: @extends "@acme/other:Base": @acme/other is not among the package\'s registry dependencies',
      'locales/tr.json: @extends "Nowhere": not a class of the package',
    ]);
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      DashApp: { '@extends': '@acme/gone:Base' },
    });
    expect(pack(manifest() as any).errors).toEqual([
      'locales/tr.json: @extends "@acme/gone:Base": @acme/gone is not among the package\'s registry dependencies',
    ]);
    const gone = manifest() as any;
    gone.dependencies['@acme/gone'] = '^1.0.0';
    expect(pack(gone).errors).toEqual([
      'locales/tr.json: @extends: @acme/gone is not installed - its texts cannot be read',
    ]);
  });

  it('should tell an "@extends" that goes round', () => {
    write(path.join(depDir, 'locales', 'tr.json'), {
      A: { '@extends': 'B' },
      B: { '@extends': 'A' },
    });
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      DashApp: { '@extends': '@acme/common:A' },
    });
    expect(pack(manifest()).errors).toEqual([
      'locales/tr.json: @extends goes round: DashApp -> @acme/common:A -> @acme/common:B -> @acme/common:A',
    ]);
  });
});
