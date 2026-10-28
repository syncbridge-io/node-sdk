import { expect } from 'expect';
import {
  compareMetadata,
  type ElementDefinition,
  isMajorChange,
} from '../src/commands/compare-published.js';

const app = (def: Partial<ElementDefinition>): ElementDefinition => ({
  classType: 'app',
  className: 'Gw',
  ...def,
});

describe('A version compared with the last published one', () => {
  it('should pass what is declared: a class, a slot, a setting, a choice renamed', () => {
    const before = [
      app({
        className: 'OldGw',
        variables: {
          address: { type: 'string' as any },
          mode: { type: 'enum' as any, enumValues: ['tcp', 'udp'] },
        },
        components: { conn: { interfaceUri: 'p:Io', required: true } },
      }),
    ];
    const now = [
      app({
        formerly: ['OldGw'],
        variables: {
          host: { type: 'string' as any, formerly: ['address'] },
          mode: {
            type: 'enum' as any,
            enumValues: ['tcp-client', 'udp'],
            formerlyValues: { tcp: 'tcp-client' },
          },
          timeout: { type: 'number' as any, required: true, default: 30 },
        },
        components: {
          link: { interfaceUri: 'p:Io', required: true, formerly: ['conn'] },
        },
      }),
    ];
    expect(compareMetadata(before, now, { major: false })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('should refuse what a profile cannot be carried across, in a version not a major', () => {
    const before = [
      app({
        variables: {
          port: { type: 'number' as any },
          mode: { type: 'enum' as any, enumValues: ['tcp', 'udp'] },
          tls: {
            type: 'nested' as any,
            variables: { cert: { type: 'string' as any } },
          },
        },
        components: { conn: { interfaceUri: 'p:Io' } },
      }),
      { classType: 'component', className: 'Gone' },
      { classType: 'plugin', className: 'NotCompared' },
    ];
    const now = [
      app({
        variables: {
          mode: { type: 'enum' as any, enumValues: ['udp'] },
          tls: { type: 'nested' as any, variables: {} },
          user: { type: 'string' as any, required: true },
        },
        components: { sink: { interfaceUri: 'p:Io', required: true } },
      }),
    ];
    const minor = compareMetadata(before, now, { major: false });
    expect(minor.warnings).toEqual([]);
    expect(minor.errors).toEqual([
      'Gw.mode: choice "tcp" no longer there - declare what it is now with formerlyValues',
      'Gw.tls.cert: a setting no longer there - its values are dropped; declare its new name with formerly',
      'Gw.user: a setting newly required with no default - a worker written before has no value for it',
      'Gw.port: a setting no longer there - its values are dropped; declare its new name with formerly',
      'Gw.sink: a component newly required - a worker written before has none',
      'Gw.conn: a component slot no longer there - declare its new name with formerly',
      'Gone: no longer in the package - a worker taking it cannot be carried; declare its new name with formerly',
    ]);
    /* A major tells them */
    const major = compareMetadata(before, now, { major: true });
    expect(major.errors).toEqual([]);
    expect(major.warnings).toEqual(minor.errors);
  });

  it('should refuse a former name still in use, in any version', () => {
    const now = [
      app({
        formerly: ['Other'],
        variables: {
          host: { type: 'string' as any, formerly: ['port'] },
          port: { type: 'number' as any },
          mode: {
            type: 'enum' as any,
            enumValues: ['a', 'b'],
            formerlyValues: { a: 'b' },
          },
        },
      }),
      { classType: 'component', className: 'Other' },
    ];
    expect(compareMetadata([], now, { major: true }).errors).toEqual([
      'Gw: formerly "Other", a class of the package still',
    ]);
    expect(compareMetadata([app({})], now, { major: true }).errors).toEqual([
      'Gw: formerly "Other", a class of the package still',
      'Gw.host: formerly "port", a setting still',
      'Gw.mode: formerlyValues "a", a choice still',
    ]);
  });

  it('should not compare the choices of a list that only suggests them', () => {
    const before = [
      app({
        variables: {
          device: { type: 'enum' as any, enumValues: ['/dev/ttyS0'] },
        },
      }),
    ];
    const now = [
      app({
        variables: {
          device: {
            type: 'enum' as any,
            enumValues: ['/dev/ttyS1'],
            enumStrict: false,
          },
        },
      }),
    ];
    expect(compareMetadata(before, now, { major: false }).errors).toEqual([]);
  });

  it('should tell a major version, a 0.x minor as one', () => {
    expect(isMajorChange('1.4.2', '2.0.0')).toBe(true);
    expect(isMajorChange('1.4.2', '1.5.0')).toBe(false);
    expect(isMajorChange('0.3.1', '0.4.0')).toBe(true);
    expect(isMajorChange('0.3.1', '0.3.2')).toBe(false);
  });
});
