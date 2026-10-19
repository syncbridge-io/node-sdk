import { expect } from 'expect';
import {
  App,
  AppBase,
  decodeProfile,
  DefineVariable,
  EnumSource,
  ExtensionRegistry,
  VariableType,
} from '../../src/index.js';

class EnumVariables {
  @DefineVariable({ enumValues: ['red', 'green'] })
  declare color?: string;

  @DefineVariable({
    enumValues: ['/dev/ttyS0', '/dev/ttyS1'],
    enumStrict: false,
  })
  declare port?: string;

  /* The server's serial ports: filled in as the list is asked for */
  @DefineVariable({ enumSource: EnumSource.SerialPorts })
  declare device?: string;
}

@App({ displayName: 'Enum' })
class EnumApp extends AppBase {
  @App.UseVariables(EnumVariables)
  declare values: EnumVariables;
}

function decode(values: Record<string, any>) {
  return decodeProfile({
    id: 'enum',
    displayName: 'Enum',
    appUri: (EnumApp as any).uri,
    values,
  }).values!;
}

describe('Profile Decode, enum variables', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(EnumApp);
  });

  it('should accept only the listed values by default', () => {
    expect(decode({ color: 'red' }).color).toBe('red');
    expect(() => decode({ color: 'blue' })).toThrow(/enumeration/);
  });

  it('should take the listed values as suggestions when not strict', () => {
    expect(decode({ port: '/dev/ttyS1' }).port).toBe('/dev/ttyS1');
    /* A port plugged in after the list was read */
    expect(decode({ port: '/dev/ttyUSB3' }).port).toBe('/dev/ttyUSB3');
  });

  it('should keep a value that is not listed as a string, as listed ones are', () => {
    expect(decode({ port: 3 }).port).toBe('3');
  });

  it('should keep enumStrict in the metadata', () => {
    const v = ExtensionRegistry.getApp((EnumApp as any).uri).metadata
      .variables!;
    expect(v.port.enumStrict).toBe(false);
    expect(v.color.enumStrict).toBeUndefined();
  });

  it("should take a server's list as a source, its values suggestions, none at import", () => {
    const v = ExtensionRegistry.getApp((EnumApp as any).uri).metadata
      .variables!;
    expect(v.device).toMatchObject({
      type: VariableType.Enum,
      enumSource: 'serial-ports',
      enumStrict: false,
    });
    expect(v.device.enumValues).toBeUndefined();
    expect(decode({ device: '/dev/ttyUSB0' }).device).toBe('/dev/ttyUSB0');
  });
});
