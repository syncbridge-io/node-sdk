import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtensionRegistry } from '@syncbridge/common';
import { expect } from 'expect';
import { collectExtensionEntries } from '../src/discovery.js';
import { createTestEnv, expectSnapshot } from '../src/index.js';
import {
  DemoApp,
  SourceComponent,
  StoreComponent,
} from './_fixtures/demo-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/demo-ext');
const BASE = path.resolve(import.meta.dirname, '_fixtures/base-ext');

describe('createTestEnv', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  describe('discovery', () => {
    it('should find the package of the calling test by default', () => {
      const own = createTestEnv();
      expect(own.packageDir).toBe(path.resolve(import.meta.dirname, '..'));
    });

    it('should register extension dependencies before the package', () => {
      expect(collectExtensionEntries(FIXTURE)).toEqual([
        path.join(fs.realpathSync(BASE), 'src/index.ts'),
        path.join(fs.realpathSync(FIXTURE), 'src/index.ts'),
      ]);
    });

    it('should use a registry of its own while it lives', async () => {
      const global = ExtensionRegistry.current;
      const other = createTestEnv({ from: FIXTURE });
      await other.ready();
      expect(ExtensionRegistry.current).toBe(other.registry);
      expect(other.registry.findApp(DemoApp.uri)).toBeDefined();
      await other.dispose();
      /* The registry current before it comes back */
      expect(ExtensionRegistry.current).toBe(global);
    });
  });

  describe('profiles', () => {
    it('should start an app with a mock for an interface', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      expect(app.status).toBe('started');
      expect(await app.run()).toBe(true);
      expect(store.calls('save')).toEqual([[10]]);
      expect(store.instance).toBe(app.store);
      expect(env.logs(app).messages).toContain('Demo started');
    });

    it('should pass component values through the profile', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { store, source: { values: { factor: 3 } } },
      });
      await app.run();
      expect(store.calls('save')).toEqual([[30]]);
    });

    it('should wait for a call made later', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      const saved = store.waitForCall('save');
      setTimeout(() => app.run(), 10);
      expect(await saved).toEqual([10]);
      await expect(
        env.mock(StoreComponent).waitForCall('save', { timeout: 10 }),
      ).rejects.toThrow(/Timed out after 10ms waiting for save\(\)/);
    });

    it('should replace one method of a concrete component', async () => {
      const source = env.mock(SourceComponent, { read: async () => 99 });
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { source, store },
      });
      await app.run();
      expect(source.calls('read')).toHaveLength(1);
      expect(store.calls('save')).toEqual([[99]]);
    });

    it('should replace a protected method, keeping the flow around it', async () => {
      const source = env.mock(SourceComponent, { fetchRaw: async () => 7 });
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { source: { use: source, values: { factor: 2 } }, store },
      });
      await app.run();
      /* read() ran as written, around the replaced step */
      expect(store.calls('save')).toEqual([[14]]);
      expect(source.calls('fetchRaw')).toEqual([[]]);
      expect(await source.waitForCall('read')).toEqual([]);
    });

    it('should refuse a method the class does not have', () => {
      expect(() =>
        env.mock(SourceComponent, { fetchRow: async () => 7 }),
      ).toThrow(/Source(Component)? has no method "fetchRow" to replace/);
    });

    it('should leave optional components out unless asked for', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const without = await env.create(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      expect(without.audit).toBeUndefined();
      const withAudit = await env.create(DemoApp, {
        values: { threshold: 5 },
        components: { store, audit: true },
      });
      expect(withAudit.audit).toBeInstanceOf(SourceComponent);
    });

    it('should let the app fill in its defaults', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.create(DemoApp, {
        components: { store },
      });
      expect(app.values.threshold).toBe(5);
    });

    it('should validate values as SyncBridge does', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      await expect(
        env.create(DemoApp, {
          // @ts-expect-error a value of the wrong type, as a profile file may hold
          values: { threshold: 'many' },
          components: { store },
        }),
      ).rejects.toThrow(/threshold/);
    });

    it('should ask for a class where only an interface is declared', async () => {
      await expect(
        env.create(DemoApp, { values: { threshold: 5 } }),
      ).rejects.toThrow(/DemoApp\.store needs a class/);
    });

    it('should name the components an app has', async () => {
      await expect(
        env.create(DemoApp, {
          values: { threshold: 5 },
          // @ts-expect-error a name the app does not have
          components: { storage: true },
        }),
      ).rejects.toThrow(/has no component "storage". It has: source, store/);
    });
  });

  describe('lifecycle', () => {
    it('should run nothing of a mock whose lifecycle is off', async () => {
      const store = env.mock(
        StoreComponent,
        {
          save: async () => undefined,
          _start: async () => {
            throw new Error('should not start');
          },
        },
        { lifecycle: false },
      );
      const app = await env.start(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      expect(app.status).toBe('started');
    });

    it('should wait for a status, and stop apps on reset', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.create(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      const started = env.waitFor(app, 'started');
      app.startNoWait();
      await started;
      await env.reset();
      expect(app.status).toBe('stopped');
    });

    it('should time out waiting for a status that does not come', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.create(DemoApp, {
        values: { threshold: 5 },
        components: { store },
      });
      await expect(
        env.waitFor(app, 'started', { timeout: 20 }),
      ).rejects.toThrow(/Timed out after 20ms/);
    });

    it('should keep what the app and its components logged', async () => {
      const store = env.mock(StoreComponent, { save: async () => undefined });
      const app = await env.start(DemoApp, {
        values: { threshold: 50 },
        components: { store },
      });
      expect(await app.run()).toBe(false);
      expect(env.logs(app).warnings.map(e => e.message)).toEqual([
        '10 is under the threshold',
      ]);
      expect(env.logs(app).errors).toEqual([]);
    });
  });
});

describe('expectSnapshot', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-snapshot-'));
    file = path.join(dir, 'demo.spec.ts');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should write a missing snapshot, then compare with it', () => {
    const ci = process.env.CI;
    delete process.env.CI;
    try {
      expectSnapshot({ a: 1, at: 'now' }, 'first', { file, ignore: ['at'] });
    } finally {
      if (ci !== undefined) process.env.CI = ci;
    }
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, '__snapshots__/demo.spec.json'), 'utf8'),
    );
    expect(written).toEqual({ first: { a: 1, at: '<ignored>' } });
    expectSnapshot({ a: 1, at: 'later' }, 'first', { file, ignore: ['at'] });
    expect(() => expectSnapshot({ a: 2 }, 'first', { file })).toThrow(
      /Snapshot "first" differs/,
    );
  });
});
