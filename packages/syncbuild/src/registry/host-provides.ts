import {
  type EngineProvides,
  hostPeerProblems,
  isSyncBridgeModule,
  SbError,
} from '@syncbridge/common';

/** How long the registry is waited for: the check is skipped after */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * What the latest stable SyncBridge provides as peers, as the registry
 * tells it: none when it tells none yet, or cannot be reached
 */
export async function fetchEngineProvides(
  registry: string,
): Promise<EngineProvides | undefined> {
  try {
    const res = await fetch(`${registry}/registry/host-provides`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const body = (await res.json()) as EngineProvides;
    return body &&
      typeof body.engine === 'string' &&
      body.packages &&
      typeof body.packages === 'object'
      ? body
      : undefined;
  } catch {
    return;
  }
}

/**
 * Refuses a package whose peers SyncBridge does not provide, as a server
 * refuses to install it - before it is published, not after. A SyncBridge
 * module declared a peer is not one: a server takes it for a registry
 * dependency. `provides` none: told, not checked - the registry checks it
 * again when the package is published.
 */
export function checkHostPeers(
  pkg: {
    name: string;
    version: string;
    peerDependencies?: Record<string, string>;
  },
  provides: EngineProvides | undefined,
  log?: (message: string) => void,
): void {
  if (!provides) {
    log?.(
      "The registry tells no list of what SyncBridge provides: the package's peers are not checked",
    );
    return;
  }
  const peers = Object.fromEntries(
    Object.entries(pkg.peerDependencies ?? {}).filter(
      ([name]) => !isSyncBridgeModule(name),
    ),
  );
  const problems = hostPeerProblems(peers, name => provides.packages[name]);
  if (problems.length)
    throw new SbError(
      `${pkg.name}@${pkg.version} cannot be installed.\n  ` +
        problems.join('\n  ') +
        `\nAs SyncBridge ${provides.engine} provides its packages: declare the others in dependencies`,
      { code: 'DEPENDENCIES_NOT_SATISFIED' },
    );
}
