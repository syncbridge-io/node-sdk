import type { LogChannel } from '../decorators/log-channel.decorator.js';
import {
  LogChannelKind,
  type LogChannelMetadata,
  type LogChannelSettings,
  LogLevel,
} from '../models/index.js';

/** Lower is more severe; the same order as the engine's loggers */
const LEVEL_ORDER: Record<string, number> = {
  fatal: 10,
  critical: 20,
  error: 30,
  warn: 40,
  info: 50,
  verbose: 60,
  trace: 60,
  debug: 70,
};

/**
 * The LogChannel a `@LogChannel` property holds: it applies the channel's
 * settings and hands what passes them to the worker's sink.
 */
export class LogChannelWriter implements LogChannel {
  enabled = true;
  level?: LogLevel;
  /** The events written; all when not set */
  events?: Set<string>;

  constructor(
    readonly metadata: LogChannelMetadata,
    /** The path of the element it belongs to; '' for the app */
    readonly source: string,
    protected _sink?: LogChannel.Sink,
  ) {
    this.configure();
  }

  get name(): string {
    return this.metadata.name;
  }

  get fullName(): string {
    return this.source ? this.source + '/' + this.name : this.name;
  }

  get kind(): LogChannelKind {
    return this.metadata.kind || LogChannelKind.text;
  }

  /** Applies the profile's settings over the definition's defaults */
  configure(settings?: LogChannelSettings, sink = this._sink) {
    this._sink = sink;
    this.enabled = settings?.enabled ?? this.metadata.enabled ?? true;
    this.level = settings?.level ?? this.metadata.level;
    this.events = settings?.events ? new Set(settings.events) : undefined;
  }

  write(record: LogChannel.Record): void {
    if (!this.enabled || !this._sink) return;
    const event = eventOf(record);
    if (this.events && event && !this.events.has(event)) return;
    if (
      this.level &&
      record.level &&
      (LEVEL_ORDER[record.level] ?? 0) > (LEVEL_ORDER[this.level] ?? 100)
    )
      return;
    this._sink(this.fullName, {
      ...record,
      ...(event ? { event } : {}),
      time: new Date(),
      source: this.source,
    });
  }

  fatal(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.fatal, message, fields });
  }

  error(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.error, message, fields });
  }

  warn(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.warn, message, fields });
  }

  info(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.info, message, fields });
  }

  verbose(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.verbose, message, fields });
  }

  debug(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.debug, message, fields });
  }

  trace(message: string, fields?: Record<string, any>) {
    this.write({ level: LogLevel.trace, message, fields });
  }
}

/** The event a record is of: its own, or read / write for data */
function eventOf(record: LogChannel.Record): string | undefined {
  if (record.event) return record.event;
  if (record.direction === 'in') return 'read';
  if (record.direction === 'out') return 'write';
}
