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
  /**
   * Held on the version of its app its configuration was written with:
   * the newest its range allows cannot take it
   */
  heldBack?: { version: string; newest: string; reason: string };
  /**
   * Its configuration waits for its classes' own migrations, run as it
   * starts or its page is opened: the version it is carried to, and the
   * one it was written with
   */
  migrationPending?: { version: string; from?: string };
}

/** A host's workers, counted: and those needing a look, by name */
export interface HostWorkerSummary {
  total: number;
  started: number;
  stopped: number;
  /** Unhealthy, invalid, needing an init or its configuration */
  problem: number;
  /** Starting, stopping, initializing */
  other: number;
  /** The workers with a problem, the first of them */
  problems: HostWorker[];
  /**
   * The workers held on an older version, or whose configuration waits
   * for its migrations, that have no problem: the first of them. Counted
   * as started or stopped, as they are; one with a problem keeps both on
   * its entry in problems
   */
  notices: HostWorker[];
}

/**
 * What of the packages a host has is in use, counted alone - no worker
 * named, nothing of their configurations: what Console's statistics of a
 * package's versions are made of, shown to its publisher
 */
export interface HostUsage {
  /**
   * The packages installed, by name: each version installed, and how many
   * workers take it - its app, or one of its components - 0 for none
   */
  packages: Record<string, Record<string, number>>;
  /** The plugins running, by their package: its version */
  plugins: Record<string, string>;
}

/** What a host tells of itself: sent when it connects, and as it changes */
export interface HostStatusMessage {
  type: 'status';
  /** The SyncBridge version */
  version: string;
  /** When SyncBridge started, ISO */
  startTime: string;
  workers: HostWorkerSummary;
  /** Its packages in use: none from a host older than common 2.13 */
  usage?: HostUsage;
}

/**
 * A host's usage counted: its packages' installed versions, and the
 * version of each package each worker takes - one worker counted once a
 * package, whatever it takes of it
 */
export function summarizeUsage(args: {
  /** Each package installed: its versions */
  installed: Record<string, string[]>;
  /** Each worker: the version of each package it takes */
  workers: Iterable<Record<string, string>>;
  /** The plugins running: their package's name and version */
  plugins?: Iterable<{ package: string; version: string }>;
}): HostUsage {
  const packages: HostUsage['packages'] = {};
  for (const [name, versions] of Object.entries(args.installed))
    for (const version of versions) (packages[name] ??= {})[version] ??= 0;
  for (const taken of args.workers)
    for (const [name, version] of Object.entries(taken)) {
      const counts = (packages[name] ??= {});
      counts[version] = (counts[version] ?? 0) + 1;
    }
  const plugins: HostUsage['plugins'] = {};
  for (const p of args.plugins ?? []) plugins[p.package] = p.version;
  return { packages, plugins };
}

/** The statuses of a worker needing a look */
const PROBLEM_STATUSES = new Set([
  'unhealthy',
  'invalid',
  'needs-init',
  'needs-config',
]);
/** The problems named at most, and the notices: the counts tell the rest */
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
    notices: [],
  };
  for (const worker of workers) {
    summary.total++;
    const problem = PROBLEM_STATUSES.has(worker.status || '');
    if (worker.status === 'started') summary.started++;
    else if (worker.status === 'stopped') summary.stopped++;
    else if (problem) {
      summary.problem++;
      if (summary.problems.length < MAX_NAMED_PROBLEMS)
        summary.problems.push(worker);
    } else summary.other++;
    if (
      !problem &&
      (worker.heldBack || worker.migrationPending) &&
      summary.notices.length < MAX_NAMED_PROBLEMS
    )
      summary.notices.push(worker);
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

/**
 * A request Console makes itself, for no user: the jobs only Console may
 * ask of a host (a workspace key made, handed over, rotated). Taken only
 * from a stream of the link, with none of the user headers; Console never
 * passes it on for a user.
 */
export const HOST_CONSOLE_SERVICE_HEADER = 'x-sb-console-service';
