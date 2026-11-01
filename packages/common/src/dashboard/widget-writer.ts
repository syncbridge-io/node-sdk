import { DashboardBase } from '../classes/dashboard-base.js';
import {
  DATA_KINDS,
  Widget,
  WIDGET_ATTENTIONS,
  WIDGET_TONES,
  widgetMetadataOf,
  windowSeconds,
} from '../decorators/widget.decorator.js';
import type {
  DashboardSectionMetadata,
  WidgetMetadata,
} from '../models/index.js';
import type { DashboardCounters } from './counters.js';
import { countIntervalMs, DASHBOARD_LIMITS, dashboardPath } from './limits.js';

const STATUSES: readonly string[] = ['ok', 'warning', 'error', 'unknown'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD = /^[A-Za-z0-9_-]{1,64}$/;
const TYPE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+@[1-9]\d{0,3}$/;

/**
 * What a worker's dashboards hand to its sink: a widget's writes, each
 * naming the widget by its path (`operations/queue`, a component's
 * `io/device/db`); a row's dates as ISO strings, times as epoch
 * milliseconds. The runtime gathers them for the engine
 */
export type DashboardOp =
  | {
      op: 'set';
      widget: string;
      value: Widget.Scalar | DashboardStatus;
      tone?: Widget.Tone;
      hint?: string;
    }
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
  /** Attention drawn to the widget, a row or a row's field, or ended */
  | ({ op: 'attend'; widget: string } & DashboardAttendTarget & {
        attention: Widget.Attention | null;
        /** When it ends by itself, epoch milliseconds */
        until?: number;
      })
  /** A widget defined as the worker runs, by its dashboard's path */
  | { op: 'define'; dashboard: string; widget: WidgetMetadata }
  | { op: 'undefine'; dashboard: string; id: string };

export type DashboardSink = (op: DashboardOp) => void;

/** What an attention is drawn to: the widget, a row, a row's field */
export interface DashboardAttendTarget {
  key?: string;
  field?: string;
}

/** An attention a widget's data holds, as the engine gives it */
export interface DashboardAttention extends DashboardAttendTarget {
  attention: Widget.Attention;
  until?: number;
}

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
 * write refused is told in the element's log and sends nothing. A
 * component's widget no owner shows (`include`) is silent: its writes
 * return at once
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
    protected _silent = false,
  ) {}

  /** Whether no owner shows it: its writes return at once */
  get silent(): boolean {
    return this._silent;
  }

  get path(): string {
    return dashboardPath(this.dashboard, this.metadata.id);
  }

  configure(
    sink?: DashboardSink,
    warn?: DashboardWarn,
    counters?: DashboardCounters,
    silent = false,
  ) {
    this._sink = sink;
    if (warn) this._warn = warn;
    this._counters = counters;
    this._silent = silent;
  }

  /**
   * A value: a number, a text, a boolean, null, or a status - a status
   * widget's `set('ok', 'Connected')`. Its tone and hint go with it: a
   * set without them ends the ones before
   */
  set(
    value: any,
    options?: string | Widget.SetOptions | Widget.StatusSetOptions,
  ): void {
    if (this._silent) return;
    if (!this._is('value', 'set')) return;
    if (
      options != null &&
      typeof options !== 'string' &&
      typeof options !== 'object'
    )
      return this._refuse("a value's options are an object");
    const o: Widget.SetOptions & Widget.StatusSetOptions =
      typeof options === 'string' ? { text: options } : options || {};
    const status = this.metadata.type === 'core.status@1';
    if (o.tone != null) {
      if (status) return this._refuse("a status's tone is its status");
      if (!WIDGET_TONES.includes(o.tone))
        return this._refuse(`a tone is one of ${WIDGET_TONES.join(', ')}`);
    }
    if (
      o.hint != null &&
      (typeof o.hint !== 'string' ||
        o.hint.length > DASHBOARD_LIMITS.hintLength)
    )
      return this._refuse(
        `a hint is a text of at most ${DASHBOARD_LIMITS.hintLength} characters`,
      );
    const text = o.text;
    let out: Widget.Scalar | DashboardStatus;
    if (status || text !== undefined) {
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
    this._sink?.({
      op: 'set',
      widget: this.path,
      value: out,
      ...(o.tone != null ? { tone: o.tone } : {}),
      ...(o.hint ? { hint: o.hint } : {}),
    });
  }

  /**
   * Draws attention to the widget - a table's row by its key, the row's
   * field - or ends it: until ended, or for its duration. A later one for
   * the same takes its place
   */
  attend(options: Widget.RowAttendOptions): void {
    if (this._silent) return;
    if (!options || typeof options !== 'object')
      return this._refuse('attend() takes its options: { attention }');
    const { attention, duration, key, field } = options;
    if (attention !== null && !WIDGET_ATTENTIONS.includes(attention))
      return this._refuse(
        `an attention is one of ${WIDGET_ATTENTIONS.join(', ')}, or null to end it`,
      );
    if (key != null) {
      if (this.metadata.data.kind !== 'table')
        return this._refuse(`"${this.path}" has no rows by key to attend`);
      if (!this._key(key)) return;
    }
    if (field != null) {
      if (key == null)
        return this._refuse('a field is attended in a row: its key');
      if (typeof field !== 'string' || !FIELD.test(field))
        return this._refuse("a field is a row's field name");
    }
    let until: number | undefined;
    if (attention !== null && duration != null) {
      let seconds: number;
      try {
        seconds = windowSeconds(duration);
      } catch {
        seconds = NaN;
      }
      if (
        !(seconds >= DASHBOARD_LIMITS.attentionMin) ||
        !(seconds <= DASHBOARD_LIMITS.attentionMax)
      )
        return this._refuse(
          `an attention's duration is ${DASHBOARD_LIMITS.attentionMin} s to ${DASHBOARD_LIMITS.attentionMax / 3600} h ('3s', '2m')`,
        );
      until = Date.now() + Math.round(seconds * 1000);
    }
    this._sink?.({
      op: 'attend',
      widget: this.path,
      ...(key != null ? { key } : {}),
      ...(field != null ? { field } : {}),
      attention,
      ...(until != null ? { until } : {}),
    });
  }

  point(series: string, value: number, at?: Date): void {
    if (this._silent) return;
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
    if (this._silent) return;
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
    if (this._silent) return;
    if (!this._is('table', 'upsert') || !this._key(key)) return;
    const out = this._row(row);
    if (out) this._sink?.({ op: 'upsert', widget: this.path, key, row: out });
  }

  remove(key: string): void {
    if (this._silent) return;
    if (!this._is('table', 'remove') || !this._key(key)) return;
    this._sink?.({ op: 'remove', widget: this.path, key });
  }

  replace(
    rows: Record<string, Widget.Row> | { key: string; row: Widget.Row }[],
  ): void {
    if (this._silent) return;
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
    if (this._silent) return;
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
    if (this._silent) return;
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
    /** Whether a widget of this id is shown: a component's, if taken */
    protected _shows: (id: string) => boolean = () => true,
  ) {}

  configure(
    path: string,
    sink?: DashboardSink,
    warn?: DashboardWarn,
    counters?: DashboardCounters,
    shows: (id: string) => boolean = () => true,
  ) {
    this.path = path;
    this._sink = sink;
    if (warn) this._warn = warn;
    this._counters = counters;
    this._shows = shows;
    for (const [id, writer] of this._defined) {
      (writer as { dashboard: string }).dashboard = path;
      writer.configure(sink, warn, counters, !shows(id));
    }
  }

  /** The widgets defined as it runs, by id */
  get defined(): string[] {
    return [...this._defined.keys()];
  }

  /**
   * A widget no owner shows is checked all the same, and returned silent:
   * the engine is not told of it
   */
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
    const silent = !this._shows(id);
    const writer = new WidgetWriter(
      metadata,
      this.path,
      this._sink,
      this._warn,
      this._counters,
      silent,
    );
    /* Defined anew: what its earlier one counted goes with it */
    if (this._defined.has(id))
      this._counters?.drop(dashboardPath(this.path, id));
    this._defined.set(id, writer);
    if (!silent)
      this._sink?.({ op: 'define', dashboard: this.path, widget: metadata });
    return writer as unknown as H;
  }

  undefine(id: string): void {
    const writer = this._defined.get(id);
    if (!writer) return;
    this._defined.delete(id);
    if (writer.silent) return;
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
