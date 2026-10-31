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
  DashboardMetadata,
  DashboardSectionMetadata,
} from '../models/index.js';
import { defineOwnMetadata } from './decorator-helpers.js';
import type { DashboardContainer } from './widget.decorator.js';

/**
 * Gives an app or component a dashboard - a tab of its own in the worker's
 * page - of the property's class, a DashboardBase whose sections and
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
 */
export function UseDashboard(options: UseDashboard.Options = {}) {
  return function (target: AppBase | ComponentBase, propertyKey: any) {
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');
    const dashboardClass: Type | undefined =
      options.type || Reflect.getMetadata('design:type', target, propertyKey);
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
    });
  };
}

export namespace UseDashboard {
  export interface Options {
    /** The tab's title; default: the property's name */
    title?: string;
    description?: string;
    /** Its place among its element's dashboards; default: as defined */
    order?: number;
    /** The dashboard class, when the property's type does not tell it */
    type?: Type;
  }
}
