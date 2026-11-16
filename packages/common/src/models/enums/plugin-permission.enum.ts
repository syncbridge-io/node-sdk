import { EnumType } from '@opra/common';

/**
 * What a plugin may do beyond its own data directory, its settings, its
 * status, questions and actions, as it declares it needs: shown to the
 * server's admins, given once they approve it. Not declared, none.
 *
 * Each code is `<subject>:<action>`: what it acts on, and what it does
 * with it. The first codes (`log-records`, `workers`…) are still
 * read, as the ones they became (`legacyPermissionCodes`).
 */
export enum PluginPermission {
  /** `host.workers.list/get` and the workers' events: their ids, names, statuses, apps */
  WorkerReadSummary = 'worker:read-summary',
  /** `host.workers.addEnvironment`: added to what every worker starts with */
  WorkerAddEnv = 'worker:add-env',
  /** Its buttons on a log's toolbar and a record's menu: every log record, the workers' messages among them */
  LogRead = 'log:read',
  /** The network: the hosts it connects to named in `hosts` */
  NetworkConnect = 'network:connect',
  /** Starting other programs, which go on running, outside Node's permission model */
  ChildProcessSpawn = 'child-process:spawn',
  /** Loading and running native addons (.node), outside Node's permission model */
  NativeCodeExecute = 'native-code:execute',
}

EnumType(PluginPermission, {
  name: 'PluginPermission',
  description:
    'What a plugin may do beyond its own data directory, as it declares it needs and an admin approves it: <subject>:<action>',
  /* The deprecated names have none: not enumerable, never listed */
  meanings: {
    WorkerReadSummary:
      "The workers' summaries: their ids, names, statuses and apps, and their events. Not their configuration",
    WorkerAddEnv: 'Adds environment variables to what every worker starts with',
    LogRead:
      "Reads every log record, the workers' messages among them - their data too",
    NetworkConnect: 'Connects to the network, the hosts it names',
    ChildProcessSpawn: "Starts other programs, outside Node's permission model",
    NativeCodeExecute:
      "Loads and runs native addons (.node), outside Node's permission model",
  } as Record<keyof typeof PluginPermission, string>,
});

/* The first names, kept for the code using them: not enumerable, so
 * neither the enum's values nor its API type has them twice */

export declare namespace PluginPermission {
  /** @deprecated Use `PluginPermission.WorkerReadSummary` */
  const Workers: PluginPermission.WorkerReadSummary;
  /** @deprecated Use `PluginPermission.WorkerAddEnv` */
  const WorkerEnvironment: PluginPermission.WorkerAddEnv;
  /** @deprecated Use `PluginPermission.LogRead` */
  const LogRecords: PluginPermission.LogRead;
  /** @deprecated Use `PluginPermission.NetworkConnect` */
  const Network: PluginPermission.NetworkConnect;
  /** @deprecated Use `PluginPermission.ChildProcessSpawn` */
  const ChildProcesses: PluginPermission.ChildProcessSpawn;
  /** @deprecated Use `PluginPermission.NativeCodeExecute` */
  const NativeCode: PluginPermission.NativeCodeExecute;
}
for (const [old, to] of Object.entries({
  Workers: PluginPermission.WorkerReadSummary,
  WorkerEnvironment: PluginPermission.WorkerAddEnv,
  LogRecords: PluginPermission.LogRead,
  Network: PluginPermission.NetworkConnect,
  ChildProcesses: PluginPermission.ChildProcessSpawn,
  NativeCode: PluginPermission.NativeCodeExecute,
}))
  Object.defineProperty(PluginPermission, old, {
    value: to,
    enumerable: false,
  });
