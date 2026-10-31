import { DashboardBase } from '../classes/dashboard-base.js';
import {
  DATA_KINDS,
  Widget,
  widgetMetadataOf,
} from '../decorators/widget.decorator.js';
import type {
  DashboardSectionMetadata,
  WidgetMetadata,
} from '../models/index.js';
import type { DashboardCounters } from './counters.js';
import { countIntervalMs, DASHBOARD_LIMITS, dashboardPath } from './limits.js';

const STATUSES: readonly string[] = ['ok', 'warning', 'error', 'unknown'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TYPE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+@[1-9]\d{0,3}$/;

/**
 * What a worker's dashboards hand to its sink: a widget's writes, each
 * naming the widget by its path (`operations/queue`, a component's
 * `io/device/db`); a row's dates as ISO strings, times as epoch
 * milliseconds. The runtime gathers them for the engine
 */
export type DashboardOp =
  | { op: 'set'; widget: string; value: Widget.Scalar | DashboardStatus }
  | { op: 'point'; widget: string; series: string; value: number; at: number }
  | { op: 'clear'; widget: string; series?: string }
  | { op: 'upsert'; widget: string; key: string; row: DashboardRow }
  | { op: 'remove'; widget: string; key: string }
  | {
      op: 'replace';
      widget: string;
      rows: { key: string; row: DashboardRow }[];
    }
  | { op: 'append'; widget: string; row: DashboardRow; at: number }
  /** A widget defined as the worker runs, by its dashboard's path */
  | { op: 'define'; dashboard: string; widget: WidgetMetadata }
  | { op: 'undefine'; dashboard: string; id: string };

export type DashboardSink = (op: DashboardOp) => void;

export interface DashboardStatus {
  status: Widget.StatusLevel;
  text?: string;
}

export type DashboardRow = Record<string, Widget.Scalar>;

/** Told once per problem: a loop of bad writes logs one line */
export type DashboardWarn = (message: string) => void;

/**
 * What a widget property holds: its writes checked against its data's
 * kind and the bounds where they are made, then handed to the sink. A
 * write refused is told in the element's log and sends nothing
 */
export class WidgetWriter
  implements
    Widget.Value<any>,
    Widget.Series,
    Widget.Table<any>,
    Widget.Feed<any>
{
  protected _told = new Set<string>();

  constructor(
    readonly metadata: WidgetMetadata,
    /** The path of its dashboard */
    readonly dashboard: string,
    protected _sink?: DashboardSink,
    protected _warn?: DashboardWarn,
    /** The worker's counts: without them, count() drops what it is given */
    protected _counters?: DashboardCounters,
  ) {}

  get path(): string {
    return dashboardPath(this.dashboard, this.metadata.id);
  }

  configure(
    sink?: DashboardSink,
    warn?: DashboardWarn,
    counters?: DashboardCounters,
  ) {
    this._sink = sink;
    if (warn) this._warn = warn;
    this._counters = counters;
  }

  /**
   * A value: a number, a text, a boolean, null, or a status - a status
   * widget's `set('ok', 'Connected')`
   */
  set(value: any, text?: string): void {
    if (!this._is('value', 'set')) return;
    let out: Widget.Scalar | DashboardStatus;
    if (this.metadata.type === 'core.status@1' || text !== undefined) {
      if (!STATUSES.includes(value))
        return this._refuse(`a status is one of ${STATUSES.join(', ')}`);
      out =
        text != null
          ? { status: value, text: String(text) }
          : { status: value };
    } else if (
      value !== null &&
      typeof value === 'object' &&
      'status' in value
    ) {
      if (!STATUSES.includes(value.status))
        return this._refuse(`a status is one of ${STATUSES.join(', ')}`);
      out =
        value.text != null
          ? { status: value.status, text: String(value.text) }
          : { status: value.status };
    } else if (isScalar(value)) out = value;
    else
      return this._refuse(
        'a value is a number, a string, a boolean, null or a status',
      );
    if (!this._fits(out)) return;
    this._sink?.({ op: 'set', widget: this.path, value: out });
  }

  point(series: string, value: number, at?: Date): void {
    if (!this._is('series', 'point') || !this._series(series)) return;
    if (typeof value !== 'number' || !Number.isFinite(value))
      return this._refuse('a point is a finite number');
    this._sink?.({
      op: 'point',
      widget: this.path,
      series,
      value,
      at: (at ?? new Date()).getTime(),
    });
  }

  count(series: string, amount = 1): void {
    if (!this._is('series', 'count') || !this._series(series)) return;
    if (typeof amount !== 'number' || !Number.isFinite(amount))
      return this._refuse('a count is a finite number');
    this._counters?.add(
      this.path,
      series,
      amount,
      countIntervalMs(this.metadata.data.interval),
    );
  }

  upsert(key: string, row: Widget.Row): void {
    if (!this._is('table', 'upsert') || !this._key(key)) return;
    const out = this._row(row);
    if (out) this._sink?.({ op: 'upsert', widget: this.path, key, row: out });
  }

  remove(key: string): void {
    if (!this._is('table', 'remove') || !this._key(key)) return;
    this._sink?.({ op: 'remove', widget: this.path, key });
  }

  replace(
    rows: Record<string, Widget.Row> | { key: string; row: Widget.Row }[],
  ): void {
    if (!this._is('table', 'replace')) return;
    const list = Array.isArray(rows)
      ? rows
      : Object.entries(rows).map(([key, row]) => ({ key, row }));
    const out: { key: string; row: DashboardRow }[] = [];
    for (const { key, row } of list) {
      const r = this._key(key) ? this._row(row) : undefined;
      if (!r) return;
      out.push({ key, row: r });
    }
    this._sink?.({ op: 'replace', widget: this.path, rows: out });
  }

  append(row: Widget.Row): void {
    if (!this._is('feed', 'append')) return;
    const out = this._row(row);
    if (out)
      this._sink?.({
        op: 'append',
        widget: this.path,
        row: out,
        at: Date.now(),
      });
  }

  clear(series?: string): void {
    if (this.metadata.data.kind === 'value')
      return this._refuse(`"${this.path}" holds a value: set it`);
    if (this.metadata.data.kind === 'series')
      this._counters?.drop(this.path, series ?? undefined);
    this._sink?.({
      op: 'clear',
      widget: this.path,
      ...(series != null && this.metadata.data.kind === 'series'
        ? { series }
        : {}),
    });
  }

  protected _is(kind: string, call: string): boolean {
    if (this.metadata.data.kind === kind) return true;
    this._refuse(
      `"${this.path}" holds a ${this.metadata.data.kind}: it has no ${call}()`,
    );
    return false;
  }

  protected _series(series: string): boolean {
    const known = this.metadata.data.series;
    if (known ? known.includes(series) : typeof series === 'string' && series)
      return true;
    this._refuse(
      known ? `its series are ${known.join(', ')}` : 'a point names its series',
    );
    return false;
  }

  protected _key(key: string): boolean {
    if (
      typeof key === 'string' &&
      key &&
      key.length <= DASHBOARD_LIMITS.keyLength
    )
      return true;
    this._refuse(
      `a row's key is a string of 1 to ${DASHBOARD_LIMITS.keyLength} characters`,
    );
    return false;
  }

  /** A row of plain values, its dates as ISO strings */
  protected _row(row: Widget.Row): DashboardRow | undefined {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      this._refuse('a row is an object');
      return;
    }
    const out: DashboardRow = {};
    for (const [field, v] of Object.entries(row)) {
      if (v === undefined) continue;
      if (v instanceof Date) out[field] = v.toISOString();
      else if (isScalar(v)) out[field] = v;
      else {
        this._refuse(`a row's "${field}" is not a plain value`);
        return;
      }
    }
    return this._fits(out) ? out : undefined;
  }

  protected _fits(value: unknown): boolean {
    if (JSON.stringify(value).length <= DASHBOARD_LIMITS.itemBytes) return true;
    this._refuse(
      `a value or a row is at most ${DASHBOARD_LIMITS.itemBytes} bytes as JSON`,
    );
    return false;
  }

  protected _refuse(why: string) {
    if (this._told.has(why)) return;
    this._told.add(why);
    this._warn?.(`Dashboard widget "${this.path}" refused a write: ${why}`);
  }
}

/** A number, a string, a boolean or null */
function isScalar(v: unknown): v is Widget.Scalar {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * A running dashboard's define and undefine: a widget defined as the
 * worker runs, checked here as a class' widget is - its type by the
 * engine, which knows the registry - and handed to the sink
 */
export class DashboardRuntime implements DashboardBase.Context {
  protected _defined = new Map<string, WidgetWriter>();

  constructor(
    /** The dashboard's path: `operations`, a component's `io/device` */
    public path: string,
    readonly sections: DashboardSectionMetadata[],
    /** The ids of its class' widgets: not to be defined again */
    readonly classWidgets: Set<string>,
    protected _sink?: DashboardSink,
    protected _warn?: DashboardWarn,
    protected _counters?: DashboardCounters,
  ) {}

  configure(
    path: string,
    sink?: DashboardSink,
    warn?: DashboardWarn,
    counters?: DashboardCounters,
  ) {
    this.path = path;
    this._sink = sink;
    if (warn) this._warn = warn;
    this._counters = counters;
    for (const writer of this._defined.values()) {
      (writer as { dashboard: string }).dashboard = path;
      writer.configure(sink, warn, counters);
    }
  }

  /** The widgets defined as it runs, by id */
  get defined(): string[] {
    return [...this._defined.keys()];
  }

  define<H>(id: string, definition: Widget.Definition<H>): H {
    const issues = this._issues(id, definition);
    if (
      !issues.length &&
      !this._defined.has(id) &&
      this._defined.size >= DASHBOARD_LIMITS.runtimeWidgets
    )
      issues.push(`at most ${DASHBOARD_LIMITS.runtimeWidgets} are defined`);
    if (issues.length) {
      const why = `Dashboard widget "${dashboardPath(this.path, id)}" not defined: ${issues.join('; ')}`;
      this._warn?.(why);
      throw new TypeError(why);
    }
    const metadata = widgetMetadataOf(id, definition);
    const writer = new WidgetWriter(
      metadata,
      this.path,
      this._sink,
      this._warn,
      this._counters,
    );
    /* Defined anew: what its earlier one counted goes with it */
    if (this._defined.has(id))
      this._counters?.drop(dashboardPath(this.path, id));
    this._defined.set(id, writer);
    this._sink?.({ op: 'define', dashboard: this.path, widget: metadata });
    return writer as unknown as H;
  }

  undefine(id: string): void {
    if (!this._defined.delete(id)) return;
    this._counters?.drop(dashboardPath(this.path, id));
    this._sink?.({ op: 'undefine', dashboard: this.path, id });
  }

  protected _issues(id: string, d: Widget.Definition<any>): string[] {
    const issues: string[] = [];
    if (!ID.test(id))
      issues.push('an id of letters, digits, _ and - is needed');
    else if (this.classWidgets.has(id))
      issues.push('its class defines a widget of that id');
    if (!d || typeof d.type !== 'string' || !TYPE.test(d.type))
      issues.push(`"${d?.type}" is not a type and version (core.stat@1)`);
    if (!d?.data || !DATA_KINDS.includes(d.data.kind))
      issues.push(`its data is one of ${DATA_KINDS.join(', ')}`);
    if (d?.data?.series && d.data.series.length > DASHBOARD_LIMITS.seriesCount)
      issues.push(`at most ${DASHBOARD_LIMITS.seriesCount} series`);
    if (d?.section) {
      const section = this.sections.find(s => s.id === d.section);
      if (!section) issues.push(`no section "${d.section}"`);
      else if (!section.dynamic)
        issues.push(`section "${d.section}" is not dynamic`);
    }
    return issues;
  }
}
