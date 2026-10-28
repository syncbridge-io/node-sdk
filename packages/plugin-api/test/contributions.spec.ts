import { expect } from 'expect';
import {
  type Contribution,
  CONTRIBUTION_POINTS,
  type PluginBase,
} from '../src/index.js';

describe('UI contributions', () => {
  it('should offer the first catalog: each point its component, its filters', () => {
    expect(Object.keys(CONTRIBUTION_POINTS).sort()).toEqual(
      [
        'logs.record.menu',
        'logs.toolbar.button',
        'plugin.card.button',
        'server.header.menu',
        'shell.sidebar.top',
        'shell.topbar.indicator',
        'worker.header.badge',
        'worker.header.menu',
        'worker.overview.card',
        'workers.row.badge',
        'workers.row.menu',
        'workers.toolbar.button',
      ].sort(),
    );
    expect(CONTRIBUTION_POINTS['shell.sidebar.top']).toEqual({
      component: 'nav-item',
      per: 'page',
      filters: {},
    });
    expect(CONTRIBUTION_POINTS['workers.row.menu'].filters).toEqual({
      app: { from: 'worker.appUri', match: 'glob' },
      status: { from: 'worker.status', match: 'one-of' },
      group: { from: 'worker.group', match: 'one-of' },
    });
    expect(
      Object.keys(CONTRIBUTION_POINTS['logs.record.menu'].filters),
    ).toEqual(['source', 'app', 'level', 'channel']);
  });

  it("should type a contribution by its point: its component's properties, its filters, its run", () => {
    const toggle: Contribution<'worker.header.menu'> = {
      component: 'menu-item',
      properties: {
        variant: 'toggle',
        label: 'Send to Oracle',
        icon: 'database',
      },
      when: { app: ['@abisena/iomt-*'], status: ['started'] },
      requires: 'host.workers.control',
      resolve: ({ worker }) => ({ checked: worker.status === 'started' }),
      run: ({ worker, checked }) => ({ message: `${worker.id}: ${checked}` }),
    };
    const badge: Contribution<'workers.row.badge'> = {
      component: 'badge',
      properties: { text: '12 waiting', tone: 'warn' },
    };
    const nav: Contribution<'shell.sidebar.top'> = {
      component: 'nav-item',
      properties: {
        variant: 'link',
        label: 'Docs',
        icon: 'book',
        href: 'https://x',
      },
    };
    expect([toggle, badge, nav].map(c => c.component)).toEqual([
      'menu-item',
      'badge',
      'nav-item',
    ]);

    const wrong: Contribution<'worker.header.menu'>[] = [
      {
        // @ts-expect-error - the point takes a menu item alone
        component: 'button',
        properties: { variant: 'action', label: 'x' },
      },
      {
        component: 'menu-item',
        properties: { variant: 'action', label: 'x' },
        // @ts-expect-error - not a filter of the point
        when: { level: ['error'] },
      },
    ];
    const sidebar: Contribution<'shell.sidebar.top'>[] = [
      {
        component: 'nav-item',
        // @ts-expect-error - the side menu shows its icon alone, collapsed
        properties: { variant: 'action', label: 'x' },
      },
      {
        component: 'nav-item',
        properties: { variant: 'action', label: 'x', icon: 'send' },
        // @ts-expect-error - the point offers no filters
        when: { app: ['x'] },
      },
    ];
    const noRun: Contribution<'workers.row.badge'> = {
      component: 'badge',
      properties: { text: 'x' },
      // @ts-expect-error - a badge is not triggered
      run: () => undefined,
    };
    expect(wrong.length + sidebar.length + [noRun].length).toBe(5);
  });

  it("should give a plugin its life's hooks, each optional", () => {
    type Hooks = Pick<
      PluginBase,
      'install' | 'uninstall' | 'settingsChanged' | 'checkSettings'
    >;
    const none: Hooks = {};
    const all: Hooks = {
      install: ({ from, to }) => void [from, to],
      uninstall: () => undefined,
      settingsChanged: () => true,
      checkSettings: () => [{ field: 'url', message: 'Not reached' }],
    };
    expect(Object.keys(none)).toEqual([]);
    expect(Object.keys(all)).toHaveLength(4);
  });
});
