import { expect } from 'expect';
import {
  SECRET_PREFIX,
  secretDecryptor,
  secretEncryptor,
} from '../../src/utils/encrypt-helpers.js';

describe('secret values', () => {
  const key = 'a-secrets-key';

  it('should read back what it encrypted, marked as encrypted', () => {
    const encrypted = secretEncryptor(key)('hunter2') as string;
    expect(encrypted.startsWith(SECRET_PREFIX)).toBe(true);
    expect(encrypted).not.toContain('hunter2');
    expect(secretDecryptor(key)(encrypted)).toBe('hunter2');
  });

  it('should encrypt anew a value already encrypted: saved again unchanged', () => {
    const once = secretEncryptor(key)('hunter2') as string;
    const twice = secretEncryptor(key)(once) as string;
    expect(twice).not.toBe(once);
    expect(secretDecryptor(key)(twice)).toBe('hunter2');
  });

  it('should take a value not encrypted as it is', () => {
    expect(secretDecryptor(key)('plain')).toBe('plain');
  });

  it('should not read with another key', () => {
    const encrypted = secretEncryptor(key)('hunter2') as string;
    /* Refused - or, its padding passing by chance, never the text */
    let read: unknown;
    try {
      read = secretDecryptor('another-key')(encrypted);
    } catch {
      read = undefined;
    }
    expect(read).not.toBe('hunter2');
  });
});
