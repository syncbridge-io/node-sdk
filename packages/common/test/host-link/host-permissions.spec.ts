import { expect } from 'expect';
import {
  HOST_ROLE_PERMISSIONS,
  HostPermission,
  hostRolePermissions,
  parseHostPermissions,
} from '../../src/index.js';

describe('host permissions', () => {
  it("should give each role its own and the lower roles'", () => {
    expect(HOST_ROLE_PERMISSIONS.viewer).toEqual([HostPermission.WorkersView]);
    expect(HOST_ROLE_PERMISSIONS.operator).toEqual([
      'host.workers.view',
      'host.workers.control',
      'host.workers.configure',
      'host.workers.create',
      'hosts.install',
    ]);
    expect([...HOST_ROLE_PERMISSIONS.admin].sort()).toEqual(
      Object.values(HostPermission).sort(),
    );
    expect(hostRolePermissions('nobody')).toEqual([]);
    expect(hostRolePermissions(undefined)).toEqual([]);
  });

  it('should take the permissions a header gives, those not known dropped', () => {
    expect(
      parseHostPermissions(
        'host.workers.view, host.workers.control,host.unknown,host.workers.view',
      ),
    ).toEqual(['host.workers.view', 'host.workers.control']);
    expect(parseHostPermissions('')).toEqual([]);
    /* No header: the role's to be taken */
    expect(parseHostPermissions(undefined)).toBeUndefined();
    expect(parseHostPermissions(null)).toBeUndefined();
  });
});
