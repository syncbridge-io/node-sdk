import { ApiField, ArrayType, ComplexType } from '@opra/common';
import type { LocalizedText } from '../../registry/localized-text.js';
import { DashboardMetadataRecord } from './dashboard-metadata.js';
import { LogChannelMetadataRecord } from './log-channel-metadata.js';
import { VariableMetadataRecord } from './variable-metadata.js';

/**
 *
 */
@ComplexType({
  description: 'Container for app components',
  additionalFields: () => ElementComponentMetadata,
})
export class ElementComponentMetadataRecord {
  [key: string]: ElementComponentMetadata;
}

/**
 *
 */
@ComplexType({
  description: 'User defined variable definition',
})
export class ElementComponentMetadata {
  propertyKey?: string;

  @ApiField({
    label: 'Class URI',
    description: 'The interface URI that the assigned class should implement.',
    examples: ['@syncbridge/builtin:IoClient'],
    required: true,
  })
  declare interfaceUri: string;

  @ApiField({
    label: 'One of',
    description:
      'The interfaces the assigned class may implement, one of them: a slot taking either of two kinds (an HL7 client or server). interfaceUri is the first of them, for what reads that alone',
    type: ArrayType('string'),
  })
  declare oneOf?: string[];

  @ApiField({
    label: 'Interface URI',
    description: 'The required in URI for the class to be assigned.',
    examples: ['@syncbridge/net:TcpClient', '@syncbridge/sqb:SqbClient'],
  })
  declare classUri?: string;

  @ApiField({
    label: 'Version',
    description: 'Version of the class',
    examples: ['0.2.1', '2.1.5', '1.18.1-alpha.1'],
  })
  declare version?: string;

  @ApiField({
    label: 'Formerly',
    description:
      "The names the slot had in the module's earlier versions: a profile written with one has its component moved here, if it has none here",
    type: ArrayType('string'),
  })
  declare formerly?: string[];

  @ApiField({
    label: 'Label',
    description:
      "The slot's short name: text, or text by language ({ en: 'Mirror stream', tr: 'Ayna akışı' }) - shown in the reader's language where the slot is named, its key in words when not given; spm takes the package's locales/ into it",
    type: 'any',
  })
  declare label?: LocalizedText;

  @ApiField({
    label: 'Description',
    description:
      "What the slot is for: text, or text by language ({ en: '...', tr: '...' }) - shown in the reader's language; spm takes the package's locales/ into it",
    type: 'any',
  })
  declare description?: LocalizedText;

  @ApiField({
    label: 'Required',
    description: 'Determine if the component is required or not',
  })
  declare required?: boolean;

  @ApiField({
    label: 'Variables',
    description: 'Variables to be overridden',
  })
  declare variables?: VariableMetadataRecord;

  @ApiField({
    label: 'Variables by class',
    description:
      "Variables to be overridden for one class of a oneOf slot alone, by its class name: { PacketCapture: { filter: { default: 'udp port 24000' } } } - over `variables`",
    type: 'any',
  })
  declare variablesOf?: Record<string, VariableMetadataRecord>;

  @ApiField({
    label: 'Components',
    description: 'Components settings of the app',
  })
  declare components?: ElementComponentMetadataRecord;

  @ApiField({
    label: 'Log channels',
    description: 'Log channels of the assigned class, besides its console',
  })
  declare logChannels?: LogChannelMetadataRecord;

  @ApiField({
    label: 'Dashboards',
    description: 'The dashboards of the assigned class',
  })
  declare dashboards?: DashboardMetadataRecord;
}
