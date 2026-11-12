import type { LogChannel } from '../decorators/log-channel.decorator.js';
import { type Widget, WIDGET_TONES } from '../decorators/widget.decorator.js';
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

  /**
   * What the element would say first about itself, as it runs: one short
   * line under its name on the worker's map (`lis.local:2575`). Set with
   * `setGlance`; none by default
   */
  get glance(): BaseElement.Line | undefined {
    return this._context.glance;
  }

  /**
   * What the element is doing now, as it runs: one short line under its
   * state on the worker's map (`↓ 12 ↑ 11 /min`). Set with `setActivity`;
   * none by default
   */
  get activity(): BaseElement.Line | undefined {
    return this._context.activity;
  }

  /**
   * Sets the element's glance: what it would say first about itself - an
   * address, a port, a database - written by the element, as it learns
   * it. Data, not prose: it is shown as it is, not translated. One line
   * of at most 80 characters; a longer one is cut. Never a secret.
   *
   * @param text The line; `undefined` or empty for none
   * @param tone How the web UI colors it; plain when none
   */
  protected setGlance(text?: string, tone?: Widget.Tone): void {
    this._setLine('glance', text, tone);
  }

  /**
   * Sets the element's activity: what it is doing now - its rate, its
   * queue, the last thing it handled - in the words and units it
   * chooses. It may be set as often as wanted: the worker sends at most
   * one change a second. Cleared when the worker stops, never kept.
   * Data, not prose; one line of at most 80 characters; never a secret.
   *
   * @param text The line; `undefined` or empty for none
   * @param tone How the web UI colors it; plain when none
   */
  protected setActivity(text?: string, tone?: Widget.Tone): void {
    this._setLine('activity', text, tone);
  }

  protected _setLine(
    kind: BaseElement.LineKind,
    text?: string,
    tone?: Widget.Tone,
  ): void {
    const line = BaseElement.toLine(text, tone);
    const old = this._context[kind];
    if (old?.text === line?.text && old?.tone === line?.tone) return;
    this._context[kind] = line;
    this.emitSafe('line-change', kind, line);
  }

  protected async _init(): Promise<void> {
    for (const component of Object.values(this.components)) {
      component.on('component-status-change', (...args) =>
        this.emitAsyncSafe('component-status-change', ...args),
      );
      /* Its lines, and its own components', told up to the app */
      component.on('line-change', (kind, line) =>
        this.emitSafe('component-line-change', component, kind, line),
      );
      component.on('component-line-change', (...args) =>
        this.emitSafe('component-line-change', ...args),
      );
      /* Those it set before it was listened to: told now */
      for (const kind of ['glance', 'activity'] as const)
        if (component[kind])
          this.emitSafe(
            'component-line-change',
            component,
            kind,
            component[kind],
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
    /** Its glance or its activity changed; `line` none when cleared */
    'line-change': [kind: BaseElement.LineKind, line?: BaseElement.Line];
    /** A component's glance or activity changed, at any depth below */
    'component-line-change': [
      component: ComponentBase,
      kind: BaseElement.LineKind,
      line?: BaseElement.Line,
    ];
  }

  /** The element's two lines on the worker's map */
  export type LineKind = 'glance' | 'activity';

  /** A line an element writes of itself: its text, and how it is colored */
  export interface Line {
    text: string;
    tone?: Widget.Tone;
  }

  /** The longest line: a longer one is cut, ending in "…" */
  export const LINE_MAX_LENGTH = 80;

  /**
   * A line as it is kept: on one line, trimmed, cut at LINE_MAX_LENGTH;
   * none when empty. A tone not known is left out
   */
  export function toLine(text?: string, tone?: Widget.Tone): Line | undefined {
    let t = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return;
    if (t.length > LINE_MAX_LENGTH)
      t = t.slice(0, LINE_MAX_LENGTH - 1).trimEnd() + '…';
    return tone && WIDGET_TONES.includes(tone)
      ? { text: t, tone }
      : { text: t };
  }

  export interface InitArgs extends Runnable.InitArgs {
    logger?: ILogger;
    name: string;
    values: Record<string, any>;
  }

  export interface Context extends Runnable.Context {
    glance?: Line;
    activity?: Line;
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
