import 'reflect-metadata';
import type { AppBase } from '../classes/app-base.js';
import type { ComponentBase } from '../classes/component-base.js';
import { CLASS_METADATA } from '../constants.js';
import {
  type LogChannelKind,
  LogChannelMetadata,
  type LogLevel,
} from '../models/index.js';
import { defineOwnMetadata } from './decorator-helpers.js';

/**
 * Defines a log channel of an app or component, assigned to the
 * decorated property, which is declared `declare readonly` so a class
 * field does not overwrite it:
 *
 * ```ts
 * @LogChannel({ name: 'communication', kind: 'transmit' })
 * declare readonly ioLogChannel: LogChannel;
 * ```
 *
 * The channel's name defaults to the property's. Records and settings are
 * keyed by the name, so a channel whose property may be renamed is given
 * one. Subclasses inherit the channel.
 */
export function LogChannel(options: LogChannel.Options = {}) {
  return function (target: AppBase | ComponentBase, propertyKey: any) {
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');
    const name = options.name || propertyKey;
    const metadata = defineOwnMetadata(target.constructor, CLASS_METADATA);
    metadata.logChannels = metadata.logChannels || {};
    metadata.logChannels[name] = new LogChannelMetadata({
      ...(options as Partial<LogChannelMetadata>),
      kind: (options.kind || 'text') as LogChannelKind,
      name,
      propertyKey,
    });
  };
}

/**
 * A log channel: what a `@LogChannel` property holds
 */
export interface LogChannel {
  /** The name within its element */
  readonly name: string;
  /** The element's path and the name: `deviceIo/communication` */
  readonly fullName: string;
  readonly kind: LogChannelKind;
  /** Whether records are written; a disabled channel drops them at once */
  readonly enabled: boolean;
  write(record: LogChannel.Record): void;
  fatal(message: string, fields?: Record<string, any>): void;
  error(message: string, fields?: Record<string, any>): void;
  warn(message: string, fields?: Record<string, any>): void;
  info(message: string, fields?: Record<string, any>): void;
  verbose(message: string, fields?: Record<string, any>): void;
  debug(message: string, fields?: Record<string, any>): void;
  trace(message: string, fields?: Record<string, any>): void;
}

export namespace LogChannel {
  export interface Options {
    /** Default: the property's name */
    name?: string;
    title?: string;
    description?: string;
    /** Default: `text` */
    kind?: LogChannelKind | `${LogChannelKind}`;
    /** Default level threshold of a text channel */
    level?: LogLevel | `${LogLevel}`;
    /** Default days the records are kept */
    retentionDays?: number;
    /** Default: true */
    enabled?: boolean;
    /**
     * The events its records are of, which a profile may pick some of
     * (settings `events`): `read` and `write` for the data received and
     * sent, `connect`, `disconnect`, or the element's own
     */
    events?: string[];
  }

  /** A record written to a channel */
  export interface Record {
    level?: LogLevel | `${LogLevel}`;
    message?: string;
    /** Of a transmit channel: received, sent, or a note */
    direction?: 'in' | 'out' | 'info';
    /**
     * What happened, as a profile picks the records by (settings
     * `events`): `connect`, `disconnect`, or the element's own. Data
     * received is `read` and sent `write` without it being given.
     */
    event?: string;
    /**
     * A short note on the record, shown and searched with it: e.g. the
     * other side of a transmission, `10.0.0.5:2575`, `/dev/ttyUSB0`
     */
    details?: string;
    /** Raw content */
    data?: Uint8Array | string;
    /** Fields of the channel's own */
    fields?: { [key: string]: any };
  }

  /** A record as a channel hands it on */
  export interface Entry extends Record {
    /** When it was written: a record's only time */
    time: Date;
    /** The path of the element that wrote it; '' for the app */
    source: string;
  }

  /**
   * Where a worker's channels hand their records: the channel's full name
   * and the record
   */
  export type Sink = (channel: string, entry: Entry) => void;
}
