import { ApiField, ComplexType, StringType } from '@opra/common';

/**
 *
 */
@ComplexType()
export class PackageMetadata {
  constructor(init?: Partial<PackageMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    label: 'Name',
    description: 'Uniquely identifies the package',
    required: true,
    type: new StringType({
      pattern: /^[a-z][a-z_-]+$/,
    }),
  })
  declare name: string;
}
