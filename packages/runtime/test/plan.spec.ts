import { ExtensionPackage } from '@syncbridge/common';
import { expect } from 'expect';
import { computeWorkerPlan } from '../src/plan.js';

function pkg(
  name: string,
  version: string,
  deps: Record<string, string> = {},
  peers: Record<string, string> = {},
) {
  const p = new ExtensionPackage();
  p.name = name;
  p.version = version;
  p.path = `/ext/${name}@${version}`;
  p.entryPoint = `/ext/${name}@${version}/index.js`;
  p.registryDependencies = deps;
  p.peerDependencies = peers;
  return p;
}

/** A registry: name -> versions, newest first, the way ExtensionRegistry keeps them */
function registry(...pkgs: ExtensionPackage[]) {
  const map = new Map<string, ExtensionPackage[]>();
  for (const p of pkgs) {
    const list = map.get(p.name) || [];
    list.push(p);
    list.sort((a, b) => (a.version < b.version ? 1 : -1));
    map.set(p.name, list);
  }
  return (name: string) => map.get(name);
}

function plan(
  prc: ExtensionPackage,
  versionsOf: (name: string) => ExtensionPackage[] | undefined,
  components?: any,
  packageVersions?: Record<string, string>,
) {
  return computeWorkerPlan({
    app: { pkg: prc, version: prc.version } as any,
    metadata: components ? ({ components } as any) : undefined,
    packageVersions,
    versionsOf,
    isInstalled: p => p.name !== '@syncbridge/builtins',
    hostURL: 'file:///app/package.json',
  });
}

describe('computeWorkerPlan', () => {
  it('should pick the newest version every requirement accepts', () => {
    const lab = pkg('@abisena/lab', '1.0.0', { '@abisena/iomt': '^1.2.0' });
    const r = plan(
      lab,
      registry(
        lab,
        pkg('@abisena/iomt', '1.1.0'),
        pkg('@abisena/iomt', '1.4.0'),
        pkg('@abisena/iomt', '2.0.0'),
      ),
    );
    expect(Object.keys(r.packages).sort()).toEqual([
      '@abisena/iomt',
      '@abisena/lab',
    ]);
    expect(r.packages['@abisena/iomt'].version).toBe('1.4.0');
    expect(r.packages['@abisena/lab'].source).toBe('installed');
  });

  it('should follow dependencies transitively and intersect the ranges', () => {
    const lab = pkg('@abisena/lab', '1.0.0', {
      '@abisena/iomt': '^1.0.0',
      '@syncbridge/sqb': '>=0.14.5',
    });
    const r = plan(
      lab,
      registry(
        lab,
        pkg('@abisena/iomt', '1.3.0', { '@syncbridge/sqb': '~0.14.0' }),
        pkg('@syncbridge/sqb', '0.14.4'),
        pkg('@syncbridge/sqb', '0.14.9'),
        pkg('@syncbridge/sqb', '0.15.0'),
      ),
    );
    expect(r.packages['@syncbridge/sqb'].version).toBe('0.14.9');
  });

  it("should take a SyncBridge module, a peer once, at a newer version installed than the server's", () => {
    const old = new ExtensionPackage();
    old.assignManifest({
      name: '@abisena/iomt-common',
      version: '1.0.5',
      peerDependencies: {
        '@syncbridge/common': '^2.0.0',
        '@syncbridge/builtins': '^2.0.1',
      },
    });
    old.path = '/ext/iomt-common';
    old.entryPoint = '/ext/iomt-common/index.js';
    /* The server's version has no directory of the extensions' */
    const bundled = pkg('@syncbridge/builtins', '2.0.0');
    bundled.path = '/app/node_modules/@syncbridge/builtins';
    const newer = pkg('@syncbridge/builtins', '2.0.1');
    const r = computeWorkerPlan({
      app: { pkg: old, version: old.version } as any,
      versionsOf: registry(old, bundled, newer),
      isInstalled: p => p.path.startsWith('/ext/'),
      hostURL: 'file:///app/package.json',
    });
    expect(r.packages['@syncbridge/builtins']).toMatchObject({
      version: '2.0.1',
      source: 'installed',
    });
    /* Not the host's: the loader takes it to the planned version */
    expect(r.shared).toEqual(['@syncbridge/common', '@syncbridge/plugin-api']);

    /* The server's, while no newer one is installed */
    const r2 = computeWorkerPlan({
      app: { pkg: old, version: old.version } as any,
      versionsOf: registry(old, pkg('@syncbridge/builtins', '2.1.0')),
      isInstalled: () => false,
      hostURL: 'file:///app/package.json',
    });
    expect(r2.packages['@syncbridge/builtins']).toMatchObject({
      version: '2.1.0',
      source: 'module',
    });
  });

  it('should take the package of every component a profile to migrate names', () => {
    const app = pkg('@abisena/ge', '2.0.0');
    const r = computeWorkerPlan({
      app: { pkg: app, version: app.version } as any,
      profile: {
        components: {
          hl7Server: {
            uri: '@syncbridge/net:TcpServer',
            components: { tls: { uri: '@syncbridge/tls:Tls' } },
          },
        },
      } as any,
      versionsOf: registry(
        app,
        pkg('@syncbridge/net', '1.0.0'),
        pkg('@syncbridge/tls', '1.0.0'),
      ),
      isInstalled: () => true,
      hostURL: 'file:///app/package.json',
    });
    expect(Object.keys(r.packages).sort()).toEqual([
      '@abisena/ge',
      '@syncbridge/net',
      '@syncbridge/tls',
    ]);
  });

  it('should take the app at the version the profile resolved to', () => {
    const v1 = pkg('@abisena/lab', '1.0.0');
    const v2 = pkg('@abisena/lab', '2.0.0');
    const r = plan(v1, registry(v1, v2));
    expect(r.packages['@abisena/lab'].version).toBe('1.0.0');
  });

  it('should include the packages of the components the metadata assigns', () => {
    const prc = pkg('@abisena/lab', '1.0.0');
    const r = plan(prc, registry(prc, pkg('@syncbridge/builtins', '0.14.0')), {
      client: {
        classUri: '@syncbridge/builtins:TcpClient',
        components: {},
      },
    });
    expect(r.packages['@syncbridge/builtins'].source).toBe('module');
  });

  describe('package versions', () => {
    const client = {
      client: { classUri: '@acme/hl7:Hl7Link', components: {} },
    };

    it("should narrow a component's package to the range the profile takes", () => {
      const prc = pkg('@abisena/lab', '1.0.0');
      const r = plan(
        prc,
        registry(
          prc,
          pkg('@acme/hl7', '1.0.0'),
          pkg('@acme/hl7', '1.0.3'),
          pkg('@acme/hl7', '1.1.0'),
          pkg('@acme/hl7', '2.0.0'),
        ),
        client,
        { '@acme/hl7': '~1.0.0' },
      );
      expect(r.packages['@acme/hl7'].version).toBe('1.0.3');
    });

    it("should keep a package within the app's range too", () => {
      const prc = pkg('@abisena/lab', '1.0.0', { '@acme/hl7': '^1.0.0' });
      const r = plan(
        prc,
        registry(
          prc,
          pkg('@acme/hl7', '1.2.0'),
          pkg('@acme/hl7', '1.4.0'),
          pkg('@acme/hl7', '2.0.0'),
        ),
        client,
        { '@acme/hl7': '>=1.2.0 <1.4.0 || >=2.0.0' },
      );
      expect(r.packages['@acme/hl7'].version).toBe('1.2.0');
    });

    it("should report a range that leaves none within the app's, with who asked", () => {
      const prc = pkg('@abisena/lab', '1.0.0', { '@acme/hl7': '^1.0.0' });
      expect(() =>
        plan(
          prc,
          registry(prc, pkg('@acme/hl7', '1.4.0'), pkg('@acme/hl7', '2.0.0')),
          client,
          { '@acme/hl7': '^2.0.0' },
        ),
      ).toThrow(
        /"@acme\/hl7" satisfies .*\^1\.0\.0 \(@abisena\/lab@1\.0\.0\).*\^2\.0\.0 \(its package versions\)/,
      );
    });

    it('should not load a package only its versions name', () => {
      const prc = pkg('@abisena/lab', '1.0.0');
      const r = plan(prc, registry(prc, pkg('@acme/hl7', '1.0.0')), undefined, {
        '@acme/hl7': '1.0.0',
      });
      expect(r.packages['@acme/hl7']).toBeUndefined();
    });

    it("should leave its app's own package to the app's version", () => {
      const v1 = pkg('@abisena/lab', '1.0.0');
      const v2 = pkg('@abisena/lab', '2.0.0');
      const r = plan(v1, registry(v1, v2), undefined, {
        '@abisena/lab': '2.0.0',
      });
      expect(r.packages['@abisena/lab'].version).toBe('1.0.0');
    });
  });

  it("should share SyncBridge's own packages alone, not the peers declared", () => {
    const prc = pkg('@abisena/lab', '1.0.0', {}, { '@opra/common': '^1' });
    const r = plan(prc, registry(prc));
    /* A peer is installed for the worker, at a version its ranges allow */
    expect(r.shared.sort()).toEqual([
      '@syncbridge/common',
      '@syncbridge/plugin-api',
    ]);
    expect(r.hostURL).toBe('file:///app/package.json');
  });

  it('should report a range nothing installed satisfies, with who asked', () => {
    const lab = pkg('@abisena/lab', '1.0.0', {
      '@abisena/iomt': '^1.0.0',
      '@syncbridge/sqb': '^0.15.0',
    });
    const iomt = pkg('@abisena/iomt', '1.0.0', {
      '@syncbridge/sqb': '~0.14.0',
    });
    expect(() =>
      plan(
        lab,
        registry(
          lab,
          iomt,
          pkg('@syncbridge/sqb', '0.14.9'),
          pkg('@syncbridge/sqb', '0.15.1'),
        ),
      ),
    ).toThrow(
      /"@syncbridge\/sqb" satisfies \^0\.15\.0 \(@abisena\/lab@1\.0\.0\), ~0\.14\.0 \(@abisena\/iomt@1\.0\.0\)/,
    );
  });

  it('should report a package that is not installed', () => {
    const lab = pkg('@abisena/lab', '1.0.0', { '@abisena/iomt': '^1.0.0' });
    expect(() => plan(lab, registry(lab))).toThrow(
      /"@abisena\/iomt" is not installed \(required by @abisena\/lab@1\.0\.0\)/,
    );
  });

  it('should refuse a package registered without a directory', () => {
    const prc = pkg('@abisena/lab', '1.0.0');
    (prc as any).path = undefined;
    expect(() => plan(prc, registry(prc))).toThrow(
      /registered without a package directory/,
    );
  });
});
