import 'reflect-metadata';
import { expect } from 'expect';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  Component,
  ComponentBase,
  DefineVariable,
  WorkerPermission,
} from '../../src/index.js';

describe('Component Decorator', () => {
  it('should decorate a class as a component', () => {
    @Component({})
    class MyComponent extends ComponentBase {}

    const classType = Reflect.getMetadata(CLASS_TYPE, MyComponent);
    const metadata = Reflect.getMetadata(CLASS_METADATA, MyComponent);

    expect(classType).toBe('component');
    expect((MyComponent as any).uri).toBe('@syncbridge/common:My');
    expect(metadata.uri).toBe('@syncbridge/common:My');
    expect(metadata.displayName).toBe('My');
    expect((MyComponent as any).className).toBe('My');
    expect((MyComponent as any).packageName).toBe('@syncbridge/common');
  });

  it('should use explicit className', () => {
    @Component({ className: 'CustomName' })
    class MyComponent extends ComponentBase {}

    expect((MyComponent as any).className).toBe('CustomName');
    expect((MyComponent as any).uri).toBe('@syncbridge/common:CustomName');
  });

  it('should handle abstract components', () => {
    @Component({ abstract: true })
    class MyComponent extends ComponentBase {}

    const metadata = Reflect.getMetadata(CLASS_METADATA, MyComponent);
    expect(metadata.abstract).toBe(true);
  });

  it('should inherit interfaces from base class', () => {
    @Component({ className: 'Base' })
    class BaseComponent extends ComponentBase {}

    @Component({ className: 'Derived' })
    class DerivedComponent extends BaseComponent {}

    const metadata = Reflect.getMetadata(CLASS_METADATA, DerivedComponent);
    expect(metadata.interfaces).toEqual(['@syncbridge/common:Base']);
    expect((DerivedComponent as any).interfaces).toEqual([
      '@syncbridge/common:Base',
    ]);
  });

  describe('Component.UseVariables', () => {
    it('should define variables', () => {
      class MyVars {
        @DefineVariable()
        declare var1: string;
      }

      @Component({})
      class MyComponent extends ComponentBase {
        @Component.UseVariables(MyVars)
        declare values: any;
      }

      const metadata = Reflect.getMetadata(CLASS_METADATA, MyComponent);
      expect(metadata.variables).toBeTruthy();
      expect(metadata.variables.var1).toBeTruthy();
    });

    it('should throw if property key is not "values"', () => {
      class MyVars {}
      expect(() => {
        const decorator = Component.UseVariables(MyVars);
        decorator({ constructor: class {} } as any, 'invalid' as any);
      }).toThrow(/Property key must be "values"/);
    });
  });

  describe('Component.UseComponent', () => {
    it('should define components', () => {
      @Component({})
      class MyComponent extends ComponentBase {
        @Component.UseComponent({ uri: 'ns:comp1' })
        declare comp1: any;
      }

      const metadata = Reflect.getMetadata(CLASS_METADATA, MyComponent);
      expect(metadata.components).toBeTruthy();
      expect(metadata.components.comp1.interfaceUri).toBe('ns:comp1');
    });
  });

  it("should tell what of the server it reaches, its base's too", () => {
    @Component({ permissions: [WorkerPermission.SerialPorts] })
    class SerialBaseComponent extends ComponentBase {}

    @Component({})
    class DeviceComponent extends SerialBaseComponent {}

    @Component({})
    class PlainComponent extends ComponentBase {}

    expect(
      Reflect.getMetadata(CLASS_METADATA, DeviceComponent).permissions,
    ).toEqual(['serial-ports']);
    expect(
      Reflect.getMetadata(CLASS_METADATA, PlainComponent).permissions,
    ).toBeUndefined();
  });

  it('should throw error if already decorated as another type', () => {
    const FakeDecorator = (target: any) => {
      Reflect.defineMetadata(CLASS_TYPE, 'app', target);
    };

    expect(() => {
      @Component({})
      @FakeDecorator
      class MyComponent extends ComponentBase {}
      return MyComponent;
    }).toThrow(/already decorated as "app"/);
  });

  it('should throw error if class name is invalid', () => {
    expect(() => {
      @Component({})
      class myComponent extends ComponentBase {}
      return myComponent;
    }).toThrow(/Class name must be PascalCase/);
  });
});
