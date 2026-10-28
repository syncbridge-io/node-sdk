import { createHash } from 'node:crypto';
import { expect } from 'expect';
import {
  generateSealKeys,
  isSealed,
  openSealed,
  sealFor,
  sealForWeb,
  sealKeyFingerprint,
} from '../../src/index.js';
import * as web from '../../src/web.js';

describe('sealed box, made with WebCrypto', () => {
  it("should seal what openSealed opens, as sealFor's - the same layout, its size too", async () => {
    const keys = generateSealKeys();
    for (const value of [
      'hunter2',
      '',
      'çok gizli şifre ✓',
      'x'.repeat(5000),
    ]) {
      const sealed = await sealForWeb(keys.publicKey, value);
      expect(isSealed(sealed)).toBe(true);
      expect(openSealed(keys.privateKey, sealed)).toBe(value);
      expect(sealed.length).toBe(sealFor(keys.publicKey, value).length);
    }
  });

  it('should seal each time anew, and for that key alone', async () => {
    const keys = generateSealKeys();
    const other = generateSealKeys();
    const a = await sealForWeb(keys.publicKey, 'same');
    expect(a).not.toBe(await sealForWeb(keys.publicKey, 'same'));
    expect(() => openSealed(other.privateKey, a)).toThrow();
    await expect(sealForWeb('not a key', 'x')).rejects.toThrow();
  });

  it("should tell a key's fingerprint: SHA-256 of its SPKI, 16 bytes by two", async () => {
    const { publicKey } = generateSealKeys();
    const hex = createHash('sha256')
      .update(Buffer.from(publicKey, 'base64'))
      .digest('hex')
      .slice(0, 32);
    const fingerprint = await sealKeyFingerprint(publicKey);
    expect(fingerprint).toMatch(/^([0-9a-f]{4}:){7}[0-9a-f]{4}$/);
    expect(fingerprint.replaceAll(':', '')).toBe(hex);
  });

  it('should be what the web entry gives, nothing of Node in it', () => {
    expect(Object.keys(web).sort()).toEqual([
      'sealForWeb',
      'sealKeyFingerprint',
    ]);
  });
});
