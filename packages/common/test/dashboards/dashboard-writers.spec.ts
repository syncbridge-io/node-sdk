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
  ExtensionRegistry,
  type Profile,
  UseDashboard,
  Widget,
} from '../../src/index.js';

@DashboardSections([
  { id: 'queue', title: 'Queue' },
  { id: 'devices', title: 'Devices', dynamic: true },
])
class OpsDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Queue', section: 'queue' })
  declare readonly queue: Widget.Stat;

  @Widget.Status({ title: 'Link' })
  declare readonly link: Widget.Status;

  @Widget.Chart({ title: 'Rate', series: ['in', 'out'] })
  declare readonly rate: Widget.Chart;

  @Widget.Chart({ title: 'Traffic', series: ['rx'], interval: '5s' })
  declare readonly traffic: Widget.Chart;

  @Widget.Table({ title: 'Devices', columns: [{ field: 'name' }] })
  declare readonly devices: Widget.Table<{ name: string; seen?: Date }>;

  @Widget.Feed({ title: 'Recent', columns: [{ field: 'text' }] })
  declare readonly recent: Widget.Feed<{ text: string }>;
}

class DeviceDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Errors' })
  declare readonly errors: Widget.Stat;
}

@Component({ displayName: 'Writer component' })
class WriterComponent extends ComponentBase {
  @UseDashboard({ title: 'Device' })
  declare readonly device: DeviceDashboard;
}

@App({ displayName: 'Writer app' })
class WriterApp extends AppBase {
  @UseDashboard({ title: 'Operations', include: [{ component: 'io' }] })
  declare readonly ops: OpsDashboard;

  @App.UseComponent({ required: true })
  declare readonly io: WriterComponent;
}

describe('Dashboard widgets as the worker runs', () => {
  const sent: DashboardOp[] = [];
  const warned: string[] = [];
  const counters = new DashboardCounters(op => sent.push(op));
  let app: WriterApp;

  before(async () => {
    await ExtensionRegistry.registerClass(WriterComponent);
    await ExtensionRegistry.registerClass(WriterApp);
    const profile = {
      id: 'p1',
      displayName: 'Writers',
      appUri: WriterApp.uri,
      components: { io: { uri: WriterComponent.uri } },
    } as unknown as Profile;
    app = (await AppFactory.createApp(profile, {
      dashboardSink: op => sent.push(op),
      dashboardCounters: counters,
    })) as WriterApp;
    const warn = (m: string) => warned.push(m);
    app.logger = { warn, child: () => ({ warn }) } as any;
    /* The loggers set, the dashboards told them */
    await AppFactory.updateApp(app, profile, {
      logger: app.logger,
      dashboardSink: op => sent.push(op),
      dashboardCounters: counters,
    });
  });

  beforeEach(() => {
    sent.length = 0;
    warned.length = 0;
  });

  it("should give each dashboard property an instance of its class, its widgets' writers in it", () => {
    expect(app.ops).toBeInstanceOf(OpsDashboard);
    expect(app.io.device).toBeInstanceOf(DeviceDashboard);
    app.ops.queue.set(42);
    app.ops.link.set('ok', 'Connected');
    app.io.device.errors.set(3);
    expect(sent).toEqual([
      { op: 'set', widget: 'ops/queue', value: 42 },
      {
        op: 'set',
        widget: 'ops/link',
        value: { status: 'ok', text: 'Connected' },
      },
      { op: 'set', widget: 'io/device/errors', value: 3 },
    ]);
  });

  it('should write a series by name, a table by key, a feed by row - dates as ISO strings', () => {
    const at = new Date('2026-10-31T10:00:00Z');
    app.ops.rate.point('in', 5, at);
    app.ops.devices.upsert('d1', { name: 'Monitor', seen: at });
    app.ops.devices.remove('d2');
    app.ops.recent.append({ text: 'hello' });
    expect(sent.slice(0, 3)).toEqual([
      {
        op: 'point',
        widget: 'ops/rate',
        series: 'in',
        value: 5,
        at: at.getTime(),
      },
      {
        op: 'upsert',
        widget: 'ops/devices',
        key: 'd1',
        row: { name: 'Monitor', seen: '2026-10-31T10:00:00.000Z' },
      },
      { op: 'remove', widget: 'ops/devices', key: 'd2' },
    ]);
    expect(sent[3]).toMatchObject({ op: 'append', row: { text: 'hello' } });
  });

  it('should refuse a write of the wrong shape, sending nothing, told once in the log', () => {
    app.ops.rate.point('sideways', 1);
    app.ops.rate.point('sideways', 2);
    app.ops.queue.set({ nested: true } as any);
    app.ops.link.set('fine' as any);
    app.ops.recent.append({ text: { deep: 1 } } as any);
    (app.ops.queue as any).append({ text: 'x' });
    app.ops.recent.append({ text: 'x'.repeat(5000) });
    expect(sent).toEqual([]);
    expect(warned).toEqual([
      'Dashboard widget "ops/rate" refused a write: its series are in, out',
      'Dashboard widget "ops/queue" refused a write: a value is a number, a string, a boolean, null or a status',
      'Dashboard widget "ops/link" refused a write: a status is one of ok, warning, error, unknown',
      'Dashboard widget "ops/recent" refused a write: a row\'s "text" is not a plain value',
      'Dashboard widget "ops/queue" refused a write: "ops/queue" holds a value: it has no append()',
      'Dashboard widget "ops/recent" refused a write: a value or a row is at most 4096 bytes as JSON',
    ]);
  });

  it('should define a widget as the worker runs into a dynamic section, and return its writer', () => {
    const bed = app.ops.define(
      'bed-7',
      Widget.stat({ title: 'Bed 7', unit: 'bpm', section: 'devices' }),
    );
    bed.set(88);
    app.ops.undefine('bed-7');
    app.ops.undefine('bed-7');
    expect(sent).toEqual([
      {
        op: 'define',
        dashboard: 'ops',
        widget: expect.objectContaining({
          id: 'bed-7',
          type: 'core.stat@1',
          section: 'devices',
          data: { kind: 'value' },
        }),
      },
      { op: 'set', widget: 'ops/bed-7', value: 88 },
      { op: 'undefine', dashboard: 'ops', id: 'bed-7' },
    ]);
  });

  it('should refuse a widget defined into a section not dynamic, of a class id, or of no type', () => {
    expect(() =>
      app.ops.define('x', Widget.stat({ section: 'queue' })),
    ).toThrow(/section "queue" is not dynamic/);
    expect(() => app.ops.define('queue', Widget.stat())).toThrow(
      /its class defines a widget of that id/,
    );
    expect(() =>
      app.ops.define('y', { type: 'nope', data: { kind: 'value' } }),
    ).toThrow(/"nope" is not a type and version/);
    expect(sent).toEqual([]);
    expect(warned).toHaveLength(3);
  });

  it("should sum a chart's counts in the worker and write them as one point an interval, its own", () => {
    const start = Date.now();
    for (let i = 0; i < 300; i++) app.ops.traffic.count('rx', 10);
    app.ops.traffic.count('rx');
    /* Nothing leaves as it counts */
    expect(sent).toEqual([]);
    counters.tick(start + 1000);
    expect(sent).toEqual([]);
    counters.tick(start + 5000);
    expect(sent).toEqual([
      {
        op: 'point',
        widget: 'ops/traffic',
        series: 'rx',
        value: 3001,
        at: start + 5000,
      },
    ]);
    /* Wrong series or kind refused as point() is; a clear drops the count */
    app.ops.traffic.count('tx', 1);
    (app.ops.queue as any).count('in', 1);
    expect(warned).toEqual([
      'Dashboard widget "ops/traffic" refused a write: its series are rx',
      'Dashboard widget "ops/queue" refused a write: "ops/queue" holds a value: it has no count()',
    ]);
    app.ops.traffic.count('rx', 7);
    app.ops.traffic.clear('rx');
    sent.length = 0;
    counters.flush(start + 20000);
    expect(sent).toEqual([]);
  });

  it('should send a value with its tone and hint, a status with its hint', () => {
    app.ops.queue.set(132, { tone: 'error', hint: 'Over 130 three times' });
    app.ops.queue.set(80);
    app.ops.link.set('warning', { text: 'Slow', hint: 'Answers in 4 s' });
    expect(sent).toEqual([
      {
        op: 'set',
        widget: 'ops/queue',
        value: 132,
        tone: 'error',
        hint: 'Over 130 three times',
      },
      { op: 'set', widget: 'ops/queue', value: 80 },
      {
        op: 'set',
        widget: 'ops/link',
        value: { status: 'warning', text: 'Slow' },
        hint: 'Answers in 4 s',
      },
    ]);
  });

  it('should refuse a tone not known, a status toned, a hint too long', () => {
    app.ops.queue.set(1, { tone: 'red' as any });
    app.ops.link.set('ok', { tone: 'ok' } as any);
    app.ops.queue.set(1, { hint: 'x'.repeat(501) });
    expect(sent).toEqual([]);
    expect(warned).toEqual([
      'Dashboard widget "ops/queue" refused a write: a tone is one of muted, ok, info, accent, warning, error',
      'Dashboard widget "ops/link" refused a write: a status\'s tone is its status',
      'Dashboard widget "ops/queue" refused a write: a hint is a text of at most 500 characters',
    ]);
  });

  it("should draw attention to a widget, a row, a row's field - for a duration or until ended", () => {
    const now = Date.now();
    app.ops.queue.attend({ attention: 'pulse' });
    app.ops.rate.attend({ attention: 'highlight', duration: '3s' });
    app.ops.devices.attend({ key: 'd1', attention: 'pulse', duration: 5 });
    app.ops.devices.attend({
      key: 'd1',
      field: 'name',
      attention: 'highlight',
    });
    app.ops.queue.attend({ attention: null, duration: '1m' });
    expect(sent.slice(0, 1)).toEqual([
      { op: 'attend', widget: 'ops/queue', attention: 'pulse' },
    ]);
    expect(sent[1]).toMatchObject({
      widget: 'ops/rate',
      attention: 'highlight',
    });
    expect((sent[1] as any).until).toBeGreaterThanOrEqual(now + 3000);
    expect((sent[1] as any).until).toBeLessThan(now + 4000);
    expect(sent[2]).toMatchObject({ key: 'd1', attention: 'pulse' });
    expect(sent.slice(3)).toEqual([
      {
        op: 'attend',
        widget: 'ops/devices',
        key: 'd1',
        field: 'name',
        attention: 'highlight',
      },
      /* An end lasts no while */
      { op: 'attend', widget: 'ops/queue', attention: null },
    ]);
  });

  it('should refuse attention of no kind known, to a row of a value, a field without its row, of a duration out of bounds', () => {
    app.ops.queue.attend({ attention: 'blink' as any });
    app.ops.queue.attend({ key: 'a', attention: 'pulse' } as any);
    app.ops.devices.attend({ field: 'name', attention: 'pulse' });
    app.ops.devices.attend({ attention: 'pulse', duration: '2d' });
    app.ops.devices.attend({ attention: 'pulse', duration: 'soon' });
    expect(sent).toEqual([]);
    expect(warned).toEqual([
      'Dashboard widget "ops/queue" refused a write: an attention is one of highlight, pulse, or null to end it',
      'Dashboard widget "ops/queue" refused a write: "ops/queue" has no rows by key to attend',
      'Dashboard widget "ops/devices" refused a write: a field is attended in a row: its key',
      "Dashboard widget \"ops/devices\" refused a write: an attention's duration is 1 s to 24 h ('3s', '2m')",
    ]);
  });
});
