import { expect } from 'expect';
import {
  generateHostKeys,
  generatePairingCode,
  hostKeyFingerprint,
  normalizePairingCode,
  readHostPublicKey,
  signHostToken,
  verifyHostToken,
} from '../../src/index.js';

describe('a host identity', () => {
  const keys = generateHostKeys();

  it('should sign tokens only its own public key takes, for what they are for', () => {
    const token = signHostToken(keys.privateKey, {
      hostId: 'h1',
      audience: 'link',
    });
    expect(verifyHostToken(token, keys.publicKey, 'link')).toMatchObject({
      h: 'h1',
      a: 'link',
    });
    /* Not for another use, nor of another key */
    expect(verifyHostToken(token, keys.publicKey, 'api')).toBeUndefined();
    expect(
      verifyHostToken(token, generateHostKeys().publicKey, 'link'),
    ).toBeUndefined();
    /* Not changed on the way */
    const [prefix, body, signature] = token.split('.');
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        h: 'h2',
      }),
    ).toString('base64url');
    expect(
      verifyHostToken(
        `${prefix}.${changed}.${signature}`,
        keys.publicKey,
        'link',
      ),
    ).toBeUndefined();
  });

  it('should take no token ended, nor one lasting longer than its kind may', () => {
    const ended = signHostToken(keys.privateKey, {
      hostId: 'h1',
      audience: 'api',
      seconds: -1,
    });
    expect(verifyHostToken(ended, keys.publicKey, 'api')).toBeUndefined();
    /* Asked for longer: made no longer than its kind's most */
    const long = signHostToken(keys.privateKey, {
      hostId: 'h1',
      audience: 'link',
      seconds: 3600,
    });
    const p = verifyHostToken(long, keys.publicKey, 'link')!;
    expect(p.exp - p.iat).toBe(60);
  });

  it('should take an Ed25519 public key alone, and tell its fingerprint', () => {
    expect(readHostPublicKey(keys.publicKey)).toBeDefined();
    expect(readHostPublicKey('not a key')).toBeUndefined();
    expect(hostKeyFingerprint(keys.publicKey)).toMatch(
      /^SHA256:[A-Za-z0-9+/]{43}$/,
    );
  });

  it('should make pairing codes, and take them as typed', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizePairingCode(code.toLowerCase().replace('-', ' '))).toBe(
      code,
    );
    expect(normalizePairingCode('ABCD-123')).toBeUndefined();
    expect(normalizePairingCode('ABCD-OO00')).toBeUndefined();
  });
});
