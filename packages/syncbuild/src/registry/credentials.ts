import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { SbError } from '@syncbridge/common';

/** The registry spm talks to when none is told */
export const DEFAULT_REGISTRY = 'https://registry.syncbridge.io';

/** Where spm keeps what it signed in with: SB_CONFIG_DIR, or ~/.syncbridge */
export function configDir(): string {
  return process.env.SB_CONFIG_DIR || path.join(os.homedir(), '.syncbridge');
}

const credentialsFile = () => path.join(configDir(), 'credentials.json');

/** What spm keeps of a sign-in to a registry */
export interface RegistryCredentials {
  /** The issuer it signed in at, and its client */
  issuer: string;
  clientId: string;
  /** Lasting as long as the sign-in: an offline token */
  refreshToken: string;
  accessToken?: string;
  /** When the access token ends: epoch ms */
  expiresAt?: number;
  /** Who signed in */
  username?: string;
}

interface CredentialsFile {
  registries: Record<string, RegistryCredentials>;
}

/**
 * The registry a command talks to: the one told, SB_REGISTRY_URL, or
 * registry.syncbridge.io - its address without a trailing slash
 */
export function resolveRegistry(told?: string): string {
  const url = told || process.env.SB_REGISTRY_URL || DEFAULT_REGISTRY;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
  } catch {
    throw new SbError(`"${url}" is not a registry's address: https://...`);
  }
  return url.replace(/\/+$/, '');
}

function read(): CredentialsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
    if (parsed && typeof parsed.registries === 'object') return parsed;
  } catch {
    /* None yet, or not one: as if none */
  }
  return { registries: {} };
}

function write(data: CredentialsFile) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  /* Written whole, then put in place; read by its owner alone */
  const file = credentialsFile();
  const partial = file + '.partial';
  fs.writeFileSync(partial, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(partial, file);
}

/** What spm keeps of the sign-in to a registry: none if it has none */
export function credentialsOf(
  registry: string,
): RegistryCredentials | undefined {
  return read().registries[registry];
}

/** Keeps a sign-in to a registry, or forgets it (undefined) */
export function saveCredentials(
  registry: string,
  credentials: RegistryCredentials | undefined,
) {
  const data = read();
  if (credentials) data.registries[registry] = credentials;
  else delete data.registries[registry];
  write(data);
}
