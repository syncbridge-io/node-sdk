# @syncbridge/common

What a SyncBridge module is written against. A module is an npm package
of **components** - clients, servers, connections - and **apps**, which
SyncBridge runs as workers, each a Node.js process of its own, made of
components. This package gives you the decorators that describe them, the
base classes they extend, and their lifecycle.

```sh
npm i -D @syncbridge/common
```

SyncBridge provides `@syncbridge/common` to every module it runs, so a
module declares it in `peerDependencies`, never in `dependencies`:

```json
"peerDependencies": { "@syncbridge/common": "^2.0.0" }
```

Start a module with `npx @syncbridge/syncbuild init @vendor/name`
([`@syncbridge/syncbuild`](https://www.npmjs.com/package/@syncbridge/syncbuild)),
and test it with
[`@syncbridge/testing`](https://www.npmjs.com/package/@syncbridge/testing).

## A component

A component is a class that extends `ComponentBase`, decorated with
`@Component`. Its settings - shown in SyncBridge's UI and kept in the
worker's profile - are a variables class, given with `UseVariables`:

```ts
import {
  Component,
  ComponentBase,
  DefineVariable,
  VariableType,
} from '@syncbridge/common';

export class WeatherClientVariables {
  @DefineVariable({ label: 'API address', required: true })
  declare url: string;

  @DefineVariable({ label: 'API key', type: VariableType.Secret })
  declare apiKey?: string;

  @DefineVariable({ label: 'Interval (s)', default: 60, minValue: 5 })
  declare interval: number;
}

@Component({
  displayName: 'Weather client',
  description: 'Reads the weather from a web service',
  tags: ['weather', 'http'],
})
export class WeatherClientComponent extends ComponentBase {
  @Component.UseVariables()
  declare values: WeatherClientVariables;

  protected async _start(abortSignal?: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this.logger?.info(`Reading ${this.values.url}`);
  }

  protected async _stop(): Promise<void> {
    /* Close what _start opened */
    await super._stop();
  }
}
```

An element's URI is `<package>:<className>`. A component's class name is
its class's without `Component` (`@acme/weather:WeatherClient`); an app's
is its class's (`@acme/weather:WeatherStationApp`). Give `className` to
choose another.

## An app

An app extends `AppBase`, decorated with `@App`. It names the components it
uses with `UseComponent`, by URI. SyncBridge creates them with the values the
worker's profile gives, and starts them before the app:

```ts
import { App, AppBase, DefineVariable } from '@syncbridge/common';
import type { WeatherClientComponent } from './weather-client.component.js';

export class WeatherStationVariables {
  @DefineVariable({ label: 'Station name', default: 'Station 1' })
  declare name: string;
}

@App({ displayName: 'Weather station' })
export class WeatherStationApp extends AppBase {
  @App.UseVariables()
  declare values: WeatherStationVariables;

  @App.UseComponent({
    uri: '@acme/weather:WeatherClient',
    required: true,
  })
  declare readonly weather: WeatherClientComponent;

  protected async _start(abortSignal?: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this.logger?.info(`${this.values.name} started`);
  }
}
```

A component may use components too, with `Component.UseComponent`. A URI
can name another module's component, for example
`@syncbridge/net:TcpClient`. Declare that module as a peer as well.

A slot may take one of several kinds that share no interface - a device
reached as a client or as a server - with `oneOf`, each a class or its
URI. Required, one of them must be chosen, and only one can be:

```ts
@App.UseComponent({ oneOf: [HL7Client, HL7Server], required: true })
declare readonly hl7: HL7Client | HL7Server;
```

The app tells which it was given (`this.hl7 instanceof HL7Server`). Where
the kinds do share what the app uses, an abstract base they both extend
serves better: one slot typed by it, no branching.

## Variables

`@DefineVariable` describes a setting. Its type is read from the
property's TypeScript type when not given. Some options:

| Option | Meaning |
| --- | --- |
| `label`, `description` | How it is shown: text, or text by language - `{ en: 'Port', tr: 'Bağlantı noktası' }` - shown in the reader's language in the server's UI and the Marketplace, else in English |
| `type` | `VariableType`: `String`, `Secret` (a password or key, kept encrypted in the profile), `Number`, `BigInt`, `Boolean`, `Enum`, `Nested` |
| `default`, `required` | Its default value, and whether it must be given |
| `enumValues` | The values of an enum |
| `enumSource` | Values SyncBridge fills in from the server it runs on: `EnumSource.SerialPorts`, `EnumSource.NetworkAddresses` |
| `format`, `pattern` | A string's format (`url`, `email`, `date-time`...) or pattern |
| `minValue`, `maxValue` | A number's range |
| `isArray` | A list of values |
| `hotPlug` | A change applies while running, without a restart |
| `index` | Its order in the UI |

A worker's configuration may name a value its server or its workspace
keeps, set once in SyncBridge Console, instead of holding it:
`${{ vars.HBYS_URL }}/api`. SyncBridge puts the value in before the app
starts and checks it as any value, so the app sees a plain value of the
variable's type. `parseValueRefs`, `resolveValueRefs` and
`profileValueRefs` read such references; `$${{` writes `${{` itself.

## Changing what a profile holds

Workers keep the values written for your module's earlier versions. A
new version that renames what they hold declares it, and SyncBridge
carries their profiles across as the version is taken - no code of yours
run:

```ts
@App({ className: 'LisGateway', formerly: 'LisBridge' })   // a class renamed
export class LisGateway extends AppBase {
  @App.UseComponent({ formerly: 'conn' })                  // a slot renamed
  declare link: TcpClient;
}

class Settings {
  @DefineVariable({ formerly: ['address', 'addr'] })     // a setting renamed
  declare host: string;

  @DefineVariable({
    enumValues: ['tcp-client', 'tcp-server'],
    formerlyValues: { tcp: 'tcp-client' },                // a choice renamed
  })
  declare mode: string;

  @DefineVariable({ required: true, default: 30 })         // added: a default
  declare timeout: number;
}
```

`formerly` names every earlier name, not the last alone; a class's is its
own, not its base's, and in its own package. A setting no longer defined
has its value dropped. The profiles written with an earlier version than
the one a worker takes - or with one not told - are carried
(`carryProfile`), the changes told in the worker's changes.

What no declaration tells - a value split in two, a unit changed - a
class carries itself, in a static method marked `@App.MigrateProfile()`
or `@Component.MigrateProfile()`:

```ts
@App.MigrateProfile()
static migrateProfile(m: ProfileMigration) {
  /* { values, from, to, path }: its own values, after what it declares */
  if (semver.lt(m.from ?? '0.0.0', '2.0.0')) {
    const [host, port] = String(m.values.address ?? '').split(':');
    return { ...m.values, host, port: Number(port) || 2575 };
  }
  return m.values;
}
```

It runs where the worker runs - in a process of the worker's, its
packages installed, never in SyncBridge's own - as the worker starts or
its page is opened, once, when its values were written with an earlier
version. What it reads may no longer be defined: such values are kept
for it, and dropped after it. A sealed secret in them is a token: moved
or dropped, never made or changed. Should it fail, or leave values that
are not valid, the worker is held on the version they were written with,
told why. `profileMigrations` and `runProfileMigrations` run them as
SyncBridge does.

`spm publish` compares the version with its package's last published one:
a class, a slot, a setting or a choice gone with nothing declared, or a
setting newly required with no default, refuses a version that is not a
major (a 0.x minor counts as one), and is told in a major.

## Lifecycle

Apps and components are `Runnable`s. Override the protected methods, and
always call `super`:

- `_init()`: once, before the first start.
- `_start(abortSignal)`: start working. The signal aborts when a stop comes
  while starting.
- `_stop()`: stop, and release what `_start` took. Close every timer,
  socket and pool: what is left open is logged as a warning when the
  worker ends.
- `_restart()`: stop and start in place, for example when values change.

`status` is a `ServiceStatus`: `stopped`, `starting`, `started`,
`unhealthy`, `stopping`. Report trouble with
`this.setStatus(ServiceStatus.unhealthy, message)`. An app's status
follows its components'.

## Logging

`this.logger` writes the element's log. A log channel is a log of its own
that the user can turn on, filter and keep apart, such as what a
connection sends and receives:

```ts
import { LogChannel } from '@syncbridge/common';

@LogChannel({ name: 'communication', title: 'Communication', kind: 'transmit' })
declare readonly ioLog: LogChannel;

// later
this.ioLog.info('Sent', { bytes: 42 });
```

## Dashboards

A dashboard is a screen of the worker's page, filled live as it runs: its
numbers, charts and lists, apart from its logs. It is a class extending
`DashboardBase`, its widgets properties decorated with `@Widget.*`; an
app gives itself one with `@UseDashboard`, each such property a tab of
its own:

```ts
import {
  App,
  AppBase,
  DashboardBase,
  DashboardSections,
  UseDashboard,
  Widget,
} from '@syncbridge/common';

@DashboardSections([
  { id: 'queue', title: 'Queue' },
  { id: 'devices', title: 'Devices', dynamic: true },
])
export class OperationsDashboard extends DashboardBase {
  @Widget.Stat({ title: 'Waiting', section: 'queue', unit: 'msg',
    thresholds: { warning: 100, error: 500 } })
  declare readonly queue: Widget.Stat;

  @Widget.Chart({ title: 'Throughput', section: 'queue',
    series: ['received', 'sent'], size: { width: 2 } })
  declare readonly throughput: Widget.Chart;

  @Widget.Table({ title: 'Devices', section: 'devices',
    columns: [{ field: 'name' }, { field: 'seen', format: 'time' }] })
  declare readonly devices: Widget.Table<{ name: string; seen: Date }>;
}

@App({ displayName: 'Gateway' })
export class GatewayApp extends AppBase {
  @UseDashboard({ title: 'Operations' })
  declare readonly operations: OperationsDashboard;

  onMessage(device: string) {
    this.operations.throughput.point('received', 1);
    this.operations.devices.upsert(device, { name: device, seen: new Date() });
  }
}
```

A widget holds its data, of one of four kinds whatever it looks like:

| Kind | Written with | Widgets |
| --- | --- | --- |
| value | `set(value)` | `Stat`, `Status` (`set('warning', 'Slow')`), `Gauge`, `Progress` |
| series | `point(series, value, at?)`, `count(series, amount?)`, `clear(series?)` | `Chart`: `style` line, area, bar or stacked |
| table | `upsert(key, row)`, `remove(key)`, `replace(rows)`, `clear()` | `Table`, `Cards` (a `template` per row), `Bars`, `Pie` |
| feed | `append(row)`, `clear()` | `Feed`: its newest rows |

- A chart keeps its last 200 points per series unless told (`points`,
  at most 1000) and, with `window` (`'15m'`, `'1h'`, seconds), only
  those inside it. A table keeps 500 rows, a feed 200, unless `max` is
  smaller.
- A rate - bytes or messages a second - is counted, not pointed:
  `count('rx', chunk.length)` adds to a sum kept in the worker, and
  SyncBridge writes it as one point each `interval` (default `'1s'`, from
  1 s to 1 h), however many events came. Nothing leaves the worker as it
  counts, and the component needs no timer. An interval with no count is
  written as 0 once the series was counted; what is counted when the
  worker stops is written then. The chart shows `points` x `interval`:
  200 points of 1 s, the last 200 seconds. Use `point` or `count` for a
  series, not both.
- `size`: `width` 1 to 4 columns, `height` `s`, `m` or `l`.
- A write is checked where it is made: one of the wrong kind or over a
  bound is refused in the element's log, once, and never thrown.
  SyncBridge gathers the writes and sends them at most once a second.
- Everything is held in memory by SyncBridge, never kept: a worker
  started again begins empty. What must survive is the app's to keep.
- A user may hide a dashboard or a widget, for everyone.

A widget the class cannot foresee - a device's own - is defined as the
worker runs, into a section marked `dynamic`; `define` returns its writer,
and defining an id again replaces it:

```ts
this.operations
  .define('bed-3', Widget.gauge({ title: 'Bed 3', max: 100, section: 'devices' }))
  .set(72);
this.operations.undefine('bed-3');
```

Define it with the same id each time the worker starts, and a user's
hiding it is kept across restarts.

### Components' widgets

A component declares dashboards the same way, but they are never tabs of
their own: the app decides how many tabs there are and what is on them.
It takes a component's widgets into one of its dashboards with
`include` - all of a dashboard's, or those its ids match (`*` any
characters) - into one of its sections or in the component's own:

```ts
@App({ displayName: 'Lab' })
export class LabApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly io: DeviceIoComponent;

  @UseDashboard({
    title: 'Operations',
    include: [{ component: 'io', dashboard: 'device',
      widgets: ['errors', 'rx*'], section: 'device' }],
  })
  declare readonly operations: OperationsDashboard;

  // A tab of a component's widgets alone
  @UseDashboard({ title: 'Device', include: [{ component: 'io' }] })
  declare readonly device: DashboardBase;
}
```

- A widget no app takes is not written at all: its writes, counts and
  definitions return at once, and nothing of it leaves the worker. A
  component may declare widgets freely; it costs only where they are
  shown.
- A component takes its own components' widgets into its dashboards the
  same way, and the app takes them from there: a widget is shown when
  each owner up to the app takes it.
- An include naming a component or dashboard that is not there is told
  in the app's log.

A plugin may bring widget types of its own; a widget names one by its id,
and is drawn plainer where the plugin is not installed:

```ts
@Widget('acme.battery@1', { data: { kind: 'value' }, properties: { device: 'Bed 3' } })
declare readonly battery: Widget.Value<number>;
```

`@syncbridge/testing` reads what a test's app wrote to its dashboards
(`env.dashboard(app, 'operations/queue')`).

## Permissions

SyncBridge runs each worker as a Linux user of its own, under Node's
permission model. A component or app that needs more than its own data
directory declares it:

```ts
@Component({
  displayName: 'Serial client',
  permissions: [WorkerPermission.SerialPorts, WorkerPermission.NativeCode],
})
```

- `SerialPorts`: the serial devices.
- `NativeCode`: native addons (`.node`), such as `serialport` or `oracledb`.
- `ChildProcesses`: starting other programs.

A subclass has its base's permissions. `spm verify` runs a module under
the permission model and tells you what it failed to declare.

## Examples

The modules SyncBridge ships are open source:
[syncbridge-io/public-modules](https://github.com/syncbridge-io/public-modules).

## License

[MIT](LICENSE)
