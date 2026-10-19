import { ApiField, ArrayType, ComplexType } from '@opra/common';
import { ElementMetadata } from './element-metadata.js';

/**
 *
 */
@ComplexType()
export class ComponentMetadata extends ElementMetadata {
  constructor(init?: Partial<ComponentMetadata>) {
    super(init);
  }

  @ApiField({
    label: 'Class Type',
    description: 'Determines the type of the class',
    fixed: 'component',
  })
  declare classType: 'component';

  @ApiField({
    label: 'Interfaces',
    description: 'List of component URIs which this component implemented',
    type: ArrayType('string'),
  })
  declare interfaces: string[];
}
