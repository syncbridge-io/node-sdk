import type { LogTarget } from './log-target.js';

/**
 * A plugin's bridge to SyncBridge: everything of the engine a plugin uses is
 * here, grouped by area, so the engine's own classes never reach a plugin.
 *
 * It grows by additions only. What a plugin registers through it is tied
 * to the plugin, and undone when the plugin is deactivated or fails to
 * activate.
 */
export interface PluginHost {
  readonly engine: PluginHost.Engine;
  readonly logs: PluginHost.Logs;
  readonly events: PluginHost.Events;
  readonly workers: PluginHost.Workers;
}

export namespace PluginHost {
  export interface Engine {
    /** The version of SyncBridge */
    readonly version: string;
    /** The version of the plugin API it provides: @syncbridge/plugin-api */
    readonly apiVersion: string;
  }

  export interface Logs {
    /**
     * Registers a log target. It is set and turned on in the config under
     * its name (`logs.targets.<name>`), and is off unless it is. Plugins are
     * activated before the log targets start, so a target registered in
     * `activate` is found as the engine starts.
     */
    registerTarget<TValues = any>(
      definition: LogTarget.Definition<TValues>,
    ): void;
  }

  /**
   * The lifecycle events of the engine and its workers. A listener is called
   * after the event, never in its way: it cannot hold up, stop or change
   * what happened. What it throws is logged.
   */
  export interface Events {
    /** Adds a listener; returns the function that removes it */
    on<K extends keyof EventMap & string>(
      event: K,
      listener: (...args: EventMap[K]) => void | Promise<void>,
    ): () => void;
  }

  export interface EventMap {
    /** The engine has started: its workers are loaded */
    'engine-started': [];
    /** The engine is stopping */
    'engine-stopping': [];
    'worker-created': [Worker];
    'worker-removed': [Worker];
    /** Its profile was changed */
    'worker-updated': [Worker];
    /** Its status changed: started, stopped, failed… */
    'worker-status-changed': [Worker];
  }

  /** The workers, read only */
  export interface Workers {
    list(): Worker[];
    get(id: string): Worker | undefined;
  }

  /** A worker as a plugin sees it: a copy, taken when asked */
  export interface Worker {
    id: string;
    name: string;
    group?: string;
    /** `stopped`, `starting`, `started`, `stopping`, `invalid`… */
    status: string;
    statusMessage?: string;
    /** The app it runs: `@vendor/package:ClassName` */
    appUri: string;
    appVersion?: string;
  }
}
