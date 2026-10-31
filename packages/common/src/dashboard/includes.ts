import type {
  DashboardMetadataRecord,
  ElementComponentMetadataRecord,
} from '../models/index.js';
import { dashboardPath } from './limits.js';

/** What an element's metadata gives of its dashboards and components */
interface DashboardOwner {
  dashboards?: DashboardMetadataRecord;
  components?: ElementComponentMetadataRecord;
}

/** Ids a widget must match: each list one of its patterns, all of them */
type Filter = RegExp[][];

/**
 * Which widgets of a worker's components are shown: those their owners
 * take with `@UseDashboard({ include })`, an app's own always. A
 * component's widget nobody takes is not written at all - its writes
 * return at once - and one taken from a component of a component must be
 * taken at each step, matching each one's ids
 */
export class DashboardVisibility {
  /** By dashboard path: the filters it is taken by */
  protected _taken = new Map<string, Filter[]>();
  /** Includes naming no component, or no dashboard of it */
  readonly issues: string[] = [];

  constructor(app: DashboardOwner) {
    for (const [name, d] of Object.entries(app.dashboards || {}))
      for (const i of d.include || []) this._take(app, '', name, i, []);
  }

  /**
   * Whether a widget of the dashboard at `path` is shown; `source` is its
   * element's path, an app's empty
   */
  shows(source: string, path: string, id: string): boolean {
    if (!source) return true;
    return !!this._taken
      .get(path)
      ?.some(f => f.every(patterns => patterns.some(p => p.test(id))));
  }

  protected _take(
    owner: DashboardOwner,
    ownerPath: string,
    ownerDashboard: string,
    include: {
      component: string;
      dashboard?: string;
      widgets?: string[];
    },
    filter: Filter,
  ) {
    const where = `Dashboard "${dashboardPath(ownerPath, ownerDashboard)}"`;
    const component = owner.components?.[include.component];
    if (!component) {
      this.issues.push(
        `${where} includes widgets of "${include.component}", which is not its component`,
      );
      return;
    }
    const path = dashboardPath(ownerPath, include.component);
    const dashboards = component.dashboards || {};
    if (include.dashboard && !dashboards[include.dashboard]) {
      this.issues.push(
        `${where} includes dashboard "${include.dashboard}" of "${path}", which it does not have`,
      );
      return;
    }
    const taken = include.widgets?.length
      ? [...filter, include.widgets.map(patternOf)]
      : filter;
    for (const [name, d] of Object.entries(dashboards)) {
      if (include.dashboard && include.dashboard !== name) continue;
      const at = dashboardPath(path, name);
      const filters = this._taken.get(at) || [];
      filters.push(taken);
      this._taken.set(at, filters);
      for (const i of d.include || [])
        this._take(component, path, name, i, taken);
    }
  }
}

/** A widget id pattern: `*` any characters */
function patternOf(pattern: string): RegExp {
  return new RegExp(
    '^' +
      pattern
        .split('*')
        .map(s => s.replace(/[.+?^${}()|[\]\\-]/g, '\\$&'))
        .join('.*') +
      '$',
  );
}
