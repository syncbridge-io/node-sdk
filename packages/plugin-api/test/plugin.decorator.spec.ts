import 'reflect-metadata';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  DefineVariable,
  normalizePluginMetadata,
} from '@syncbridge/common';
import { expect } from 'expect';
import { Plugin, PluginBase, PluginPermission } from '../src/index.js';

describe('@Plugin', () => {
  it('should define the plugin with its settings', async () => {
    class Settings {
      @DefineVariable({ label: 'URL', required: true })
      url!: string;
    }

    @Plugin({
      name: 'audit-log',
      title: 'Audit',
      description: 'Copies the audit records',
      settings: Settings,
    })
    class AuditPlugin extends PluginBase<Settings> {
      activate() {}
    }

    expect(Reflect.getMetadata(CLASS_TYPE, AuditPlugin)).toBe('plugin');
    const metadata = await normalizePluginMetadata(
      Reflect.getMetadata(CLASS_METADATA, AuditPlugin),
    );
    expect(metadata).toMatchObject({
      classType: 'plugin',
      name: 'audit-log',
      className: 'AuditPlugin',
      title: 'Audit',
      description: 'Copies the audit records',
      settings: { url: { label: 'URL', required: true } },
    });
  });

  it('should refuse a name that cannot be a config key', () => {
    expect(() => Plugin({ name: 'Audit Log' })).toThrow(
      /Invalid plugin name "Audit Log"/,
    );
  });

  it('should tell what it declares it needs, the hosts it reaches among them', async () => {
    @Plugin({
      name: 'oracle-client',
      permissions: [
        PluginPermission.WorkerAddEnv,
        PluginPermission.NetworkConnect,
        PluginPermission.NetworkConnect,
      ],
      hosts: ['download.oracle.com'],
    })
    class OracleClientPlugin extends PluginBase {
      activate() {}
    }

    const metadata = await normalizePluginMetadata(
      Reflect.getMetadata(CLASS_METADATA, OracleClientPlugin),
    );
    expect(metadata.permissions).toEqual(['worker:add-env', 'network:connect']);
    expect(metadata.hosts).toEqual(['download.oracle.com']);
  });

  it('should take the first codes, and their names, as the ones they became', async () => {
    @Plugin({
      name: 'legacy',
      permissions: [
        PluginPermission.Workers,
        'log-records' as PluginPermission,
        'network' as PluginPermission,
        PluginPermission.NetworkConnect,
      ],
      hosts: ['example.com'],
    })
    class LegacyPlugin extends PluginBase {
      activate() {}
    }
    const metadata = await normalizePluginMetadata(
      Reflect.getMetadata(CLASS_METADATA, LegacyPlugin),
    );
    expect(metadata.permissions).toEqual([
      'worker:read-summary',
      'log:read',
      'network:connect',
    ]);
    expect(Object.values(PluginPermission)).toEqual([
      'worker:read-summary',
      'worker:add-env',
      'log:read',
      'network:connect',
      'child-process:spawn',
      'native-code:execute',
    ]);
  });

  it('should declare nothing when nothing is given', async () => {
    @Plugin({ name: 'quiet' })
    class QuietPlugin extends PluginBase {
      activate() {}
    }
    const metadata = Reflect.getMetadata(CLASS_METADATA, QuietPlugin);
    expect(metadata.permissions).toBeUndefined();
    expect(metadata.hosts).toBeUndefined();
  });

  it('should refuse a permission it does not know, and hosts without the network', () => {
    expect(() =>
      Plugin({ name: 'a', permissions: ['root' as PluginPermission] }),
    ).toThrow(/unknown permission "root"/);
    expect(() => Plugin({ name: 'a', hosts: ['example.com'] })).toThrow(
      /hosts are given with the "network:connect" permission/,
    );
  });
});
