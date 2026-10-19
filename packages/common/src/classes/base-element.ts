import type { LogChannel } from '../decorators/log-channel.decorator.js';
import type { ILogger } from '../interfaces/index.js';
import { ServiceStatus } from '../models/index.js';
import type { ComponentBase } from './component-base.js';
import { Runnable } from './runnable.js';

export abstract class BaseElement<
  TEvents extends BaseElement.Events = BaseElement.Events,
> extends Runnable<TEvents> {
  static uri: string;
  static packageName: string;
  static className: string;
  static interfaces: string[];
  declare protected _context: BaseElement.Context;
  readonly name: string;
  logger?: ILogger;
  components: Record<string, ComponentBase> = {};
  /** The element's log channels by name; see `@LogChannel` */
  readonly logChannels: Record<string, LogChannel> = {};
  values: Record<string, any>;

  constructor(init: BaseElement.InitArgs) {
    super(init);
    this.logger = init.logger;
    this.name = init.name;
    this.values = init.values;
    this.on('error', err => this.logger?.error(err));
    this.on('values-updated', (properties: string[]) => {
      this.logger?.info(
        `Configuration changed. Updated properties: ${properties.join(',')}`,
      );
    });
  }

  get status(): ServiceStatus {
    return this._context.calculatedStatus || this._context.status;
  }

  get statusMessage(): string {
    return this._context.calculatedStatusMessage ?? this._context.statusMessage;
  }

  protected async _init(): Promise<void> {
    for (const component of Object.values(this.components)) {
      component.on('component-status-change', (...args) =>
        this.emitAsyncSafe('component-status-change', ...args),
      );
      component.on('status-change', (status, statusMessage) => {
        /** Reset counters */
        this._context.statusIndicators = this._context.statusIndicators || {};
        Object.keys(ServiceStatus).forEach(key => {
          this._context.statusIndicators[key] = {
            count: 0,
            components: [],
            componentNames: [],
          };
        });
        Object.values(this.components).forEach(comp => {
          const counter = this._context.statusIndicators[comp.status];
          counter.count++;
          counter.components.push(comp);
          counter.componentNames.push(comp.name);
        });
        const oldStatus = this.status;
        const oldStatusMessage = this.statusMessage;
        this._context.calculatedStatus = undefined;
        this._context.calculatedStatusMessage = undefined;
        /** If there are one or more unhealthy components, set calculatedStatus to unhealthy */
        if (
          this._context.status === ServiceStatus.started ||
          this._context.status === ServiceStatus.starting
        ) {
          for (const _status of [
            ServiceStatus.unhealthy,
            ServiceStatus.starting,
          ]) {
            for (const cmp of Object.values(this.components)) {
              if (cmp.status === _status) {
                this._context.calculatedStatus = _status;
                if (_status === ServiceStatus.unhealthy)
                  this._context.calculatedStatusMessage = cmp.statusMessage;
                break;
              }
            }
          }
        }
        this.emitSafe(
          'component-status-change',
          component,
          status,
          statusMessage,
        );
        if (
          this.status !== oldStatus ||
          this.statusMessage !== oldStatusMessage
        )
          this.onStatusChange();
      });
    }
    /** Initialize components first */
    await Promise.all(
      Object.values(this.components).map(component => component.init()),
    );
  }

  protected async _start(abortSignal?: AbortSignal): Promise<void> {
    if (
      this.status === ServiceStatus.starting ||
      this.status === ServiceStatus.started
    )
      await Promise.all(
        Object.values(this.components).map(component =>
          component.start(abortSignal),
        ),
      );
  }

  protected async _stop(): Promise<void> {
    await Promise.all(
      Object.values(this.components)
        .reverse()
        .map(component => component.stop()),
    );
  }

  protected onStatusChange() {
    super.onStatusChange();
  }
}

/**
 * @namespace
 */
export namespace BaseElement {
  export interface Events extends Runnable.Events {
    'component-status-change': [
      component: ComponentBase,
      status: ServiceStatus,
      statusMessage: string,
    ];
    'values-updated': [string[]];
  }

  export interface InitArgs extends Runnable.InitArgs {
    logger?: ILogger;
    name: string;
    values: Record<string, any>;
  }

  export interface Context extends Runnable.Context {
    calculatedStatus?: ServiceStatus;
    calculatedStatusMessage?: string;
    statusIndicators: Record<
      string,
      {
        count: number;
        components: ComponentBase[];
        componentNames: string[];
      }
    >;
  }
}
