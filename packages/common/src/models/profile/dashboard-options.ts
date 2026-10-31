import { ApiField, ArrayType, ComplexType } from '@opra/common';

/**
 * A worker's dashboard as its users set it: shared by all of them
 */
@ComplexType()
export class ProfileDashboardOptions {
  constructor(init?: Partial<ProfileDashboardOptions>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    type: ArrayType(String),
    label: 'Hidden',
    description:
      'The widgets and sections hidden, by path: hidden for every user',
  })
  hidden?: string[];
}
