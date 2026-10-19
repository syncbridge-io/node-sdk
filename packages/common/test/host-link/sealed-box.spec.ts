import { expect } from 'expect';
import {
  generateSealKeys,
  isSealed,
  openSealed,
  readSealPublicKey,
  sealFor,
  sealKeysOf,
} from '../../src/index.js';

describe('sealed box', () => {
  it('should be opened only by the key it was sealed for', () => {
    const host = generateSealKeys();
    const sealed = sealFor(host.publicKey, 'hunter2 ğüşİ');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('hunter2');
    expect(openSealed(host.privateKey, sealed)).toBe('hunter2 ğüşİ');
    expect(() => openSealed(generateSealKeys().privateKey, sealed)).toThrow();
  });

  it('should seal the same value differently each time', () => {
    const host = generateSealKeys();
    expect(sealFor(host.publicKey, 'x')).not.toBe(sealFor(host.publicKey, 'x'));
  });

  it('should refuse a value tampered with', () => {
    const host = generateSealKeys();
    const sealed = sealFor(host.publicKey, 'hunter2');
    const bytes = Buffer.from(sealed.slice('sbseal1.'.length), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() =>
      openSealed(host.privateKey, 'sbseal1.' + bytes.toString('base64')),
    ).toThrow();
  });

  it('should take only an X25519 public key to seal for', () => {
    expect(readSealPublicKey(generateSealKeys().publicKey)).toBeDefined();
    expect(readSealPublicKey('not a key')).toBeUndefined();
    expect(() => sealFor('not a key', 'x')).toThrow();
  });

  it('should draw the same key pair from the same secret, another from another', () => {
    const a = sealKeysOf('console-key');
    expect(sealKeysOf('console-key')).toEqual(a);
    expect(sealKeysOf('other-key').publicKey).not.toBe(a.publicKey);
    expect(openSealed(a.privateKey, sealFor(a.publicKey, 'hunter2'))).toBe(
      'hunter2',
    );
  });
});
