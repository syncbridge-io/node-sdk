import { expect } from 'expect';
import {
  App,
  AppBase,
  decodeProfile,
  DefineVariable,
  ExtensionRegistry,
  VariableType,
} from '../../src/index.js';

class RangeVariables {
  @DefineVariable({
    type: VariableType.Number,
    required: true,
    default: 24005,
    minValue: 1,
    maxValue: 65535,
  })
  declare port: number;

  @DefineVariable({ type: VariableType.Number, minValue: 0 })
  declare offset?: number;

  @DefineVariable({ type: VariableType.String, pattern: '^[a-z]+$' })
  declare code?: string;

  @DefineVariable({
    type: VariableType.Number,
    isArray: true,
    minOccurs: 2,
    maxOccurs: 3,
  })
  declare ports?: number[];
}

@App({ displayName: 'Range' })
class RangeApp extends AppBase {
  @App.UseVariables(RangeVariables)
  declare values: RangeVariables;
}

function decode(values: Record<string, any>) {
  return decodeProfile({
    id: 'range',
    displayName: 'Range',
    appUri: (RangeApp as any).uri,
    values,
  }).values!;
}

describe('Profile Decode, variables with value rules', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(RangeApp);
  });

  it('should apply the default before checking the range', () => {
    expect(decode({}).port).toBe(24005);
  });

  it('should coerce the value before checking the range', () => {
    expect(decode({ port: '8080' }).port).toBe(8080);
  });

  it('should accept the bounds themselves', () => {
    expect(decode({ port: 1 }).port).toBe(1);
    expect(decode({ port: 65535 }).port).toBe(65535);
  });

  it('should refuse values out of range', () => {
    expect(() => decode({ port: 0 })).toThrow(/greater than or equal to 1/);
    expect(() => decode({ port: 65536 })).toThrow(/65535/);
  });

  it('should check a minValue of 0', () => {
    expect(decode({ offset: 0 }).offset).toBe(0);
    expect(() => decode({ offset: -1 })).toThrow(/greater than or equal to 0/);
  });

  it('should leave an optional variable with rules unset', () => {
    const values = decode({});
    expect(values.offset).toBeUndefined();
    expect(values.code).toBeUndefined();
  });

  it('should check a pattern after the type', () => {
    expect(decode({ code: 'abc' }).code).toBe('abc');
    expect(() => decode({ code: 'ABC' })).toThrow();
  });

  it('should check the number of items and still validate each', () => {
    expect(decode({ ports: ['1', '2'] }).ports).toEqual([1, 2]);
    expect(() => decode({ ports: [1] })).toThrow();
    expect(() => decode({ ports: [1, 2, 3, 4] })).toThrow();
    expect(() => decode({ ports: [1, 'x'] })).toThrow();
  });
});
