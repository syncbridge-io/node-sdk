/*
 * The link of a SyncBridge server (a host) to SyncBridge Console: a
 * WebSocket the host opens - so it may be behind any firewall - with its
 * key (`Authorization: Bearer <key>`), its binary messages the frames of a
 * Multiplexer. Console opens streams on it to the host's own HTTP
 * server; the link's control messages are below.
 */

/** Where Console takes the hosts' links, on its API's port */
export const HOST_LINK_PATH = '/hosts/link';

/**
 * The close code Console closes a link with when the host is not to
 * connect again: its key changed, it was removed, or another host
 * connected with the key. Any other close is a drop: it connects again.
 */
export const HOST_LINK_CLOSED = 4001;

/** A worker as a host tells of it */
export interface HostWorker {
  id: string;
  name?: string;
  status?: string;
}

/** A host's workers, counted: and those needing a look, by name */
export interface HostWorkerSummary {
  total: number;
  started: number;
  stopped: number;
  /** Unhealthy, invalid, or needing an init */
  problem: number;
  /** Starting, stopping, initializing */
  other: number;
  /** The workers with a problem, the first of them */
  problems: HostWorker[];
}

/** What a host tells of itself: sent when it connects, and as it changes */
export interface HostStatusMessage {
  type: 'status';
  /** The SyncBridge version */
  version: string;
  /** When SyncBridge started, ISO */
  startTime: string;
  workers: HostWorkerSummary;
}

/** The statuses of a worker needing a look */
const PROBLEM_STATUSES = new Set(['unhealthy', 'invalid', 'needs-init']);
/** The problems named at most: the counts tell the rest */
export const MAX_NAMED_PROBLEMS = 10;

/** A host's workers, counted, as it tells Console */
export function summarizeWorkers(
  workers: Iterable<HostWorker>,
): HostWorkerSummary {
  const summary: HostWorkerSummary = {
    total: 0,
    started: 0,
    stopped: 0,
    problem: 0,
    other: 0,
    problems: [],
  };
  for (const worker of workers) {
    summary.total++;
    if (worker.status === 'started') summary.started++;
    else if (worker.status === 'stopped') summary.stopped++;
    else if (PROBLEM_STATUSES.has(worker.status || '')) {
      summary.problem++;
      if (summary.problems.length < MAX_NAMED_PROBLEMS)
        summary.problems.push(worker);
    } else summary.other++;
  }
  return summary;
}

export type HostLinkMessage = HostStatusMessage;

/*
 * The headers a request Console passes on to the host carries: who it
 * is for. The host takes them only from a stream of its link: what comes
 * any other way is not Console.
 */
export const CONSOLE_USER_HEADER = 'x-sb-console-user';
export const CONSOLE_USER_NAME_HEADER = 'x-sb-console-user-name';
export const CONSOLE_ROLE_HEADER = 'x-sb-console-role';
/** What the user may do inside the host: HostPermission values, comma-separated */
export const CONSOLE_PERMISSIONS_HEADER = 'x-sb-console-permissions';
