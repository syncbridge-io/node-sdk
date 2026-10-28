import { expect } from 'expect';
import {
  App,
  AppBase,
  carryProfile,
  Component,
  ComponentBase,
  DefineVariable,
  ExtensionRegistry,
  type Profile,
  type ProfileMigration,
  profileMigrations,
  runProfileMigrations,
  SECRET_PREFIX,
} from '../../src/index.js';

class MigratingLinkVariables {
  @DefineVariable()
  declare host?: string;

  @DefineVariable()
  declare port?: number;
}

@Component({ className: 'MigratingLink' })
class MigratingLink extends ComponentBase {
  @Component.UseVariables(MigratingLinkVariables)
  declare values: MigratingLinkVariables;

  /* 1.x kept "host:port" as address */
  @Component.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    const { address, ...rest } = m.values;
    if (address === undefined) return m.values;
    const [host, port] = String(address).split(':');
    return { ...rest, host, port: Number(port) };
  }
}

class MigratingAppVariables {
  @DefineVariable()
  declare name?: string;

  @DefineVariable()
  declare token?: string;
}

const seen: ProfileMigration[] = [];

@App({ className: 'MigratingApp' })
class MigratingApp extends AppBase {
  @App.UseVariables(MigratingAppVariables)
  declare values: MigratingAppVariables;

  @App.UseComponent()
  declare link?: MigratingLink;

  @App.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    seen.push(m);
    const { title, ...rest } = m.values;
    return title === undefined ? m.values : { ...rest, name: title };
  }
}

describe('A class carrying its own values, migrateProfile', () => {
  let end: () => void;
  let version: string;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [MigratingLink, MigratingApp])
      await ExtensionRegistry.registerClass(cls as any);
    version = ExtensionRegistry.getApp((MigratingApp as any).uri).version;
  });

  after(() => end());

  beforeEach(() => (seen.length = 0));

  const profile = (written?: string): Profile =>
    ({
      id: 'w',
      displayName: 'W',
      appUri: (MigratingApp as any).uri,
      ...(written ? { writtenWith: written } : {}),
      values: { title: 'Ward 3' },
      components: {
        link: {
          uri: (MigratingLink as any).uri,
          ...(written ? { writtenWith: written } : {}),
          values: { address: 'lis.local:2575' },
        },
      },
    }) as Profile;

  const classOf = (s: { kind: string; uri: string }) =>
    s.kind === 'app' ? MigratingApp : MigratingLink;

  it("should declare it in the metadata, an app's and a component's", () => {
    expect(
      ExtensionRegistry.getApp((MigratingApp as any).uri).metadata.staticEvents,
    ).toMatchObject({ migrateProfile: 'migrateProfile' });
    expect(
      (
        ExtensionRegistry.getComponent((MigratingLink as any).uri)
          .metadata as any
      ).staticEvents,
    ).toEqual({ migrateProfile: 'migrateProfile' });
  });

  it('should tell the classes to run it, written with an earlier version or none told, not with this one', () => {
    const steps = profileMigrations(profile('0.0.1'));
    expect(steps).toEqual([
      {
        kind: 'app',
        path: '',
        uri: (MigratingApp as any).uri,
        version,
        from: '0.0.1',
        method: 'migrateProfile',
      },
      {
        kind: 'component',
        path: 'components/link',
        uri: (MigratingLink as any).uri,
        version,
        from: '0.0.1',
        method: 'migrateProfile',
      },
    ]);
    expect(profileMigrations(profile()).map(s => s.from)).toEqual([
      undefined,
      undefined,
    ]);
    expect(profileMigrations(profile(version))).toEqual([]);
  });

  it('should keep what a migrating class no longer defines, for its own migrateProfile to read', () => {
    const { profile: carried } = carryProfile(profile('0.0.1'));
    expect(carried.values).toEqual({ title: 'Ward 3' });
    expect(carried.components!.link.values).toEqual({
      address: 'lis.local:2575',
    });
  });

  it('should run each on its own values, the profile given left as it was', async () => {
    const given = profile('0.0.1');
    const out = await runProfileMigrations(
      given,
      profileMigrations(given),
      classOf,
    );
    expect(out.values).toEqual({ name: 'Ward 3' });
    expect(out.components!.link.values).toEqual({
      host: 'lis.local',
      port: 2575,
    });
    expect(seen).toEqual([
      { values: { title: 'Ward 3' }, from: '0.0.1', to: version, path: '' },
    ]);
    expect(given).toEqual(profile('0.0.1'));
  });

  it('should take a sealed secret moved or dropped, and refuse one made', async () => {
    const sealed = `${SECRET_PREFIX}abc`;
    const given = profile('0.0.1');
    given.values = { title: 'Ward 3', token: sealed };
    const moved = await runProfileMigrations(
      given,
      profileMigrations(given),
      classOf,
    );
    expect(moved.values).toEqual({ name: 'Ward 3', token: sealed });
    const made = {
      migrateProfile: () => ({ token: `${SECRET_PREFIX}made` }),
    };
    await expect(
      runProfileMigrations(given, profileMigrations(given), () => made),
    ).rejects.toThrow(/a secret it was not given/);
  });

  it('should refuse an answer that is not values', async () => {
    const given = profile('0.0.1');
    await expect(
      runProfileMigrations(given, profileMigrations(given), () => ({
        migrateProfile: () => undefined,
      })),
    ).rejects.toThrow(/answered no values/);
  });
});
