import { expect } from 'expect';
import { type Profile, ProfileEditor } from '../../src/index.js';

function profile(): Profile {
  return {
    id: 'w1',
    displayName: 'GE B125',
    appUri: '@abisena/ge-b125:GeB125App',
    values: { readFrequency: 5, limits: { hr: [40, 160] } },
    components: {
      hl7Server: { uri: '@syncbridge/net:TcpServer', values: { port: 2575 } },
      his: { uri: '@abisena/his:HisClient', values: { token: 'sbscrt::x' } },
    },
  } as Profile;
}

describe('The whole profile, as an app migrating it is given', () => {
  it('should read values and components by their place', () => {
    const p = new ProfileEditor(profile());
    expect(p.get('values/readFrequency')).toBe(5);
    expect(p.get('values/limits/hr')).toEqual([40, 160]);
    expect(p.get('components/hl7Server/values/port')).toBe(2575);
    expect(p.get('components/hl7Server').uri).toBe('@syncbridge/net:TcpServer');
    expect(p.has('components/device')).toBe(false);
    expect(p.has('components/device/values/port')).toBe(false);
  });

  it('should move a slot down into a new component, and a setting with it', () => {
    const p = new ProfileEditor(profile());
    p.addComponent('components/device', '@abisena/ge-b125:GeB125Device');
    expect(
      p.move('components/hl7Server', 'components/device/components/hl7Server'),
    ).toBe(true);
    expect(
      p.move('values/readFrequency', 'components/device/values/readFrequency'),
    ).toBe(true);
    expect(p.profile.components).toEqual({
      device: {
        uri: '@abisena/ge-b125:GeB125Device',
        components: {
          hl7Server: {
            uri: '@syncbridge/net:TcpServer',
            values: { port: 2575 },
          },
        },
        values: { readFrequency: 5 },
      },
      his: profile().components!.his,
    });
    expect(p.profile.values).toEqual({ limits: { hr: [40, 160] } });
    expect(p.changes.map(c => [c.kind, c.location, c.from])).toEqual([
      ['added', 'components/device', '@abisena/ge-b125:GeB125Device'],
      [
        'moved',
        'components/device/components/hl7Server',
        'components/hl7Server',
      ],
      [
        'moved',
        'components/device/values/readFrequency',
        'values/readFrequency',
      ],
    ]);
  });

  it('should move a sealed secret as it is', () => {
    const p = new ProfileEditor(profile());
    p.move('components/his/values/token', 'values/hisToken');
    expect(p.get('values/hisToken')).toBe('sbscrt::x');
  });

  it('should answer false for nothing to move or remove', () => {
    const p = new ProfileEditor(profile());
    expect(p.move('values/nothing', 'values/other')).toBe(false);
    expect(p.move('components/none', 'components/other')).toBe(false);
    expect(p.remove('values/nothing')).toBe(false);
    expect(p.changes).toEqual([]);
  });

  it('should refuse to move over something, or a value to a component', () => {
    const p = new ProfileEditor(profile());
    expect(() => p.move('values/readFrequency', 'values/limits')).toThrow(
      /it holds one/,
    );
    expect(() => p.move('values/readFrequency', 'components/rf')).toThrow(
      /a value goes to a value's place/,
    );
    expect(p.get('values/readFrequency')).toBe(5);
  });

  it('should refuse a place a component does not hold', () => {
    const p = new ProfileEditor(profile());
    expect(() => p.set('components/none/values/a', 1)).toThrow(
      /no component holds it/,
    );
    expect(() => p.get('somewhere')).toThrow(/no place in a profile/);
    expect(() => p.set('values/readFrequency/x', 1)).toThrow(/holds a value/);
  });

  it('should rename beside, set and remove', () => {
    const p = new ProfileEditor(profile());
    p.rename('components/hl7Server', 'server');
    p.set('values/limits/spo2', [90, 100]);
    p.remove('values/readFrequency');
    expect(Object.keys(p.profile.components!)).toEqual(['his', 'server']);
    expect(p.profile.values).toEqual({
      limits: { hr: [40, 160], spo2: [90, 100] },
    });
    expect(p.changes.map(c => c.kind)).toEqual(['moved', 'set', 'removed']);
  });

  it('should answer a component there of its class, refuse another', () => {
    const p = new ProfileEditor(profile());
    const held = p.addComponent(
      'components/hl7Server',
      '@syncbridge/net:TcpServer',
    );
    expect(held.values).toEqual({ port: 2575 });
    expect(() =>
      p.addComponent('components/hl7Server', '@syncbridge/net:UdpServer'),
    ).toThrow(/"@syncbridge\/net:TcpServer" is there/);
    expect(() => p.set('components/x', { values: {} })).toThrow(/its uri/);
    expect(p.changes).toEqual([]);
  });
});
