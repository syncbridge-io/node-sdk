import { expect } from 'expect';
import {
  missingPermissionOf,
  nodePermissionArgs,
  workerPermissionsOf,
} from '../../src/index.js';

describe("A worker's permissions", () => {
  const components: Record<string, any> = {
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
          permissions: ['child-processes'],
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
    ).toEqual(['child-processes', 'native-code', 'serial-ports']);
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

  it('should tell what a refused worker is to declare', () => {
    expect(
      missingPermissionOf(
        'Error [ERR_DLOPEN_DISABLED]: Cannot load native addon because loading addons is disabled.',
      ),
    ).toBe('native-code');
    expect(
      missingPermissionOf(
        "Error [ERR_ACCESS_DENIED]: Access to this API has been restricted. permission: 'ChildProcess'",
      ),
    ).toBe('child-processes');
    expect(missingPermissionOf('Cannot find module x')).toBeUndefined();
  });
});
