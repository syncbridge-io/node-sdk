import { App, AppBase, DefineVariable, VariableType } from '../../src/index.js';
import { Cmp1Component } from './cmp1.component.js';

export class Prc1Variables {
  @DefineVariable({
    required: true,
    hotPlug: true,
  })
  declare var1: string;

  @DefineVariable({
    default: 'abc',
  })
  declare var2?: string;

  @DefineVariable({
    type: VariableType.Number,
  })
  declare varNum?: number;

  @DefineVariable({
    type: VariableType.Nested,
    variables: {
      n1: { type: VariableType.String },
    },
  })
  declare varNested?: any;

  @DefineVariable({
    type: VariableType.Secret,
  })
  declare varSecret?: string;
}

@App({
  displayName: 'App-1',
})
export class Prc1App extends AppBase {
  @App.UseVariables(Prc1Variables)
  declare values: any;

  @App.UseComponent({
    uri: Cmp1Component.uri,
    required: true,
  })
  declare cmp1: Cmp1Component;

  @App.UseComponent({
    uri: Cmp1Component.uri,
  })
  declare cmp2: Cmp1Component;
}
