import type { ILogger } from '@syncbridge/common';
import type { PluginHost } from './plugin-host.js';

/**
 * The class a plugin extends. What is the plugin's own is a member of it;
 * the engine is reached through `host` only.
 *
 * SyncBridge creates it when the plugin is enabled (`plugins.<name>`),
 * calls `activate` as it starts, before its log targets start, and
 * `deactivate` as it stops. Its life's other hooks, each optional, since
 * 2.3:
 *
 *   approved -> install({}) -> activate                   its first time
 *   approved -> [data copied] -> install({from}) -> activate  a new version
 *   checkSettings -> saved -> settingsChanged             its settings
 *   deactivate -> uninstall -> its data deleted           removed
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

  /**
   * Called once at its first approval (`from` none), and once at each
   * version after it, before it is activated: what is to be made, or
   * moved to the new version. A plugin that throws is not activated - an
   * update keeps its data as it was. Never called with `from` newer than
   * `to`: a version taken back takes back the data copied before it.
   */
  install?(info: PluginBase.Install): void | Promise<void>;

  /**
   * Called once as its package is removed, after it is deactivated: what
   * it made outside its data directory undone. Removing never waits on it
   * beyond a time; its data directory is deleted after it.
   */
  uninstall?(): void | Promise<void>;

  /**
   * Its settings saved, as it runs: `true` taken at once (`settings` is
   * then `next`); `false` or none, it is restarted with them
   */
  settingsChanged?(
    next: TSettings,
    previous: TSettings,
  ): boolean | Promise<boolean>;

  /**
   * Settings asked to be saved, checked first - what their types cannot
   * tell: a server reached, credentials taken. What it answers is told by
   * field, and nothing is saved.
   */
  checkSettings?(
    candidate: TSettings,
  ): PluginBase.SettingsProblem[] | Promise<PluginBase.SettingsProblem[]>;
}

export namespace PluginBase {
  export interface InitArgs<TSettings> {
    name: string;
    settings: TSettings;
    logger: ILogger;
    dataDirectory: string;
    host: PluginHost;
  }

  /** The versions an install moves between */
  export interface Install {
    /** The version installed before; none at its first */
    from?: string;
    to: string;
  }

  /** What is wrong with settings, by the setting */
  export interface SettingsProblem {
    /** The setting; none: the settings as a whole */
    field?: string;
    message: string;
  }
}
