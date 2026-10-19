import { EnumType } from '@opra/common';

/**
 * What of the server a worker reaches beyond its own directory, as an app
 * or a component declares it needs: its worker given it - its user in the
 * device's group - and told in the UI. Not declared, none.
 */
export enum WorkerPermission {
  /** The serial ports: its user in their group (dialout) */
  SerialPorts = 'serial-ports',
  /**
   * Native addons (.node): a module with one - serialport, oracledb - is
   * outside Node's permission model, so it is given it by name alone
   */
  NativeCode = 'native-code',
  /** Starting other programs: outside Node's permission model too */
  ChildProcesses = 'child-processes',
}

EnumType(WorkerPermission, {
  name: 'WorkerPermission',
  description:
    'What of the server a worker reaches beyond its own directory, as an app or a component declares it needs',
  meanings: {
    SerialPorts: 'The serial ports of the server',
    NativeCode:
      "Native addons (.node), outside Node's permission model: a module with one",
    ChildProcesses:
      "Starting other programs, outside Node's permission model too",
  },
});
