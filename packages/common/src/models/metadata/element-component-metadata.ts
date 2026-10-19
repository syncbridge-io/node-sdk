import { ApiField, ComplexType } from '@opra/common';
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
    label: 'Description',
    description: 'Description of the component',
  })
  declare description?: string;

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
    label: 'Components',
    description: 'Components settings of the app',
  })
  declare components?: ElementComponentMetadataRecord;

  @ApiField({
    label: 'Log channels',
    description: 'Log channels of the assigned class, besides its console',
  })
  declare logChannels?: LogChannelMetadataRecord;
}
