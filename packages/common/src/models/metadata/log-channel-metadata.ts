import { ApiField, ArrayType, ComplexType } from '@opra/common';
import { LogChannelKind } from '../enums/log-channel-kind.js';
import { LogLevel } from '../enums/log-level.js';

/**
 * Log channels of an element: channel name -> definition
 */
@ComplexType({
  description: 'Log channels of an element',
  additionalFields: () => LogChannelMetadata,
})
export class LogChannelMetadataRecord {
  [key: string]: LogChannelMetadata;
}

/**
 * A log channel an element writes to, defined with `@LogChannel`
 */
@ComplexType({ description: 'A log channel an element writes to' })
export class LogChannelMetadata {
  constructor(init?: Partial<LogChannelMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    description:
      'Name of the channel within its element; its records and settings are keyed by it',
    required: true,
  })
  declare name: string;

  @ApiField({ description: 'The property the channel is assigned to' })
  declare propertyKey?: string;

  @ApiField({ label: 'Title', description: 'Human friendly name' })
  declare title?: string;

  @ApiField({ label: 'Description' })
  declare description?: string;

  @ApiField({ description: "How the channel's records are shown" })
  declare kind?: LogChannelKind;

  @ApiField({ description: 'Default level threshold of a text channel' })
  declare level?: LogLevel;

  @ApiField({ description: 'Default days the records are kept' })
  declare retentionDays?: number;

  @ApiField({ description: 'Whether the channel writes by default' })
  declare enabled?: boolean;

  @ApiField({
    type: ArrayType(String),
    description:
      "The events its records are of, which a profile may pick some of: read and write (the data received and sent), connect, disconnect, or the element's own",
  })
  declare events?: string[];
}
