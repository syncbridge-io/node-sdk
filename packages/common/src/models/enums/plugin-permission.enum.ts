import { EnumType } from '@opra/common';

/**
 * What a plugin reaches beyond its own data directory, its settings, its
 * status, questions and actions, as it declares it needs: shown to the
 * server's admins, given once they approve it. Not declared, none.
 */
export enum PluginPermission {
  /** `host.workers.addEnvironment`: what every worker starts with */
  WorkerEnvironment = 'worker-environment',
  /** `host.logs.registerTarget`: every log record, the workers' messages among them */
  LogRecords = 'log-records',
  /** `host.workers.list/get` and the workers' events: their ids, names, statuses */
  Workers = 'workers',
  /** The network: the hosts it reaches named in `hosts` */
  Network = 'network',
  /** Starting other programs, outside Node's permission model */
  ChildProcesses = 'child-processes',
  /** Native addons (.node), outside Node's permission model */
  NativeCode = 'native-code',
}

EnumType(PluginPermission, {
  name: 'PluginPermission',
  description:
    'What a plugin reaches beyond its own data directory, as it declares it needs and an admin approves it',
  meanings: {
    WorkerEnvironment: 'What every worker starts with: its environment',
    LogRecords:
      "Every log record, the workers' messages among them - their data too",
    Workers: 'The workers: their ids, names and statuses, and their events',
    Network: 'The network, the hosts it names',
    ChildProcesses: "Starting other programs, outside Node's permission model",
    NativeCode: "Native addons (.node), outside Node's permission model",
  },
});
