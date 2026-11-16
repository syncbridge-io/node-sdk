import 'reflect-metadata';
import * as common from '@syncbridge/common';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  type PluginMetadata,
  PluginPermission,
  readVariables,
} from '@syncbridge/common';
import type { Type } from 'ts-gems';
import type { PluginBase } from './plugin-base.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/* The first codes taken as the ones they became - by a common that has
 * them; one before them knows the first codes alone, as they are */
const permissionCodes: (codes?: PluginPermission[]) => PluginPermission[] =
  (common as any).permissionCodes ?? ((codes?: PluginPermission[]) => codes);
/* Its code, by the common found: "network" in one before the new codes */
const NETWORK: PluginPermission =
  (PluginPermission as any).NetworkConnect ?? 'network';

/**
 * Makes a class a plugin. syncbuild finds it among the classes the package
 * exports from its entry point and lists it in the package's manifest.
 *
 * @example
 * @Plugin({ name: 'audit', settings: AuditSettings })
 * export class AuditPlugin extends PluginBase<AuditSettings> {
 *   async activate() {
 *     this.host.events.on('worker-updated', worker => send(worker));
 *   }
 * }
 */
export function Plugin(options: Plugin.Options) {
  if (!NAME_PATTERN.test(options.name))
    throw new TypeError(
      `Invalid plugin name "${options.name}": lower case letters, digits and "-", starting with a letter`,
    );
  const known = Object.values(PluginPermission) as string[];
  /* The first codes taken as the ones they became */
  const permissions = permissionCodes(options.permissions);
  for (const p of permissions || [])
    if (!known.includes(p))
      throw new TypeError(
        `Plugin "${options.name}": unknown permission "${p}" - one of ${known.join(', ')}`,
      );
  if (options.hosts?.length && !permissions?.includes(NETWORK))
    throw new TypeError(
      `Plugin "${options.name}": hosts are given with the "${NETWORK}" permission`,
    );
  /* Read now: the settings class is defined before the plugin's */
  const settings = options.settings
    ? readVariables(options.settings)
    : undefined;
  return function <T extends Type<PluginBase<any>>>(target: T) {
    const classType = Reflect.getMetadata(CLASS_TYPE, target);
    if (classType && classType !== 'plugin')
      throw new TypeError(`${target.name} already decorated as "${classType}"`);
    Reflect.defineMetadata(CLASS_TYPE, 'plugin', target);
    const metadata: PluginMetadata = {
      classType: 'plugin',
      name: options.name,
      className: target.name,
      title: options.title,
      description: options.description,
      settings,
      ...(permissions?.length ? { permissions } : {}),
      ...(options.hosts?.length ? { hosts: [...options.hosts] } : {}),
    };
    Reflect.defineMetadata(CLASS_METADATA, metadata, target);
  };
}

export namespace Plugin {
  export interface Options {
    /** The name it is set by: `plugins.<name>`; lower case, `-` allowed */
    name: string;
    title?: string;
    description?: string;
    /** The class its settings are defined by, with @DefineVariable */
    settings?: Type;
    /**
     * What it reaches beyond its own data directory: shown to the server's
     * admins, given once they approve it, nothing else. Not declared, none
     */
    permissions?: PluginPermission[];
    /** The hosts it connects to, with `PluginPermission.NetworkConnect` */
    hosts?: string[];
  }
}
