import { clearTimeout } from 'node:timers';
import { AsyncEventEmitter, type EventMap } from 'node-events-async';
import { NODE_ENV, noOp } from '../constants.js';
import { ServiceStatus } from '../models/index.js';
import { SbError } from './sb-error.js';

/**
 *
 */
export abstract class Runnable<
  T extends Runnable.Events = Runnable.Events,
> extends AsyncEventEmitter<EventMap<T>> {
  protected _context: Runnable.Context;
  private _startAbortController?: AbortController;

  constructor(init?: Runnable.InitArgs) {
    super();
    this.setMaxListeners(1000);
    this._context = {
      initialized: false,
      status: ServiceStatus.stopped,
      statusMessage: 'Stopped',
      startMaxWaitMs:
        init?.startMaxWaitMs ?? (NODE_ENV === 'dev' ? 60000 * 5 : 30000),
      stopMaxWaitMs:
        init?.stopMaxWaitMs ?? (NODE_ENV === 'dev' ? 60000 * 5 : 30000),
    };
  }

  get status(): ServiceStatus {
    return this._context.status;
  }

  get statusMessage(): string {
    return this._context.statusMessage;
  }

  get startTime(): Date | undefined {
    return this._context.startTime;
  }

  /**
   *
   */
  get stopped(): boolean {
    return (
      this.status === ServiceStatus.stopped ||
      this.status === ServiceStatus.invalid
    );
  }

  startNoWait(): void {
    this.start().catch(noOp);
  }

  stopNoWait(): void {
    this.stop().catch(noOp);
  }

  /**
   *
   */
  async init(): Promise<void> {
    if (this._context.initialized) return;
    this._context.initialized = true;
    await this._init().catch(e => {
      const err = e instanceof SbError ? e : new SbError(e);
      err.code = 'INIT_FAILED';
      err.message = `Initialization failed: ${err.message}`;
      this.setStatus(ServiceStatus.invalid, err.message);
      this.onError(err);
      throw err;
    });
    this.onInitialize();
  }

  /**
   *
   */
  async start(abortSignal?: AbortSignal): Promise<void> {
    if (this._context.waitTimer) await this._context.waitTimer;
    if (this.status === ServiceStatus.started) return;
    this.setStatus(ServiceStatus.starting);
    const abortController = (this._startAbortController =
      new AbortController());
    abortSignal?.addEventListener('abort', () => abortController.abort());
    this._context.waitTimer = Promise.resolve()
      .then(async () => {
        await this.init();
        try {
          let promiseSettled = false;
          await new Promise<void>((resolve, reject) => {
            let startWaitTimer: NodeJS.Timeout | undefined;
            if (this._context.startMaxWaitMs) {
              startWaitTimer = setTimeout(() => {
                const err = new SbError('Start timeout', {
                  code: 'START_TIMEOUT',
                });
                abortController.abort(err);
                reject(err);
              }, this._context.startMaxWaitMs).unref();
            }
            const onStopping = () => {
              clearTimeout(startWaitTimer);
              abortController.abort();
              reject();
            };
            this.once('stopping', onStopping);
            Promise.resolve()
              .then(async () => {
                await this._start(abortController.signal);
                if (promiseSettled) return;
                if (this._context.status === ServiceStatus.starting)
                  this.setStatus(ServiceStatus.started);
                resolve();
              })
              .catch(e => {
                reject(e);
              })
              .finally(() => {
                this.removeListener('stopping', onStopping);
                clearTimeout(startWaitTimer);
              });
          }).finally(() => (promiseSettled = true));
        } catch (e: any) {
          if (this.status === ServiceStatus.stopping) return;
          const err = e instanceof SbError ? e : new SbError(e);
          err.code = err.code || 'START_FAILED';
          this.onError(err);
          throw err;
        }
      })
      .catch(async e => {
        const err = e instanceof SbError ? e : new SbError(e);
        this._context.waitTimer = undefined;
        await this.stop().then(() => {
          throw err;
        });
      })
      .finally(() => {
        this._startAbortController = undefined;
        this._context.waitTimer = undefined;
      });
    await this._context.waitTimer;
  }

  /**
   *
   */
  async stop(): Promise<void> {
    if (this.status === ServiceStatus.stopped) return;
    this.setStatus(ServiceStatus.stopping);
    this.emit('stopping');
    this._startAbortController?.abort();
    if (this._context.waitTimer) await this._context.waitTimer;
    this._context.waitTimer = Promise.resolve()
      .then(async () => {
        try {
          let promiseSettled = false;
          await new Promise<void>((resolve, reject) => {
            let stopWaitTimer: NodeJS.Timeout | undefined;
            if (this._context.stopMaxWaitMs) {
              stopWaitTimer = setTimeout(() => {
                const err = new SbError('Stop timeout', {
                  code: 'STOP_TIMEOUT',
                });
                reject(err);
              }, this._context.stopMaxWaitMs).unref();
            }
            Promise.resolve()
              .then(async () => {
                await this._stop();
                if (promiseSettled) return;
                if (this._context.status === ServiceStatus.stopping)
                  this.setStatus(ServiceStatus.stopped);
                resolve();
              })
              .catch(e => reject(e))
              .finally(() => {
                clearTimeout(stopWaitTimer);
              });
          }).finally(() => (promiseSettled = true));
        } catch (e: any) {
          const err = e instanceof SbError ? e : new SbError(e);
          err.code = err.code || 'STOP_FAILED';
          this.onError(err);
          this._context.waitTimer = undefined;
          await this._terminate().then(() => {
            this.setStatus(ServiceStatus.stopped, err.message);
            throw e;
          });
        }
      })
      .finally(() => {
        this._context.waitTimer = undefined;
      });
    await this._context.waitTimer;
  }

  /**
   * Stops and starts it again in place - its values changed - without a
   * stop's and a start's statuses told: a stop() meanwhile aborts the start,
   * as it does a start(). One not running is left as it is.
   */
  protected async _restart(): Promise<void> {
    if (
      this.status !== ServiceStatus.started &&
      this.status !== ServiceStatus.unhealthy
    )
      return;
    const abortController = (this._startAbortController =
      new AbortController());
    try {
      await this._stop();
      if (abortController.signal.aborted) return;
      await this._start(abortController.signal);
    } finally {
      if (this._startAbortController === abortController)
        this._startAbortController = undefined;
    }
  }

  /**
   *
   */
  protected _init(): Promise<void> {
    return Promise.resolve();
  }

  /**
   *
   */
  protected abstract _start(abortSignal?: AbortSignal): Promise<void>;

  /**
   *
   */
  protected abstract _stop(): Promise<void>;

  /**
   *
   */
  protected _terminate(): Promise<void> {
    return Promise.resolve();
  }

  /**
   *
   */
  protected onError(err: Error): void {
    this.emitSafe('error', err);
  }

  /**
   *
   */
  protected onInitialize(): void {
    this.emitSafe('initialize');
  }

  /**
   *
   */
  protected onStatusChange(): void {
    this.emitSafe('status-change', this.status, this.statusMessage);
  }

  /**
   *
   */
  protected setStatus(status: ServiceStatus, statusMessage?: string) {
    if (this._context.status !== status) {
      this._context.status = status;
      this._context.statusMessage = statusMessage || '';
      if (status === ServiceStatus.started)
        this._context.startTime = new Date();
      this.onStatusChange();
    }
  }
}

const RUNNABLE_TOKEN = Symbol.for(Runnable.name);
Runnable.prototype[RUNNABLE_TOKEN] = true;

/**
 * @namespace
 */
export namespace Runnable {
  export interface Events {
    error: [error: unknown, ...args: any[]];
    initialize: [];
    'status-change': [status: ServiceStatus, message: string];
  }

  export interface InitArgs {
    startMaxWaitMs?: number;
    stopMaxWaitMs?: number;
  }

  export interface Context {
    initialized: boolean;
    status: ServiceStatus;
    statusMessage: string;
    waitTimer?: Promise<void>;
    startTime?: Date;
    startMaxWaitMs: number;
    stopMaxWaitMs: number;
    stopTimer?: NodeJS.Timeout;
  }
}
