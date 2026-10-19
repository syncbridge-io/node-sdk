import { ApiField, ComplexType } from '@opra/common';
import { LogOptions } from './log-options.js';

/**
 * WorkerComponentRecord
 */
@ComplexType({
  description: 'Container for profile components',
  additionalFields: () => ProfileComponent,
})
export class ProfileComponentRecord {
  [key: string]: ProfileComponent;
}

/**
 * ProfileComponentSettings
 */
@ComplexType()
export class ProfileComponentSettings {
  constructor(init?: Partial<ProfileComponentSettings>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Logs',
    description: 'Log settings of the component',
  })
  logs?: LogOptions;
}

/**
 * ProfileComponent
 */
@ComplexType({
  description: 'User defined variable definition',
})
export class ProfileComponent {
  @ApiField({
    description: 'URI of the component',
    examples: ['@syncbridge/net:TcpClient', '@syncbridge/serial:SerialClient'],
  })
  declare uri: string;

  @ApiField({
    label: 'Values',
    description: 'Values of user defined variables',
    type: 'object',
  })
  declare values?: Record<string, any>;

  @ApiField({
    label: 'Components',
    description: 'Sub components',
  })
  declare components?: ProfileComponentRecord;

  @ApiField({
    label: 'Settings',
    description: 'Settings of the component',
  })
  declare settings?: ProfileComponentSettings;

  @ApiField({
    label: 'Disabled',
    description: 'Determine if the component is disabled or not',
  })
  declare disabled?: boolean;
}
