import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/*
 * A value sealed for one host: only its private key opens it. Its key pair
 * for this (X25519) is apart from its identity's (Ed25519, signing): made
 * on the host when it pairs, its public key told to Console. A value is
 * sealed with a key of its own each time (ephemeral X25519), the shared
 * secret drawn out by HKDF-SHA256, the value enciphered by AES-256-GCM -
 * what Console sends a host, its workers' secrets, never plain on the way.
 */

/** A sealed value's first part: its kind and version */
const SEALED_PREFIX = 'sbseal1.';
const INFO = Buffer.from('syncbridge sealed box v1');
const SPKI = { format: 'der', type: 'spki' } as const;

/** A key pair a host's values are sealed for: its public key told */
export function generateSealKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export(SPKI).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/* An X25519 private key's PKCS#8 DER, but for its 32 bytes */
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

/**
 * A key pair to seal for drawn from a secret, the same each time: one kept
 * by none but drawn when needed - Console's own, from the key it is given
 */
export function sealKeysOf(secret: string): {
  publicKey: string;
  privateKey: string;
} {
  const seed = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.alloc(0),
      Buffer.from('syncbridge seal key v1'),
      32,
    ),
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKey: createPublicKey(privateKey).export(SPKI).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** A public key to seal for, as sent: an X25519 key's SPKI, base64; undefined if not */
export function readSealPublicKey(value: string): Buffer | undefined {
  try {
    const der = Buffer.from(String(value), 'base64');
    const key = createPublicKey({ key: der, ...SPKI });
    return key.asymmetricKeyType === 'x25519' ? der : undefined;
  } catch {
    return;
  }
}

/** The key a sealed value is enciphered with: both public keys bound in */
function sealKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer) {
  return Buffer.from(
    hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), INFO, 32),
  );
}

/** A value sealed for the host whose public key is given */
export function sealFor(publicKey: string, value: string): string {
  const recipientDer = readSealPublicKey(publicKey);
  if (!recipientDer) throw new TypeError('Not a key to seal for');
  const recipient = createPublicKey({ key: recipientDer, ...SPKI });
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralDer = ephemeral.publicKey.export(SPKI);
  const key = sealKey(
    diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }),
    ephemeralDer,
    recipientDer,
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enciphered = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return (
    SEALED_PREFIX +
    Buffer.concat([
      Buffer.from([ephemeralDer.length]),
      ephemeralDer,
      iv,
      cipher.getAuthTag(),
      enciphered,
    ]).toString('base64')
  );
}

/** Whether a value is one sealed */
export const isSealed = (value: string) => value.startsWith(SEALED_PREFIX);

/** A sealed value opened, by the private key it was sealed for */
export function openSealed(privateKey: string, sealed: string): string {
  if (!isSealed(sealed)) throw new TypeError('Not a sealed value');
  const data = Buffer.from(sealed.slice(SEALED_PREFIX.length), 'base64');
  const length = data[0];
  const ephemeralDer = data.subarray(1, 1 + length);
  const iv = data.subarray(1 + length, 13 + length);
  const tag = data.subarray(13 + length, 29 + length);
  const enciphered = data.subarray(29 + length);
  const own = createPrivateKey(privateKey);
  const ownDer = createPublicKey(own).export(SPKI);
  const key = sealKey(
    diffieHellman({
      privateKey: own,
      publicKey: createPublicKey({ key: ephemeralDer, ...SPKI }),
    }),
    ephemeralDer,
    ownDer,
  );
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(enciphered),
    decipher.final(),
  ]).toString('utf8');
}
