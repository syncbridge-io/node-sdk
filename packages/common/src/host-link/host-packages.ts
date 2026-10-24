/*
 * Packages a host installs from the registry: it asks Console for a plan -
 * the version of what it wants, the registry packages it needs that it
 * has not - each one it may download (public, or its workspace's), each
 * with its size, its hash and a short-lived link to it. Asked by the host,
 * with a token it signs (HOST_TOKEN_HEADER).
 */

/** Where, under Console's API, a host's packages are planned */
export const HOST_PACKAGES_PATH = 'host/packages';

/** What a host asks to install */
export interface HostPackagesResolveRequest {
  /** "@org/name" */
  name: string;
  /** Its versions taken: "^2.0.0"; none, the newest */
  range?: string;
  /** What it has: each package's versions installed */
  installed?: Record<string, string[]>;
}

/** A package of the plan, to be installed in its turn */
export interface HostPackagePlanItem {
  name: string;
  version: string;
  size: number;
  /** SHA-256 of its archive, hex: checked before it is installed */
  sha256: string;
  /** Where it is read, relative to Console's API; a few minutes good */
  url: string;
}

/** What to install, in order: the packages needed first */
export interface HostPackagesResolveResponse {
  items: HostPackagePlanItem[];
}

/*
 * A host's packages' updates: what the registry has newer of each package
 * it has, asked in one call. To check, its installed versions sent - each
 * answered the newest of its minor (a fix), of its major (fixes and
 * features) and a newer major, told apart; nothing signed. To install, the
 * very versions it takes sent - each answered with a short-lived grant to
 * read it: read by it without its access asked again, unless that version,
 * its package or the host's workspace is suspended, or the access ended,
 * since.
 */

/** Where, under Console's API, a host's packages' updates are asked */
export const HOST_PACKAGE_UPDATES_PATH = 'host/packages/updates';

/** What a host asks of its packages' updates */
export interface HostPackageUpdatesRequest {
  /**
   * check: what is newer of the versions it has; download: grants to read
   * the versions it installs
   */
  mode: 'check' | 'download';
  /** "@org/name" -> its newest version installed (check), or the one it installs (download) */
  packages: Record<string, string>;
}

/** A version offered: what it needs of the registry's packages */
export interface HostPackageOffer {
  version: string;
  /** Registry packages it depends on: name -> range */
  dependencies: Record<string, string>;
}

/** What is newer of a package, or why it was not told */
export interface HostPackageUpdate {
  name: string;
  /** The version sent */
  version: string;
  /**
   * NOT_FOUND: not in the registry, or (download) no such version;
   * NO_ACCESS: the host's workspace may not use it; SUSPENDED (download):
   * the version is suspended
   */
  problem?: 'NOT_FOUND' | 'NO_ACCESS' | 'SUSPENDED';
  /** check: the newest of its minor, newer than the one sent (a fix) */
  patch?: HostPackageOffer;
  /** check: the newest of its major, newer than the one sent */
  minor?: HostPackageOffer;
  /** check: a newer major's newest - told, never installed without asking */
  major?: string;
  /** download: the version sent, its grant in its link; a few minutes good */
  download?: HostPackagePlanItem & {
    dependencies: Record<string, string>;
  };
}

/** Each package sent, answered */
export interface HostPackageUpdatesResponse {
  items: HostPackageUpdate[];
}
