import { expect } from 'expect';
import {
  normalizeAppMetadata,
  normalizeAppMetadataSilent,
  normalizeComponentMetadata,
  normalizeComponentMetadataSilent,
  SbValidationError,
} from '../../src/index.js';

describe('Metadata Normalization', () => {
  describe('normalizeAppMetadata', () => {
    it('should normalize app metadata', async () => {
      const metadata = {
        className: 'MyApp',
        version: '1.0.0',
        displayName: 'My App',
        variables: {
          var1: {
            displayName: 'Var 1',
            enumValues: {
              a: '1',
              b: '2',
            },
          },
        },
      };
      const normalized = await normalizeAppMetadata(metadata as any);
      expect(normalized.classType).toBe('app');
      expect(normalized.className).toBe('MyApp');
      expect(Array.isArray(normalized.variables!.var1.enumValues)).toBeTruthy();
      expect(normalized.variables!.var1.enumValues).toEqual(['1', '2']);
    });

    it('should resolve promises in metadata', async () => {
      const metadata = {
        className: 'MyApp',
        version: '1.0.0',
        displayName: 'My App',
        description: Promise.resolve('Resolved Description'),
      };
      const normalized = await normalizeAppMetadata(metadata as any);
      expect(normalized.description).toBe('Resolved Description');
    });

    it('should throw error if validation fails', async () => {
      const metadata = {
        className: 'MyApp',
        version: '1.0.0',
        // displayName is required
      };
      try {
        await normalizeAppMetadata(metadata as any);
        throw new Error('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(SbValidationError);
        expect(e.message).toContain('Worker profile decoding error');
      }
    });
  });

  describe('normalizeAppMetadataSilent', () => {
    it('should normalize app metadata silently', async () => {
      const metadata = {
        className: 'MyApp',
        displayName: 'My App',
      };
      const r = await normalizeAppMetadataSilent(metadata as any);
      expect(r.metadata).toBeTruthy();
      expect(r.metadata.classType).toBe('app');
      expect(r.metadata.className).toBe('MyApp');
    });

    it('should return issues if validation fails silently', async () => {
      const metadata = {
        uri: 'my-app',
        // displayName is required
      };
      const r = await normalizeAppMetadataSilent(metadata as any);
      expect(r.issues).toBeTruthy();
      expect(r.issues!.length).toBeGreaterThan(0);
    });
  });

  describe('normalizeComponentMetadata', () => {
    it('should normalize component metadata', async () => {
      const metadata = {
        className: 'MyComponent',
        version: '1.0.0',
        displayName: 'My Component',
        variables: {
          var1: {
            displayName: 'Var 1',
            enumValues: {
              v1: 'Value 1',
              v2: 'Value 2',
            },
          },
        },
      };
      const normalized = await normalizeComponentMetadata(metadata as any);
      expect(normalized.classType).toBe('component');
      expect(normalized.className).toBe('MyComponent');
      expect(normalized.variables!.var1.enumValues).toEqual([
        'Value 1',
        'Value 2',
      ]);
    });
  });

  describe('normalizeComponentMetadataSilent', () => {
    it('should normalize component metadata silently', async () => {
      const metadata = {
        className: 'MyComponent',
        version: '1.0.0',
        displayName: 'My Component',
      };
      const r = await normalizeComponentMetadataSilent(metadata as any);
      expect(r.metadata).toBeTruthy();
      expect(r.metadata.classType).toBe('component');
      expect(r.metadata.className).toBe('MyComponent');
    });
  });
});
