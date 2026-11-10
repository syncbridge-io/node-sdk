import semver from 'semver';

/**
 * What a SyncBridge engine provides a package as its peers: the packages at
 * the top of its installed tree, at their versions - as its install check
 * finds them. The registry serves the latest stable engine's.
 *
 * @deprecated A package's peers are installed for the workers that load it;
 * the engine shares only its own packages. Neither spm nor SyncBridge checks
 * this list any more.
 */
export interface EngineProvides {
  /** The engine's version */
  engine: string;
  /** By npm name: the version installed */
  packages: Record<string, string>;
}

/**
 * What a host lacks of a package's peers, as SyncBridge tells it when it
 * refuses to install the package: one line a peer
 *
 * @deprecated See EngineProvides
 */
export function hostPeerProblems(
  peers: Record<string, string> | undefined,
  /** The version of an npm package the host provides, if it does */
  hostVersionOf: (name: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const [name, range] of Object.entries(peers ?? {})) {
    const version = hostVersionOf(name);
    if (!version) problems.push(`The host does not provide "${name}"`);
    else if (!semver.satisfies(version, range))
      problems.push(
        `The host provides "${name}" ${version}, which does not satisfy ${range}`,
      );
  }
  return problems;
}
