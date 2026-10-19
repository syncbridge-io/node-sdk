import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolveRegistry } from '../registry/credentials.js';
import {
  type DeviceCode,
  login,
  logout,
  registryFetch,
} from '../registry/registry-client.js';

/** Opens an address in the user's browser, if there is one to open */
export function openBrowser(url: string): boolean {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Who a registry knows the user as, and the organizations they are in */
export interface WhoAmI {
  registry: string;
  username: string;
  fullName?: string;
  organizations: { name: string; displayName?: string; role?: string }[];
}

/**
 * Signs in to a registry, telling the user where to enter the code it
 * shows (onCode); the browser opened there unless told not to
 */
export async function signIn(options: {
  registry?: string;
  onCode: (code: DeviceCode) => void;
}) {
  const registry = resolveRegistry(options.registry);
  const credentials = await login(registry, options.onCode);
  return { registry, username: credentials.username };
}

/** Signs out of a registry: false if it was signed in to none */
export async function signOut(options: { registry?: string }) {
  const registry = resolveRegistry(options.registry);
  return { registry, signedOut: await logout(registry) };
}

/** Who the user is at a registry, as it tells */
export async function whoAmI(options: { registry?: string }): Promise<WhoAmI> {
  const registry = resolveRegistry(options.registry);
  const me = (await (await registryFetch(registry, 'auth/me')).json()) as {
    username: string;
    fullName?: string;
  };
  const orgs = (await (
    await registryFetch(registry, 'registry/me/organizations')
  ).json()) as { payload?: any[] } | any[];
  const list = Array.isArray(orgs) ? orgs : (orgs.payload ?? []);
  return {
    registry,
    username: me.username,
    fullName: me.fullName,
    organizations: list.map((o: any) => ({
      name: o.name,
      displayName: o.displayName,
      role: o.role,
    })),
  };
}
