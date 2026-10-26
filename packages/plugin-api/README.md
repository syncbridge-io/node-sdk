# @syncbridge/plugin-api

The API SyncBridge plugins are written against: `PluginBase`, `@Plugin`
and the types of `host`, the plugin's bridge to SyncBridge.

A plugin extends SyncBridge itself, in its main process: a log target
today, more as the API grows. It declares this package as a peer; SyncBridge
provides it, and does not load a plugin whose range its version does not
satisfy.

```ts
import { DefineVariable } from '@syncbridge/common';
import { Plugin, PluginBase } from '@syncbridge/plugin-api';

class ElasticSettings {
  @DefineVariable({ label: 'URL', required: true })
  url!: string;
}

@Plugin({
  name: 'elasticsearch-log',
  title: 'Elasticsearch',
  settings: ElasticSettings,
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

## License

MIT
