import 'reflect-metadata';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  type PluginMetadata,
  readVariables,
} from '@syncbridge/common';
import type { Type } from 'ts-gems';
import type { PluginBase } from './plugin-base.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Makes a class a plugin. syncbuild finds it among the classes the package
 * exports from its entry point and lists it in the package's manifest.
 *
 * @example
 * @Plugin({ name: 'elasticsearch-log', settings: ElasticSettings })
 * export class ElasticsearchLogPlugin extends PluginBase<ElasticSettings> {
 *   async activate() {
 *     this.host.logs.registerTarget({ name: 'elasticsearch', create: … });
 *   }
 * }
 */
export function Plugin(options: Plugin.Options) {
  if (!NAME_PATTERN.test(options.name))
    throw new TypeError(
      `Invalid plugin name "${options.name}": lower case letters, digits and "-", starting with a letter`,
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
  }
}
