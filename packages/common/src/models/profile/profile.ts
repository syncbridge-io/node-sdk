import { ApiField, ComplexType } from '@opra/common';
import { ProfileLogOptions } from './log-options.js';
import { ProfileComponentRecord } from './profile-component.js';

/**
 * ProfileSettings
 */
@ComplexType()
export class ProfileSettings {
  constructor(init?: Partial<ProfileSettings>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Auto Start',
    description: 'Determines if the app will be auto started or not',
  })
  autostart?: boolean;

  @ApiField({
    label: 'Logs',
    description: 'Log settings of the app',
  })
  logs?: ProfileLogOptions;
}

/**
 * Profile
 */
@ComplexType()
export class Profile {
  constructor(init?: Partial<Profile>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Identity',
    description: 'Uniquely identifies the profile',
    required: true,
  })
  declare id: string;

  @ApiField({
    label: 'Display Name',
    description: 'Human friendly name of the profile to be displayed in the UI',
    required: true,
  })
  declare displayName: string;

  @ApiField({
    label: 'App URI',
    description: 'URI of the app',
    required: true,
  })
  declare appUri: string;

  @ApiField({
    label: 'App Version',
    description:
      'Determines which installed version will be used. This value accepts semver format. https://semver.npmjs.com/',
  })
  declare appVersion?: string;

  @ApiField({
    label: 'Written with',
    description:
      "The version of its app its values were last written with: the engine's to set, on every save - what a migration starts from",
  })
  declare writtenWith?: string;

  @ApiField({
    label: 'Group',
    description: 'Group of the profile. Profiles are grouped by this value',
  })
  declare group?: string;

  @ApiField({
    label: 'Description',
    description: 'Long description',
  })
  declare description?: string;

  @ApiField({
    label: 'Icon',
    description: 'Icon url',
  })
  declare iconUrl?: string;

  @ApiField({
    label: 'Values',
    description: 'Values of user defined variables',
    type: 'object',
  })
  declare values?: Record<string, any>;

  @ApiField({
    label: 'Components',
    description: 'Components of the app',
  })
  declare components?: ProfileComponentRecord;

  @ApiField({
    label: 'Settings',
    description: 'Settings of the app',
  })
  declare settings?: ProfileSettings;
}
