import {
  type AppMetadata,
  coreWidgetType,
  DASHBOARD_LIMITS,
  type DashboardAttention,
  DashboardCounters,
  type DashboardMetadataRecord,
  type DashboardOp,
  dashboardPath,
  type DashboardRow,
  dataMax,
  dataWindow,
  type ElementComponentMetadataRecord,
  widgetIssues,
  type WidgetMetadata,
} from '@syncbridge/common';

/**
 * A widget's data as SyncBridge holds it: what its dashboard shows. The
 * same shape the engine gives (GET worker@<id>/dashboards). `attention`:
 * what is drawn attention to now - the widget, rows, rows' fields
 */
export type DashboardData = (
  | {
      kind: 'value';
      value: unknown;
      tone?: string;
      hint?: string;
      at: number;
    }
  | { kind: 'series'; series: Record<string, [number, number][]> }
  | { kind: 'table'; rows: { key: string; row: DashboardRow }[] }
  | { kind: 'feed'; rows: { at: number; row: DashboardRow }[] }
) & { attention?: DashboardAttention[] };

/**
 * An app's dashboards in a test env: each write applied at once - no
 * gathering, so a test reads what it wrote - under the bounds the engine
 * keeps, and the widgets defined as the app runs
 */
export class TestDashboards {
  protected _data = new Map<string, DashboardData>();
  /** By widget path: what is drawn attention to */
  protected _attention = new Map<string, DashboardAttention[]>();
  /** By dashboard path, by id */
  protected _defined = new Map<string, Map<string, WidgetMetadata>>();
  protected _issues = new Map<string, string[]>();
  protected _metadata?: AppMetadata;
  /** Its charts' counts: written as points when the test flushes them */
  readonly counters = new DashboardCounters(op => this.apply(op));

  constructor(protected _warn: (message: string) => void = () => undefined) {}

  /** The app's metadata, its widgets' definitions read from it */
  set metadata(metadata: AppMetadata | undefined) {
    this._metadata = metadata;
    for (const [path, widget] of classWidgets(metadata))
      this._check(path, widget);
  }

  /**
   * A widget's data, by its path: `ops/queue`, `io/device/errors` - and
   * the attention not ended, nor over by its duration
   */
  get(path: string): DashboardData | undefined {
    const data = this._data.get(path);
    const now = Date.now();
    const attention = (this._attention.get(path) || []).filter(
      a => a.until == null || a.until > now,
    );
    if (!attention.length) return data;
    return {
      ...(data || emptyData(this._widget(path)!.data.kind)),
      attention,
    } as DashboardData;
  }

  /** The widgets defined as the app runs into a dashboard, by path */
  defined(dashboard: string): WidgetMetadata[] {
    return [...(this._defined.get(dashboard)?.values() || [])];
  }

  /** What is wrong with the widgets' definitions, by path: SyncBridge draws none of them */
  issues(): Record<string, string[]> {
    return Object.fromEntries(this._issues);
  }

  apply(op: DashboardOp): void {
    if (op.op === 'define') {
      const path = dashboardPath(op.dashboard, op.widget.id);
      let defined = this._defined.get(op.dashboard);
      if (!defined) this._defined.set(op.dashboard, (defined = new Map()));
      const before = defined.get(op.widget.id);
      if (before && before.data.kind !== op.widget.data.kind)
        this._data.delete(path);
      defined.set(op.widget.id, op.widget);
      this._check(path, op.widget);
      return;
    }
    if (op.op === 'undefine') {
      const path = dashboardPath(op.dashboard, op.id);
      this._defined.get(op.dashboard)?.delete(op.id);
      this._data.delete(path);
      this._attention.delete(path);
      this._issues.delete(path);
      return;
    }
    const widget = this._widget(op.widget);
    if (!widget) return;
    const before = this._data.get(op.widget);
    switch (op.op) {
      case 'set':
        this._data.set(op.widget, {
          kind: 'value',
          value: op.value,
          ...(op.tone != null ? { tone: op.tone } : {}),
          ...(op.hint != null ? { hint: op.hint } : {}),
          at: Date.now(),
        });
        return;
      case 'attend': {
        if (
          op.key != null &&
          !(before?.kind === 'table' && before.rows.some(r => r.key === op.key))
        )
          return;
        const now = Date.now();
        const list = (this._attention.get(op.widget) || []).filter(
          a =>
            (a.until == null || a.until > now) &&
            !(a.key === op.key && a.field === op.field),
        );
        if (op.attention !== null && (op.until == null || op.until > now)) {
          if (list.length >= DASHBOARD_LIMITS.attentions) list.shift();
          list.push(
            Object.fromEntries(
              Object.entries({
                attention: op.attention,
                key: op.key,
                field: op.field,
                until: op.until,
              }).filter(([, v]) => v != null),
            ) as unknown as DashboardAttention,
          );
        }
        this._attention.set(op.widget, list);
        return;
      }
      case 'point': {
        const series = before?.kind === 'series' ? before.series : {};
        const points = [...(series[op.series] || []), [op.at, op.value]] as [
          number,
          number,
        ][];
        const max = dataMax('series', widget.data.max);
        const oldest = op.at - dataWindow(widget.data.window) * 1000;
        while (points.length > max || (points.length && points[0][0] < oldest))
          points.shift();
        this._data.set(op.widget, {
          kind: 'series',
          series: { ...series, [op.series]: points },
        });
        return;
      }
      case 'upsert': {
        const rows = before?.kind === 'table' ? [...before.rows] : [];
        const at = rows.findIndex(r => r.key === op.key);
        if (at >= 0) rows[at] = { key: op.key, row: op.row };
        else rows.push({ key: op.key, row: op.row });
        const kept = rows.slice(-dataMax('table', widget.data.max));
        this._data.set(op.widget, { kind: 'table', rows: kept });
        if (kept.length < rows.length)
          this._dropAttention(op.widget, key => !kept.some(r => r.key === key));
        return;
      }
      case 'remove':
        if (before?.kind === 'table')
          this._data.set(op.widget, {
            kind: 'table',
            rows: before.rows.filter(r => r.key !== op.key),
          });
        this._dropAttention(op.widget, key => key === op.key);
        return;
      case 'replace': {
        const rows = op.rows.slice(-dataMax('table', widget.data.max));
        this._data.set(op.widget, { kind: 'table', rows });
        const keys = new Set(rows.map(r => r.key));
        this._dropAttention(op.widget, key => !keys.has(key));
        return;
      }
      case 'append': {
        const rows = before?.kind === 'feed' ? [...before.rows] : [];
        rows.push({ at: op.at, row: op.row });
        this._data.set(op.widget, {
          kind: 'feed',
          rows: rows.slice(-dataMax('feed', widget.data.max)),
        });
        return;
      }
      case 'clear':
        if (before?.kind === 'series' && op.series != null) {
          const series = { ...before.series };
          delete series[op.series];
          this._data.set(op.widget, { kind: 'series', series });
        } else {
          this._data.delete(op.widget);
          this._dropAttention(op.widget, () => true);
        }
        return;
    }
  }

  /** The attention to rows whose key is gone: it goes with them */
  protected _dropAttention(path: string, gone: (key: string) => boolean) {
    const list = this._attention.get(path);
    if (list)
      this._attention.set(
        path,
        list.filter(a => a.key == null || !gone(a.key)),
      );
  }

  /** A widget checked as SyncBridge checks it: its type a core one, or none known */
  protected _check(path: string, widget: WidgetMetadata) {
    const issues = widgetIssues(widget, coreWidgetType(widget.type));
    if (issues.length) {
      this._issues.set(path, issues);
      this._warn(`Dashboard widget "${path}": ${issues.join('; ')}`);
    } else this._issues.delete(path);
  }

  protected _widget(path: string): WidgetMetadata | undefined {
    const known = classWidgets(this._metadata).get(path);
    if (known) return known;
    const at = path.lastIndexOf('/');
    return at > 0
      ? this._defined.get(path.slice(0, at))?.get(path.slice(at + 1))
      : undefined;
  }
}

/** A widget's data holding nothing yet, by its kind */
function emptyData(kind: string): DashboardData {
  switch (kind) {
    case 'series':
      return { kind: 'series', series: {} };
    case 'table':
      return { kind: 'table', rows: [] };
    case 'feed':
      return { kind: 'feed', rows: [] };
    default:
      return { kind: 'value', value: null, at: 0 };
  }
}

const indexes = new WeakMap<AppMetadata, Map<string, WidgetMetadata>>();

/** The widgets an app's and its components' dashboard classes define, by path */
function classWidgets(metadata: AppMetadata | undefined) {
  if (!metadata) return new Map<string, WidgetMetadata>();
  let index = indexes.get(metadata);
  if (index) return index;
  index = new Map();
  const add = (record: DashboardMetadataRecord | undefined, source: string) => {
    for (const [name, d] of Object.entries(record || {}))
      for (const w of d.widgets || [])
        index!.set(dashboardPath(dashboardPath(source, name), w.id), w);
  };
  const walk = (
    components: ElementComponentMetadataRecord | undefined,
    parent: string,
  ) => {
    for (const [key, c] of Object.entries(components || {})) {
      const source = dashboardPath(parent, key);
      add(c.dashboards, source);
      walk(c.components, source);
    }
  };
  add(metadata.dashboards, '');
  walk(metadata.components, '');
  indexes.set(metadata, index);
  return index;
}
