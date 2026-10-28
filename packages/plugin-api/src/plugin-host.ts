import type { Type } from 'ts-gems';
import type { Contribution, ContributionPoint } from './contributions.js';
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
  /** How it is doing, told on its card: since 2.1 */
  readonly status: PluginHost.Status;
  /** Questions to the admins, and actions of its own: since 2.1 */
  readonly ui: PluginHost.Ui;
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

  /** The workers, read; and what they are given as they start */
  export interface Workers {
    list(): Worker[];
    get(id: string): Worker | undefined;
    /**
     * Adds to the environment every worker starts with - an isolated one
     * too - since 2.1. A list is put before what the variable has, joined
     * with ":"; a string is set, unless SyncBridge's own environment sets
     * it. The directories of LD_LIBRARY_PATH and ORACLE_HOME are given to
     * the reads of a worker declaring native code. A running worker takes
     * it at its restart, marked as waiting for it. Returns what removes
     * it; undone too when the plugin is deactivated.
     */
    addEnvironment(environment: Record<string, string | string[]>): () => void;
  }

  /** How a plugin is doing */
  export interface StatusInfo {
    /** attention: it waits for an admin - a question asked */
    state: 'ready' | 'busy' | 'attention' | 'error';
    message?: string;
    /** 0..1, when known: a download's */
    progress?: number;
  }

  export interface Status {
    /** Told on its card while it is active; not kept over a restart */
    set(status: StatusInfo): void;
    clear(): void;
  }

  /** An answer a question offers */
  export interface Choice {
    value: string;
    label: string;
    /** The answer it expects, drawn as the main one */
    primary?: boolean;
    danger?: boolean;
  }

  /** A question to the server's admins */
  export interface Question {
    /** Its own among the plugin's: asked again, answered with the answer kept */
    id: string;
    title: string;
    text?: string;
    /** Read before answering: a license */
    link?: { label: string; url: string };
    /** Its answers; with an input, the form's buttons */
    choices?: Choice[];
    /** A form: a class of @DefineVariable's, as its settings are */
    input?: Type;
  }

  /** An admin's answer, kept with who gave it and when */
  export interface Answer {
    choice?: string;
    values?: Record<string, any>;
    /** Who answered: an admin's name */
    by: string;
    /** When, ISO 8601 */
    at: string;
  }

  /** What an action tells when it is done */
  export interface ActionResult {
    message?: string;
  }

  /** A button on its card, run by an admin */
  export interface Action<TInput = any> {
    /** Its own among the plugin's; lower case, "-" allowed */
    name: string;
    label: string;
    description?: string;
    /** Asked in a form first: a class of @DefineVariable's */
    input?: Type<TInput>;
    /** Asked to confirm first, in these words */
    confirm?: string;
    danger?: boolean;
    /** What it does; its message, or what it throws, told on the card */
    run(input: TInput): void | ActionResult | Promise<void | ActionResult>;
  }

  /**
   * Questions to the admins and actions of the plugin's own, drawn by
   * SyncBridge on its card - nothing of the plugin runs in the browser
   */
  export interface Ui {
    /**
     * Asks the admins; resolved when one answers - at once when it was
     * answered before, the answer kept in the plugin's data. Waiting, the
     * plugin's status is "attention".
     */
    ask(question: Question): Promise<Answer>;
    /** The answer kept forgotten: asked anew - a new license */
    forget(id: string): void;
    /** A button on its card; returns what removes it */
    registerAction<TInput = any>(action: Action<TInput>): () => void;
    /**
     * Adds a component at a point of the web UI (contributions.ts), since
     * 2.3: its own contributions named apart by `id`, one given again
     * replacing it. Returns what removes it; undone too when the plugin is
     * deactivated.
     */
    contribute<P extends ContributionPoint>(
      point: P,
      contribution: Contribution<P> & { id: string },
    ): () => void;
    /**
     * What a contribution's `resolve` answered, asked again: where it is
     * drawn for one item alone (a worker's id), or everywhere - since 2.3
     */
    refresh(point: ContributionPoint, id: string, key?: string): void;
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
