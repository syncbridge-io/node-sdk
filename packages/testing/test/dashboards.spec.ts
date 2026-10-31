import path from 'node:path';
import { expect } from 'expect';
import { createTestEnv } from '../src/index.js';
import { MeterApp } from './_fixtures/demo-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/demo-ext');

describe('A test env reading dashboards', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  it('should show each write at once, by the widget path, under the bounds SyncBridge keeps', async () => {
    const app = await env.start(MeterApp);
    expect(env.dashboard(app, 'meter/count')).toBeUndefined();
    app.read('a', 10);
    app.read('b', 20);
    app.read('c', 30);
    app.read('a', 40);
    expect(env.dashboard(app, 'meter/count')).toMatchObject({
      kind: 'value',
      value: 4,
    });
    /* Three points at most: the first went */
    const rate = env.dashboard(app, 'meter/rate');
    expect(rate?.kind === 'series' && rate.series.in.map(p => p[1])).toEqual([
      20, 30, 40,
    ]);
    /* Two rows at most: a, upserted again, kept its place; b went */
    expect(env.dashboard(app, 'meter/devices')).toEqual({
      kind: 'table',
      rows: [
        { key: 'c', row: { name: 'c' } },
        { key: 'a', row: { name: 'a' } },
      ],
    });
    expect(env.dashboardIssues(app)).toEqual({});
  });

  it('should tell the widgets defined as the app runs, and what is wrong with one, as SyncBridge would', async () => {
    const app = await env.start(MeterApp);
    app.defineDevice('bed-3');
    expect(env.definedWidgets(app, 'meter').map(w => w.id)).toEqual([
      'bed-3',
      'broken',
    ]);
    expect(env.dashboard(app, 'meter/bed-3')).toMatchObject({ value: 1 });
    expect(env.dashboardIssues(app)).toEqual({
      'meter/broken': ['it needs "max"'],
    });
    expect(
      env.logs(app).some(e => String(e.message).includes('meter/broken')),
    ).toBe(true);
  });
});
