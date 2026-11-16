import { expect } from 'expect';
import {
  missingPermissionOf,
  nodePermissionArgs,
  permissionCodes,
  workerPermissionsOf,
} from '../../src/index.js';

describe("A worker's permissions", () => {
  const components: Record<string, any> = {
    /* Built with the first codes: read as the ones they became */
    '@acme/serial:SerialPort': {
      permissions: ['serial-ports', 'native-code'],
    },
    '@acme/net:TcpClient': {},
  };
  const find = (uri: string) => components[uri];

  it('should be what its app and each component given it declare - the one chosen, else the one asked for - all the way down', () => {
    expect(
      workerPermissionsOf(
        {
          permissions: ['child-process:spawn'],
          components: {
            link: {
              interfaceUri: '@acme/net:IoClient',
              classUri: '@acme/net:TcpClient',
              components: {
                fallback: { interfaceUri: '@acme/serial:SerialPort' },
              },
            },
          },
        } as any,
        find,
      ),
    ).toEqual([
      'child-process:spawn',
      'native-code:execute',
      'serial-port:connect',
    ]);
    expect(workerPermissionsOf(undefined, find)).toEqual([]);
  });

  it("should hold a worker to Node's permission model: its paths, and only what it declares outside the model", () => {
    expect(
      nodePermissionArgs({
        read: ['/no/such/a'],
        write: ['/no/such/b'],
        permissions: [],
      }),
    ).toEqual([
      '--permission',
      '--allow-fs-read=/no/such/a',
      '--allow-fs-write=/no/such/b',
    ]);
    expect(
      nodePermissionArgs({ permissions: ['native-code', 'child-processes'] }),
    ).toEqual([
      '--permission',
      '--allow-fs-read=*',
      '--allow-fs-write=*',
      '--allow-addons',
      '--allow-child-process',
    ]);
  });

  it('should give the same, its codes the first ones or the new', () => {
    expect(
      nodePermissionArgs({
        permissions: ['native-code:execute', 'child-process:spawn'],
      }),
    ).toEqual(
      nodePermissionArgs({ permissions: ['native-code', 'child-processes'] }),
    );
    expect(
      permissionCodes(['serial-ports', 'serial-port:connect', 'x']),
    ).toEqual(['serial-port:connect', 'x']);
  });

  it('should tell what a refused worker is to declare', () => {
    expect(
      missingPermissionOf(
        'Error [ERR_DLOPEN_DISABLED]: Cannot load native addon because loading addons is disabled.',
      ),
    ).toBe('native-code:execute');
    expect(
      missingPermissionOf(
        "Error [ERR_ACCESS_DENIED]: Access to this API has been restricted. permission: 'ChildProcess'",
      ),
    ).toBe('child-process:spawn');
    expect(missingPermissionOf('Cannot find module x')).toBeUndefined();
  });
});
