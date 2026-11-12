import {
  App,
  AppBase,
  Component,
  ComponentBase,
  DashboardBase,
  type DashboardOp,
  DefineVariable,
  ExtensionRegistry,
  type ILogger,
  ServiceStatus,
  UseDashboard,
  VariableType,
  Widget,
} from '@syncbridge/common';
import { expect } from 'expect';
import {
  AppWorker,
  type ComponentStatusInfo,
  type ElementLinesInfo,
} from '../src/index.js';

@Component({ className: 'PwPart' })
class PwPart extends ComponentBase {
  tell(glance?: string, activity?: string) {
    this.setGlance(glance);
    this.setActivity(activity, 'warning');
  }
}

class PwVariables {
  @DefineVariable({ type: VariableType.Number, default: 1, hotPlug: true })
  declare level: number;
}

class PwDashboard extends DashboardBase {
  @Widget.Chart({ title: 'Traffic', series: ['rx'], interval: 60 })
  declare readonly traffic: Widget.Chart;
}

@App({ className: 'PwApp' })
class PwApp extends AppBase {
  @App.UseVariables(PwVariables)
  declare values: PwVariables;

  @UseDashboard({ title: 'PW' })
  declare readonly dash: PwDashboard;

  @App.UseComponent({ required: true })
  declare readonly part: PwPart;
}

@App({ className: 'PwOtherApp' })
class PwOtherApp extends AppBase {}

describe('AppWorker', () => {
  const registry = new ExtensionRegistry();
  let release: () => void;
  /* Silent: the app logs its configuration changes */
  const logger: ILogger = new Proxy({} as any, {
    get: (_t, key) => (key === 'level' ? 'info' : () => logger),
  });
  let worker: AppWorker;

  const profile = (values: Record<string, any> = {}, uri?: string) =>
    ({
      id: 'pw',
      displayName: 'PW',
      appUri: uri || (PwApp as any).uri,
      values,
      components: { part: { uri: (PwPart as any).uri } },
    }) as any;

  before(async () => {
    release = ExtensionRegistry.use(registry);
    await registry.registerClass(PwPart);
    await registry.registerClass(PwApp);
    await registry.registerClass(PwOtherApp);
  });

  after(() => release());

  beforeEach(() => {
    worker = new AppWorker({ dataDirectory: '' });
  });

  afterEach(() => worker.stop());

  it('should create the app from a profile and report its status', async () => {
    const statuses: string[] = [];
    const components: ComponentStatusInfo[] = [];
    worker.on('status-change', s => statuses.push(s));
    worker.on('component-status-change', (_c, info) => components.push(info));

    const r = await worker.updateProfile(profile({ level: 3 }), logger);
    expect(r.issues || []).toEqual([]);
    expect(worker.app).toBeInstanceOf(PwApp);
    expect(worker.app!.values.level).toBe(3);

    await worker.start();
    await new Promise<void>(resolve => {
      if (worker.app!.status === ServiceStatus.started) resolve();
      else worker.on('status-change', s => s === 'started' && resolve());
    });
    expect(statuses).toContain('started');
    expect(components).toContainEqual(
      expect.objectContaining({
        componentName: 'part',
        path: expect.stringContaining('part'),
        status: 'started',
      }),
    );
  });

  it("should tell a component's lines: at once, then at most once a second", async () => {
    const told: ElementLinesInfo[] = [];
    worker.on('lines-change', info => told.push(info));
    await worker.updateProfile(profile(), logger);
    await worker.start();
    await new Promise(r => setTimeout(r, 50));
    const part = (worker.app as PwApp).part as PwPart;
    /* The glance told at once; the activity, set in the same second, waits */
    part.tell('lis.local:2575', 'Queue 1');
    expect(told).toEqual([
      { path: part.path, glance: { text: 'lis.local:2575' } },
    ]);
    /* Within the second: the last of them, once it is over */
    part.tell('lis.local:2575', 'Queue 2');
    part.tell('lis.local:2575', 'Queue 3');
    await new Promise(r => setTimeout(r, 1100));
    expect(told).toHaveLength(2);
    expect(told[1].activity).toEqual({ text: 'Queue 3', tone: 'warning' });
  }).slow(2000);

  it('should tell a change waiting as it stops', async () => {
    const told: ElementLinesInfo[] = [];
    worker.on('lines-change', info => told.push(info));
    await worker.updateProfile(profile(), logger);
    await worker.start();
    await new Promise(r => setTimeout(r, 50));
    const part = (worker.app as PwApp).part as PwPart;
    part.tell('a');
    part.tell('b');
    await worker.stop();
    expect(told.map(t => t.glance?.text)).toEqual(['a', 'b']);
  });

  it('should update the app it created', async () => {
    await worker.updateProfile(profile({ level: 3 }), logger);
    const created = worker.app;
    const r = await worker.updateProfile(profile({ level: 5 }), logger);
    expect(r.issues || []).toEqual([]);
    expect(worker.app).toBe(created);
    expect(worker.app!.values.level).toBe(5);
  });

  it('should refuse a profile of another app class', async () => {
    await worker.updateProfile(profile(), logger);
    await expect(
      worker.updateProfile(profile({}, (PwOtherApp as any).uri), logger),
    ).rejects.toThrow(/App class can not be changed/);
  });

  it('should return the issues of an invalid profile', async () => {
    const r = await worker.updateProfile(profile({ level: 'high' }), logger);
    expect(r.issues?.[0]?.message).toBeDefined();
    expect(worker.app).toBeUndefined();
  });

  it("should keep a chart's counts in the worker, sending what was counted as it stops", async () => {
    const sent: DashboardOp[][] = [];
    worker = new AppWorker({
      dataDirectory: '',
      dashboardSink: ops => sent.push(ops),
    });
    await worker.updateProfile(profile(), logger);
    await worker.start();
    const app = worker.app as PwApp;
    for (let i = 0; i < 500; i++) app.dash.traffic.count('rx', 2);
    await new Promise(r => setTimeout(r, 1200));
    /* Its interval a minute: nothing sent yet */
    expect(sent.flat().filter(op => op.op === 'point')).toEqual([]);
    await worker.stop();
    expect(sent.flat().filter(op => op.op === 'point')).toEqual([
      expect.objectContaining({
        widget: 'dash/traffic',
        series: 'rx',
        value: 1000,
      }),
    ]);
  });
});
