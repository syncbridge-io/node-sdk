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
