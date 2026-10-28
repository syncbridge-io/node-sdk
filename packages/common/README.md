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
