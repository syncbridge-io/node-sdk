import { EnumType } from '@opra/common';

/**
 * What of the server a worker may do beyond its own directory, as an app
 * or a component declares it needs: its worker given it - its user in the
 * device's group - and told in the UI. Not declared, none.
 *
 * Each code is `<subject>:<action>`, as a plugin's are. The first codes
 * (`serial-ports`…) are still read, as the ones they became
 * (`legacyPermissionCodes`).
 */
export enum WorkerPermission {
  /** Connecting to the serial ports: its user in their group (dialout) */
  SerialPortConnect = 'serial-port:connect',
  /**
   * Loading and running native addons (.node): a module with one -
   * serialport, oracledb - is outside Node's permission model, so it is
   * given it by name alone
   */
  NativeCodeExecute = 'native-code:execute',
  /** Starting other programs: outside Node's permission model too */
  ChildProcessSpawn = 'child-process:spawn',
}

EnumType(WorkerPermission, {
  name: 'WorkerPermission',
  description:
    'What of the server a worker may do beyond its own directory, as an app or a component declares it needs: <subject>:<action>',
  /* The deprecated names have none: not enumerable, never listed */
  meanings: {
    SerialPortConnect: 'Connects to the serial ports of the server',
    NativeCodeExecute:
      "Loads and runs native addons (.node), outside Node's permission model: a module with one",
    ChildProcessSpawn:
      "Starts other programs, outside Node's permission model too",
  } as Record<keyof typeof WorkerPermission, string>,
});

/* The first names, kept for the code using them: not enumerable */

export declare namespace WorkerPermission {
  /** @deprecated Use `WorkerPermission.SerialPortConnect` */
  const SerialPorts: WorkerPermission.SerialPortConnect;
  /** @deprecated Use `WorkerPermission.NativeCodeExecute` */
  const NativeCode: WorkerPermission.NativeCodeExecute;
  /** @deprecated Use `WorkerPermission.ChildProcessSpawn` */
  const ChildProcesses: WorkerPermission.ChildProcessSpawn;
}
for (const [old, to] of Object.entries({
  SerialPorts: WorkerPermission.SerialPortConnect,
  NativeCode: WorkerPermission.NativeCodeExecute,
  ChildProcesses: WorkerPermission.ChildProcessSpawn,
}))
  Object.defineProperty(WorkerPermission, old, {
    value: to,
    enumerable: false,
  });
