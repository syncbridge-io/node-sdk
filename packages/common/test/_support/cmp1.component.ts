import { Component, ComponentBase, DefineVariable } from '../../src/index.js';

export class Cmp1Variables {
  @DefineVariable({
    required: true,
    hotPlug: true,
  })
  declare var1: string;

  @DefineVariable({
    default: 'xyz',
  })
  declare var2?: string;

  @DefineVariable({
    ignored: true,
  })
  declare varIgnored?: string;
}

@Component({
  displayName: 'Component-1',
})
export class Cmp1Component extends ComponentBase {
  @Component.UseVariables(Cmp1Variables)
  declare values: any;
}
