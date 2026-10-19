import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

/*
 * A host's identity with SyncBridge Console: a key pair of its own, made on
 * the host - its private key never leaves it. It is paired once, by a code
 * Console gives (short-lived, taken once): the host sends its public key
 * with the code. From then on it proves itself by tokens it signs, each
 * short-lived: no secret travels, and a token seen is no key.
 */

/** Where a host pairs with Console, by a code: on its API's port */
export const HOST_PAIR_PATH = '/hosts/pair';

/**
 * The header a host's token for Console's APIs comes in: a bearer token
 * is a user's, there
 */
export const HOST_TOKEN_HEADER = 'x-sb-host-token';

/** What a token is for: the link (taken once), or Console's other APIs */
export type HostTokenAudience = 'link' | 'api';

/** The longest a token is taken for, by what it is for */
export const HOST_TOKEN_MAX_SECONDS: Record<HostTokenAudience, number> = {
  link: 60,
  api: 15 * 60,
};

/** A token's first part: its kind and version */
const TOKEN_PREFIX = 'sbh1';

/** What a host's token says: who it is, for what, from when until when */
export interface HostTokenPayload {
  /** The host's id */
  h: string;
  /** What it is for */
  a: HostTokenAudience;
  /** Made at, and ends at: seconds */
  iat: number;
  exp: number;
  /** A word of its own: a link's token is taken once */
  n: string;
}

/** A key pair for a host: its public key told, its private key kept */
export function generateHostKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** A public key, as sent: an Ed25519 key's SPKI, base64; undefined if not */
export function readHostPublicKey(value: string): Buffer | undefined {
  try {
    const der = Buffer.from(String(value), 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? der : undefined;
  } catch {
    return;
  }
}

/** A public key's fingerprint, to compare by eye: SHA256:<base64> */
export function hostKeyFingerprint(publicKey: string): string {
  return (
    'SHA256:' +
    createHash('sha256')
      .update(Buffer.from(publicKey, 'base64'))
      .digest('base64')
      .replace(/=+$/, '')
  );
}

/** A token of the host's, signed with its private key */
export function signHostToken(
  privateKey: string,
  input: { hostId: string; audience: HostTokenAudience; seconds?: number },
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: HostTokenPayload = {
    h: input.hostId,
    a: input.audience,
    iat: now,
    exp:
      now +
      Math.min(
        input.seconds ?? HOST_TOKEN_MAX_SECONDS[input.audience],
        HOST_TOKEN_MAX_SECONDS[input.audience],
      ),
    n: randomBytes(12).toString('base64url'),
  };
  const body = `${TOKEN_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signature = sign(null, Buffer.from(body), createPrivateKey(privateKey));
  return `${body}.${signature.toString('base64url')}`;
}

/** What a token says, not checked yet: whose it is, to find its key */
export function readHostToken(token: string): HostTokenPayload | undefined {
  const [prefix, body] = String(token || '').split('.');
  if (prefix !== TOKEN_PREFIX || !body) return;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof p?.h === 'string' &&
      (p.a === 'link' || p.a === 'api') &&
      Number.isInteger(p.iat) &&
      Number.isInteger(p.exp) &&
      typeof p.n === 'string'
      ? (p as HostTokenPayload)
      : undefined;
  } catch {
    return;
  }
}

/**
 * What a token says, if it is signed with the host's key, for this, now:
 * not ended, not made later than now (a minute's clock skew taken), and
 * not lasting longer than its kind may
 */
export function verifyHostToken(
  token: string,
  publicKey: string,
  audience: HostTokenAudience,
): HostTokenPayload | undefined {
  const payload = readHostToken(token);
  if (!payload || payload.a !== audience) return;
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.exp <= now ||
    payload.iat > now + 60 ||
    payload.exp - payload.iat > HOST_TOKEN_MAX_SECONDS[audience]
  )
    return;
  const [prefix, body, signature] = token.split('.');
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.from(`${prefix}.${body}`),
      key,
      Buffer.from(signature || '', 'base64url'),
    )
      ? payload
      : undefined;
  } catch {
    return;
  }
}

/* A pairing code's letters: no 0/O, 1/I/L to mix up */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A new pairing code: 8 letters, as XXXX-XXXX (40 bits) */
export function generatePairingCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_LETTERS[b % CODE_LETTERS.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * A pairing code as typed, taken as given: upper case, spaces and dashes
 * left out; undefined if not a code
 */
export function normalizePairingCode(input: string): string | undefined {
  const code = String(input || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  if (code.length !== 8) return;
  for (const c of code) if (!CODE_LETTERS.includes(c)) return;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
