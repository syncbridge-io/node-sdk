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
) {
  return computeWorkerPlan({
    app: { pkg: prc, version: prc.version } as any,
    metadata: components ? ({ components } as any) : undefined,
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

  it('should share @syncbridge/common and every declared peer', () => {
    const prc = pkg('@abisena/lab', '1.0.0', {}, { '@opra/common': '^1' });
    const r = plan(prc, registry(prc));
    expect(r.shared.sort()).toEqual(['@opra/common', '@syncbridge/common']);
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
