import { ApiField, ArrayType, ComplexType, StringType } from '@opra/common';
import type { LocalizedText } from '../../registry/localized-text.js';
import { PluginPermission } from '../enums/plugin-permission.enum.js';
import { VariableMetadataRecord } from './variable-metadata.js';

/**
 * A plugin as its class defines it (`@Plugin` of @syncbridge/plugin-api):
 * what extends SyncBridge itself, in its main process
 */
@ComplexType()
export class PluginMetadata {
  constructor(init?: Partial<PluginMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Class Type',
    description: 'Determines the type of the class',
    fixed: 'plugin',
  })
  declare classType: 'plugin';

  @ApiField({
    label: 'Name',
    description:
      'The name the plugin is set by, `plugins.<name>`; unique among the installed packages',
    required: true,
    type: new StringType({ pattern: /^[a-z][a-z0-9-]*$/ }),
  })
  declare name: string;

  @ApiField({
    label: 'Class Name',
    description: 'Computer friendly class name',
    required: true,
  })
  declare className: string;

  @ApiField({
    label: 'Title',
    description:
      "Human friendly name: text, or text by language ({ en: '...', tr: '...' })",
    type: 'any',
  })
  declare title?: LocalizedText;

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
    label: 'Settings',
    description: 'The settings it is set with, under `plugins.<name>`',
  })
  declare settings?: VariableMetadataRecord;

  @ApiField({
    label: 'Permissions',
    description:
      'What it reaches beyond its own data directory: shown to the admins, given once they approve it',
    type: ArrayType(PluginPermission),
  })
  declare permissions?: PluginPermission[];

  @ApiField({
    label: 'Hosts',
    description:
      'The hosts it reaches, with the network permission: shown and approved, not held yet',
    type: ArrayType('string'),
  })
  declare hosts?: string[];
}
