import {
  App,
  AppBase,
  Component,
  ComponentBase,
  DefineVariable,
  Profile,
  VariableType,
} from '@syncbridge/common';

/** How a source retries a read: values nested in its own */
export class SourceRetryVariables {
  @DefineVariable({ type: VariableType.Number, default: 3 })
  declare attempts: number;

  @DefineVariable({ type: VariableType.Number, default: 1000 })
  declare maxDelay: number;
}

export class SourceVariables {
  @DefineVariable({ type: VariableType.Number, default: 1 })
  declare factor: number;

  @DefineVariable({})
  declare retry: SourceRetryVariables;
}

/** Reads a value; a concrete class, so a profile can use it as it is */
@Component({ className: 'Source' })
export class SourceComponent extends ComponentBase {
  @Component.UseVariables(SourceVariables)
  declare values: SourceVariables;

  async read(): Promise<number> {
    return (await this.fetchRaw()) * this.values.factor;
  }

  /** The step that reaches outside: a device, in a real component */
  protected async fetchRaw(): Promise<number> {
    return 10;
  }
}

/** Where results go: only an interface, a test has to give a class */
@Component({ className: 'Store', abstract: true })
export class StoreComponent extends ComponentBase {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async save(value: number): Promise<void> {
    throw new Error('Not implemented');
  }
}

export class DemoVariables {
  @DefineVariable({ type: VariableType.Number, required: true })
  declare threshold: number;
}

@App({ displayName: 'Demo' })
export class DemoApp extends AppBase {
  @App.UseVariables(DemoVariables)
  declare values: DemoVariables;

  @App.UseComponent({ required: true })
  declare readonly source: SourceComponent;

  @App.UseComponent({ required: true })
  declare readonly store: StoreComponent;

  @App.UseComponent()
  declare readonly audit?: SourceComponent;

  protected async _start(abortSignal?: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this.logger?.info('Demo started');
  }

  @App.OnCreateProfile()
  static onCreateProfile(profile: Profile): void {
    profile.values = { threshold: 5, ...profile.values };
  }

  /** Saves what the source reads when it is over the threshold */
  async run(): Promise<boolean> {
    const value = await this.source.read();
    if (value <= this.values.threshold) {
      this.logger?.warn(`${value} is under the threshold`);
      return false;
    }
    await this.store.save(value);
    return true;
  }
}
