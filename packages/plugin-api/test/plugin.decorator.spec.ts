import 'reflect-metadata';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  DefineVariable,
  normalizePluginMetadata,
} from '@syncbridge/common';
import { expect } from 'expect';
import { Plugin, PluginBase } from '../src/index.js';

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
});
