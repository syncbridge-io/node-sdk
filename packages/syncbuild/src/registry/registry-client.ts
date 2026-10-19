import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { SbError } from '@syncbridge/common';
import {
  credentialsOf,
  type RegistryCredentials,
  saveCredentials,
} from './credentials.js';

/** Where a registry's users sign in, as it tells: GET /auth/cli */
interface CliAuth {
  issuer: string;
  clientId: string;
}

/** What spm reads of an issuer's discovery document */
interface Discovery {
  device_authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}

/** What a device authorization starts with: the code its user enters */
export interface DeviceCode {
  userCode: string;
  /** Where its user enters it */
  verificationUri: string;
  /** Where its user goes with it entered already */
  verificationUriComplete?: string;
  /** When it ends: seconds */
  expiresIn: number;
}

/** A token is refreshed this long before it ends */
const EARLY_MS = 60_000;

/** The scopes spm signs in with: lasting past the browser's session */
const SCOPES = 'openid offline_access';

/** What went wrong, as a registry or an issuer tells it */
async function messageOf(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    return (
      body.errors?.[0]?.message ||
      body.error_description ||
      body.error ||
      text ||
      resp.statusText
    );
  } catch {
    return text || resp.statusText;
  }
}

async function getJson<T>(url: string): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e: any) {
    throw new SbError(
      `${url} could not be reached: ${e.cause?.message ?? e.message}`,
    );
  }
  if (!resp.ok)
    throw new SbError(
      `${url} answered ${resp.status}: ${await messageOf(resp)}`,
    );
  return (await resp.json()) as T;
}

async function postForm(url: string, form: Record<string, string>) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
}

/** Who a token is of: its preferred_username claim, read, not checked */
function usernameOf(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
    );
    return payload.preferred_username;
  } catch {
    return undefined;
  }
}

async function discover(issuer: string): Promise<Discovery> {
  return getJson<Discovery>(
    `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
  );
}

/** What a token endpoint gave, kept */
function kept(
  auth: CliAuth,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number },
  before?: RegistryCredentials,
): RegistryCredentials {
  const refreshToken = tokens.refresh_token ?? before?.refreshToken;
  if (!refreshToken)
    throw new SbError('The sign-in gave no refresh token: spm cannot keep it');
  return {
    issuer: auth.issuer,
    clientId: auth.clientId,
    refreshToken,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 60) * 1000,
    username: usernameOf(tokens.access_token) ?? before?.username,
  };
}

/**
 * Signs in to a registry by the device authorization grant: its user is
 * told a code and where to enter it (onCode), in any browser; spm waits
 * until they have, and keeps the sign-in
 */
export async function login(
  registry: string,
  onCode: (code: DeviceCode) => void,
): Promise<RegistryCredentials> {
  const auth = await getJson<CliAuth>(`${registry}/auth/cli`);
  const endpoints = await discover(auth.issuer);
  const start = await postForm(endpoints.device_authorization_endpoint, {
    client_id: auth.clientId,
    scope: SCOPES,
  });
  if (!start.ok)
    throw new SbError(`Signing in could not start: ${await messageOf(start)}`);
  const device = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  onCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete,
    expiresIn: device.expires_in,
  });
  let interval = (device.interval ?? 5) * 1000;
  const ends = Date.now() + device.expires_in * 1000;
  while (Date.now() < ends) {
    await sleep(interval);
    const resp = await postForm(endpoints.token_endpoint, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: auth.clientId,
    });
    const body = (await resp.json().catch(() => ({}))) as any;
    if (resp.ok) {
      const credentials = kept(auth, body);
      saveCredentials(registry, credentials);
      return credentials;
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (body.error === 'access_denied')
      throw new SbError('Signing in was denied');
    if (body.error === 'expired_token') break;
    throw new SbError(
      `Signing in failed: ${body.error_description || body.error || resp.status}`,
    );
  }
  throw new SbError(
    'The code ended before it was entered: run spm login again',
  );
}

/** Signs out of a registry: its token revoked, if it can be, and forgotten */
export async function logout(registry: string): Promise<boolean> {
  const credentials = credentialsOf(registry);
  if (!credentials) return false;
  try {
    const endpoints = await discover(credentials.issuer);
    if (endpoints.revocation_endpoint)
      await postForm(endpoints.revocation_endpoint, {
        client_id: credentials.clientId,
        token: credentials.refreshToken,
        token_type_hint: 'refresh_token',
      });
  } catch {
    /* Unreachable: forgotten here all the same */
  }
  saveCredentials(registry, undefined);
  return true;
}

/**
 * An access token for a registry: the one kept while it lasts, else one
 * the sign-in's refresh token gets
 */
export async function accessTokenOf(
  registry: string,
  options?: { renew?: boolean },
): Promise<string> {
  const credentials = credentialsOf(registry);
  if (!credentials)
    throw new SbError(`Not signed in to ${registry}: run spm login`);
  if (
    !options?.renew &&
    credentials.accessToken &&
    (credentials.expiresAt ?? 0) - EARLY_MS > Date.now()
  )
    return credentials.accessToken;
  const endpoints = await discover(credentials.issuer);
  const resp = await postForm(endpoints.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
  });
  if (!resp.ok) {
    const message = await messageOf(resp);
    if (resp.status === 400 || resp.status === 401)
      throw new SbError(
        `The sign-in to ${registry} has ended (${message}): run spm login`,
      );
    throw new SbError(`The sign-in could not be renewed: ${message}`);
  }
  const renewed = kept(
    { issuer: credentials.issuer, clientId: credentials.clientId },
    (await resp.json()) as any,
    credentials,
  );
  saveCredentials(registry, renewed);
  return renewed.accessToken!;
}

/** An error the registry answered with: its status, its message */
export class RegistryError extends SbError {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/**
 * A request to a registry as its signed-in user: renewed once if the
 * token was refused. Answers what it gave, or throws a RegistryError.
 */
export async function registryFetch(
  registry: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = async (renew: boolean) => {
    const token = await accessTokenOf(registry, { renew });
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetch(`${registry}/${path}`, { ...init, headers });
    } catch (e: any) {
      throw new SbError(
        `${registry} could not be reached: ${e.cause?.message ?? e.message}`,
      );
    }
  };
  let resp = await send(false);
  if (resp.status === 401) resp = await send(true);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const message =
      (body as any)?.errors?.[0]?.message || text || resp.statusText;
    throw new RegistryError(resp.status, message, body);
  }
  return resp;
}

/**
 * Whether spm runs in a GitHub Actions job that may ask its OIDC token
 * (`permissions: id-token: write`): it publishes as the job then
 */
export function inGitHubActions(env = process.env): boolean {
  return !!(
    env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  );
}

/**
 * The job's OIDC token, for the registry: who the run is - its
 * repository, workflow, ref - signed by GitHub, short-lived
 */
export async function gitHubOidcToken(
  registry: string,
  env = process.env,
): Promise<string> {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL!);
  url.searchParams.set('audience', registry);
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
      },
    });
  } catch (e: any) {
    throw new SbError(
      `GitHub's OIDC token could not be asked: ${e.cause?.message ?? e.message}`,
    );
  }
  const body = (await resp.json().catch(() => ({}))) as { value?: string };
  if (!resp.ok || !body.value)
    throw new SbError(
      `GitHub gave no OIDC token (${resp.status}): the job needs "permissions: id-token: write"`,
    );
  return body.value;
}

/**
 * A request to a registry as a GitHub Actions job: its OIDC token, asked
 * anew each time (it lasts minutes), in X-SB-CI-Token. Answers what it
 * gave, or throws a RegistryError.
 */
export async function ciFetch(
  registry: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-SB-CI-Token', await gitHubOidcToken(registry));
  let resp: Response;
  try {
    resp = await fetch(`${registry}/${path}`, { ...init, headers });
  } catch (e: any) {
    throw new SbError(
      `${registry} could not be reached: ${e.cause?.message ?? e.message}`,
    );
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const message =
      (body as any)?.errors?.[0]?.message || text || resp.statusText;
    throw new RegistryError(resp.status, message, body);
  }
  return resp;
}
