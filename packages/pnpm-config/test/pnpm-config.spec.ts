import { expect } from 'expect';
import { aliasRange, hooks, isModule, mirrorAlias } from '../src/index.js';

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

describe('isModule / mirrorAlias', () => {
  it("should tell SyncBridge's modules from its SDK", () => {
    expect(isModule('@syncbridge/hl7')).toBe(true);
    expect(isModule('@syncbridge/common')).toBe(false);
    expect(isModule('@syncbridge/pnpm-config')).toBe(false);
    expect(isModule('@acme/hl7')).toBe(false);
  });

  it('should name a module from the mirror, its range spaceless', () => {
    expect(mirrorAlias('@syncbridge/hl7', '>=2.0.1 <3')).toBe(
      'npm:@sbext/syncbridge__hl7@^2.0.1',
    );
  });
});

describe('the readPackage hook', () => {
  const logged: string[] = [];
  const context = { log: (m: string) => logged.push(m) };

  it("should give a mirror package's module peers to it from the mirror, the SDK and the rest left", () => {
    const pkg = hooks.readPackage(
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
      hooks.readPackage(
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
    expect(hooks.readPackage(structuredClone(pkg), context)).toEqual(pkg);
  });
});
