import { expect } from 'expect';
import {
  App,
  AppBase,
  Component,
  ComponentBase,
  coreWidgetType,
  DashboardBase,
  DashboardSections,
  ExtensionRegistry,
  templateIssues,
  templateScopes,
  UseDashboard,
  Widget,
  widgetIssues,
  widgetMetadataOf,
  widgetTypeIssues,
} from '../../src/index.js';

describe('The core widget types', () => {
  it('should define a gauge and a progress bar of a value, bars and a pie of a table, a chart of a style', () => {
    expect(Widget.gauge({ min: 0, max: 100, unit: '%' })).toEqual({
      type: 'core.gauge@1',
      properties: { min: 0, max: 100, unit: '%' },
      data: { kind: 'value' },
    });
    expect(Widget.progress({ max: 500 }).type).toBe('core.progress@1');
    expect(Widget.bars({ unit: 'msg', max: 20 })).toEqual({
      type: 'core.bars@1',
      properties: { unit: 'msg' },
      data: { kind: 'table', max: 20 },
    });
    expect(Widget.pie({ donut: false })).toMatchObject({
      type: 'core.pie@1',
      properties: { donut: false },
      data: { kind: 'table' },
    });
    expect(
      Widget.chart({ series: ['a'], style: 'stacked' }).properties,
    ).toEqual({ style: 'stacked' });
  });

  it('should check each against its type: a gauge needs its max, a chart one of its styles', () => {
    const issues = (id: string, d: Widget.Definition<any>) =>
      widgetIssues(widgetMetadataOf(id, d), coreWidgetType(d.type));
    expect(issues('g', Widget.gauge({ max: 10 }))).toEqual([]);
    expect(
      issues('g', { type: 'core.gauge@1', data: { kind: 'value' } }),
    ).toEqual(['it needs "max"']);
    expect(
      issues('c', Widget.chart({ series: ['a'], style: 'pie' as any })),
    ).toEqual(['"style" is one of line, area, bar, stacked']);
    expect(issues('p', { type: 'core.pie@1', data: { kind: 'feed' } })).toEqual(
      ["a core.pie@1's data is a table, not a feed"],
    );
  });

  it("should take its texts by language - a title, a unit, a series' label - and refuse one not text", () => {
    const issues = (id: string, d: Widget.Definition<any>) =>
      widgetIssues(widgetMetadataOf(id, d), coreWidgetType(d.type));
    const chart = Widget.chart({
      title: { en: 'Traffic', tr: 'Trafik' },
      series: ['rx'],
      unit: { en: 'B/s', tr: 'B/sn' },
      labels: { rx: { en: 'Received', tr: 'Alınan' } },
    });
    expect(chart.properties).toEqual({
      unit: { en: 'B/s', tr: 'B/sn' },
      labels: { rx: { en: 'Received', tr: 'Alınan' } },
    });
    expect(issues('c', chart)).toEqual([]);
    expect(
      issues('s', Widget.stat({ title: { en: '' }, unit: 42 as any })),
    ).toEqual([
      'its title is a text, or text by language',
      '"unit" is a text, or text by language',
    ]);
  });

  it("should check a plugin's template type: its tree bound to what it is drawn with", () => {
    const battery = {
      name: 'acme.battery',
      version: 1,
      title: 'Battery',
      renderer: 'template' as const,
      data: ['value' as const],
      properties: { device: { type: 'string' as const, required: true } },
      template: {
        type: 'stack' as const,
        children: [
          { type: 'text' as const, value: 'prop.device' },
          { type: 'progress' as const, value: 'data.value' },
        ],
      },
    };
    expect(widgetTypeIssues(battery)).toEqual([]);
    /* A value is drawn once: no row to bind */
    expect(
      widgetTypeIssues({
        ...battery,
        template: { type: 'text', value: 'row.name' },
      }),
    ).toEqual(['template root: "row.name" binds prop.<name> or data.<name>']);
    /* A table for each row: its data is the row */
    expect(
      widgetTypeIssues({
        ...battery,
        data: ['table'],
        template: { type: 'text', value: 'data.value' },
      }),
    ).toEqual(['template root: "data.value" binds prop.<name> or row.<field>']);
    expect(
      widgetTypeIssues({
        ...battery,
        name: 'battery',
        version: 0,
        data: ['blob' as any],
      }),
    ).toEqual([
      '"battery" is not a type\'s name (vendor.name)',
      'its version is a whole number from 1',
      'its data is of value, series, table, feed',
    ]);
    expect(
      widgetTypeIssues({
        ...battery,
        properties: { level: { type: 'number', values: ['a'] } },
        template: undefined,
      }),
    ).toEqual([
      'property "level": only a string has values, a list',
      'a template type needs its template',
    ]);
    expect(templateScopes(['series', 'feed'])).toEqual(['prop', 'data', 'row']);
    /* An app's cards bind their row and properties alone */
    expect(templateIssues({ type: 'text', value: 'data.value' })).toEqual([
      'template root: "data.value" binds row.<field> or prop.<name>',
    ]);
  });
});

@DashboardSections([
  { id: 'queue', title: 'Queue' },
  { id: 'devices', title: 'Devices', dynamic: true },
])
class OperationsDashboard extends DashboardBase {
  @Widget.Stat({
    title: 'Queue',
    section: 'queue',
    unit: 'messages',
    thresholds: { warning: 100, error: 500 },
  })
  declare readonly queue: Widget.Stat;

  @Widget.Chart({
    title: 'Throughput',
    section: 'queue',
    series: ['received', 'sent'],
    window: '1h',
    points: 600,
    size: { width: 2 },
  })
  declare readonly throughput: Widget.Chart;

  @Widget.Cards({
    title: 'Monitors',
    section: 'devices',
    template: { type: 'text', value: 'row.name' },
    max: 100,
  })
  declare readonly monitors: Widget.Cards<{ name: string }>;
}

class HealthDashboard extends DashboardBase {
  @Widget.Status({ title: 'Database' })
  declare readonly db: Widget.Status;

  @Widget('acme.map@1', {
    title: 'Locations',
    data: { kind: 'table', max: 50 },
    properties: { zoom: 3 },
  })
  declare readonly map: Widget.Table;
}

@Component({ displayName: 'Dashboard component' })
class DeviceComponent extends ComponentBase {
  @UseDashboard({ title: 'Device' })
  declare readonly device: HealthDashboard;
}

@App({ displayName: 'Dashboard app' })
class DashboardApp extends AppBase {
  @UseDashboard({ title: 'Operations' })
  declare readonly operations: OperationsDashboard;

  @UseDashboard({ title: 'Health', order: 0 })
  declare readonly health: HealthDashboard;

  @App.UseComponent({ required: true })
  declare readonly io: DeviceComponent;
}

describe('Dashboard decorators', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(DeviceComponent);
    await ExtensionRegistry.registerClass(DashboardApp);
  });

  it("should give an element its dashboards, each of its class' sections and widgets", () => {
    const { dashboards } = ExtensionRegistry.getApp(DashboardApp.uri).metadata;
    expect(Object.keys(dashboards!)).toEqual(['operations', 'health']);
    const operations = dashboards!.operations;
    expect(operations).toMatchObject({
      name: 'operations',
      propertyKey: 'operations',
      title: 'Operations',
      sections: [
        { id: 'queue', title: 'Queue' },
        { id: 'devices', title: 'Devices', dynamic: true },
      ],
    });
    /* In the order defined, each with its data's kind and bounds */
    expect(operations.widgets).toEqual([
      expect.objectContaining({
        id: 'queue',
        type: 'core.stat@1',
        section: 'queue',
        properties: {
          unit: 'messages',
          thresholds: { warning: 100, error: 500 },
        },
        data: { kind: 'value' },
      }),
      expect.objectContaining({
        id: 'throughput',
        type: 'core.chart@1',
        size: { width: 2 },
        data: {
          kind: 'series',
          series: ['received', 'sent'],
          max: 600,
          window: 3600,
        },
      }),
      expect.objectContaining({
        id: 'monitors',
        type: 'core.card@1',
        properties: { template: { type: 'text', value: 'row.name' } },
        data: { kind: 'table', max: 100 },
      }),
    ]);
    expect(dashboards!.health.order).toBe(0);
  });

  it("should take a plugin's type as it is told, and a component's dashboards", () => {
    const { dashboards } = ExtensionRegistry.getApp(DashboardApp.uri).metadata;
    expect(dashboards!.health.widgets![1]).toMatchObject({
      id: 'map',
      type: 'acme.map@1',
      properties: { zoom: 3 },
      data: { kind: 'table', max: 50 },
    });
    const component = ExtensionRegistry.getComponent(DeviceComponent.uri);
    expect(
      component.metadata.dashboards!.device.widgets!.map(w => w.id),
    ).toEqual(['db', 'map']);
  });

  it("should give a subclass its base's widgets, its own after them", () => {
    class MoreDashboard extends HealthDashboard {
      @Widget.Stat({ title: 'Latency', unit: 'ms' })
      declare readonly latency: Widget.Stat;
    }
    class More extends AppBase {
      @UseDashboard()
      declare readonly more: MoreDashboard;
    }
    const { dashboards } = Reflect.getMetadata(
      Symbol.for('CLASS_METADATA'),
      More,
    );
    expect(dashboards.more.widgets.map((w: any) => w.id)).toEqual([
      'db',
      'map',
      'latency',
    ]);
    /* The base's own left as it was */
    class Base extends AppBase {
      @UseDashboard()
      declare readonly base: HealthDashboard;
    }
    expect(
      Reflect.getMetadata(Symbol.for('CLASS_METADATA'), Base).dashboards.base
        .widgets.length,
    ).toBe(2);
  });

  it('should refuse a widget put into a section its dashboard does not define', () => {
    class Wrong extends DashboardBase {
      @Widget.Stat({ section: 'nowhere' })
      declare readonly x: Widget.Stat;
    }
    expect(() => {
      class A extends AppBase {
        @UseDashboard()
        declare readonly wrong: Wrong;
      }
      return A;
    }).toThrow(/section "nowhere", which Wrong does not define/);
  });

  it('should refuse a dashboard not of a DashboardBase, and sections defined twice', () => {
    class NotOne {}
    expect(() => {
      class A extends AppBase {
        @UseDashboard()
        declare readonly x: NotOne;
      }
      return A;
    }).toThrow(/must be a class extending DashboardBase/);
    expect(() => {
      @DashboardSections([{ id: 'a' }, { id: 'a' }])
      class Twice extends DashboardBase {}
      return Twice;
    }).toThrow(/"a" is defined twice/);
  });

  it('should take a chart window as 30s, 15m, 1h, 1d or seconds, and refuse another', () => {
    expect(Widget.chart({ series: ['a'], window: '30s' }).data.window).toBe(30);
    expect(Widget.chart({ series: ['a'], window: '15m' }).data.window).toBe(
      900,
    );
    expect(Widget.chart({ series: ['a'], window: 120 }).data.window).toBe(120);
    expect(() => Widget.chart({ series: ['a'], window: '1w' })).toThrow(
      /Not a window/,
    );
  });

  it('should not define a widget before the worker runs the dashboard', () => {
    class D extends DashboardBase {}
    expect(() => new (D as any)().define('x', Widget.stat())).toThrow(
      /before the worker runs its dashboard/,
    );
  });
});
