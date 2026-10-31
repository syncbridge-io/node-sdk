import 'reflect-metadata';
import { DASHBOARD_CONTAINER } from '../constants.js';
import {
  type DataKind,
  WidgetDataMetadata,
  WidgetMetadata,
  WidgetSize,
} from '../models/index.js';

/**
 * Defines a widget of a dashboard class (a DashboardBase), assigned to the
 * decorated property - declared `declare readonly` so a class field does
 * not overwrite it. The property holds the widget's data, written as the
 * worker runs:
 *
 * ```ts
 * class OperationsDashboard extends DashboardBase {
 *   @Widget.Stat({ title: 'Queue', unit: 'messages', section: 'queue' })
 *   declare readonly queue: Widget.Stat;
 * }
 * // in the app
 * this.operations.queue.set(42);
 * ```
 *
 * `Widget.Stat`, `Status`, `Chart`, `Feed`, `Table` and `Cards` define the
 * core types; `@Widget('<plugin>.<name>@1', { data, properties })` a type a
 * plugin registers. Widgets are drawn in the order they are defined.
 */
export function Widget(
  definitionOrType: Widget.Definition<any> | string,
  options?: Widget.CustomOptions,
) {
  const definition =
    typeof definitionOrType === 'string'
      ? Widget.custom(definitionOrType, options!)
      : definitionOrType;
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');
    const container = ownContainer(target);
    container.widgets[propertyKey] = widgetMetadataOf(propertyKey, definition);
  };
}

/** A dashboard class' own definitions, its base class' copied in */
export interface DashboardContainer {
  sections?: {
    id: string;
    title?: string;
    description?: string;
    dynamic?: boolean;
  }[];
  /** By id, in the order defined */
  widgets: Record<string, WidgetMetadata>;
}

/** The container on a dashboard class' prototype, made its own */
export function ownContainer(prototype: Object): DashboardContainer {
  if (Reflect.hasOwnMetadata(DASHBOARD_CONTAINER, prototype))
    return Reflect.getOwnMetadata(DASHBOARD_CONTAINER, prototype);
  const base: DashboardContainer | undefined = Reflect.getMetadata(
    DASHBOARD_CONTAINER,
    Object.getPrototypeOf(prototype),
  );
  const own: DashboardContainer = {
    ...(base?.sections ? { sections: [...base.sections] } : {}),
    widgets: { ...base?.widgets },
  };
  Reflect.defineMetadata(DASHBOARD_CONTAINER, own, prototype);
  return own;
}

/** A widget's metadata from its definition and its id */
export function widgetMetadataOf(
  id: string,
  definition: Widget.Definition<any>,
): WidgetMetadata {
  const { size, data, ...rest } = definition;
  return new WidgetMetadata({
    ...rest,
    id,
    ...(size ? { size: new WidgetSize(size) } : {}),
    data: new WidgetDataMetadata(data),
  });
}

/**
 * The kinds a widget's data may be. Not among the models: the models'
 * document takes every export there for a type
 */
export const DATA_KINDS: readonly DataKind[] = [
  'value',
  'series',
  'table',
  'feed',
];

/** '30s', '15m', '1h', '1d' or seconds, in seconds */
export function windowSeconds(window: number | string): number {
  if (typeof window === 'number') return window;
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(window.trim());
  if (!m) throw new TypeError(`Not a window: "${window}" (e.g. 30s, 15m, 1h)`);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[
    m[2] as 's' | 'm' | 'h' | 'd'
  ];
  return Number(m[1]) * unit;
}

const omitUndefined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export namespace Widget {
  /**
   * A widget's definition, without its id: what `@Widget` takes and what
   * `DashboardBase.define` takes as the worker runs. `H` is what its
   * property holds - how its data is written
   */
  export interface Definition<H> {
    type: string;
    title?: string;
    description?: string;
    section?: string;
    size?: Size;
    properties?: Record<string, any>;
    data: {
      kind: DataKind;
      max?: number;
      window?: number;
      /** A series': count()'s interval, in seconds */
      interval?: number;
      series?: string[];
    };
    /** Only for the type: never set */
    readonly __holds?: H;
  }

  export interface Size {
    /** Columns, 1 to 4 */
    width?: number;
    height?: 's' | 'm' | 'l';
  }

  /** What every widget takes */
  export interface Options {
    title?: string;
    description?: string;
    /** One of its dashboard's sections (`@DashboardSections`) */
    section?: string;
    size?: Size;
  }

  /** A color by thresholds: the higher the worse, unless `below` */
  export interface Thresholds {
    warning?: number;
    error?: number;
    direction?: 'above' | 'below';
  }

  export type Format =
    'number' | 'percent' | 'bytes' | 'duration' | 'time' | 'text';

  export interface Column {
    /** The row's field */
    field: string;
    title?: string;
    format?: Format;
    /** Relative width */
    width?: number;
  }

  export type StatusLevel = 'ok' | 'warning' | 'error' | 'unknown';

  export type Scalar = number | string | boolean | null;

  export type Row = Record<string, Scalar | Date | undefined>;

  /**
   * A template's node: the web UI's primitives, nothing of the app's code.
   * `value` binds what it shows: `row.<field>`, `prop.<name>`
   */
  export interface TemplateNode {
    type:
      | 'text'
      | 'number'
      | 'badge'
      | 'light'
      | 'progress'
      | 'sparkline'
      | 'chart'
      | 'table'
      | 'stack'
      | 'grid'
      | 'divider';
    value?: string;
    label?: string;
    unit?: string;
    format?: Format;
    decimals?: number;
    thresholds?: Thresholds;
    columns?: number;
    direction?: 'row' | 'column';
    fields?: Column[];
    children?: TemplateNode[];
  }

  /* --- What a widget's property holds, by its data's kind --- */

  /** A value: a number, a text, a status */
  export interface Value<T = Scalar> {
    set(value: T): void;
  }

  /** Points in time, by series */
  export interface Series {
    /** A point of a series, now unless told when */
    point(series: string, value: number, at?: Date): void;
    /**
     * Adds to a series' count, kept in the worker: what it sums is written
     * as one point each interval (the widget's `interval`, default 1 s) -
     * 0 for an interval with none, once the series was counted. A busy
     * source counts each event and sends a point a second
     */
    count(series: string, amount?: number): void;
    /** A series' points, or all */
    clear(series?: string): void;
  }

  /** Rows by key */
  export interface Table<R extends Row = Row> {
    upsert(key: string, row: R): void;
    remove(key: string): void;
    replace(rows: Record<string, R> | { key: string; row: R }[]): void;
    clear(): void;
  }

  /** The newest rows */
  export interface Feed<R extends Row = Row> {
    append(row: R): void;
    clear(): void;
  }

  /* --- The core types --- */

  export type Stat = Value<number | string | null>;
  export interface Status {
    set(status: StatusLevel, text?: string): void;
  }
  export type Chart = Series;
  export type Cards<R extends Row = Row> = Table<R>;
  export type Gauge = Value<number | null>;
  export type Progress = Value<number | null>;
  /** A row per category, its key the category's */
  export interface Category extends Row {
    /** Its name shown: the key unless given */
    label?: string;
    value: number | null;
  }
  export type Bars = Table<Category>;
  export type Pie = Table<Category>;

  export interface StatOptions extends Options {
    unit?: string;
    format?: Format;
    decimals?: number;
    thresholds?: Thresholds;
  }

  export interface ChartOptions extends Options {
    /** Its lines, by name */
    series: string[];
    /** How far back it shows: '15m', '1h', or seconds */
    window?: number | string;
    /**
     * What `count()` sums is written as a point each interval: '1s',
     * '5s', '1m', or seconds - default 1 s, at least 1 s, at most 1 h.
     * The chart then shows its points times its interval
     */
    interval?: number | string;
    /**
     * At most this many points per series - the oldest goes as one comes:
     * default 200, at most 1000
     */
    points?: number;
    unit?: string;
    /** The axis' bounds */
    min?: number;
    max?: number;
    /**
     * line (default); area, filled under; bar, a bar a point; stacked,
     * the series' areas one on another - a total and its parts
     */
    style?: 'line' | 'area' | 'bar' | 'stacked';
  }

  /** A value against its bounds: how full, how far */
  export interface GaugeOptions extends Options {
    /** Default 0 */
    min?: number;
    max: number;
    unit?: string;
    format?: Format;
    decimals?: number;
    thresholds?: Thresholds;
  }

  /** Categories compared, each a row */
  export interface CategoryOptions extends Options {
    unit?: string;
    format?: Format;
    decimals?: number;
    /** At most this many categories */
    max?: number;
  }

  export interface PieOptions extends CategoryOptions {
    /** A ring, the total in its middle (default), or a full pie */
    donut?: boolean;
  }

  export interface ListOptions extends Options {
    columns: Column[];
    /** At most this many rows */
    max?: number;
  }

  export interface CardsOptions extends Options {
    /** One card's look; its `row.<field>`s are the row's */
    template: TemplateNode;
    /** At most this many cards */
    max?: number;
  }

  export interface CustomOptions extends Options {
    data: {
      kind: DataKind;
      max?: number;
      window?: number | string;
      interval?: number | string;
      series?: string[];
    };
    properties?: Record<string, any>;
  }

  /* --- Definitions, for @Widget and for DashboardBase.define --- */

  const base = (o: Options) =>
    omitUndefined({
      title: o.title,
      description: o.description,
      section: o.section,
      size: o.size,
    });

  /** A number or a short text, its unit, colored by thresholds */
  export function stat(o: StatOptions = {}): Definition<Stat> {
    return {
      ...base(o),
      type: 'core.stat@1',
      properties: omitUndefined({
        unit: o.unit,
        format: o.format,
        decimals: o.decimals,
        thresholds: o.thresholds,
      }),
      data: { kind: 'value' },
    };
  }

  /** A status light with its text */
  export function status(o: Options = {}): Definition<Status> {
    return { ...base(o), type: 'core.status@1', data: { kind: 'value' } };
  }

  /** Series over time: lines, areas, bars, or stacked areas */
  export function chart(o: ChartOptions): Definition<Chart> {
    return {
      ...base(o),
      type: 'core.chart@1',
      properties: omitUndefined({
        unit: o.unit,
        min: o.min,
        max: o.max,
        style: o.style,
      }),
      data: omitUndefined({
        kind: 'series' as const,
        series: o.series,
        max: o.points,
        window: o.window != null ? windowSeconds(o.window) : undefined,
        interval: o.interval != null ? windowSeconds(o.interval) : undefined,
      }),
    };
  }

  /** The newest rows under columns: a log of events, messages */
  export function feed<R extends Row = Row>(
    o: ListOptions,
  ): Definition<Feed<R>> {
    return {
      ...base(o),
      type: 'core.list@1',
      properties: { columns: o.columns },
      data: omitUndefined({ kind: 'feed' as const, max: o.max }),
    };
  }

  /** Rows by key under columns: connections, devices */
  export function table<R extends Row = Row>(
    o: ListOptions,
  ): Definition<Table<R>> {
    return {
      ...base(o),
      type: 'core.list@1',
      properties: { columns: o.columns },
      data: omitUndefined({ kind: 'table' as const, max: o.max }),
    };
  }

  /** A card per row: a device's card, kept by its key */
  export function cards<R extends Row = Row>(
    o: CardsOptions,
  ): Definition<Cards<R>> {
    return {
      ...base(o),
      type: 'core.card@1',
      properties: { template: o.template },
      data: omitUndefined({ kind: 'table' as const, max: o.max }),
    };
  }

  const bounded = (o: GaugeOptions) =>
    omitUndefined({
      min: o.min,
      max: o.max,
      unit: o.unit,
      format: o.format,
      decimals: o.decimals,
      thresholds: o.thresholds,
    });

  /** A dial between its bounds: fill, load, a queue against its capacity */
  export function gauge(o: GaugeOptions): Definition<Gauge> {
    return {
      ...base(o),
      type: 'core.gauge@1',
      properties: bounded(o),
      data: { kind: 'value' },
    };
  }

  /** A bar between its bounds: the same as a gauge, in less room */
  export function progress(o: GaugeOptions): Definition<Progress> {
    return {
      ...base(o),
      type: 'core.progress@1',
      properties: bounded(o),
      data: { kind: 'value' },
    };
  }

  const categories = (o: CategoryOptions) =>
    omitUndefined({ unit: o.unit, format: o.format, decimals: o.decimals });

  /** Categories as bars, largest first: messages per device */
  export function bars(o: CategoryOptions = {}): Definition<Bars> {
    return {
      ...base(o),
      type: 'core.bars@1',
      properties: categories(o),
      data: omitUndefined({ kind: 'table' as const, max: o.max }),
    };
  }

  /** Categories as shares of a whole: message types */
  export function pie(o: PieOptions = {}): Definition<Pie> {
    return {
      ...base(o),
      type: 'core.pie@1',
      properties: omitUndefined({ ...categories(o), donut: o.donut }),
      data: omitUndefined({ kind: 'table' as const, max: o.max }),
    };
  }

  /** A type a plugin registers: its data's kind and its properties */
  export function custom<H = unknown>(
    type: string,
    o: CustomOptions,
  ): Definition<H> {
    const { data, properties, ...rest } = o;
    return {
      ...base(rest),
      type,
      ...(properties ? { properties } : {}),
      data: omitUndefined({
        ...data,
        window: data.window != null ? windowSeconds(data.window) : undefined,
        interval:
          data.interval != null ? windowSeconds(data.interval) : undefined,
      }),
    };
  }

  /* --- The decorators of the core types --- */

  export const Stat = (o: StatOptions = {}) => Widget(stat(o));
  export const Status = (o: Options = {}) => Widget(status(o));
  export const Chart = (o: ChartOptions) => Widget(chart(o));
  export const Feed = (o: ListOptions) => Widget(feed(o));
  export const Table = (o: ListOptions) => Widget(table(o));
  export const Cards = (o: CardsOptions) => Widget(cards(o));
  export const Gauge = (o: GaugeOptions) => Widget(gauge(o));
  export const Progress = (o: GaugeOptions) => Widget(progress(o));
  export const Bars = (o: CategoryOptions = {}) => Widget(bars(o));
  export const Pie = (o: PieOptions = {}) => Widget(pie(o));
}
