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
} from '../../src/index.js';

const seen: Record<string, ProfileMigration> = {};

class FoldedLinkVariables {
  @DefineVariable()
  declare host?: string;
}

@Component({ className: 'FoldedLink', formerly: ['OldLink'] })
class FoldedLink extends ComponentBase {
  @Component.UseVariables(FoldedLinkVariables)
  declare values: FoldedLinkVariables;

  @Component.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    seen.link = m;
    return m.values;
  }
}

class FoldedAppVariables {
  @DefineVariable()
  declare model?: string;
}

/* Two model apps folded into one: the model told by the class written for */
@App({ className: 'FoldedApp', formerly: ['ModelAApp', 'ModelBApp'] })
class FoldedApp extends AppBase {
  @App.UseVariables(FoldedAppVariables)
  declare values: FoldedAppVariables;

  @App.UseComponent()
  declare link?: FoldedLink;

  @App.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    seen.app = m;
    const model = m.fromUri?.split(':').pop()?.replace(/App$/, '');
    return model ? { ...m.values, model } : m.values;
  }
}

describe('A migration told the class a profile was written for, renamed since (formerly)', () => {
  let end: () => void;
  let pkg: string;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [FoldedLink, FoldedApp])
      await ExtensionRegistry.registerClass(cls as any);
    const uri = (FoldedApp as any).uri as string;
    pkg = uri.slice(0, uri.lastIndexOf(':'));
  });

  after(() => end());

  beforeEach(() => {
    delete seen.app;
    delete seen.link;
  });

  const profile = (app: string, link: string): Profile =>
    ({
      id: 'w',
      displayName: 'W',
      appUri: `${pkg}:${app}`,
      writtenWith: '0.0.1',
      values: {},
      components: {
        link: { uri: `${pkg}:${link}`, writtenWith: '0.0.1', values: {} },
      },
    }) as Profile;

  const migrate = async (p: Profile, withChanges = true) => {
    const { profile: carried, changes } = carryProfile(p);
    const steps = profileMigrations(
      carried,
      withChanges ? { changes } : undefined,
    );
    return {
      steps,
      out: await runProfileMigrations(carried, steps, s =>
        s.kind === 'app' ? FoldedApp : FoldedLink,
      ),
    };
  };

  it("should give the app and the component the former class's uri", async () => {
    const { steps, out } = await migrate(profile('ModelBApp', 'OldLink'));
    expect(steps.map(s => [s.path, s.fromUri])).toEqual([
      ['components/link', `${pkg}:OldLink`],
      ['', `${pkg}:ModelBApp`],
    ]);
    expect(seen.app?.fromUri).toBe(`${pkg}:ModelBApp`);
    expect(seen.link?.fromUri).toBe(`${pkg}:OldLink`);
    expect(out.appUri).toBe((FoldedApp as any).uri);
    expect(out.values).toEqual({ model: 'ModelB' });
  });

  it('should give none where the class kept its name, or the changes were not told', async () => {
    await migrate(profile('FoldedApp', 'FoldedLink'));
    expect(seen.app).toBeDefined();
    expect(seen.app?.fromUri).toBeUndefined();
    expect(seen.link?.fromUri).toBeUndefined();
    const { steps } = await migrate(profile('ModelAApp', 'OldLink'), false);
    expect(steps.every(s => s.fromUri === undefined)).toBe(true);
  });
});
