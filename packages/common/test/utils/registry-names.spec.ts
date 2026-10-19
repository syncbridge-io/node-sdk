import { expect } from 'expect';
import {
  fromSbextName,
  parseSbSpecifier,
  RESERVED_SCOPES,
  toSbextName,
  validateRegistryName,
  validateScopeName,
} from '../../src/index.js';

describe('registry names', () => {
  describe('validateScopeName', () => {
    it('should accept a valid scope, with or without "@"', () => {
      expect(validateScopeName('abisena')).toEqual([]);
      expect(validateScopeName('@abisena')).toEqual([]);
      expect(validateScopeName('my-org.2')).toEqual([]);
    });

    it('should refuse what would make the sbext name ambiguous', () => {
      expect(validateScopeName('abi__sena')).toHaveLength(1);
    });

    it('should refuse npm-invalid scopes', () => {
      expect(validateScopeName('')).toHaveLength(1);
      expect(validateScopeName('Abisena')).toHaveLength(1);
      expect(validateScopeName('_abisena')).toHaveLength(1);
      expect(validateScopeName('.abisena')).toHaveLength(1);
      expect(validateScopeName('abi sena')).toHaveLength(1);
    });

    it('should refuse the sbext scope but not the other reserved ones', () => {
      expect(validateScopeName('sbext')).toHaveLength(1);
      expect(RESERVED_SCOPES).toContain('syncbridge');
      expect(validateScopeName('syncbridge')).toEqual([]);
    });
  });

  describe('validateRegistryName', () => {
    it('should accept a scoped name', () => {
      expect(validateRegistryName('@abisena/iomt')).toEqual([]);
      expect(validateRegistryName('@abisena/iomt-common')).toEqual([]);
      expect(validateRegistryName('@syncbridge/sqb')).toEqual([]);
    });

    it('should refuse an unscoped name', () => {
      expect(validateRegistryName('lodash')).toHaveLength(1);
      expect(validateRegistryName('@abisena')).toHaveLength(1);
      expect(validateRegistryName('@abisena/iomt/x')).toHaveLength(1);
    });

    it('should refuse "__" in either part', () => {
      expect(validateRegistryName('@abisena/io__mt')).toHaveLength(1);
      expect(validateRegistryName('@abi__sena/iomt')).toHaveLength(1);
    });

    it('should refuse npm-invalid names', () => {
      expect(validateRegistryName('@abisena/IoMT')).toHaveLength(1);
      expect(validateRegistryName('@abisena/')).toHaveLength(1);
      expect(validateRegistryName('@abisena/' + 'x'.repeat(214))).toHaveLength(
        1,
      );
    });
  });

  describe('toSbextName / fromSbextName', () => {
    it('should map a registry name and back', () => {
      expect(toSbextName('@abisena/iomt')).toBe('@sbext/abisena__iomt');
      expect(fromSbextName('@sbext/abisena__iomt')).toBe('@abisena/iomt');
      expect(fromSbextName(toSbextName('@my-org.2/a.b-c'))).toBe(
        '@my-org.2/a.b-c',
      );
    });

    it('should refuse what it cannot map', () => {
      expect(() => toSbextName('lodash')).toThrow(/scoped/);
      expect(() => fromSbextName('@other/abisena__iomt')).toThrow(/@sbext/);
      expect(() => fromSbextName('@sbext/abisena-iomt')).toThrow();
      expect(() => fromSbextName('@sbext/a__b__c')).toThrow();
    });
  });

  describe('parseSbSpecifier', () => {
    it('should return undefined for a specifier without the prefix', () => {
      expect(parseSbSpecifier('@abisena/iomt')).toBeUndefined();
      expect(parseSbSpecifier('node:fs')).toBeUndefined();
    });

    it('should parse the name and the subpath', () => {
      expect(parseSbSpecifier('sb:@abisena/iomt')).toEqual({
        name: '@abisena/iomt',
        subpath: '.',
      });
      expect(parseSbSpecifier('sb:@abisena/iomt/protocol/pdu')).toEqual({
        name: '@abisena/iomt',
        subpath: './protocol/pdu',
      });
    });

    it('should throw for a prefixed specifier that is not a registry name', () => {
      expect(() => parseSbSpecifier('sb:lodash')).toThrow();
      expect(() => parseSbSpecifier('sb:@abisena/io__mt')).toThrow();
    });
  });
});
