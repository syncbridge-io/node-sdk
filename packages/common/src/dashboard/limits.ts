/**
 * The bounds of a worker's dashboards (engine docs/worker-dashboards.md,
 * section 2): checked where data is written and again by the engine, so a
 * worker cannot fill the engine's memory. A widget may ask lower
 */
export const DASHBOARD_LIMITS = {
  /** Widgets per worker, in its classes or defined as it runs */
  widgets: 200,
  /** Widgets a worker defines as it runs */
  runtimeWidgets: 100,
  /**
   * A series' points: as many as a widget asks, up to the max; none asked,
   * the default - a chart's window, the oldest point going as one comes.
   * Its window in seconds, a widget's series
   */
  seriesDefault: 200,
  seriesMax: 1000,
  seriesWindow: 86400,
  seriesCount: 8,
  /** A table's rows, a feed's rows */
  tableMax: 500,
  feedMax: 200,
  /** A row's key, in characters */
  keyLength: 200,
  /** A value or a row as JSON, in bytes */
  itemBytes: 4096,
  /** All of a worker's dashboard state as JSON, in bytes */
  workerBytes: 8 * 1024 * 1024,
} as const;

/** How often the gathered writes go to the engine, in milliseconds */
export const DASHBOARD_FLUSH_MS = 1000;
export const DASHBOARD_FLUSH_MIN_MS = 250;

/**
 * A widget's bound on its data: what it asked, never above the engine's;
 * a series asking none keeps the default
 */
export function dataMax(kind: string, asked?: number): number {
  const top =
    kind === 'series'
      ? DASHBOARD_LIMITS.seriesMax
      : kind === 'table'
        ? DASHBOARD_LIMITS.tableMax
        : kind === 'feed'
          ? DASHBOARD_LIMITS.feedMax
          : 1;
  if (asked && asked > 0) return Math.min(Math.floor(asked), top);
  return kind === 'series' ? DASHBOARD_LIMITS.seriesDefault : top;
}

/** A series' window in seconds: what it asked, never above the engine's */
export function dataWindow(asked?: number): number {
  return asked && asked > 0
    ? Math.min(asked, DASHBOARD_LIMITS.seriesWindow)
    : DASHBOARD_LIMITS.seriesWindow;
}

/** A dashboard's or a widget's path under its element's: `io/device/db` */
export function dashboardPath(source: string, name: string): string {
  return source ? `${source}/${name}` : name;
}
