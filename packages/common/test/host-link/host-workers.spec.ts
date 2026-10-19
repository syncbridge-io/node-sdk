import { expect } from 'expect';
import { mapProfileStrings } from '../../src/index.js';

describe('mapProfileStrings', () => {
  it('should pass every string of a profile through, the rest as it is', () => {
    const profile = {
      id: 'w1',
      values: { password: 'sbscrt::x', port: 1883, on: true, none: null },
      components: { mqtt: { settings: { tokens: ['sbscrt::y', 'plain'] } } },
    };
    const out = mapProfileStrings(profile, s =>
      s.startsWith('sbscrt::') ? 'SEALED' : s,
    );
    expect(out).toEqual({
      id: 'w1',
      values: { password: 'SEALED', port: 1883, on: true, none: null },
      components: { mqtt: { settings: { tokens: ['SEALED', 'plain'] } } },
    });
    /* Its own left as it was */
    expect(profile.values.password).toBe('sbscrt::x');
  });
});
