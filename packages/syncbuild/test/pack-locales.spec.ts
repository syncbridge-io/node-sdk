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

  describe('the component slots', () => {
    /** An HL7 app of the dependency's base: its two slots, one within one */
    const slotted = (): any => ({
      dependencies: { '@acme/common': '^1.0.0' },
      apps: [
        {
          className: 'Hl7App',
          displayName: 'HL7',
          components: {
            hl7Client: {
              interfaceUri: '@acme/hl7:Client',
              description: 'HL7 client component.',
            },
            hl7Server: {
              interfaceUri: '@acme/hl7:Server',
              description: 'HL7 server component.',
              components: {
                tls: { interfaceUri: '@acme/net:Tls', description: 'TLS.' },
              },
            },
          },
        },
      ],
    });

    it('should take a slot\'s description - its base\'s through "@extends", its own over it - and pack it', () => {
      write(path.join(depDir, 'locales', 'tr.json'), {
        Hl7DeviceApp: {
          components: {
            hl7Client: { description: 'HL7 istemci bileşeni.' },
            hl7Server: { description: 'HL7 sunucu bileşeni.' },
          },
        },
      });
      write(path.join(pkgDir, 'locales', 'tr.json'), {
        Hl7App: {
          '@extends': '@acme/common:Hl7DeviceApp',
          displayName: 'HL7',
          components: { 'hl7Server.tls': { description: 'TLS.' } },
        },
      });
      const m = slotted();
      const warnings: string[] = [];
      const r = pack(m, warnings);
      expect(r.errors).toEqual([]);
      const { components } = m.apps[0];
      expect(components.hl7Client.description).toEqual({
        en: 'HL7 client component.',
        tr: 'HL7 istemci bileşeni.',
      });
      expect(components.hl7Server.description).toEqual({
        en: 'HL7 server component.',
        tr: 'HL7 sunucu bileşeni.',
      });
      expect(components.hl7Server.components.tls.description).toEqual({
        en: 'TLS.',
        tr: 'TLS.',
      });
      expect(warnings).toEqual([]);
      expect(r.files.tr.Hl7App.components).toEqual({
        hl7Client: { description: 'HL7 istemci bileşeni.' },
        hl7Server: { description: 'HL7 sunucu bileşeni.' },
        'hl7Server.tls': { description: 'TLS.' },
      });
    });

    it("should not take a base's text where the class's code tells none - a slot or a setting redeclared without it - and tell it; one the file tells of the class itself, taken", () => {
      write(path.join(depDir, 'locales', 'tr.json'), {
        Hl7DeviceApp: {
          description: 'HL7 cihazı.',
          components: {
            hl7Client: { description: 'HL7 istemci bileşeni.' },
            hl7Server: { description: 'HL7 sunucu bileşeni.' },
          },
          variables: { host: { label: 'Sunucu', description: 'Adres.' } },
        },
      });
      write(path.join(pkgDir, 'locales', 'tr.json'), {
        Hl7App: {
          '@extends': '@acme/common:Hl7DeviceApp',
          displayName: 'HL7',
          components: { 'hl7Server.tls': { description: 'TLS.' } },
          variables: { port: { description: 'Port numarası.' } },
        },
      });
      const m = slotted();
      /* Redeclared without its description, as an older common left it */
      delete m.apps[0].components.hl7Server.description;
      m.apps[0].variables = {
        host: { label: 'Host' },
        port: { label: 'Port' },
      };
      const warnings: string[] = [];
      const r = pack(m, warnings);
      expect(r.errors).toEqual([]);
      const [app] = m.apps;
      expect(app.components.hl7Server.description).toBeUndefined();
      expect(app.components.hl7Client.description).toEqual({
        en: 'HL7 client component.',
        tr: 'HL7 istemci bileşeni.',
      });
      expect(app.description).toBeUndefined();
      expect(app.variables.host).toEqual({
        label: { en: 'Host', tr: 'Sunucu' },
      });
      /* The file's own: the translation alone, as before */
      expect(app.variables.port.description).toEqual({
        tr: 'Port numarası.',
      });
      expect(warnings).toEqual([
        "locales/tr.json: 3 texts of what a class extends left out, its code telling none in en: Hl7App description, Hl7App's host description, Hl7App's hl7Server component description",
        "locales/tr.json lacks 1 text, shown in en meanwhile: Hl7App's port label",
      ]);
    });

    it('should tell what a slot lacks, and refuse one the class has not, or a text not of a slot', () => {
      write(path.join(pkgDir, 'locales', 'tr.json'), {
        Hl7App: {
          components: {
            hl7Client: { description: 'İstemci.', label: 'x' },
            gone: { description: 'Yok.' },
          },
        },
      });
      const warnings: string[] = [];
      const r = pack(slotted(), warnings);
      expect(r.errors).toEqual([
        'locales/tr.json: Hl7App\'s hl7Client component "label" is not a text of it: description',
        'locales/tr.json: Hl7App has no component "gone"',
      ]);
      expect(warnings).toEqual([
        expect.stringMatching(
          /lacks 3 texts, shown in en meanwhile: Hl7App displayName, Hl7App's hl7Server component description, Hl7App's hl7Server\.tls component description$/,
        ),
      ]);
    });
  });
});

describe("locales/ of a class's dashboards", () => {
  let root: string;
  let pkgDir: string;
  let depDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-dashboards-'));
    pkgDir = path.join(root, 'device');
    depDir = path.join(root, 'common');
    write(path.join(depDir, 'locales', 'tr.json'), {
      IomtBaseApp: {
        dashboards: { monitor: { widgets: { link: { title: 'Bağlantı' } } } },
      },
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** An app of a dashboard as its manifest has it */
  const manifest = (): any => ({
    dependencies: { '@acme/common': '^1.0.0' },
    apps: [
      {
        className: 'MonitorApp',
        displayName: 'Monitor',
        dashboards: {
          monitor: {
            name: 'monitor',
            title: 'Monitor',
            sections: [{ id: 'beds', title: 'Beds', dynamic: true }],
            widgets: [
              { id: 'link', type: 'core.status@1', data: { kind: 'value' } },
              {
                id: 'traffic',
                type: 'core.chart@1',
                title: 'Traffic',
                properties: { unit: 'B/s' },
                data: { kind: 'series', series: ['rx', 'tx'] },
              },
              {
                id: 'devices',
                type: 'core.list@1',
                title: 'Devices',
                properties: {
                  columns: [
                    { field: 'name', title: 'Name' },
                    { field: 'seen' },
                  ],
                },
                data: { kind: 'table' },
              },
            ],
          },
        },
      },
    ],
  });

  const pack = (m: any, warnings: string[] = []) =>
    packLocales(pkgDir, m, 'en', w => warnings.push(w), {
      dependencyDir: name => (name === '@acme/common' ? depDir : undefined),
    });

  it("should take a dashboard's, its sections' and widgets' texts - a unit, columns by field, series by name - by language", () => {
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      MonitorApp: {
        '@extends': '@acme/common:IomtBaseApp',
        dashboards: {
          monitor: {
            title: 'Monitör',
            sections: { beds: { title: 'Yataklar' } },
            widgets: {
              traffic: {
                title: 'Trafik',
                unit: 'B/sn',
                series: { rx: 'Alınan' },
              },
              devices: { columns: { name: 'Ad', seen: 'Son görülme' } },
            },
          },
        },
      },
    });
    const m = manifest();
    const warnings: string[] = [];
    const r = pack(m, warnings);
    expect(r.errors).toEqual([]);
    const d = m.apps[0].dashboards.monitor;
    expect(d.title).toEqual({ en: 'Monitor', tr: 'Monitör' });
    expect(d.sections[0].title).toEqual({ en: 'Beds', tr: 'Yataklar' });
    const [link, traffic, devices] = d.widgets;
    /* Its base's text, its code telling none: left out, told */
    expect(link.title).toBeUndefined();
    expect(traffic.title).toEqual({ en: 'Traffic', tr: 'Trafik' });
    expect(traffic.properties.unit).toEqual({ en: 'B/s', tr: 'B/sn' });
    expect(traffic.properties.labels).toEqual({
      rx: { en: 'rx', tr: 'Alınan' },
    });
    expect(devices.properties.columns).toEqual([
      { field: 'name', title: { en: 'Name', tr: 'Ad' } },
      { field: 'seen', title: { en: 'seen', tr: 'Son görülme' } },
    ]);
    expect(warnings.join('\n')).toMatch(
      /left out.*MonitorApp's dashboard monitor\.widgets\.link title/,
    );
    expect(warnings.join('\n')).toMatch(
      /lacks 2 texts.*MonitorApp displayName, MonitorApp's dashboard monitor\.widgets\.devices title$/,
    );
    /* Packed with what it extends taken in, as the file tells it */
    expect(r.files.tr.MonitorApp.dashboards.monitor.widgets).toMatchObject({
      link: { title: 'Bağlantı' },
      traffic: { title: 'Trafik', series: { rx: 'Alınan' } },
    });
  });

  it('should refuse what the class has not: a dashboard, a widget, a text not of it, a column, a unit its code tells not', () => {
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      MonitorApp: {
        dashboards: {
          nope: { title: 'Yok' },
          monitor: {
            heading: 'Başlık',
            widgets: {
              ghost: { title: 'Hayalet' },
              link: { unit: 'adet' },
              devices: { columns: { age: 'Yaş' } },
            },
          },
        },
      },
    });
    const r = pack(manifest());
    expect(r.errors).toEqual([
      'locales/tr.json: MonitorApp has no dashboard "nope"',
      'locales/tr.json: MonitorApp\'s dashboard "monitor" "heading" is not a text of it: title, description',
      'locales/tr.json: MonitorApp has no dashboard widget "ghost" of "monitor"',
      'locales/tr.json: MonitorApp\'s dashboard widget "link" of "monitor" "unit" is not a text of it: title, description',
      'locales/tr.json: MonitorApp\'s dashboard columns of widget "devices" of "monitor" "age" is not a text of it: name, seen',
    ]);
  });
});
