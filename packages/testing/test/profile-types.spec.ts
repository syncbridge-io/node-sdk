import { ComponentBase } from '@syncbridge/common';
import { expect } from 'expect';
import { MockComponent, type ProfileOptions } from '../src/index.js';
import {
  DemoApp,
  SourceComponent,
  StoreComponent,
} from './_fixtures/demo-ext/src/index.js';

/**
 * The profile options are typed from the app class: these are checked
 * by the compiler, the `@ts-expect-error` lines being the mistakes it must
 * catch. At run time there is nothing to do.
 */
class FileStore extends StoreComponent {}
class SourceWithExtras extends SourceComponent {}

describe('profile option types', () => {
  it('should accept what the app declares', () => {
    const options: ProfileOptions<DemoApp>[] = [
      { values: { threshold: 5 } },
      {
        components: {
          source: { values: { factor: 2 } },
          store: FileStore,
          audit: false,
        },
      },
      /* A mock of the declared class, or a subclass with variables of its own */
      { components: { store: new MockComponent(StoreComponent) } },
      {
        components: { audit: { use: SourceWithExtras, values: { extra: 1 } } },
      },
      { components: { store: { use: 'other-ext:FileStore' } } },
    ];
    /* Nested variables in part */
    const nested: ProfileOptions<DemoApp> = {
      components: {
        source: { values: { factor: 2, retry: { maxDelay: 100 } } },
      },
    };
    expect(options).toHaveLength(5);
    expect(nested.components?.source).toBeDefined();
  });

  it('should refuse names and types the app does not declare', () => {
    const wrong: ProfileOptions<DemoApp>[] = [
      // @ts-expect-error threshold is a number
      { values: { threshold: 'many' } },
      // @ts-expect-error no such variable
      { values: { treshold: 5 } },
      // @ts-expect-error no such component
      { components: { storage: true } },
      // @ts-expect-error factor is a number
      { components: { source: { values: { factor: 'x' } } } },
      // @ts-expect-error a nested variable is typed too
      { components: { source: { values: { retry: { attempts: 'x' } } } } },
      // @ts-expect-error not a component class
      { components: { store: Date } },
    ];
    /* An untyped app takes anything */
    const loose: ProfileOptions<ComponentBase & { values: any }> = {
      values: { anything: true },
    };
    expect(wrong).toHaveLength(6);
    expect(loose.values).toBeDefined();
  });
});
