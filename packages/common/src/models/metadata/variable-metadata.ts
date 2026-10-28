import { ApiField, ArrayType, ComplexType } from '@opra/common';
import type { LocalizedText } from '../../registry/localized-text.js';
import { EnumSource } from '../enums/enum-source.enum.js';
import { VariableFormat } from '../enums/variable-format.enum.js';
import { VariableType } from '../enums/variable-type.enum.js';

/**
 *
 */
@ComplexType({
  description: 'User defined variables',
  additionalFields: () => VariableMetadata,
})
export class VariableMetadataRecord {
  [key: string]: VariableMetadata;
}

/**
 *
 */
@ComplexType({
  description: 'User defined variable definition',
})
export class VariableMetadata {
  ignored?: boolean;

  @ApiField({
    description:
      'Index of the variable. Variables with higher index will be displayed first',
  })
  declare index?: number;

  @ApiField({
    description:
      'Determine if the variable can be changed while worker running',
  })
  hotPlug?: boolean;

  @ApiField({
    description:
      "Its label: text, or text by language ({ en: '...', tr: '...' }) - shown in the server's UI and the Marketplace in the reader's language",
    type: 'any',
  })
  declare label?: LocalizedText;

  @ApiField({
    description:
      "What it is for: text, or text by language ({ en: '...', tr: '...' })",
    type: 'any',
  })
  declare description?: LocalizedText;

  @ApiField({
    description: 'Examples of the variable value.',
    type: ArrayType(String),
  })
  declare examples?: string[];

  @ApiField({
    description: 'Choices of the variable',
    type: ArrayType(String),
  })
  declare choice?: string[];

  @ApiField({
    description: 'Data type of the variable',
    type: VariableType,
  })
  declare type?: VariableType;

  @ApiField({
    description: 'Nested variables. Available if type is object',
  })
  declare variables?: VariableMetadataRecord;

  @ApiField({
    description: 'Format of the variable. Available if type is string',
    type: VariableFormat,
  })
  declare format?: VariableFormat;

  @ApiField({
    description: 'List of values. Available if type is enum',
    type: 'string',
  })
  declare enumValues?: (string | number)[];

  @ApiField({
    description:
      'Where the values come from when they depend on the server: filled in by SyncBridge as the list is asked for, as suggestions (enumStrict false). Available if type is enum',
    type: EnumSource,
  })
  declare enumSource?: EnumSource;

  @ApiField({
    description:
      'Whether the value must be one of enumValues (default) or may be any other value of their type, ' +
      'enumValues being suggestions: e.g. the serial ports seen when the list was read, while a device ' +
      'plugged in later must still be accepted. Available if type is enum',
  })
  declare enumStrict?: boolean;

  @ApiField({
    description: 'Determine if the variable is an array or not',
  })
  declare isArray?: boolean;

  @ApiField({
    description: 'Determines if "null" values is allowed',
  })
  declare nullable?: boolean;

  @ApiField({
    description:
      'Minimum number of items in the array. Available if isArray is true',
  })
  declare minOccurs?: number;

  @ApiField({
    description:
      'Maximum number of items in the array. Available if isArray is true',
  })
  declare maxOccurs?: number;

  @ApiField({
    description: 'Determine if the variable is required or not',
  })
  declare required?: boolean;

  @ApiField({
    description: 'Default value of the variable',
  })
  declare default?: any;

  @ApiField({
    description:
      'Regex pattern for the variable value. Available if type is string',
  })
  declare pattern?: string;

  @ApiField({
    description: 'Minimum value for the variable',
  })
  declare minValue?: string | number;

  @ApiField({
    description: 'Maximum value for the variable',
  })
  declare maxValue?: string | number;

  @ApiField({
    description: 'Width of the variable in the UI',
  })
  declare displayWidth?: number;

  @ApiField({
    description:
      "The names it had in the module's earlier versions: a profile written with one has its value moved here, if it has none here. Every earlier name, not the last alone",
    type: ArrayType(String),
  })
  declare formerly?: string[];

  @ApiField({
    description:
      "Values of its choices renamed since the module's earlier versions, by what they were ({ tcp: 'tcp-client' }): a profile written with one has it replaced. Available if type is enum",
    type: 'object',
  })
  declare formerlyValues?: Record<string, string | number>;

  @ApiField({
    description:
      "How SyncBridge's settings screen treats it, as a log target's or plugin's setting: hidden, not shown there; readonly, shown and not changed there. Either is set only where SyncBridge is deployed. Default: shown and changed there",
  })
  declare ui?: 'hidden' | 'readonly';
}
