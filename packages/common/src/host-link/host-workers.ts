/*
 * A host's workers' configurations (profiles), kept by Console: a host
 * reinstalled gets them back. The host tells Console what it has - each
 * worker by a hash of its profile - and sends those Console asks for;
 * Console keeps them, their secret values sealed on the way and kept
 * enciphered. Asked by the host, with a token it signs (HOST_TOKEN_HEADER).
 */

/** Where, under Console's API, a host's workers are kept */
export const HOST_WORKERS_PATH = 'host/workers';

/** A worker as a host tells of it: its id, its profile's hash */
export interface HostWorkerDigest {
  id: string;
  hash: string;
}

/** What a host tells of its workers: all of them, so those gone go */
export interface HostWorkersSyncRequest {
  workers: HostWorkerDigest[];
}

/** What Console answers: whether it keeps them; if so, which to send */
export interface HostWorkersSyncResponse {
  /** Its workspace keeps its hosts' workers: off, none are sent */
  enabled: boolean;
  /** Why not, when not */
  reason?: string;
  /** Those it has not, or not as they are: to be sent */
  need: string[];
  /** The key secret values are sealed for, on the way to Console */
  sealKey?: string;
  /**
   * The host was reinstalled: the workers Console keeps are to be taken
   * back (HOST_WORKERS_RESTORE_PATH). None is forgotten meanwhile.
   */
  restore?: boolean;
}

/** A worker's profile, as sent: its secret values sealed for Console */
export interface HostWorkerProfile {
  id: string;
  hash: string;
  profile: Record<string, any>;
  /** The version of its app's package it runs: taken again on restore */
  packageVersion?: string;
}

/** The profiles sent at once: their secrets sealed for Console */
export interface HostWorkersPutRequest {
  workers: HostWorkerProfile[];
}

/**
 * A profile with each of its string values passed through `fn` - its
 * secret values found by what they start with - the rest as they are
 */
export function mapProfileStrings<T>(
  value: T,
  fn: (text: string) => string,
): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value))
    return value.map(item => mapProfileStrings(item, fn)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      out[key] = mapProfileStrings(item, fn);
    return out as T;
  }
  return value;
}

/** Where, under Console's API, a host reinstalled takes its workers back */
export const HOST_WORKERS_RESTORE_PATH = 'host/workers/restore';

/** A worker to take back: its secret values sealed for the host */
export interface HostRestoreWorker {
  id: string;
  /** Its profile's hash, as Console keeps it: told back while it waits */
  hash: string;
  profile: Record<string, any>;
  /** Its app's package, and the version of it it ran */
  packageName?: string;
  packageVersion?: string;
}

/** The workers a host reinstalled takes back */
export interface HostWorkersRestoreResponse {
  workers: HostRestoreWorker[];
}

/**
 * Where a worker taken back is: restored; waiting for its package - one
 * not in the registry, or its workspace may not use - or failed
 */
export type HostWorkerRestoreState = 'restored' | 'waiting' | 'failed';

/** What a host tells of the workers it takes back */
export interface HostWorkersRestoreStatusRequest {
  workers: { id: string; state: HostWorkerRestoreState; message?: string }[];
  /** Each one tried: the reinstall is over, those waiting wait on the host */
  done?: boolean;
}
