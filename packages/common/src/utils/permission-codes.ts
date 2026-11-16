/**
 * The first permission codes, as the ones they became - a plugin's
 * and a worker's alike: read from the packages built with them, and from
 * the approvals given them
 */
export const legacyPermissionCodes: Readonly<Record<string, string>> = {
  workers: 'worker:read-summary',
  'worker-environment': 'worker:add-env',
  'log-records': 'log:read',
  network: 'network:connect',
  'serial-ports': 'serial-port:connect',
  'child-processes': 'child-process:spawn',
  'native-code': 'native-code:execute',
};

/** A permission's code as it is now: a first one taken to its new one */
export function permissionCode<T extends string>(code: T): T {
  return (legacyPermissionCodes[code] ?? code) as T;
}

/** A list of permissions' codes as they are now, each once, in order */
export function permissionCodes<T extends string>(codes: T[]): T[];
export function permissionCodes<T extends string>(
  codes: T[] | undefined,
): T[] | undefined;
export function permissionCodes<T extends string>(codes?: T[]) {
  return codes && [...new Set(codes.map(c => permissionCode(c)))];
}
