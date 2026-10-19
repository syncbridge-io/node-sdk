import type { AppBase } from './app-base.js';
import { BaseElement } from './base-element.js';

export class ComponentBase<
  TEvents extends ComponentBase.Events = ComponentBase.Events,
> extends BaseElement<TEvents> {
  declare protected _context: ComponentBase.Context;
  readonly app: AppBase;
  readonly parent: AppBase | ComponentBase;
  readonly path: string;

  constructor(init: ComponentBase.InitArgs) {
    super(init);
    this.app = init.app;
    this.parent = init.parent;
    this.path = init.path;
  }
}

const COMPONENT_BASE_TOKEN = Symbol.for(ComponentBase.name);
ComponentBase.prototype[COMPONENT_BASE_TOKEN] = true;

/**
 * @namespace
 */
export namespace ComponentBase {
  export interface Events extends BaseElement.Events {}

  export interface InitArgs extends BaseElement.InitArgs {
    app: AppBase;
    parent: AppBase | ComponentBase;
    path: string;
  }

  export interface Context extends BaseElement.Context {
    parent: AppBase | ComponentBase;
    name: string;
    path: string;
  }
}
