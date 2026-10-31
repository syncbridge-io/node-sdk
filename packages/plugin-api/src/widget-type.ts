import type { DataKind, Widget, WidgetPropertySpec } from '@syncbridge/common';

/**
 * A kind of dashboard widget a plugin brings, since 2.4: a template - a
 * tree of the web UI's primitives, its nodes bound to the widget's
 * properties and data - nothing of the plugin's code runs in the browser.
 * An app uses it by its id, `<plugin>.<name>@<version>`:
 *
 * @example
 * // A plugin named "acme"
 * this.host.ui.registerWidgetType({
 *   name: 'battery',
 *   title: 'Battery',
 *   data: ['value'],
 *   properties: { device: { type: 'string', required: true } },
 *   template: {
 *     type: 'stack',
 *     children: [
 *       { type: 'text', value: 'prop.device' },
 *       { type: 'progress', value: 'data.value' },
 *     ],
 *   },
 * });
 * // An app
 * @Widget('acme.battery@1', { data: { kind: 'value' }, properties: { device: 'Bed 3' } })
 */
export interface WidgetTypeDefinition {
  /** Its own among the plugin's; lower case, "-" allowed */
  name: string;
  /**
   * Changed when its properties or data change in a way the widgets using
   * it would break on; both may be registered. Default 1
   */
  version?: number;
  title: string;
  description?: string;
  /**
   * The kinds its data may be. A value or a series is drawn once, bound
   * as `data.value` or `data.<series>`; a table or a feed once for each
   * row, as `row.<field>`
   */
  data: DataKind[];
  /** What a widget of it is given, bound as `prop.<name>` */
  properties?: Record<string, WidgetPropertySpec>;
  template: Widget.TemplateNode;
}
