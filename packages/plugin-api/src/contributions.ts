import type { HostPermission } from '@syncbridge/common';
import type { Type } from 'ts-gems';

/**
 * What a plugin adds to SyncBridge's web UI: a component at a point - a
 * named place of the UI, as precise as it is offered. Each point takes the
 * components it lists, tells them where they are drawn (its context), and
 * offers the filters a contribution's `when` may use. Nothing of the
 * plugin runs in the browser: SyncBridge draws what it declares.
 *
 * A point, a component, a property or a filter added is a minor version;
 * one removed or changed in meaning, a major.
 */

/** How a filter matches the value it is given */
export type FilterMatch = 'one-of' | 'glob' | 'equals';

/** A filter of a point: where its value is in the context, how it matches */
export interface PointFilter {
  /** A path in the point's context: `worker.appUri` */
  from: string;
  match: FilterMatch;
}

/** A point of the catalog, as SyncBridge reads it */
export interface PointDefinition {
  /** The component it takes */
  component: ContributionComponent;
  /** Drawn once (a toolbar) or per item (a row): its filters are for items */
  per: 'page' | 'item';
  filters: Record<string, PointFilter>;
}

const WORKER_FILTERS = {
  app: { from: 'worker.appUri', match: 'glob' },
  status: { from: 'worker.status', match: 'one-of' },
  group: { from: 'worker.group', match: 'one-of' },
} as const satisfies Record<string, PointFilter>;

const LOG_FILTERS = {
  source: { from: 'log.source', match: 'one-of' },
  app: { from: 'log.appUri', match: 'glob' },
} as const satisfies Record<string, PointFilter>;

/** The points SyncBridge offers: the first catalog, of plugin-api 2.3 */
export const CONTRIBUTION_POINTS = {
  'shell.sidebar.top': { component: 'nav-item', per: 'page', filters: {} },
  'shell.topbar.indicator': { component: 'badge', per: 'page', filters: {} },
  'workers.toolbar.button': { component: 'button', per: 'page', filters: {} },
  'workers.row.menu': {
    component: 'menu-item',
    per: 'item',
    filters: WORKER_FILTERS,
  },
  'workers.row.badge': {
    component: 'badge',
    per: 'item',
    filters: WORKER_FILTERS,
  },
  'worker.header.menu': {
    component: 'menu-item',
    per: 'page',
    filters: WORKER_FILTERS,
  },
  'worker.header.badge': {
    component: 'badge',
    per: 'page',
    filters: WORKER_FILTERS,
  },
  'worker.overview.card': {
    component: 'card',
    per: 'page',
    filters: WORKER_FILTERS,
  },
  'logs.toolbar.button': {
    component: 'button',
    per: 'page',
    filters: LOG_FILTERS,
  },
  'logs.record.menu': {
    component: 'menu-item',
    per: 'item',
    filters: {
      ...LOG_FILTERS,
      level: { from: 'record.level', match: 'one-of' },
      channel: { from: 'record.channel', match: 'glob' },
    },
  },
  'server.header.menu': { component: 'menu-item', per: 'page', filters: {} },
  'plugin.card.button': { component: 'button', per: 'page', filters: {} },
} as const satisfies Record<string, PointDefinition>;

export type ContributionPoint = keyof typeof CONTRIBUTION_POINTS;

export type ContributionComponent =
  'menu-item' | 'button' | 'nav-item' | 'badge' | 'card';

/** How a badge or a card's row reads */
export type Tone = 'neutral' | 'ok' | 'warn' | 'error';

export namespace Contribution {
  /** A worker, as a point tells it */
  export interface WorkerContext {
    id: string;
    name: string;
    group?: string;
    status: string;
    appUri: string;
    appVersion?: string;
  }

  /** A log, as a point tells it: the server's, or a worker's */
  export interface LogContext {
    source: 'server' | 'worker';
    /** Of a worker's log */
    workerId?: string;
    appUri?: string;
    channel: string;
  }

  /** A log record, as a point tells it */
  export interface RecordContext {
    id?: string;
    time: string;
    level: string;
    message: string;
    channel: string;
  }

  /** The server, as a point tells it */
  export interface ServerContext {
    name: string;
    version: string;
  }

  /** What each point tells its components of where they are drawn */
  export interface Contexts {
    'shell.sidebar.top': { server: ServerContext };
    'shell.topbar.indicator': { server: ServerContext };
    'workers.toolbar.button': {
      filter: { search?: string; state?: string; group?: string };
    };
    'workers.row.menu': { worker: WorkerContext };
    'workers.row.badge': { worker: WorkerContext };
    'worker.header.menu': { worker: WorkerContext };
    'worker.header.badge': { worker: WorkerContext };
    'worker.overview.card': { worker: WorkerContext };
    'logs.toolbar.button': {
      log: LogContext;
      filter: { search?: string; level?: string; start?: string; end?: string };
    };
    'logs.record.menu': { log: LogContext; record: RecordContext };
    'server.header.menu': { server: ServerContext };
    'plugin.card.button': { plugin: { name: string } };
  }

  /* -------- The components and their properties -------- */

  /** What every component may have */
  interface Common {
    label: string;
    /** A name of the UI's icon set (lucide): `database`, `send` */
    icon?: string;
    description?: string;
    /** Not to be used now, and why */
    disabled?: string;
    hidden?: boolean;
  }

  /** What runs, asked first: an action's */
  interface Acting {
    /** Asked to confirm first, in these words */
    confirm?: string;
    /** Asked in a form first: a class of @DefineVariable's */
    input?: Type;
    /** Drawn as what cannot be undone */
    danger?: boolean;
  }

  /** One of a menu's or submenu's items: run with its name */
  export type Item =
    | ({ name: string; variant: 'action' } & Common & Acting)
    | ({ name: string; variant: 'toggle'; checked?: boolean } & Common);

  export type MenuItemProperties =
    | ({ variant: 'action' } & Common & Acting)
    | ({ variant: 'toggle'; checked?: boolean } & Common)
    | ({ variant: 'submenu'; items: Item[] } & Common);

  /** A button's look: none primary - a page's main button is its own */
  export type Appearance = 'secondary' | 'ghost' | 'icon';

  export type ButtonProperties = (
    | ({ variant: 'action' } & Common & Acting)
    | ({ variant: 'toggle'; checked?: boolean } & Common)
    | ({ variant: 'menu'; items: Item[] } & Common)
  ) & { appearance?: Appearance };

  export type NavItemProperties =
    | ({ variant: 'action'; icon: string; count?: number } & Common & Acting)
    | ({
        variant: 'link';
        icon: string;
        count?: number;
        href: string;
      } & Common);

  export interface BadgeProperties {
    text: string;
    tone?: Tone;
    icon?: string;
    tooltip?: string;
    /** http(s): opened in a new tab */
    link?: string;
    hidden?: boolean;
  }

  export interface CardProperties {
    title: string;
    icon?: string;
    rows: { label: string; value: string; tone?: Tone }[];
    link?: string;
    hidden?: boolean;
  }

  export interface PropertiesOf {
    'menu-item': MenuItemProperties;
    button: ButtonProperties;
    'nav-item': NavItemProperties;
    badge: BadgeProperties;
    card: CardProperties;
  }

  /** What `run` is given beyond its point's context */
  export interface RunExtras {
    /** A toggle's state, as it is turned to */
    checked?: boolean;
    /** Its form's values */
    input?: Record<string, any>;
    /** The item of a menu or submenu that was chosen */
    item?: string;
  }

  /** What `run` tells: told where it was run */
  export interface Result {
    message?: string;
    /** http(s): opened in a new tab */
    link?: string;
  }

  /** Where it stands among the point's contributions */
  export interface Placement {
    group?: string;
    order?: number;
  }

  /**
   * `when`: the point's filters, its values matched as its `match` says;
   * of a point offering none, nothing
   */
  export type When<P extends ContributionPoint> = [
    keyof (typeof CONTRIBUTION_POINTS)[P]['filters'],
  ] extends [never]
    ? Record<string, never>
    : {
        [F in keyof (typeof CONTRIBUTION_POINTS)[P]['filters']]?: string[];
      };
}

/**
 * A contribution at point `P`: a few fields at its root, the component's
 * own under `properties`
 */
export type Contribution<P extends ContributionPoint> = {
  component: (typeof CONTRIBUTION_POINTS)[P]['component'];
  properties: Contribution.PropertiesOf[(typeof CONTRIBUTION_POINTS)[P]['component']];
  placement?: Contribution.Placement;
  /** Where it is shown, by the point's filters - all of them to match */
  when?: Contribution.When<P>;
  /** Who may run it; none: those changing the server's settings */
  requires?: `${HostPermission}`;
  /**
   * Its properties by where it is: over the static ones. Its answer is
   * kept until `host.ui.refresh` - a list drawn again calls nothing.
   */
  resolve?(
    context: Contribution.Contexts[P],
  ):
    | Partial<
        Contribution.PropertiesOf[(typeof CONTRIBUTION_POINTS)[P]['component']]
      >
    | Promise<
        Partial<
          Contribution.PropertiesOf[(typeof CONTRIBUTION_POINTS)[P]['component']]
        >
      >;
} & ((typeof CONTRIBUTION_POINTS)[P]['component'] extends 'badge' | 'card'
  ? { run?: never }
  : {
      /** What it does, triggered; its result told where it was run */
      run?(
        context: Contribution.Contexts[P] & Contribution.RunExtras,
      ): void | Contribution.Result | Promise<void | Contribution.Result>;
    });
