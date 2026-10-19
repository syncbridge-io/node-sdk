import { Component, DefineVariable } from '../../src/index.js';
import { Cmp1Component, Cmp1Variables } from './cmp1.component.js';

export class Cmp1_1Variables extends Cmp1Variables {
  @DefineVariable()
  declare var3: string;
}

@Component({
  displayName: 'Component-1-1',
})
export class Cmp1_1Component extends Cmp1Component {
  @Component.UseVariables(Cmp1_1Variables)
  declare values: any;
}
