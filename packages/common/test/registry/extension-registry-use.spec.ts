import { expect } from 'expect';
import { ExtensionRegistry } from '../../src/index.js';

describe('ExtensionRegistry.use', () => {
  it('should make a registry current until the use ends', () => {
    const before = ExtensionRegistry.current;
    const mine = new ExtensionRegistry();
    const release = ExtensionRegistry.use(mine);
    expect(ExtensionRegistry.current).toBe(mine);
    release();
    expect(ExtensionRegistry.current).toBe(before);
  });

  it('should bring back the right registry when uses end out of order', () => {
    const before = ExtensionRegistry.current;
    const a = new ExtensionRegistry();
    const b = new ExtensionRegistry();
    const releaseA = ExtensionRegistry.use(a);
    const releaseB = ExtensionRegistry.use(b);
    /* a ends first: b, begun later, stays current */
    releaseA();
    expect(ExtensionRegistry.current).toBe(b);
    releaseB();
    expect(ExtensionRegistry.current).toBe(before);
  });

  it('should end a use once, however often it is ended', () => {
    const before = ExtensionRegistry.current;
    const a = new ExtensionRegistry();
    const b = new ExtensionRegistry();
    const releaseA = ExtensionRegistry.use(a);
    releaseA();
    const releaseB = ExtensionRegistry.use(b);
    releaseA();
    expect(ExtensionRegistry.current).toBe(b);
    releaseB();
    expect(ExtensionRegistry.current).toBe(before);
  });

  it('should send the static methods to the current registry', async () => {
    const mine = new ExtensionRegistry();
    const release = ExtensionRegistry.use(mine);
    try {
      expect(ExtensionRegistry.packages).toBe(mine.packages);
    } finally {
      release();
    }
    expect(ExtensionRegistry.packages).not.toBe(mine.packages);
  });
});
