import {
  App,
  AppBase,
  DefineVariable,
  ExtensionRegistry,
  type Profile,
  type ProfileMigration,
} from '@syncbridge/common';
import { expect } from 'expect';
import { migrateProfileTo } from '../src/index.js';

class GatewayVariables {
  @DefineVariable({ formerly: 'server', required: true })
  declare host: string;

  @DefineVariable({ required: true })
  declare port: number;
}

@App({ className: 'MigrateGateway' })
class MigrateGateway extends AppBase {
  @App.UseVariables(GatewayVariables)
  declare values: GatewayVariables;

  /* 1.x kept the port in the host: "lis:2575" */
  @App.MigrateProfile()
  static migrateProfile(m: ProfileMigration) {
    const [host, port] = String(m.values.host ?? '').split(':');
    return port ? { ...m.values, host, port: Number(port) } : m.values;
  }
}

describe('migrateProfileTo', () => {
  let end: () => void;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    await ExtensionRegistry.registerClass(MigrateGateway as any);
  });

  after(() => end());

  const old = (values: Record<string, any>): Profile =>
    ({
      id: 'g',
      displayName: 'G',
      appUri: (MigrateGateway as any).uri,
      writtenWith: '1.0.0',
      values,
    }) as Profile;

  it('should carry what the class declares, then run its own migrateProfile, and check the result', async () => {
    const r = await migrateProfileTo(old({ server: 'lis:2575' }));
    expect(r.profile.values).toEqual({ host: 'lis', port: 2575 });
    expect(r.changes.map(c => c.message)).toEqual([
      'Setting "server" renamed "host"',
    ]);
    expect(r.migrated).toEqual([(MigrateGateway as any).uri]);
    expect(r.issues).toEqual([]);
  });

  it('should tell what is wrong once carried', async () => {
    const r = await migrateProfileTo(old({ server: 'lis' }));
    expect(r.issues.map(i => (i as any).location)).toEqual(['values/port']);
  });
});
