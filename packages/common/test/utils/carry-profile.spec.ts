import { expect } from 'expect';
import {
  App,
  AppBase,
  carryProfile,
  Component,
  ComponentBase,
  decodeProfileSilent,
  DefineVariable,
  ExtensionRegistry,
  Profile,
} from '../../src/index.js';

class CarryTls {
  @DefineVariable({ formerly: 'certificate' })
  declare cert?: string;
}

class CarryLinkVariables {
  @DefineVariable({ formerly: ['address', 'addr'], required: true })
  declare host: string;

  @DefineVariable({
    enumValues: ['tcp-client', 'tcp-server'],
    formerlyValues: { tcp: 'tcp-client' },
  })
  declare mode?: string;

  @DefineVariable({ variables: CarryTls })
  declare tls?: CarryTls;
}

@Component({ className: 'CarryLink', formerly: ['CarryConn', 'CarryOld'] })
class CarryLink extends ComponentBase {
  @Component.UseVariables(CarryLinkVariables)
  declare values: CarryLinkVariables;
}

/* A subclass: its base's former names are not its own */
@Component({ className: 'CarryLinkPlus' })
class CarryLinkPlus extends CarryLink {}

class CarryAppVariables {
  @DefineVariable({ formerly: 'title' })
  declare name?: string;
}

@App({ className: 'CarryApp', formerly: 'CarryOldApp' })
class CarryApp extends AppBase {
  @App.UseVariables(CarryAppVariables)
  declare values: CarryAppVariables;

  @App.UseComponent({ formerly: 'conn', required: true })
  declare link: CarryLink;
}

const pkg = (CarryApp as any).packageName as string;

/** A profile written for the earlier versions: every name a former one */
function oldProfile(written?: string): Profile {
  return {
    id: 'w',
    displayName: 'W',
    appUri: `${pkg}:CarryOldApp`,
    ...(written ? { writtenWith: written } : {}),
    values: { title: 'Ward 3', gone: 1 },
    components: {
      conn: {
        uri: `${pkg}:CarryConn`,
        ...(written ? { writtenWith: written } : {}),
        values: {
          address: 'lis.local',
          mode: 'tcp',
          tls: { certificate: 'PEM' },
          stale: 2,
        },
      },
    },
  } as Profile;
}

describe('Carrying a profile to the versions it takes', () => {
  let end: () => void;
  let version: string;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [CarryLink, CarryLinkPlus, CarryApp])
      await ExtensionRegistry.registerClass(cls as any);
    version = ExtensionRegistry.getApp((CarryApp as any).uri).version;
  });

  after(() => end());

  it('should declare former names as lists, a class its own alone', () => {
    const app = ExtensionRegistry.getApp((CarryApp as any).uri).metadata;
    expect(app.formerly).toEqual(['CarryOldApp']);
    expect(app.components!.link.formerly).toEqual(['conn']);
    expect(app.variables!.name.formerly).toEqual(['title']);
    const link = ExtensionRegistry.getComponent(
      (CarryLink as any).uri,
    ).metadata;
    expect(link.formerly).toEqual(['CarryConn', 'CarryOld']);
    expect(link.variables!.host.formerly).toEqual(['address', 'addr']);
    expect(link.variables!.mode.formerlyValues).toEqual({ tcp: 'tcp-client' });
    expect(link.variables!.tls.variables!.cert.formerly).toEqual([
      'certificate',
    ]);
    expect(
      ExtensionRegistry.getComponent((CarryLinkPlus as any).uri).metadata
        .formerly,
    ).toBeUndefined();
  });

  it('should carry what is declared - classes, a slot, settings, a choice - and drop what is gone', () => {
    const given = oldProfile();
    const { profile, changes } = carryProfile(given);
    expect(profile).toMatchObject({
      appUri: (CarryApp as any).uri,
      values: { name: 'Ward 3' },
      components: {
        link: {
          uri: (CarryLink as any).uri,
          values: {
            host: 'lis.local',
            mode: 'tcp-client',
            tls: { cert: 'PEM' },
          },
        },
      },
    });
    expect(profile.values).toEqual({ name: 'Ward 3' });
    expect(profile.components!.conn).toBeUndefined();
    expect(Object.keys(profile.components!.link.values!).sort()).toEqual([
      'host',
      'mode',
      'tls',
    ]);
    expect(
      changes.map(c => [c.kind, c.location, c.from, c.to ?? null]),
    ).toEqual([
      ['class', 'appUri', `${pkg}:CarryOldApp`, (CarryApp as any).uri],
      ['value', 'values/name', 'title', 'name'],
      ['dropped', 'values/gone', 'gone', null],
      ['component', 'components/link', 'conn', 'link'],
      [
        'class',
        'components/link/uri',
        `${pkg}:CarryConn`,
        (CarryLink as any).uri,
      ],
      ['value', 'components/link/values/host', 'address', 'host'],
      ['choice', 'components/link/values/mode', 'tcp', 'tcp-client'],
      ['value', 'components/link/values/tls/cert', 'certificate', 'cert'],
      ['dropped', 'components/link/values/stale', 'stale', null],
    ]);
    expect(changes[1].message).toBe('Setting "title" renamed "name"');
    /* What it was given is left as it was */
    expect(given).toEqual(oldProfile());
    /* And it is a profile of the classes as they are */
    expect(decodeProfileSilent(profile).result).toBe(true);
    expect(() => decodeProfileSilent(oldProfile())).toThrow(/not found/);
  });

  it('should carry values written with an earlier version, not with this one or a newer', () => {
    const earlier = carryProfile(oldProfile('0.0.1'));
    expect(earlier.profile.components!.link.values!.host).toBe('lis.local');
    for (const written of [version, '999.0.0']) {
      const p = oldProfile(written);
      p.appUri = (CarryApp as any).uri;
      p.components = {
        link: { ...p.components!.conn, uri: (CarryLink as any).uri },
      };
      const { profile, changes } = carryProfile(p);
      expect(changes).toEqual([]);
      expect(profile.values).toEqual({ title: 'Ward 3', gone: 1 });
      expect(profile.components!.link.values!.address).toBe('lis.local');
    }
  });

  it('should carry a component its holder carries, though its own values are of its version', () => {
    const p = oldProfile('0.0.1');
    p.components!.conn.writtenWith = version;
    const { profile } = carryProfile(p);
    expect(profile.components!.link.values!.host).toBe('lis.local');
  });

  it('should leave a value under its new name, and a reference among choices, as they are', () => {
    const p = oldProfile();
    p.components!.conn.values = {
      host: 'new.local',
      address: 'old.local',
      mode: '${{ vars.MODE }}',
    };
    const { profile, changes } = carryProfile(p);
    expect(profile.components!.link.values).toEqual({
      host: 'new.local',
      mode: '${{ vars.MODE }}',
    });
    expect(changes.filter(c => c.kind === 'choice')).toEqual([]);
    expect(
      changes.find(c => c.location === 'components/link/values/address')?.kind,
    ).toBe('dropped');
  });

  it('should leave a profile whose app is not found as it is', () => {
    const p = { ...oldProfile(), appUri: `${pkg}:NoSuchApp` } as Profile;
    expect(carryProfile(p)).toEqual({ profile: p, changes: [] });
  });
});
