# @syncbridge/plugin-api

The API SyncBridge plugins are written against: `PluginBase`, `@Plugin`
and the types of `host`, the plugin's bridge to SyncBridge.

A plugin extends SyncBridge itself: a log target, a native library the
workers use, more as the API grows. SyncBridge runs each plugin in a
process of its own, as a user of its own, held to what it declares and the
server's admins approve. It declares this package as a peer; SyncBridge
provides it, and does not load a plugin whose range its version does not
satisfy.

```ts
import { DefineVariable } from '@syncbridge/common';
import { Plugin, PluginBase, PluginPermission } from '@syncbridge/plugin-api';

class ElasticSettings {
  @DefineVariable({ label: 'URL', required: true })
  url!: string;
}

@Plugin({
  name: 'elasticsearch-log',
  title: 'Elasticsearch',
  settings: ElasticSettings,
  permissions: [PluginPermission.LogRecords, PluginPermission.Network],
  hosts: ['es.example.com'],
})
export class ElasticsearchLogPlugin extends PluginBase<ElasticSettings> {
  async activate() {
    this.host.logs.registerTarget({
      name: 'elasticsearch',
      create: () => new ElasticTarget(this.settings),
    });
  }
}
```

A plugin is off until the config turns it on, with its settings:

```yaml
plugins:
  elasticsearch-log:
    enabled: true
    url: https://es:9200
logs:
  targets:
    elasticsearch:
      enabled: true
```

or in the environment: `SB_PLUGINS_ELASTICSEARCH_LOG_ENABLED=true`,
`SB_PLUGINS_ELASTICSEARCH_LOG_URL=...`.

- `this.settings`, `this.logger`, `this.dataDirectory`, `this.name`: the
  plugin's own.
- `this.host.engine`: SyncBridge's version and the API's.
- `this.host.logs.registerTarget(definition)`: a log target.
- `this.host.events.on(event, listener)`: the engine's and the workers'
  lifecycle, to observe only.
- `this.host.workers`: the workers and their status, read;
  `addEnvironment({...})` adds to the environment every worker starts with
  - a native library's directory, say (2.1).
- `this.host.status.set({ state, message, progress })`: how it is doing,
  told on its card in Settings → Plugins (2.1).
- `this.host.ui.ask(question)`: a question to the server's admins - its
  choices, or a form - resolved with the answer, kept with who gave it and
  when; asked once (2.1).
- `this.host.ui.registerAction(action)`: a button on its card, its input
  asked in a form first, run by an admin (2.1).

Nothing of a plugin runs in the browser: it declares what it asks and
offers, and SyncBridge draws it. A plugin using what 2.1 adds asks for
`@syncbridge/plugin-api` `^2.1.0`.

```ts
const { choice } = await this.host.ui.ask({
  id: 'license',
  title: "The vendor's license",
  link: { label: 'Read it', url: 'https://example.com/license' },
  choices: [
    { value: 'accept', label: 'Accept', primary: true },
    { value: 'decline', label: 'Decline' },
  ],
});
if (choice === 'accept') void this.install();
```

What a plugin registers is undone when it is deactivated, or when its
`activate` fails; a plugin that fails is turned off and the engine goes on.

## Permissions (2.2)

A plugin reaches its own data directory, its settings, its status, its
questions and its actions. Anything more it declares in `@Plugin`, and the
server's admins are shown it and approve it before the plugin runs - again
when an update declares more:

| `PluginPermission` | What it gives |
| --- | --- |
| `WorkerEnvironment` | `host.workers.addEnvironment` |
| `LogRecords` | `host.logs.registerTarget`: every log record, the workers' messages among them |
| `Workers` | `host.workers.list/get` and the workers' events |
| `Network` | the network; the hosts it reaches named in `hosts` |
| `ChildProcesses` | starting other programs |
| `NativeCode` | native addons (.node) |

A host API called undeclared is refused, telling the permission it needs.
Starting programs and native addons are held by Node's permission model;
`spm verify` loads a plugin under it, telling what it failed to declare.
A directory given to the workers by `addEnvironment` is one under
`<dataDirectory>/shared`, which the workers may read.

## Lifecycle hooks (2.3)

Beside `activate` and `deactivate`, a plugin may have:

- `install({ from, to })`: once for each version, before it is first
  activated - `from` the version installed before it, none the first
  time. Its data directory is copied first (the last three kept): a failed
  install puts it back, and so does going back to an older version.
- `uninstall()`: as its package is removed, to clean up what it made
  outside its data directory; the directory is removed after it.
- `settingsChanged(next, previous)`: its settings changed while it runs;
  `true` takes them as they are, otherwise SyncBridge restarts it alone.
- `checkSettings(candidate)`: before they are saved; the problems it
  returns (`{ field, message }`) are shown and nothing is saved.

```ts
async install({ from }: PluginBase.Install) {
  if (from && semver.lt(from, '2.0.0')) await this.moveQueue();
}

settingsChanged(next: ElasticSettings, previous: ElasticSettings) {
  return next.url === previous.url; // a new URL: restarted
}
```

## UI contributions (2.3)

A plugin adds to exact places in the UI, each a point by name -
`<page>.<area>.<place>` - with the component it draws there. It gives
the component's properties and SyncBridge draws it; no code, HTML or SVG
of the plugin reaches the browser. Icons are named from the UI's icon
set ([lucide](https://lucide.dev/icons)): `database`, `send`.

```ts
this.host.ui.contribute('worker.header.menu', {
  id: 'send',
  component: 'menu-item',
  properties: { variant: 'toggle', label: 'Send to Oracle', icon: 'database' },
  when: { app: ['@acme/iomt:*'], status: ['started'] },
  requires: 'host.workers.control',
  resolve: ({ worker }) => ({ checked: this.sending.has(worker.id) }),
  run: ({ worker, checked }) => {
    this.toggle(worker.id, checked);
    return { message: `${worker.name}: ${checked ? 'sending' : 'stopped'}` };
  },
});
```

| Point | Component | Where |
| --- | --- | --- |
| `shell.sidebar.top` | `nav-item` | the side menu, under its own items |
| `shell.topbar.indicator` | `badge` | the top bar |
| `workers.toolbar.button` | `button` | the Workers list's toolbar |
| `workers.row.menu` | `menu-item` | a worker's row menu |
| `workers.row.badge` | `badge` | beside a worker's name in the list |
| `worker.header.menu` | `menu-item` | a worker page's menu |
| `worker.header.badge` | `badge` | a worker page's title |
| `worker.overview.card` | `card` | a worker's Overview |
| `logs.toolbar.button` | `button` | a log's toolbar |
| `logs.record.menu` | `menu-item` | a log record's menu |
| `server.header.menu` | `menu-item` | the Server logs page's menu |
| `plugin.card.button` | `button` | its own card in Settings → Plugins |

- `when`: where it is shown, by the filters its point offers (a worker's
  `app` as a glob, its `status` and `group`; a log's `source`, `app`, a
  record's `level` and `channel`). SyncBridge checks it again before a run.
- `requires`: the permission a user needs to run it; the server's
  settings permission when not given. Points telling of the workers need
  `PluginPermission.Workers`, of the logs `LogRecords`.
- `resolve(context)`: its properties where it is drawn - checked, hidden,
  a count - kept until `this.host.ui.refresh(point, id)` says they changed.
- `run(context, { checked, input, item })`: the user chose it; the
  context is built by SyncBridge, not taken from the browser. Its
  `message` and `link` are shown.

`registerAction` stays, as a button on its own card.

## Dashboard widget types (2.4)

Workers' dashboards (`@UseDashboard` in `@syncbridge/common`) draw
widgets of types. A plugin adds one as a template: a tree of the UI's
primitives - `text`, `number`, `badge`, `light`, `progress`, `sparkline`,
`chart`, `table`, `stack`, `grid`, `divider` - each node's `value` bound
to the widget's properties or data. Like contributions, nothing of the
plugin's code reaches the browser.

```ts
// A plugin named "acme": its id acme.battery@1
this.host.ui.registerWidgetType({
  name: 'battery',
  title: 'Battery',
  data: ['value'],
  properties: { device: { type: 'string', required: true } },
  template: {
    type: 'stack',
    children: [
      { type: 'text', value: 'prop.device' },
      { type: 'progress', value: 'data.value' },
    ],
  },
});
```

An app uses it by its id:

```ts
@Widget('acme.battery@1', { data: { kind: 'value' }, properties: { device: 'Bed 3' } })
declare readonly battery: Widget.Value<number>;
```

- `data`: the kinds its data may be. A value or a series is drawn once,
  bound as `data.value` or `data.<series>` (a series' points, for
  `sparkline` and `chart`); a table or a feed for each row, as
  `row.<field>`, a feed's newest first.
- `properties`: what a widget of it is given (`string`, `number`,
  `boolean`, `object`, `array`; a string's `values`), bound as
  `prop.<name>`, and checked in each widget using it.
- `version`: 1 unless given. Raise it when a change would break the
  widgets using it; both versions may be registered side by side.

A wrong type - a binding its data cannot have, a primitive not known,
more than 50 nodes or 6 levels - throws as it is registered. One given
again replaces it; it returns what removes it, and goes when the plugin is
deactivated. A widget whose type is not registered is drawn as a
placeholder with its data as it is, so an app keeps working without the
plugin.

## License

MIT
