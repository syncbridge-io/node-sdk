import { expect } from 'expect';
import {
  AppExtension,
  CLASS_METADATA,
  ComponentExtension,
  ExtensionPackage,
  ExtensionRegistry,
  normalizeAppMetadata,
  normalizeComponentMetadata,
} from '../../src/index.js';
import { Cmp1Component } from '../_support/cmp1.component.js';
import { Prc1App } from '../_support/prc1.app.js';

/** A registry holding the given versions of one package, its app and component in each */
async function registryOf(...versions: string[]) {
  const registry = new ExtensionRegistry();
  const app = await normalizeAppMetadata(
    Reflect.getMetadata(CLASS_METADATA, Prc1App),
  );
  const cmp = await normalizeComponentMetadata(
    Reflect.getMetadata(CLASS_METADATA, Cmp1Component),
  );
  for (const version of versions) {
    const pkg = new ExtensionPackage();
    pkg.name = '@test/pre';
    pkg.version = version;
    pkg.apps.push(
      new AppExtension(
        pkg,
        'Listener',
        { ...app, className: 'Listener' },
        Prc1App,
      ),
    );
    pkg.components.push(
      new ComponentExtension(pkg, 'Device', { ...cmp, className: 'Device' }),
    );
    registry.storePackage(pkg);
  }
  return registry;
}

describe('ExtensionRegistry versions', () => {
  it('should find a prerelease asked with no version, when it alone is there', async () => {
    const r = await registryOf('1.4.0-pc.1');
    expect(r.getComponent('@test/pre:Device').version).toBe('1.4.0-pc.1');
    expect(r.getApp('@test/pre:Listener').version).toBe('1.4.0-pc.1');
  });

  it('should take a stable version before a prerelease, with no version asked', async () => {
    const r = await registryOf('1.5.0-beta.1', '1.4.0');
    expect(r.findComponent('@test/pre:Device')?.version).toBe('1.4.0');
    expect(r.findApp('@test/pre:Listener')?.version).toBe('1.4.0');
  });

  it('should keep a range asked as semver reads it', async () => {
    const r = await registryOf('1.4.0-pc.1');
    expect(r.findComponent('@test/pre:Device', '^1.0.0')).toBeUndefined();
    expect(r.findComponent('@test/pre:Device', '1.4.0-pc.1')?.version).toBe(
      '1.4.0-pc.1',
    );
  });
});
