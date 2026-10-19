import { ApiField, ArrayType, ComplexType } from '@opra/common';
import { LogLevel } from '../enums/log-level.js';

/**
 * Settings of a log channel, overriding its definition's defaults
 */
@ComplexType()
export class LogChannelSettings {
  constructor(init?: Partial<LogChannelSettings>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({ description: 'Whether the channel writes' })
  enabled?: boolean;

  @ApiField({ description: 'Level threshold of a text channel' })
  level?: LogLevel;

  @ApiField({ description: 'Days the records are kept' })
  retentionDays?: number;

  @ApiField({
    type: ArrayType(String),
    description:
      "The events written, of those the channel's definition names (read, write, connect, disconnect...); all when not given",
  })
  events?: string[];
}

/**
 * Settings of an element's log channels: channel name -> settings
 */
@ComplexType({
  description: "Settings of an element's log channels",
  additionalFields: () => LogChannelSettings,
})
export class LogChannelSettingsRecord {
  [key: string]: LogChannelSettings;
}

/**
 * LogOptions
 */
@ComplexType()
export class LogOptions {
  constructor(init?: Partial<LogOptions>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Level',
    description: 'Determines the log level',
  })
  level?: LogLevel;

  @ApiField({
    label: 'Error Stack',
    description: 'Determines if error stack will be logged or not',
  })
  errorStack?: boolean;

  @ApiField({
    label: 'Channels',
    description: "Settings of the element's log channels, by channel name",
  })
  channels?: LogChannelSettingsRecord;
}

/**
 * ProfileSettings
 */
@ComplexType()
export class ProfileLogOptions extends LogOptions {
  constructor(init?: Partial<ProfileLogOptions>) {
    super(init);
  }

  @ApiField({
    label: 'Pipe To Main',
    description: 'Determines if logs will be piped to application terminal',
  })
  pipeToMain?: boolean;
}
