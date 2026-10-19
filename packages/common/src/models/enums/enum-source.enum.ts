import { EnumType } from '@opra/common';

/**
 * Where an enum variable's values come from when they depend on the server
 * it runs on: filled in by SyncBridge as the list is asked for - never at
 * a module's import, nor when its package is built
 */
export enum EnumSource {
  /** The serial ports of the server, by their paths */
  SerialPorts = 'serial-ports',
  /** The server's IPv4 addresses, its loopback's apart */
  NetworkAddresses = 'network-addresses',
}

EnumType(EnumSource, {
  name: 'EnumSource',
  description:
    "Where an enum variable's values come from, filled in by SyncBridge as the list is asked for",
  meanings: {
    SerialPorts: 'The serial ports of the server, by their paths',
    NetworkAddresses: "The server's IPv4 addresses, its loopback's apart",
  },
});
