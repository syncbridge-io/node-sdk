import { ApiField, ArrayType, ComplexType } from '@opra/common';
import type { LocalizedText } from '../../registry/localized-text.js';
import type { ModuleSummary } from '../../registry/module-catalog.js';
import { WorkerPermission } from '../enums/worker-permission.enum.js';
import type { ElementComponentMetadataRecord } from './element-component-metadata.js';
import { LogChannelMetadataRecord } from './log-channel-metadata.js';
import { VariableMetadataRecord } from './variable-metadata.js';

/**
 *
 */
@ComplexType()
export class ElementMetadata {
  constructor(init?: Partial<ElementMetadata>) {
    if (init) Object.assign(this, init);
  }

  abstract?: boolean;

  @ApiField({
    description: 'URI of the element',
    examples: ['@syncbridge/net:TcpClient', '@syncbridge/serial:SerialClient'],
  })
  declare uri: string;

  @ApiField({
    label: 'Class Name',
    description: 'Computer friendly class name',
    required: true,
  })
  declare className: string;

  @ApiField({
    label: 'Formerly',
    description:
      "The class names it had in its package's earlier versions: a profile naming one is read as naming it. Its own, not its base's",
    type: ArrayType('string'),
  })
  declare formerly?: string[];

  @ApiField({
    label: 'Version',
    description: 'Version of the class',
    examples: ['0.2.1', '2.1.5', '1.18.1-alpha.1'],
    required: true,
  })
  declare version: string;

  @ApiField({
    label: 'Name',
    description:
      "Human friendly name: text, or text by language ({ en: '...', tr: '...' }) - shown in the reader's language; spm takes the package's locales/ into it",
    required: true,
    type: 'any',
  })
  declare displayName: LocalizedText;

  @ApiField({
    label: 'Icon',
    description: 'Icon url',
  })
  declare iconUrl?: string;

  @ApiField({
    label: 'Description',
    description:
      "Long description: text, or text by language ({ en: '...', tr: '...' })",
    type: 'any',
  })
  declare description?: LocalizedText;

  @ApiField({
    label: 'README',
    description:
      'Its README among the package\'s documents: "docs/<ClassName>/README.md", told by spm; read from the registry, not in what is installed',
  })
  declare readme?: string;

  @ApiField({
    label: 'Variables',
    description: 'User defined variables',
  })
  declare variables?: VariableMetadataRecord;

  @ApiField({
    type: async () =>
      (await import('./element-component-metadata.js'))
        .ElementComponentMetadataRecord,
    label: 'Components',
    description: 'Components',
  })
  declare components?: ElementComponentMetadataRecord;

  @ApiField({
    label: 'Log channels',
    description: 'Log channels the element writes to, besides its console',
  })
  declare logChannels?: LogChannelMetadataRecord;

  @ApiField({
    label: 'Summary',
    description:
      "What it is for, in a sentence: the Marketplace's card and search. One in the package's docs language, or one per language ({ en: '...', tr: '...' }); spm keeps it by language",
    type: 'any',
  })
  declare summary?: ModuleSummary;

  @ApiField({
    label: 'Screenshots',
    description:
      'How it looks: images among its documents (docs/<ClassName>/...), shown on its page in the Marketplace - not installed. 8 at most',
    type: ArrayType('string'),
  })
  declare screenshots?: string[];

  @ApiField({
    label: 'Tags',
    description: 'Tags of the component. Tags are used to group components',
    type: ArrayType('string'),
  })
  declare tags: string[];

  @ApiField({
    label: 'Permissions',
    description:
      "What of the server it reaches beyond its worker's own directory: its worker is given it. A subclass has its base's too",
    type: ArrayType(WorkerPermission),
  })
  declare permissions?: WorkerPermission[];
}
