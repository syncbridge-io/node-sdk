import crypto from 'node:crypto';
import { validator } from 'valgen';

/** What marks a value encrypted, before its text */
export const SECRET_PREFIX = 'sbscrt::';

/**
 * A secret value kept encrypted: one already so, encrypted anew (a fresh
 * salt and IV) - its text, not its prefix, taken as encrypted
 */
export const secretEncryptor = (secretKey: string) => {
  return validator((input: string) => {
    if (input.startsWith(SECRET_PREFIX)) {
      input = decryptText(input.substring(SECRET_PREFIX.length), secretKey);
    }
    return SECRET_PREFIX + encryptText(input, secretKey);
  });
};

/** A secret value read: one encrypted, its text; any other, as it is */
export const secretDecryptor = (secretKey: string) => {
  return validator((input: string) => {
    if (input.startsWith(SECRET_PREFIX)) {
      return decryptText(input.substring(SECRET_PREFIX.length), secretKey);
    }
    return input;
  });
};

function encryptText(input: string, secretKey: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(secretKey, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(input, 'utf8'),
    cipher.final(),
  ]);
  // Store salt + IV + EncryptedData
  return Buffer.concat([salt, iv, encrypted]).toString('base64');
}

function decryptText(input: string, secretKey: string): string {
  const data = Buffer.from(input, 'base64');
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const key = crypto.scryptSync(secretKey, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
