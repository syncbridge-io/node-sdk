import 'reflect-metadata';
import type { Type } from 'ts-gems';
import type { AppBase } from '../classes/app-base.js';
import type { ComponentBase } from '../classes/component-base.js';
import { DashboardBase } from '../classes/dashboard-base.js';
import {
  CLASS_METADATA,
  DASHBOARD_CLASSES,
  DASHBOARD_CONTAINER,
} from '../constants.js';
import {
  DashboardIncludeMetadata,
  DashboardMetadata,
  DashboardSectionMetadata,
} from '../models/index.js';
import type { LocalizedText } from '../registry/localized-text.js';
import { defineOwnMetadata } from './decorator-helpers.js';
import type { DashboardContainer } from './widget.decorator.js';

/**
 * Gives an app or component a dashboard - an app's a tab of its own in the
 * worker's page - of the property's class, a DashboardBase whose sections and
 * widgets it takes. The property is declared `declare readonly`; as the
 * worker runs it holds the dashboard, its widgets written through it:
 *
 * ```ts
 * class BedsideApp extends AppBase {
 *   @UseDashboard({ title: 'Operations' })
 *   declare readonly operations: OperationsDashboard;
 *
 *   @UseDashboard({ title: 'Devices' })
 *   declare readonly devices: DevicesDashboard;
 * }
 * ```
 *
 * An element may have several; one dashboard class may serve several
 * properties, each its own tab.
 *
 * A component's dashboards are never tabs of their own: its widgets are
 * shown where its owner takes them, with `include` - all of a dashboard's,
 * or those its ids match - into a dashboard of the owner's, which may be
 * of no widgets of its own. Widgets nobody takes are not written at all:
 *
 * ```ts
 * @UseDashboard({
 *   title: 'Operations',
 *   include: [{ component: 'io', dashboard: 'device', widgets: ['errors', 'rx*'] }],
 * })
 * declare readonly operations: OperationsDashboard;
 *
 * @UseDashboard({ title: 'Device', include: [{ component: 'io' }] })
 * declare readonly device: DashboardBase;
 * ```
 *
 * A component takes its own components' widgets the same way; its owner
 * takes them from its dashboard.
 */
export function UseDashboard(options: UseDashboard.Options = {}) {
  return function (target: AppBase | ComponentBase, propertyKey: any) {
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');
    let dashboardClass: Type | undefined =
      options.type || Reflect.getMetadata('design:type', target, propertyKey);
    /* A dashboard of included widgets alone may be typed DashboardBase */
    if (dashboardClass === DashboardBase && options.include?.length)
      dashboardClass = IncludedDashboard;
    if (
      typeof dashboardClass !== 'function' ||
      !(dashboardClass.prototype instanceof DashboardBase)
    )
      throw new TypeError(
        `The type of dashboard "${propertyKey}" must be a class extending DashboardBase`,
      );
    const container: DashboardContainer = Reflect.getMetadata(
      DASHBOARD_CONTAINER,
      dashboardClass.prototype,
    ) || { widgets: {} };
    const sections = container.sections || [];
    const known = new Set(sections.map(s => s.id));
    const widgets = Object.values(container.widgets);
    for (const w of widgets)
      if (w.section && !known.has(w.section))
        throw new TypeError(
          `Widget "${w.id}" of dashboard "${propertyKey}" goes into section "${w.section}", which ${dashboardClass.name} does not define`,
        );
    const include = (options.include || []).map(i => {
      const where = `dashboard "${propertyKey}" includes`;
      if (!i || typeof i.component !== 'string' || !NAME.test(i.component))
        throw new TypeError(
          `The ${where} widgets of "${i?.component}", which is not a component's name`,
        );
      if (i.dashboard != null && !NAME.test(i.dashboard))
        throw new TypeError(
          `The ${where} dashboard "${i.dashboard}" of "${i.component}", which is not a dashboard's name`,
        );
      for (const w of i.widgets || [])
        if (typeof w !== 'string' || !PATTERN.test(w))
          throw new TypeError(
            `The ${where} widgets "${w}" of "${i.component}": letters, digits, _, - and *`,
          );
      if (i.section && !known.has(i.section))
        throw new TypeError(
          `The ${where} widgets of "${i.component}" into section "${i.section}", which ${dashboardClass.name} does not define`,
        );
      return new DashboardIncludeMetadata({
        component: i.component,
        ...(i.dashboard ? { dashboard: i.dashboard } : {}),
        ...(i.widgets?.length ? { widgets: [...i.widgets] } : {}),
        ...(i.section ? { section: i.section } : {}),
      });
    });

    /* The class itself, for the runtime to make the dashboard of: kept
     * apart from the metadata, which is written to the manifest */
    const classes: Record<string, Type> = {
      ...Reflect.getMetadata(DASHBOARD_CLASSES, target.constructor),
    };
    classes[propertyKey] = dashboardClass;
    Reflect.defineMetadata(DASHBOARD_CLASSES, classes, target.constructor);

    const metadata = defineOwnMetadata(target.constructor, CLASS_METADATA);
    metadata.dashboards = metadata.dashboards || {};
    metadata.dashboards[propertyKey] = new DashboardMetadata({
      name: propertyKey,
      propertyKey,
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.order != null ? { order: options.order } : {}),
      ...(sections.length
        ? { sections: sections.map(s => new DashboardSectionMetadata(s)) }
        : {}),
      widgets,
      ...(include.length ? { include } : {}),
    });
  };
}

const NAME = /^[A-Za-z0-9_$-]{1,64}$/;
const PATTERN = /^[A-Za-z0-9_*-]{1,64}$/;

/** The class of a dashboard holding included widgets alone */
class IncludedDashboard extends DashboardBase {}

export namespace UseDashboard {
  export interface Options {
    /** The tab's title; default: the property's name */
    title?: LocalizedText;
    description?: LocalizedText;
    /** Its place among its element's dashboards; default: as defined */
    order?: number;
    /** The dashboard class, when the property's type does not tell it */
    type?: Type;
    /** Widgets of its components' dashboards it shows, in this order */
    include?: Include[];
  }

  export interface Include {
    /** The component, by the name its owner gives it */
    component: string;
    /** Its dashboard; default: every one of them */
    dashboard?: string;
    /** The widgets, by id; `*` matches any characters. Default: every one */
    widgets?: string[];
    /** The section of this dashboard they go into; default: the component's own */
    section?: string;
  }
}
