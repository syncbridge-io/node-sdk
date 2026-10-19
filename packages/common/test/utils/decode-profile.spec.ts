import assert from 'node:assert';
import { expect } from 'expect';
import {
  decodeProfile,
  decodeProfileSilent,
  encodeProfile,
  encodeProfileSilent,
  ExtensionRegistry,
  SbValidationError,
} from '../../src/index.js';
import { Cmp1Component } from '../_support/cmp1.component.js';
import { Prc1App } from '../_support/prc1.app.js';

describe('Profile Decode', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(Cmp1Component);
    await ExtensionRegistry.registerClass(Prc1App);
  });

  it('should decode profile for a valid profile', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'val1',
        var2: 123,
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: {
            var1: 'cmp-val1',
          },
        },
      },
    };
    const decoded = decodeProfile(profile);

    expect(decoded.id).toBe('worker-1');
    expect(decoded.values!.var1).toBe('val1');
    expect(decoded.values!.var2).toBe('123');
    expect(decoded.components!.cmp1.values!.var1).toBe('cmp-val1');
    // Default value check
    expect(decoded.components!.cmp1.values!.var2).toBe('xyz');
  });

  it('should decode profile silently', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'val1',
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: {
            var1: 'cmp-val1',
          },
        },
      },
    };
    const r = decodeProfileSilent(profile);
    expect(r.result).toBeTruthy();
    assert(r.result);
    expect(r.profile.values!.var1).toEqual('val1');
    expect(r.issues?.length ?? 0).toBe(0);
  });

  it('should coerce types during decoding', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'val1',
        varNum: '456', // Should be coerced to number
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'v1' },
        },
      },
    };
    const decoded = decodeProfile(profile);
    expect(decoded.values!.varNum).toBe(456);
  });

  it('should throw SbValidationError if validation fails in decodeProfile', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {},
    };
    try {
      decodeProfile(profile);
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(SbValidationError);
      expect(e.message).toContain('Worker profile decoding error');
    }
  });

  it('should handle secret decryption if cryptoSecretKey is provided', () => {
    const secretKey = 'my-secret-key';
    const rawValue = 'password123';
    // Encrypt first to simulate encoded profile
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'v1',
        varSecret: rawValue,
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'v1' },
        },
      },
    };
    const encoded = encodeProfile(profile, {
      cryptoSecretKey: secretKey,
    });
    expect(encoded.values!.varSecret).toMatch(/^sbscrt::/);
    const decoded = decodeProfile(encoded, {
      cryptoSecretKey: secretKey,
    });
    expect(decoded.values!.varSecret).toBe(rawValue);
  });

  it('should encode profile', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'v1',
        var2: '123',
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'v1' },
        },
      },
    };
    const encoded = encodeProfile(profile);
    expect(encoded.id).toBe('worker-1');
    expect(encoded.values!.var1).toBe('v1');
  });

  it('should encode profile silently', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: { var1: 'v1' },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'v1' },
        },
      },
    };
    const r = encodeProfileSilent(profile);
    assert(r.result);
    expect(r.profile).toBeTruthy();
    expect(r.issues?.length || 0).toBe(0);
  });

  it('should handle nested variables', () => {
    // Prc1App has varNested
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: {
        var1: 'v1',
        varNested: {
          n1: 'nested-val',
        },
      },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'v1' },
        },
      },
    };
    const decoded = decodeProfile(profile);
    expect(decoded.values!.varNested.n1).toBe('nested-val');
  });

  it('should handle components validation', () => {
    const profile = {
      id: 'worker-1',
      displayName: 'Worker 1',
      appUri: Prc1App.uri,
      values: { var1: 'v1' },
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: {
            // var1 is required in Cmp1Component
          },
        },
      },
    };
    const r = decodeProfileSilent(profile);
    expect(r.result).not.toBeTruthy();
    assert(!r.result);
    expect(r.issues).toBeTruthy();
    expect(
      r.issues!.some(i =>
        String(i.location).includes('components/cmp1/values/var1'),
      ),
    ).toBeTruthy();
  });
});
