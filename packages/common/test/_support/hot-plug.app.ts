import { App, AppBase, DefineVariable, VariableType } from '../../src/index.js';

/** A row of a list of groups */
export class HotRowVariables {
  @DefineVariable()
  declare code?: string;

  @DefineVariable()
  declare unit?: string;
}

/** A group whose own settings are not marked hot-plug */
export class HotLimitVariables {
  @DefineVariable({ type: VariableType.Number })
  declare min?: number;

  @DefineVariable({ type: VariableType.Number })
  declare max?: number;
}

export class HotPlugVariables {
  @DefineVariable({ variables: HotRowVariables, hotPlug: true })
  declare rows?: HotRowVariables[];

  @DefineVariable({ type: VariableType.String, hotPlug: true })
  declare tags?: string[];

  @DefineVariable({ variables: HotLimitVariables, hotPlug: true })
  declare limits?: HotLimitVariables;

  @DefineVariable({ variables: HotRowVariables })
  declare cold?: HotRowVariables[];
}

/** An app with hot-plug lists and a hot-plug group */
@App({ displayName: 'Hot plug' })
export class HotPlugApp extends AppBase {
  @App.UseVariables(HotPlugVariables)
  declare values: HotPlugVariables;
}
