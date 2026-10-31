import type { Widget } from '../decorators/widget.decorator.js';

/** Where a running dashboard's define and undefine go: the worker's */
export const DASHBOARD_CONTEXT = Symbol.for('DASHBOARD_CONTEXT');

/**
 * A dashboard: the class a `@UseDashboard` property is of. Its sections
 * (`@DashboardSections`) and widgets (`@Widget`) are defined on it; as the
 * worker runs its widget properties hold their data, and widgets the
 * metadata could not foresee are defined:
 *
 * ```ts
 * @DashboardSections([{ id: 'devices', title: 'Devices', dynamic: true }])
 * class DevicesDashboard extends DashboardBase {}
 *
 * // in the app
 * const bed3 = this.devices.define('bed-3',
 *   Widget.stat({ title: 'Bed 3', unit: 'bpm', section: 'devices' }));
 * bed3.set(72);
 * ```
 */
export abstract class DashboardBase {
  declare protected [DASHBOARD_CONTEXT]?: DashboardBase.Context;

  /**
   * Defines a widget as the worker runs, or defines it anew, in a section
   * declared `dynamic`; returns what writes its data. Given the same id
   * each time, it stays hidden where a user hid it
   */
  define<H>(id: string, definition: Widget.Definition<H>): H {
    const context = this[DASHBOARD_CONTEXT];
    if (!context)
      throw new Error(
        `Dashboard widget "${id}" defined before the worker runs its dashboard`,
      );
    return context.define(id, definition);
  }

  /** Removes a widget defined as the worker runs */
  undefine(id: string): void {
    this[DASHBOARD_CONTEXT]?.undefine(id);
  }
}

export namespace DashboardBase {
  /** What the worker's runtime gives a running dashboard */
  export interface Context {
    define<H>(id: string, definition: Widget.Definition<H>): H;
    undefine(id: string): void;
  }
}
