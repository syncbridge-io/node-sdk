import type { LocalizedText } from '../registry/localized-text.js';
import { ownContainer } from './widget.decorator.js';

/**
 * Defines the sections of a dashboard class, in their order: its widgets
 * go into them by their `section`; one with none goes above them, under
 * no title.
 *
 * ```ts
 * @DashboardSections([
 *   { id: 'queue', title: 'Queue' },
 *   { id: 'devices', title: 'Devices', dynamic: true },
 * ])
 * class OperationsDashboard extends DashboardBase { ... }
 * ```
 *
 * A section `dynamic` takes the widgets defined as the worker runs
 * (`DashboardBase.define`). A subclass' sections replace its base's.
 */
export function DashboardSections(sections: DashboardSections.Section[]) {
  return function (target: Function) {
    const ids = new Set<string>();
    for (const s of sections) {
      if (!s.id || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id))
        throw new TypeError(
          `A dashboard section's id is letters, digits, _ and -: "${s.id}"`,
        );
      if (ids.has(s.id))
        throw new TypeError(`Dashboard section "${s.id}" is defined twice`);
      ids.add(s.id);
    }
    ownContainer(target.prototype).sections = sections.map(s => ({ ...s }));
  };
}

export namespace DashboardSections {
  export interface Section {
    id: string;
    title?: LocalizedText;
    description?: LocalizedText;
    /** Whether widgets defined as the worker runs may go here */
    dynamic?: boolean;
  }
}
