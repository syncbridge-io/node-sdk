/*
 * The sealed box (sealed-box.ts) made with WebCrypto - a browser's, and
 * Node's own: a value sealed for a key whose private half is a host's,
 * byte for byte as `sealFor` makes it, so `openSealed` opens it. What
 * SyncBridge Console's pages seal a secret with, in the browser of who
 * sets it: Console keeps it sealed, never opens it. Nothing of Node is
 * imported here: `@syncbridge/common/web` takes this alone.
 */

const SEALED_PREFIX = 'sbseal1.';
const INFO = 'syncbridge sealed box v1';

const subtle = () => globalThis.crypto.subtle;
const utf8 = (text: string) => new TextEncoder().encode(text);

function concat(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A value sealed for the key given (an X25519 key's SPKI, base64): `sbseal1.` */
export async function sealForWeb(
  publicKey: string,
  value: string,
): Promise<string> {
  const recipientDer = fromBase64(publicKey);
  const recipient = await subtle().importKey(
    'spki',
    recipientDer,
    { name: 'X25519' },
    false,
    [],
  );
  const ephemeral = (await subtle().generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const ephemeralDer = new Uint8Array(
    await subtle().exportKey('spki', ephemeral.publicKey),
  );
  const shared = await subtle().deriveBits(
    { name: 'X25519', public: recipient },
    ephemeral.privateKey,
    256,
  );
  /* Both public keys bound in, as sealFor binds them */
  const hkdf = await subtle().importKey('raw', shared, 'HKDF', false, [
    'deriveKey',
  ]);
  const key = await subtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: concat(ephemeralDer, recipientDer),
      info: utf8(INFO),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  /* WebCrypto's ciphertext ends with its tag; the box keeps it before */
  const out = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv }, key, utf8(value)),
  );
  const enciphered = out.subarray(0, out.length - 16);
  const tag = out.subarray(out.length - 16);
  return (
    SEALED_PREFIX +
    toBase64(concat([ephemeralDer.length], ephemeralDer, iv, tag, enciphered))
  );
}

/**
 * What a key to seal for is told by, to compare it with what a host or
 * Console shows: SHA-256 of its SPKI, its first 16 bytes in hex, by two
 * ("3f2a:91c0:...")
 */
export async function sealKeyFingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(
    await subtle().digest('SHA-256', fromBase64(publicKey)),
  );
  const hex = Array.from(digest.subarray(0, 16), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return hex.match(/.{4}/g)!.join(':');
}
