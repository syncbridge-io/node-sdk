import { expect } from 'expect';
import {
  App,
  AppBase,
  AppFactory,
  Component,
  ComponentBase,
  DashboardBase,
  DashboardCounters,
  type DashboardOp,
  DashboardSections,
  DashboardVisibility,
  ExtensionRegistry,
  type Profile,
  UseDashboard,
  Widget,
} from '../../src/index.js';

class LineDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Frames' })
  declare readonly frames: Widget.Stat;

  @Widget.Stat({ title: 'Dropped' })
  declare readonly dropped: Widget.Stat;
}

@Component({ displayName: 'Include line' })
class LineComponent extends ComponentBase {
  @UseDashboard({ title: 'Line' })
  declare readonly stats: LineDashboard;
}

@DashboardSections([{ id: 'beds', title: 'Beds', dynamic: true }])
class DeviceDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Errors' })
  declare readonly errors: Widget.Stat;

  @Widget.Chart({ title: 'Received', series: ['bytes'] })
  declare readonly rxBytes: Widget.Chart;

  @Widget.Stat({ title: 'Frames received' })
  declare readonly rxFrames: Widget.Stat;

  @Widget.Chart({ title: 'Sent', series: ['bytes'] })
  declare readonly txBytes: Widget.Chart;
}

class DebugDashboard extends DashboardBase {
  @Widget.Feed({ title: 'Raw', columns: [{ field: 'text' }] })
  declare readonly raw: Widget.Feed<{ text: string }>;
}

@Component({ displayName: 'Include device' })
class DeviceComponent extends ComponentBase {
  @UseDashboard({
    title: 'Device',
    include: [{ component: 'line', widgets: ['frames'] }],
  })
  declare readonly device: DeviceDashboard;

  @UseDashboard({ title: 'Debug' })
  declare readonly debug: DebugDashboard;

  @Component.UseComponent({ required: true })
  declare readonly line: LineComponent;
}

@DashboardSections([{ id: 'io', title: 'Device' }])
class OpsDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Queue' })
  declare readonly queue: Widget.Stat;
}

@App({ displayName: 'Include app' })
class IncludeApp extends AppBase {
  @UseDashboard({
    title: 'Operations',
    include: [
      {
        component: 'io',
        dashboard: 'device',
        widgets: ['errors', 'rx*', 'frames'],
        section: 'io',
      },
    ],
  })
  declare readonly ops: OpsDashboard;

  @App.UseComponent({ required: true })
  declare readonly io: DeviceComponent;
}

describe("Components' dashboards, shown where their owners take them", () => {
  const sent: DashboardOp[] = [];
  const counters = new DashboardCounters(op => sent.push(op));
  let app: IncludeApp;

  before(async () => {
    await ExtensionRegistry.registerClass(LineComponent);
    await ExtensionRegistry.registerClass(DeviceComponent);
    await ExtensionRegistry.registerClass(IncludeApp);
    const profile = {
      id: 'p1',
      displayName: 'Includes',
      appUri: IncludeApp.uri,
      components: {
        io: {
          uri: DeviceComponent.uri,
          components: { line: { uri: LineComponent.uri } },
        },
      },
    } as unknown as Profile;
    app = (await AppFactory.createApp(profile, {
      dashboardSink: op => sent.push(op),
      dashboardCounters: counters,
    })) as IncludeApp;
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('should keep what it includes in its metadata', () => {
    const { dashboards } = ExtensionRegistry.getApp(IncludeApp.uri).metadata;
    expect(dashboards!.ops.include).toEqual([
      {
        component: 'io',
        dashboard: 'device',
        widgets: ['errors', 'rx*', 'frames'],
        section: 'io',
      },
    ]);
  });

  it('should write the widgets the app takes, by id or pattern', () => {
    app.ops.queue.set(1);
    app.io.device.errors.set(2);
    app.io.device.rxBytes.point('bytes', 10, new Date(0));
    app.io.device.rxFrames.set(3);
    expect(sent.map(op => (op as { widget: string }).widget)).toEqual([
      'ops/queue',
      'io/device/errors',
      'io/device/rxBytes',
      'io/device/rxFrames',
    ]);
  });

  it('should write nothing of the widgets nobody takes - not even a count', () => {
    app.io.device.txBytes.point('bytes', 10);
    app.io.device.txBytes.count('bytes', 10);
    app.io.device.txBytes.clear();
    app.io.debug.raw.append({ text: 'x' });
    counters.flush();
    expect(sent).toEqual([]);
    expect(app.io.device.txBytes).toMatchObject({ silent: true });
  });

  it("should take a component's component's widgets only where each owner takes them", () => {
    app.io.line.stats.frames.set(5);
    app.io.line.stats.dropped.set(1);
    expect(sent).toEqual([
      { op: 'set', widget: 'io/line/stats/frames', value: 5 },
    ]);
  });

  it('should define a widget as the worker runs when taken, silent when not', () => {
    const bed = app.io.device.define(
      'rx-bed7',
      Widget.stat({ title: 'Bed 7', section: 'beds' }),
    );
    const other = app.io.device.define(
      'tx-bed7',
      Widget.stat({ title: 'Bed 7', section: 'beds' }),
    );
    bed.set(1);
    other.set(2);
    app.io.device.undefine('tx-bed7');
    expect(sent.map(op => op.op)).toEqual(['define', 'set']);
    expect(sent[1]).toMatchObject({ widget: 'io/device/rx-bed7' });
  });

  it('should check a widget nobody takes as it is defined all the same', () => {
    expect(() =>
      app.io.device.define(
        'tx-bed8',
        Widget.stat({ title: 'Bed 8', section: 'nowhere' }),
      ),
    ).toThrow(/no section "nowhere"/);
  });
});

describe('DashboardVisibility', () => {
  const component = (dashboards: Record<string, any>, components?: any) => ({
    dashboards,
    ...(components ? { components } : {}),
  });

  it("should show an app's widgets always, a component's none unless taken", () => {
    const v = new DashboardVisibility({
      dashboards: { ops: { name: 'ops' } },
      components: { io: component({ device: { name: 'device' } }) },
    } as any);
    expect(v.shows('', 'ops', 'queue')).toBe(true);
    expect(v.shows('io', 'io/device', 'errors')).toBe(false);
  });

  it('should take every widget of every dashboard when it names none', () => {
    const v = new DashboardVisibility({
      dashboards: { all: { name: 'all', include: [{ component: 'io' }] } },
      components: {
        io: component({ device: { name: 'device' }, debug: { name: 'debug' } }),
      },
    } as any);
    expect(v.shows('io', 'io/device', 'errors')).toBe(true);
    expect(v.shows('io', 'io/debug', 'raw')).toBe(true);
  });

  it('should tell of an include naming no component or no dashboard of it', () => {
    const v = new DashboardVisibility({
      dashboards: {
        ops: {
          name: 'ops',
          include: [
            { component: 'nope' },
            { component: 'io', dashboard: 'nope' },
          ],
        },
      },
      components: { io: component({ device: { name: 'device' } }) },
    } as any);
    expect(v.issues).toEqual([
      'Dashboard "ops" includes widgets of "nope", which is not its component',
      'Dashboard "ops" includes dashboard "nope" of "io", which it does not have',
    ]);
  });
});

describe('UseDashboard include', () => {
  it('should refuse a section its class does not define', () => {
    expect(() => {
      class Holder extends AppBase {
        @UseDashboard({
          include: [{ component: 'io', section: 'nowhere' }],
        })
        declare readonly ops: OpsDashboard;
      }
      return Holder;
    }).toThrow(/into section "nowhere", which OpsDashboard does not define/);
  });

  it('should refuse a pattern of other characters', () => {
    expect(() => {
      class Holder extends AppBase {
        @UseDashboard({ include: [{ component: 'io', widgets: ['a.b'] }] })
        declare readonly ops: OpsDashboard;
      }
      return Holder;
    }).toThrow(/letters, digits, _, - and \*/);
  });

  it('should take DashboardBase as the type of one of included widgets alone', () => {
    class Holder extends AppBase {
      @UseDashboard({ title: 'Device', include: [{ component: 'io' }] })
      declare readonly device: DashboardBase;
    }
    expect(Holder).toBeDefined();
  });
});
