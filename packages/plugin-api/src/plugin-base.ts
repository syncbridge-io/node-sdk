import type { ILogger } from '@syncbridge/common';
import type { PluginHost } from './plugin-host.js';

/**
 * The class a plugin extends. What is the plugin's own is a member of it;
 * the engine is reached through `host` only.
 *
 * SyncBridge creates it when the plugin is enabled (`plugins.<name>`),
 * calls `activate` as it starts, before its log targets start, and
 * `deactivate` as it stops.
 */
export abstract class PluginBase<TSettings = Record<string, any>> {
  /** The name it is set by: `plugins.<name>` */
  readonly name: string;
  /** Its settings from the config, checked against its definition */
  readonly settings: TSettings;
  /** Its own log, in the engine's log under its name */
  readonly logger: ILogger;
  /** A directory of its own, for what it keeps */
  readonly dataDirectory: string;
  /** The bridge to SyncBridge */
  readonly host: PluginHost;

  constructor(init: PluginBase.InitArgs<TSettings>) {
    this.name = init.name;
    this.settings = init.settings;
    this.logger = init.logger;
    this.dataDirectory = init.dataDirectory;
    this.host = init.host;
  }

  /** Called as the engine starts. A plugin that throws is turned off */
  abstract activate(): void | Promise<void>;

  /** Called as the engine stops, before what it registered is undone */
  deactivate(): void | Promise<void> {}
}

export namespace PluginBase {
  export interface InitArgs<TSettings> {
    name: string;
    settings: TSettings;
    logger: ILogger;
    dataDirectory: string;
    host: PluginHost;
  }
}
