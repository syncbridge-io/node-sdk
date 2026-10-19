import { EventEmitter } from 'node:events';
import { Component, ComponentBase } from '@syncbridge/common';
import type { Type } from 'ts-gems';

/** A component class, abstract ones included */
export type ComponentClass<T extends ComponentBase = ComponentBase> =
  abstract new (...args: any[]) => T;

const MOCK = Symbol.for('@syncbridge/testing:mock');
let mockSeq = 0;

/**
 * Replacements for a component's methods. Public ones are typed from the
 * class; protected ones, which TypeScript does not let a type name, are
 * accepted by name and checked against the class when the mock is made.
 */
export type MockImplementation<T> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => infer R
    ? (this: T, ...args: A) => R
    : never;
} & { [method: string]: ((this: T, ...args: any[]) => any) | undefined };

/** A method of T: a public one by its typed name, a protected one by name */
export type MethodName<T> = (keyof T & string) | (string & {});

export interface MockOptions {
  /**
   * Whether the class's own init, start and stop run. Off, the mock does
   * nothing when the app starts it: for a component that connects to
   * something the test does not have. Default: on.
   */
  lifecycle?: boolean;
}

/**
 * A component class standing in for another: a subclass of it, so it has
 * the same variables, interfaces and methods, with the methods given in
 * `impl` replaced and every call to its public and protected methods
 * recorded. Replacing a protected method lets the class's own flow run
 * and stops it at the step that reaches outside, e.g. a write to a HIS.
 */
export class MockComponent<T extends ComponentBase = ComponentBase> {
  readonly [MOCK] = true;
  readonly class: Type<T>;
  /** Instances the app created, in order */
  readonly instances: T[] = [];
  protected readonly _calls = new Map<string, any[][]>();
  protected readonly _events = new EventEmitter();

  constructor(
    readonly target: ComponentClass<T>,
    impl: MockImplementation<T> = {},
    options: MockOptions = {},
  ) {
    const handle = this;
    const baseName = (target as any).className || target.name;
    const className = `${baseName.replace(/Component$/, '')}Mock${++mockSeq}`;
    for (const name of Object.keys(impl))
      if (!hasMethod(target, name))
        throw new TypeError(
          `${target.name} has no method "${name}" to replace`,
        );
    const methods = [...new Set([...ownMethods(target), ...Object.keys(impl)])];
    const Base = target as unknown as Type<ComponentBase>;

    const Mock = class extends Base {
      constructor(...args: any[]) {
        super(...(args as [any]));
        handle.instances.push(this as any);
        for (const name of methods) {
          const fn = (impl as any)[name] ?? (this as any)[name];
          (this as any)[name] = function (this: any, ...a: any[]) {
            handle._record(name, a);
            return fn.apply(this, a);
          };
        }
        if (options.lifecycle === false) {
          (this as any)._init = async () => {};
          (this as any)._start = async () => {};
          (this as any)._stop = async () => {};
        }
      }
    };
    Object.defineProperty(Mock, 'name', { value: className });
    Component({ className, displayName: `${baseName} (mock)` })(Mock);
    this.class = Mock as unknown as Type<T>;
  }

  get uri(): string {
    return (this.class as any).uri;
  }

  /** The instance the app created last */
  get instance(): T | undefined {
    return this.instances.at(-1);
  }

  /** The arguments of each call to `method`, in order */
  calls(method: MethodName<T>): any[][] {
    return this._calls.get(method) || [];
  }

  /**
   * Resolves with the arguments of the next call to `method`, or of the
   * first one when it was called already: for an app that calls its
   * components asynchronously, after data arrives
   */
  waitForCall(
    method: MethodName<T>,
    options: { timeout?: number } = {},
  ): Promise<any[]> {
    const done = this.calls(method).at(0);
    if (done) return Promise.resolve(done);
    const timeout = options.timeout ?? 5000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._events.off(method, resolve);
        reject(
          new Error(`Timed out after ${timeout}ms waiting for ${method}()`),
        );
      }, timeout);
      this._events.once(method, args => {
        clearTimeout(timer);
        resolve(args);
      });
    });
  }

  /** Forgets the calls recorded so far */
  clear() {
    this._calls.clear();
  }

  protected _record(method: string, args: any[]) {
    let list = this._calls.get(method);
    if (!list) this._calls.set(method, (list = []));
    list.push(args);
    this._events.emit(method, args);
  }
}

export function isMockComponent(x: unknown): x is MockComponent<any> {
  return !!(x as any)?.[MOCK];
}

/** Whether `name` is a method anywhere in `target`'s prototype chain */
function hasMethod(target: Function, name: string): boolean {
  for (let p = target.prototype; p; p = Object.getPrototypeOf(p)) {
    const desc = Object.getOwnPropertyDescriptor(p, name);
    if (desc) return typeof desc.value === 'function';
  }
  return false;
}

/**
 * Methods declared from `target` down to ComponentBase, public and
 * protected: the ones recorded. Lifecycle methods (`_init`...) and those of
 * the base classes stay out.
 */
function ownMethods(target: Function): string[] {
  const names = new Set<string>();
  let proto = target.prototype;
  while (proto && proto !== ComponentBase.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name.startsWith('_')) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof desc?.value === 'function') names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}
