import type { DashboardSink } from './widget-writer.js';

interface Counter {
  widget: string;
  series: string;
  /** Its interval, in milliseconds */
  interval: number;
  /** What was counted since `start` */
  sum: number;
  start: number;
}

/**
 * A worker's chart counts (`Widget.Chart.count`), kept in the worker: each
 * series' sum written to the sink as one point an interval - at its end,
 * 0 for an interval with none - so a busy source sends a point a second,
 * never one an event. The runtime ticks it while the worker runs and
 * flushes it as it stops; a test flushes it when it reads
 */
export class DashboardCounters {
  /** By widget path and series */
  protected _counters = new Map<string, Counter>();

  constructor(protected _sink?: DashboardSink) {}

  configure(sink?: DashboardSink) {
    this._sink = sink;
  }

  /** Adds to a series' count; its interval starting with its first */
  add(
    widget: string,
    series: string,
    amount: number,
    interval: number,
    now = Date.now(),
  ) {
    const key = `${widget}\0${series}`;
    let counter = this._counters.get(key);
    if (!counter || counter.interval !== interval) {
      counter = { widget, series, interval, sum: 0, start: now };
      this._counters.set(key, counter);
    }
    counter.sum += amount;
  }

  /**
   * Writes the counts whose interval ended. Intervals missed - the
   * process held up - are written as the first one's sum and a 0 at the
   * last one's end, not a point each
   */
  tick(now = Date.now()) {
    for (const c of this._counters.values()) {
      if (now < c.start + c.interval) continue;
      this._point(c, c.sum, c.start + c.interval);
      const ended = Math.floor((now - c.start) / c.interval);
      if (ended > 1) this._point(c, 0, c.start + ended * c.interval);
      c.sum = 0;
      c.start += ended * c.interval;
    }
  }

  /** Every count written now, its interval cut short, and forgotten: at a stop */
  flush(now = Date.now()) {
    this.tick(now);
    for (const c of this._counters.values())
      if (c.sum) this._point(c, c.sum, now);
    this._counters.clear();
  }

  /** A widget's counts dropped, or one series': cleared, undefined */
  drop(widget: string, series?: string) {
    for (const [key, c] of this._counters)
      if (c.widget === widget && (series == null || c.series === series))
        this._counters.delete(key);
  }

  protected _point(c: Counter, value: number, at: number) {
    this._sink?.({
      op: 'point',
      widget: c.widget,
      series: c.series,
      value,
      at,
    });
  }
}
