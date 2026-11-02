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
  type ProfileCarryChange,
  type ProfileMigration,
  profileMigrations,
  runProfileMigrations,
  SECRET_PREFIX,
} from '../../src/index.js';

class SplitServerVariables {
  @DefineVariable({ formerly: ['listen'] })
  declare port?: number;
}

@Component({ className: 'SplitServer' })
class SplitServer extends ComponentBase {
  @Component.UseVariables(SplitServerVariables)
  declare values: SplitServerVariables;

  /* Older versions kept "ip" as well: no more */
  @Component.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    delete m.values.ip;
    return m.values;
  }
}

class SplitDeviceVariables {
  @DefineVariable()
  declare readFrequency?: number;
}

@Component({ className: 'SplitDevice' })
class SplitDevice extends ComponentBase {
  @Component.UseVariables(SplitDeviceVariables)
  declare values: SplitDeviceVariables;

  @Component.UseComponent({ uri: (SplitServer as any).uri })
  declare hl7Server?: SplitServer;
}

class SplitAppVariables {
  @DefineVariable()
  declare limits?: string;
}

/* 2.0 took the device's work into SplitDevice: hl7Server and readFrequency
 * moved down into it */
@App({ className: 'SplitApp' })
class SplitApp extends AppBase {
  @App.UseVariables(SplitAppVariables)
  declare values: SplitAppVariables;

  @App.UseComponent({ required: true, uri: (SplitDevice as any).uri })
  declare device: SplitDevice;

  @App.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    const p = m.profile!;
    p.addComponent('components/device', (SplitDevice as any).uri);
    p.move('components/hl7Server', 'components/device/components/hl7Server');
    p.move('values/readFrequency', 'components/device/values/readFrequency');
    return m.values;
  }
}

describe('An app moving its profile about, migrateProfile', () => {
  let end: () => void;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [SplitServer, SplitDevice, SplitApp])
      await ExtensionRegistry.registerClass(cls as any);
  });

  after(() => end());

  /* As 1.x wrote it: hl7Server a slot of the app's own */
  const written = (): Profile =>
    ({
      id: 'w',
      displayName: 'W',
      appUri: (SplitApp as any).uri,
      writtenWith: '0.0.1',
      values: { limits: 'adult', readFrequency: 5 },
      components: {
        hl7Server: {
          uri: (SplitServer as any).uri,
          writtenWith: '0.0.1',
          values: { listen: 2575, ip: '0.0.0.0' },
        },
      },
    }) as Profile;

  const classOf = (s: { uri: string }) =>
    [SplitServer, SplitDevice, SplitApp].find(c => (c as any).uri === s.uri);

  it('should carry a component in a slot no longer declared, by its own class', () => {
    const { profile, changes } = carryProfile(written());
    expect(profile.components!.hl7Server.values).toEqual({
      port: 2575,
      ip: '0.0.0.0',
    });
    expect(changes.map(c => c.location)).toEqual([
      'components/hl7Server/values/port',
    ]);
  });

  it('should run the components first, the app last', () => {
    const { profile } = carryProfile(written());
    expect(profileMigrations(profile).map(s => s.path)).toEqual([
      'components/hl7Server',
      '',
    ]);
  });

  it('should move a slot and a setting down into a new component, carried already', async () => {
    const { profile } = carryProfile(written());
    const changes: ProfileCarryChange[] = [];
    const out = await runProfileMigrations(
      profile,
      profileMigrations(profile),
      classOf,
      { changes },
    );
    expect(out.values).toEqual({ limits: 'adult' });
    expect(out.components).toEqual({
      device: {
        uri: (SplitDevice as any).uri,
        components: {
          hl7Server: {
            uri: (SplitServer as any).uri,
            writtenWith: '0.0.1',
            values: { port: 2575 },
          },
        },
        values: { readFrequency: 5 },
      },
    });
    expect(changes.map(c => [c.kind, c.location])).toEqual([
      ['added', 'components/device'],
      ['moved', 'components/device/components/hl7Server'],
      ['moved', 'components/device/values/readFrequency'],
    ]);
    expect(profile).toEqual(carryProfile(written()).profile);
  });

  it('should take a sealed secret moved from a component, refuse one made', async () => {
    const sealed = `${SECRET_PREFIX}abc`;
    const given = written();
    given.components!.hl7Server.values!.key = sealed;
    const step = profileMigrations(given).filter(s => s.kind === 'app');
    const moving = {
      migrateProfile(m: ProfileMigration) {
        m.profile!.move('components/hl7Server/values/key', 'values/key');
        return m.values;
      },
    };
    const out = await runProfileMigrations(given, step, () => moving);
    expect(out.values!.key).toBe(sealed);
    const making = {
      migrateProfile(m: ProfileMigration) {
        m.profile!.set('components/hl7Server/values/key', `${SECRET_PREFIX}x`);
        return m.values;
      },
    };
    await expect(
      runProfileMigrations(given, step, () => making),
    ).rejects.toThrow(/a secret it was not given/);
  });
});
