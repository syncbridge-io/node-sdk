import assert from 'node:assert';
import { clone } from '@jsopen/objects';
import { expect } from 'expect';
import { AppFactory, ExtensionRegistry, Profile } from '../../src/index.js';
import { Cmp1Component } from '../_support/cmp1.component.js';
import { Cmp1_1Component } from '../_support/cmp1_1.component.js';
import { HotPlugApp } from '../_support/hot-plug.app.js';
import { Prc1App } from '../_support/prc1.app.js';

describe('AppFactory', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(Cmp1Component);
    await ExtensionRegistry.registerClass(Cmp1_1Component);
    await ExtensionRegistry.registerClass(Prc1App);
    await ExtensionRegistry.registerClass(HotPlugApp);
  });

  it('should create an app', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial' },
        },
      },
      values: { var1: 'initial' },
    };
    const app = await AppFactory.createApp(profile as any);
    expect(app).toBeInstanceOf(Prc1App);
    expect(app.name).toBe('My Profile');
  });

  it('should throw error if app not found', async () => {
    const profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: 'non-existent',
    };
    await expect(AppFactory.createApp(profile as any)).rejects.toThrow(
      'not found',
    );
  });

  it('should createAppSilent() return issues', async () => {
    const profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
    };
    const r1 = await AppFactory.createAppSilent(profile as any);
    expect(r1.result).not.toBeTruthy();
    assert(!r1.result);
    expect(r1.issues.length).toEqual(1);
    expect(r1.issues[0].message).toMatch('cmp1');
  });

  it('should create nested components', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial' },
        },
      },
      values: { var1: 'initial' },
    };
    const app = await AppFactory.createApp(profile as any);
    expect(app).toBeInstanceOf(Prc1App);
    expect(app.name).toBe('My Profile');
    expect((app as any).cmp1).toBeDefined();
    expect(app.components.cmp1).toBeDefined();
  });

  it('should init default values', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial' },
        },
      },
      values: { var1: 'initial' },
    };
    const app = await AppFactory.createApp(profile as any);
    expect(app).toBeInstanceOf(Prc1App);
    expect(app.values.var2).toEqual('abc');
    expect(app.components.cmp1.values.var2).toEqual('xyz');
  });

  it('should update hot-plug app variables', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial' },
        },
      },
      values: { var1: 'initial', var2: 'initial' },
    };

    const r1 = await AppFactory.createAppSilent<Prc1App>(profile);
    expect(r1.result).toEqual(true);
    assert(r1.result);
    r1.app.values = profile.values; // Manually simulate what should happen if decoding worked
    expect(r1.app.values?.var1).toBe('initial');
    expect(r1.app.values?.var2).toBe('initial');

    let updatedProperties: string[] = [];
    r1.app.on('values-updated', props => {
      updatedProperties = props;
    });

    const newProfile = clone(profile);
    newProfile.values = { var1: 'updated', var2: 'updated' };

    await AppFactory.updateApp(r1.app, newProfile);
    expect(updatedProperties.length).toEqual(1);
    expect(r1.app.values?.var1).toBe('updated');
    expect(r1.app.values?.var2).toBe('initial');
  });

  describe('updating a running app', () => {
    const profile = (values: object): Profile => ({
      id: 'hot',
      displayName: 'Hot plug',
      appUri: HotPlugApp.uri,
      values,
    });
    const start = async (values: object) => {
      const app = await AppFactory.createApp<HotPlugApp>(profile(values));
      let updated: string[] = [];
      app.on('values-updated', props => {
        updated = props;
      });
      return { app, updated: () => updated };
    };

    it('should replace a hot-plug list of groups whole, a list still', async () => {
      const { app, updated } = await start({ rows: [{ code: 'A' }] });
      expect(app.values.rows).toEqual([{ code: 'A' }]);
      await AppFactory.updateApp(
        app,
        profile({ rows: [{ code: 'A' }, { code: 'B', unit: 'bpm' }] }),
      );
      expect(Array.isArray(app.values.rows)).toBe(true);
      expect(app.values.rows).toEqual([
        { code: 'A' },
        { code: 'B', unit: 'bpm' },
      ]);
      expect(updated()).toEqual(['rows']);
      await AppFactory.updateApp(app, profile({ rows: [{ code: 'B' }] }));
      expect(app.values.rows).toEqual([{ code: 'B' }]);
    });

    it('should replace a hot-plug list of values whole', async () => {
      const { app } = await start({ tags: ['a', 'b'] });
      await AppFactory.updateApp(app, profile({ tags: ['c'] }));
      expect(app.values.tags).toEqual(['c']);
    });

    it('should not share the list with the profile', async () => {
      const { app } = await start({});
      const next = profile({ rows: [{ code: 'A' }] });
      await AppFactory.updateApp(app, next);
      (next.values as any).rows.push({ code: 'X' });
      expect(app.values.rows).toEqual([{ code: 'A' }]);
    });

    it("should update all of a hot-plug group's settings", async () => {
      const { app, updated } = await start({ limits: { min: 1, max: 5 } });
      await AppFactory.updateApp(app, profile({ limits: { min: 2, max: 5 } }));
      expect(app.values.limits).toEqual({ min: 2, max: 5 });
      expect(updated()).toEqual(['limits.min']);
    });

    it('should leave a list not hot-plug as it was', async () => {
      const { app } = await start({ cold: [{ code: 'A' }] });
      await AppFactory.updateApp(app, profile({ cold: [{ code: 'B' }] }));
      expect(app.values.cold).toEqual([{ code: 'A' }]);
    });
  });

  it('should update hot-plug component variables', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial', var2: 'initial' },
        },
      },
      values: { var1: 'initial' },
    };

    const r1 = await AppFactory.createAppSilent<Prc1App>(profile);
    expect(r1.result).toEqual(true);
    assert(r1.result);
    r1.app.values = profile.values; // Manually simulate what should happen if decoding worked
    expect(r1.app.components.cmp1.values?.var1).toBe('initial');
    expect(r1.app.components.cmp1.values?.var2).toBe('initial');

    let updatedProperties: string[] = [];
    r1.app.cmp1.on('values-updated', props => {
      updatedProperties = props;
    });

    const newProfile = clone(profile);
    newProfile.components!.cmp1.values = { var1: 'updated', var2: 'updated' };
    await AppFactory.updateApp(r1.app, newProfile);
    expect(updatedProperties.length).toEqual(1);
    expect(r1.app.components.cmp1.values?.var1).toBe('updated');
    expect(r1.app.components.cmp1.values?.var2).toBe('initial');
  });

  it('should not allow updating components URI', async () => {
    const profile: Profile = {
      id: 'p1',
      displayName: 'My Profile',
      appUri: Prc1App.uri,
      components: {
        cmp1: {
          uri: Cmp1Component.uri,
          values: { var1: 'initial' },
        },
      },
      values: { var1: 'initial', var2: 'initial' },
    };
    const r1 = await AppFactory.createAppSilent<Prc1App>(profile);
    expect(r1.result).toEqual(true);
    assert(r1.result);
    const newProfile = clone(profile);
    newProfile.components!.cmp1.uri = Cmp1_1Component.uri;
    const r2 = await AppFactory.updateAppSilent(r1.app, newProfile);
    expect(r2.result).toEqual(false);
    expect(r2.issues.length).toEqual(1);
    expect(r2.issues[0].message).toMatch('cmp1');
  });
});
