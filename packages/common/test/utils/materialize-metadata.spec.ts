import { expect } from 'expect';
import {
  AppExtension,
  CLASS_METADATA,
  ExtensionPackage,
  ExtensionRegistry,
  materializeMetadata,
  materializeMetadataSilent,
  normalizeAppMetadata,
  SbValidationError,
} from '../../src/index.js';
import { Cmp1Component } from '../_support/cmp1.component.js';
import { Cmp1_1Component } from '../_support/cmp1_1.component.js';
import { Prc1App } from '../_support/prc1.app.js';

describe('materializeMetadata', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(Cmp1Component);
    await ExtensionRegistry.registerClass(Cmp1_1Component);
    await ExtensionRegistry.registerClass(Prc1App);
  });

  it('should materialize metadata for a valid profile', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
        },
      },
    };
    const metadata = materializeMetadata(profile as any);
    expect(metadata.className).toBe(Prc1App.className);
    expect(metadata.displayName).toBe('App-1');
    expect(metadata.variables).toBeTruthy();
    expect(metadata.variables!.var1).toBeTruthy();
    expect(metadata.variables!.var2).toBeTruthy();
    expect(metadata.components).toBeTruthy();
    expect(metadata.components!.cmp1).toBeTruthy();
    expect(metadata.components!.cmp1.classUri).toBe(Cmp1Component.uri);
    expect(metadata.components!.cmp1.variables).toBeTruthy();
    expect(metadata.components!.cmp1.variables!.var1).toBeTruthy();
    expect(metadata.components!.cmp2).toBeUndefined(); // Optional and not provided
  });

  it('should materialize metadata silently', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
        },
      },
    };
    const r = materializeMetadataSilent(profile as any);
    expect(r.result).toBe(true);
    if (r.result) {
      expect(r.metadata.className).toBe(Prc1App.className);
    }
  });

  it('should return undefined components as abstract if requested', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
        },
      },
    };
    const metadata = materializeMetadata(profile as any, {
      returnUndefinedComponentsAsAbstract: true,
    });
    expect(metadata.components!.cmp2).toBeTruthy();
    expect(metadata.components!.cmp2.interfaceUri).toBe(Cmp1Component.uri);
    expect(metadata.components!.cmp2.classUri).toBeUndefined();
  });

  it('should throw error if required component is missing', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {},
    };
    try {
      materializeMetadata(profile as any);
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(SbValidationError);
      expect(e.message).toContain('Component "cmp1" should be configured');
    }
  });

  it('should return failure if required component is missing (silent)', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {},
    };
    const r = materializeMetadataSilent(profile as any);
    expect(r.result).toBe(false);
    if (!r.result) {
      expect(
        r.issues.some(i =>
          i.message.includes('Component "cmp1" should be configured'),
        ),
      ).toBeTruthy();
    }
  });

  it('should throw error if component does not implement interface', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: 'invalid-uri',
        },
      },
    };
    // ExtensionRegistry.getComponent will throw if not found, but materializeMetadata catches issues
    const r = materializeMetadataSilent(profile as any);
    expect(r.result).toBe(false);
  });

  it('should throw error if required component is disabled', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          disabled: true,
        },
      },
    };
    try {
      materializeMetadata(profile as any);
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e.message).toContain(
        'Component "cmp1" is disabled but it is required',
      );
    }
  });

  it('should sort variables and respect index', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1_1Component.uri,
        },
      },
    };
    const metadata = materializeMetadata(profile as any);
    const cmp1Variables = Object.keys(metadata.components!.cmp1.variables!);
    // Prc1App.cmp1 uses Cmp1Component which has var1, var2.
    // Profile uses Cmp1_1Component which has var1, var2, var3.
    // materializeMetadata merges variables from registry and metadata.
    expect(cmp1Variables).toContain('var1');
    expect(cmp1Variables).toContain('var2');
    expect(cmp1Variables).toContain('var3');
  });

  it('should remove ignored variables', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
        },
      },
    };
    const metadata = materializeMetadata(profile);
    expect(metadata.components!.cmp1.variables).toBeTruthy();
    expect(metadata.components!.cmp1.variables!.var1).toBeTruthy();
    expect(metadata.components!.cmp1.variables!.varIgnored).toBeDefined();
  });

  it('should remove ignored variables if "removeIgnoredVariables" is true', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
        },
      },
    };
    const metadata = materializeMetadata(profile, {
      removeIgnoredVariables: true,
    });
    expect(metadata.components!.cmp1.variables).toBeTruthy();
    expect(metadata.components!.cmp1.variables!.var1).toBeTruthy();
    expect(metadata.components!.cmp1.variables!.varIgnored).not.toBeDefined();
  });

  it('should use the app version the profile asks for', async () => {
    const base = await normalizeAppMetadata(
      Reflect.getMetadata(CLASS_METADATA, Prc1App),
    );
    for (const version of ['1.0.0', '2.0.0']) {
      const pkg = new ExtensionPackage();
      pkg.name = '@test/versioned';
      pkg.version = version;
      pkg.apps.push(
        new AppExtension(
          pkg,
          Prc1App.name,
          { ...base, displayName: `App v${version}` },
          Prc1App,
        ),
      );
      ExtensionRegistry.storePackage(pkg);
    }
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: '@test/versioned:' + base.className,
      components: { cmp1: { uri: Cmp1Component.uri } },
    };
    expect(
      materializeMetadata({ ...profile, appVersion: '^1.0.0' } as any)
        .displayName,
    ).toBe('App v1.0.0');
    expect(materializeMetadata(profile as any).displayName).toBe('App v2.0.0');
  });
});
