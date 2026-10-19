import { ApiField, ComplexType } from '@opra/common';
import { ElementMetadata } from './element-metadata.js';

@ComplexType()
export class AppMetadata extends ElementMetadata {
  constructor(init?: Partial<AppMetadata>) {
    super(init);
  }

  @ApiField({
    label: 'Class Type',
    description: 'Determines the type of the class',
    fixed: 'app',
  })
  declare classType: 'app';

  staticEvents?: Record<string, string>;
}
