import { AppBase } from '../classes/app-base.js';
import { ComponentBase } from '../classes/component-base.js';
import { Runnable } from '../classes/runnable.js';

const RUNNABLE_TOKEN = Symbol.for(Runnable.name);
const APP_BASE_TOKEN = Symbol.for(AppBase.name);
const COMPONENT_BASE_TOKEN = Symbol.for(ComponentBase.name);

export function isRunnable(proto: any): proto is Runnable {
  return !!proto[RUNNABLE_TOKEN];
}

export function isAppBase(proto: any): proto is AppBase {
  return !!proto[APP_BASE_TOKEN];
}

export function isComponentBase(proto: any): proto is ComponentBase {
  return !!proto[COMPONENT_BASE_TOKEN];
}
