/**
 * What a user may do inside a host. Console grants them to an
 * organization's members and passes them on with each request
 * (CONSOLE_PERMISSIONS_HEADER); the host's own users have their role's.
 */
export enum HostPermission {
  /** Seeing the workers, their logs and configuration, and the settings */
  WorkersView = 'host.workers.view',
  /** Starting, stopping and initializing workers */
  WorkersControl = 'host.workers.control',
  /** Changing a worker's configuration and its log channels */
  WorkersConfigure = 'host.workers.configure',
  /** Adding workers */
  WorkersCreate = 'host.workers.create',
  /** Removing workers */
  WorkersDelete = 'host.workers.delete',
  /** Changing the host's settings, uploading packages */
  Settings = 'host.settings',
  /** Updating SyncBridge */
  Updates = 'host.updates',
  /** The host's own users */
  Users = 'host.users',
  /** Pairing with Console, restoring, restarting SyncBridge */
  System = 'host.system',
  /**
   * Installing packages from the registry: Console's own permission, sent
   * with its installs
   */
  Install = 'hosts.install',
}

/** The roles inside a host, each a set of permissions */
export type HostRole = 'viewer' | 'operator' | 'admin';

const VIEWER = [HostPermission.WorkersView];
const OPERATOR = [
  ...VIEWER,
  HostPermission.WorkersControl,
  HostPermission.WorkersConfigure,
  HostPermission.WorkersCreate,
  HostPermission.Install,
];

/**
 * The permissions of each role: a host's own users', and a user's whose
 * Console sends a role alone (one older than the permissions)
 */
export const HOST_ROLE_PERMISSIONS: Readonly<
  Record<HostRole, readonly HostPermission[]>
> = {
  viewer: VIEWER,
  operator: OPERATOR,
  admin: Object.values(HostPermission),
};

const KNOWN = new Set<string>(Object.values(HostPermission));

/** The permissions of a role; none for a role not known */
export function hostRolePermissions(
  role: string | undefined | null,
): HostPermission[] {
  return [...(HOST_ROLE_PERMISSIONS[role as HostRole] || [])];
}

/**
 * The permissions a CONSOLE_PERMISSIONS_HEADER value gives: comma-separated,
 * those not known dropped. No header, undefined: the role's to be taken.
 */
export function parseHostPermissions(
  value: string | undefined | null,
): HostPermission[] | undefined {
  if (value == null) return;
  const given = value
    .split(',')
    .map(s => s.trim())
    .filter(s => KNOWN.has(s));
  return [...new Set(given)] as HostPermission[];
}
