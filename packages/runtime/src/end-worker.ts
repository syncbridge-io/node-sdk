import process from 'node:process';

/**
 * What a worker process holds of its own: its stdio and IPC pipes. Any
 * other active resource is its app's.
 */
const OWN = new Set(['PipeWrap', 'TTYWrap']);

/**
 * What keeps this process alive beyond its own stdio and IPC, as
 * `Timeout ×2, TCPWrap ×1`; none, when nothing does
 */
export function resourcesLeft(
  active: string[] = process.getActiveResourcesInfo(),
): string | undefined {
  const counts = new Map<string, number>();
  for (const kind of active)
    if (!OWN.has(kind)) counts.set(kind, (counts.get(kind) || 0) + 1);
  return counts.size
    ? [...counts].map(([kind, n]) => `${kind} ×${n}`).join(', ')
    : undefined;
}

export interface EndWorkerOptions {
  /** Told what the app left open, if anything: the host's log */
  warn: (message: string) => void;
  /** Sends what is still queued for the host - log records */
  flush?: () => void;
  /**
   * How long, at most, the IPC channel is given to deliver what was sent,
   * in ms; default 1000. It ends as soon as it has.
   */
  drainMs?: number;
  /** Default 0 */
  exitCode?: number;
}

/**
 * Ends a worker process once its app has stopped. A worker runs one app:
 * what that app left open - a timer, a socket, a library's pool - only
 * keeps a stopped process alive, so it is told to the host as a warning,
 * for the module's developer to close in `_stop()`, and the process ends
 * regardless, rather than waiting for it.
 */
export function endWorker(options: EndWorkerOptions): Promise<never> {
  const left = resourcesLeft();
  if (left)
    options.warn(
      `The app left ${left} open when it stopped: close it in _stop(). The worker ends regardless`,
    );
  options.flush?.();
  return new Promise<never>(() => {
    const exit = () => {
      if (process.connected) process.disconnect?.();
      process.exit(options.exitCode ?? 0);
    };
    if (!process.connected || !process.send) return exit();
    setTimeout(exit, options.drainMs ?? 1000);
    /* IPC delivers in order: once this one is sent, so is all before it.
     * A host ignores it - it tells nothing */
    process.send({ type: 'ended' }, () => exit());
  });
}
