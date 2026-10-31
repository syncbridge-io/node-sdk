import { EventEmitter } from 'node:events';
import {
  type AppBase,
  AppFactory,
  type ComponentBase,
  DashboardCounters,
  type DashboardOp,
  type DashboardSink,
  type ILogger,
  type LogChannel,
  type Profile,
  SbError,
  type ServiceStatus,
  type StackExecutor,
} from '@syncbridge/common';
import { DashboardCoalescer } from './dashboard-coalescer.js';

export interface ComponentStatusInfo {
  componentName: string;
  path: string;
  status: ServiceStatus;
  statusMessage: string;
}

/**
 * The part of a SyncBridge worker that runs the app, whatever carries
 * its messages: it creates the app from a profile, updates it when
 * the profile changes, starts and stops it, and reports its status and the
 * status of its components. The SyncBridge engine's worker and `spm verify`'s
 * both run it; each only adds its own messaging and logging.
 *
 * The planned packages must be registered first (`registerPlanPackages`).
 */
export class AppWorker extends EventEmitter<AppWorker.Events> {
  app?: AppBase;
  /** The dashboards' writes gathered for `options.dashboardSink` */
  protected _dashboard?: DashboardCoalescer;
  /** The charts' counts, written as points by the tick while it runs */
  protected _counters?: DashboardCounters;
  protected _tick?: NodeJS.Timeout;

  constructor(readonly options: AppWorker.Options) {
    super();
    if (options.dashboardSink) {
      this._dashboard = new DashboardCoalescer(
        options.dashboardSink,
        options.dashboardInterval,
      );
      this._counters = new DashboardCounters(this._dashboardSink);
    }
  }

  /** Where the app's dashboards hand each write: gathered */
  protected get _dashboardSink(): DashboardSink | undefined {
    const coalescer = this._dashboard;
    return coalescer && (op => coalescer.push(op));
  }

  get profile(): Profile | undefined {
    return this.app?.[AppFactory.PROFILE_KEY];
  }

  /**
   * Creates the app from `profile` the first time, and updates it
   * after; the app class cannot change. Returns the issues that kept
   * the profile from being applied, if any.
   */
  async updateProfile(
    profile: Profile,
    logger: ILogger,
  ): Promise<{ issues?: StackExecutor.Issue[] }> {
    if (!profile)
      throw new SbError('Profile is required', {
        code: 'PROFILE_UPDATE_FAILED',
      });
    const oldProfile = this.profile;
    if (oldProfile && this.app) {
      profile.id = oldProfile.id;
      if (profile.appUri !== oldProfile.appUri) {
        throw new SbError('App class can not be changed.', {
          code: 'PROFILE_UPDATE_FAILED',
        });
      }
      return AppFactory.updateAppSilent(this.app, profile, {
        logger,
        logSink: this.options.logSink,
        dashboardSink: this._dashboardSink,
        dashboardCounters: this._counters,
      });
    }
    const r = await AppFactory.createAppSilent(profile, {
      logger,
      dataDirectory: this.options.dataDirectory,
      logSink: this.options.logSink,
      dashboardSink: this._dashboardSink,
      dashboardCounters: this._counters,
    });
    if (r.result) this._attach(r.app);
    return r;
  }

  /** Starts the app; a failure shows in its status, not here */
  async start(): Promise<void> {
    if (!this.app) throw new Error('App not initialized');
    const counters = this._counters;
    if (counters && !this._tick) {
      /* Each second: the counts whose interval ended, as points */
      this._tick = setInterval(() => counters.tick(), 1000);
      this._tick.unref();
    }
    this.app.start().catch(() => undefined);
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    clearInterval(this._tick);
    this._tick = undefined;
    /* What the app counted and wrote as it stopped goes too */
    this._counters?.flush();
    this._dashboard?.stop();
  }

  protected _attach(app: AppBase) {
    this.app = app;
    app.on('error', err => this.emit('error', err));
    app.on('status-change', (status, statusMessage) =>
      this.emit('status-change', status, statusMessage || ''),
    );
    app.on(
      'component-status-change',
      (component: ComponentBase, status, statusMessage) =>
        this.emit('component-status-change', component, {
          componentName: component.name,
          path: component.path,
          status,
          statusMessage: statusMessage || '',
        }),
    );
  }
}

export namespace AppWorker {
  export interface Options {
    /** The app's data directory */
    dataDirectory: string;
    /** Where the app's log channels hand their records */
    logSink?: LogChannel.Sink;
    /**
     * Where the app's dashboards' writes go, gathered: at most once an
     * interval. Without it they are dropped
     */
    dashboardSink?: (ops: DashboardOp[]) => void;
    /** The interval, in milliseconds: default 1000, at least 250 */
    dashboardInterval?: number;
  }

  export interface Events {
    'status-change': [status: ServiceStatus, statusMessage: string];
    'component-status-change': [
      component: ComponentBase,
      info: ComponentStatusInfo,
    ];
    error: [error: Error];
  }
}
