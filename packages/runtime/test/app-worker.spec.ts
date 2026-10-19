import {
  App,
  AppBase,
  Component,
  ComponentBase,
  DefineVariable,
  ExtensionRegistry,
  type ILogger,
  ServiceStatus,
  VariableType,
} from '@syncbridge/common';
import { expect } from 'expect';
import { AppWorker, type ComponentStatusInfo } from '../src/index.js';

@Component({ className: 'PwPart' })
class PwPart extends ComponentBase {}

class PwVariables {
  @DefineVariable({ type: VariableType.Number, default: 1, hotPlug: true })
  declare level: number;
}

@App({ className: 'PwApp' })
class PwApp extends AppBase {
  @App.UseVariables(PwVariables)
  declare values: PwVariables;

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
});
