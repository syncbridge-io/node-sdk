import type { ILogger } from '@syncbridge/common';

const LEVELS = [
  'fatal',
  'critical',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

export type LogLevel = (typeof LEVELS)[number];

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** The component the entry came from, as its path in the profile */
  component?: string;
  meta: Record<string, any>;
  error?: Error;
}

/**
 * An ILogger keeping every entry in memory, children included, so a test
 * can look at what an app and its components logged. With `echo`,
 * entries are printed as well.
 */
export class MemoryLogger implements ILogger {
  level = 'trace';
  declare fatal: ILogger['fatal'];
  declare critical: ILogger['critical'];
  declare error: ILogger['error'];
  declare warn: ILogger['warn'];
  declare info: ILogger['info'];
  declare debug: ILogger['debug'];
  declare trace: ILogger['trace'];

  constructor(
    readonly entries: LogEntry[] = [],
    protected readonly _meta: Record<string, any> = {},
    protected readonly _echo = false,
  ) {
    for (const level of LEVELS)
      this[level] = ((message: any, ...meta: any[]) =>
        this._log(level, message, meta)) as any;
  }

  child(options: object): ILogger {
    return new MemoryLogger(
      this.entries,
      { ...this._meta, ...options },
      this._echo,
    );
  }

  close(): void {}

  protected _log(level: LogLevel, message: any, meta: any[]): ILogger {
    const entry: LogEntry = {
      level,
      message: '',
      meta: { ...this._meta },
    };
    if (message instanceof Error) {
      entry.error = message;
      entry.message = message.message;
    } else if (message && typeof message === 'object') {
      const { message: msg, ...rest } = message;
      entry.message = String(msg ?? '');
      Object.assign(entry.meta, rest);
    } else entry.message = String(message);
    for (const m of meta) {
      if (m instanceof Error) entry.error = entry.error || m;
      else if (m && typeof m === 'object') Object.assign(entry.meta, m);
    }
    if (entry.meta.component) entry.component = entry.meta.component;
    this.entries.push(entry);
    if (this._echo)
      console.log(
        `[${level}]${entry.component ? ` ${entry.component}:` : ''} ${entry.message}`,
      );
    return this;
  }
}

/** An app's log entries, with shortcuts for the levels tests check */
export class LogRecord extends Array<LogEntry> {
  get errors(): LogEntry[] {
    return this.filter(e => ['fatal', 'critical', 'error'].includes(e.level));
  }

  get warnings(): LogEntry[] {
    return this.filter(e => e.level === 'warn');
  }

  /** The messages alone, for a readable assertion */
  get messages(): string[] {
    return this.map(e => e.message);
  }
}
