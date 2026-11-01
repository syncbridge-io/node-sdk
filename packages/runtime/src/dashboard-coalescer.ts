import {
  DASHBOARD_FLUSH_MIN_MS,
  DASHBOARD_FLUSH_MS,
  DASHBOARD_LIMITS,
  type DashboardOp,
  type DashboardRow,
} from '@syncbridge/common';

type Pending =
  | { kind: 'value'; op: DashboardOp & { op: 'set' } }
  | {
      kind: 'series';
      /** Cleared before the points: true for all, else by series */
      cleared: true | Set<string>;
      points: Map<string, { value: number; at: number }[]>;
    }
  | {
      kind: 'table';
      base?: 'clear' | { key: string; row: DashboardRow }[];
      /** By key, in the order changed: a row, or null for removed */
      changes: Map<string, DashboardRow | null>;
    }
  | {
      kind: 'feed';
      cleared: boolean;
      rows: { row: DashboardRow; at: number }[];
    }
  /** A clear before any write told the widget's kind */
  | { kind: 'cleared'; all: boolean; series: Set<string> };

type Attend = DashboardOp & { op: 'attend' };

/**
 * A worker's dashboard writes gathered for the engine (engine
 * docs/worker-dashboards.md, section 8): a value set many times goes as
 * its last, a series' points and a feed's rows together, a table's rows
 * as each one's last change; a clear or a replace drops what came before
 * it. Sent at most once an interval, so a loop of writes costs nothing.
 * Widgets defined and undefined go first, in their order; attention last,
 * the last for each widget, row or field - a row's dropped with the row.
 */
export class DashboardCoalescer {
  protected _layout: DashboardOp[] = [];
  protected _data = new Map<string, Pending>();
  /** By widget, by what it is drawn to */
  protected _attend = new Map<string, Map<string, Attend>>();
  protected _timer?: NodeJS.Timeout;
  readonly interval: number;

  constructor(
    protected _send: (ops: DashboardOp[]) => void,
    interval = DASHBOARD_FLUSH_MS,
  ) {
    this.interval = Math.max(interval, DASHBOARD_FLUSH_MIN_MS);
  }

  /** Takes a write, sent with the others when the interval is up */
  push(op: DashboardOp): void {
    switch (op.op) {
      case 'define':
        this._layout.push(op);
        break;
      case 'undefine':
        this._layout.push(op);
        this._data.delete(`${op.dashboard}/${op.id}`);
        this._attend.delete(`${op.dashboard}/${op.id}`);
        break;
      case 'attend': {
        let targets = this._attend.get(op.widget);
        if (!targets) this._attend.set(op.widget, (targets = new Map()));
        const target = `${op.key ?? ''}\u0000${op.field ?? ''}`;
        targets.delete(target);
        targets.set(target, op);
        break;
      }
      case 'set':
        this._data.set(op.widget, { kind: 'value', op });
        break;
      case 'point': {
        const p = this._of(op.widget, 'series') as Extract<
          Pending,
          { kind: 'series' }
        >;
        const list = p.points.get(op.series) || [];
        list.push({ value: op.value, at: op.at });
        if (list.length > DASHBOARD_LIMITS.seriesMax) list.shift();
        p.points.set(op.series, list);
        break;
      }
      case 'append': {
        const p = this._of(op.widget, 'feed') as Extract<
          Pending,
          { kind: 'feed' }
        >;
        p.rows.push({ row: op.row, at: op.at });
        if (p.rows.length > DASHBOARD_LIMITS.feedMax) p.rows.shift();
        break;
      }
      case 'upsert':
      case 'remove': {
        const p = this._of(op.widget, 'table') as Extract<
          Pending,
          { kind: 'table' }
        >;
        p.changes.delete(op.key);
        p.changes.set(op.key, op.op === 'upsert' ? op.row : null);
        if (op.op === 'remove') this._dropAttends(op.widget, k => k === op.key);
        break;
      }
      case 'replace': {
        const p = this._of(op.widget, 'table') as Extract<
          Pending,
          { kind: 'table' }
        >;
        p.base = op.rows;
        p.changes.clear();
        const keys = new Set(op.rows.map(r => r.key));
        this._dropAttends(op.widget, k => !keys.has(k));
        break;
      }
      case 'clear':
        this._clear(op.widget, op.series);
        if (op.series == null) this._dropAttends(op.widget, () => true);
        break;
    }
    this._schedule();
  }

  /** Sends what is gathered, now */
  flush(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = undefined;
    const ops = [...this._layout];
    for (const [widget, p] of this._data) ops.push(...expand(widget, p));
    for (const targets of this._attend.values()) ops.push(...targets.values());
    this._layout = [];
    this._data.clear();
    this._attend.clear();
    if (ops.length) this._send(ops);
  }

  /** Sends what is left and stops */
  stop(): void {
    this.flush();
  }

  protected _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), this.interval);
    this._timer.unref?.();
  }

  /** A widget's pending attention to rows whose key is gone */
  protected _dropAttends(widget: string, gone: (key: string) => boolean) {
    const targets = this._attend.get(widget);
    if (!targets) return;
    for (const [target, op] of targets)
      if (op.key != null && gone(op.key)) targets.delete(target);
  }

  /**
   * The widget's pending writes, of the kind its write tells; a clear
   * pending before it carried over, so it still goes first
   */
  protected _of(widget: string, kind: 'series' | 'table' | 'feed'): Pending {
    const p = this._data.get(widget);
    if (p?.kind === kind) return p;
    const before = p?.kind === 'cleared' ? p : undefined;
    const next: Pending =
      kind === 'series'
        ? {
            kind,
            cleared: before?.all ? true : new Set(before?.series),
            points: new Map(),
          }
        : kind === 'table'
          ? {
              kind,
              ...(before ? { base: 'clear' as const } : {}),
              changes: new Map(),
            }
          : { kind, cleared: !!before, rows: [] };
    this._data.set(widget, next);
    return next;
  }

  /* A clear drops what is pending before it; its widget's kind not yet
   * told by a write, it is kept as it came */
  protected _clear(widget: string, series?: string) {
    const p = this._data.get(widget);
    if (!p || p.kind === 'value' || p.kind === 'cleared') {
      const c =
        p?.kind === 'cleared'
          ? p
          : { kind: 'cleared' as const, all: false, series: new Set<string>() };
      if (series == null) c.all = true;
      else c.series.add(series);
      this._data.set(widget, c);
      return;
    }
    if (p.kind === 'series') {
      if (series == null) {
        p.cleared = true;
        p.points.clear();
      } else {
        if (p.cleared !== true) p.cleared.add(series);
        p.points.delete(series);
      }
    } else if (p.kind === 'table') {
      p.base = 'clear';
      p.changes.clear();
    } else {
      p.cleared = true;
      p.rows = [];
    }
  }
}

/** A widget's pending writes as the operations the engine takes */
function expand(widget: string, p: Pending): DashboardOp[] {
  const ops: DashboardOp[] = [];
  switch (p.kind) {
    case 'value':
      ops.push(p.op);
      break;
    case 'series':
      if (p.cleared === true) ops.push({ op: 'clear', widget });
      else
        for (const series of p.cleared)
          ops.push({ op: 'clear', widget, series });
      for (const [series, points] of p.points)
        for (const { value, at } of points)
          ops.push({ op: 'point', widget, series, value, at });
      break;
    case 'table':
      if (p.base === 'clear') ops.push({ op: 'clear', widget });
      else if (p.base) ops.push({ op: 'replace', widget, rows: p.base });
      for (const [key, row] of p.changes)
        ops.push(
          row
            ? { op: 'upsert', widget, key, row }
            : { op: 'remove', widget, key },
        );
      break;
    case 'feed':
      if (p.cleared) ops.push({ op: 'clear', widget });
      for (const { row, at } of p.rows)
        ops.push({ op: 'append', widget, row, at });
      break;
    case 'cleared':
      if (p.all) ops.push({ op: 'clear', widget });
      else
        for (const series of p.series)
          ops.push({ op: 'clear', widget, series });
      break;
  }
  return ops;
}
