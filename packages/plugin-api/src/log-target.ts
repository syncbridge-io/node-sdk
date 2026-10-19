import type { Type } from 'ts-gems';

/**
 * Where copies of the log records go besides the store: the console, files,
 * or a service such as Elasticsearch. A target only writes; the UI reads
 * the store.
 *
 * A target is registered by name (`host.logs.registerTarget`) and set in
 * the config under that name, `logs.targets.<name>`. SyncBridge registers
 * `console` and `file`.
 */
export interface LogTarget {
  /** Writes a record. A target that fails throws; the record is not retried */
  write(record: LogTarget.Record): void | Promise<void>;
  /** Writes what the target holds back, if it batches */
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export namespace LogTarget {
  /**
   * A record as a target gets it: what the store keeps, with the log it is
   * of. Its time is the server's, in its zone (`2026-10-13T00:12:05.123+03:00`).
   */
  export interface Record {
    /** The log: `Engine`, or `worker_<id>` */
    log: string;
    /** The worker's id, for a worker's log */
    workerId?: string;
    /** The record's channel: `console`, or one an app or component writes to */
    channel: string;
    timestamp: string;
    level: string;
    message?: string;
    /** Of a transmit channel: received (in), sent (out), or a note (info) */
    direction?: string;
    /** A short note on the record, e.g. the other side of a transmission */
    details?: string;
    /** Raw content of a transmit record */
    data?: string;
    /** `base64` when `data` is binary */
    dataEncoding?: string;
    /** Path of the element that wrote it */
    source?: string;
    context?: string;
    stack?: string;
    [key: string]: any;
  }

  /** A target as it is registered */
  export interface Definition<TValues = any> {
    /** The name it is set by: `logs.targets.<name>`; lower case, `-` allowed */
    name: string;
    title?: string;
    description?: string;
    /**
     * Whether it writes when the config does not set `enabled`. False for a
     * target a plugin registers: installing it does not send the logs
     * anywhere until it is set to.
     */
    enabledByDefault?: boolean;
    /**
     * The target's own settings, defined with @DefineVariable: checked and
     * given their defaults when the target starts, shown by the API
     */
    variables?: Type;
    /** Makes the target from its settings, as checked */
    create(values: TValues): LogTarget | Promise<LogTarget>;
  }

  /** The settings every target has, besides its own */
  export interface CommonSettings {
    enabled: boolean;
    /** The least severe level written; default: logs.level */
    level?: string;
    /** Whether errors' stacks are written; default: logs.errorStack */
    errorStack?: boolean;
    /** Channels written, `*` for all; default: the console */
    channels: string[];
  }
}
