import 'reflect-metadata';
import { expect } from 'expect';
import {
  App,
  AppBase,
  CLASS_METADATA,
  CLASS_TYPE,
  DefineVariable,
} from '../../src/index.js';

describe('App Decorator', () => {
  it('should define metadata for an app', () => {
    @App({
      displayName: 'My App',
      description: 'My Description',
    })
    class MyApp extends AppBase {}

    const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyApp);
    expect(metadata.displayName).toBe('My App');
    expect(metadata.description).toBe('My Description');
    expect(MyApp.className).toBe('MyApp');
    expect(MyApp.uri.endsWith(':MyApp')).toBeTruthy();
  });

  it('should use className from options if provided', () => {
    @App({
      className: 'CustomName',
    })
    class MyApp extends AppBase {}

    expect(MyApp.className).toBe('CustomName');
    expect(MyApp.uri.endsWith(':CustomName')).toBeTruthy();
  });

  it('should throw error if class name is not PascalCase', () => {
    expect(() => {
      // @ts-ignore
      @App()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      class my_app extends AppBase {}
    }).toThrow(/Class name must be PascalCase/);
  });

  it('should throw error if already decorated as another type', () => {
    class MyApp extends AppBase {}
    Reflect.defineMetadata(CLASS_TYPE, 'component', MyApp);

    expect(() => {
      const decorator = App();
      decorator(MyApp as any);
    }).toThrow(/already decorated as "component"/);
  });

  it('should define abstract app', () => {
    @App({
      abstract: true,
    })
    class MyAbstractApp extends AppBase {}

    const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyAbstractApp);
    expect(metadata.abstract).toBe(true);
  });

  describe('App.UseVariables', () => {
    it('should define variables', () => {
      class MyVariables {
        @DefineVariable()
        declare var1: string;
      }

      @App()
      class MyApp extends AppBase {
        @App.UseVariables(MyVariables)
        declare values: any;
      }

      const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyApp);
      expect(metadata.variables).toBeTruthy();
      expect(metadata.variables.var1).toBeTruthy();
    });

    it('should throw if property key is not "values"', () => {
      class MyVariables {}
      expect(() => {
        const decorator = App.UseVariables(MyVariables);
        decorator({ constructor: class {} } as any, 'invalid' as any);
      }).toThrow(/Property key must be "values"/);
    });
  });

  describe('App.UseComponent', () => {
    it('should define components', () => {
      @App()
      class MyApp extends AppBase {
        @App.UseComponent({ uri: 'ns:comp1' })
        declare comp1: any;
      }

      const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyApp);
      expect(metadata.components).toBeTruthy();
      expect(metadata.components.comp1.interfaceUri).toBe('ns:comp1');
    });
  });

  describe('App events', () => {
    it('should define OnCreateProfile', () => {
      @App()
      class MyApp extends AppBase {
        @App.OnCreateProfile()
        static onCreate() {}
      }

      const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyApp);
      expect(metadata.staticEvents.onCreateProfile).toBe('onCreate');
    });

    it('should define OnUpdateProfile', () => {
      @App()
      class MyApp extends AppBase {
        @App.OnUpdateProfile()
        static onUpdate() {}
      }

      const metadata = Reflect.getOwnMetadata(CLASS_METADATA, MyApp);
      expect(metadata.staticEvents.onUpdateProfile).toBe('onUpdate');
    });
  });
});
