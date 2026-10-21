# Migrating a package to apps and the new manifest

How to bring an extension package written for `@syncbridge/common` 1.1.x,
`@syncbridge/syncbuild` 1.0.x and `@syncbridge/testing` 1.1.x to the
current SyncBridge. The changes:

- **Processors are apps.** Every `processor` name in the API, the
  profiles and the manifest is `app` now.
- **The manifest has a file of its own.** A built package carries
  `syncbridge-manifest.json`, with each app's and component's definition
  and the module its class is in; `metadata/` is gone.
- **Traffic goes to log channels.** `TransmitLogger` and the
  `communicationLogs` settings are gone: components write what they send
  and receive to their `communication` channel, kept in SyncBridge's log
  store and shown in its UI. The channel is off until a profile turns it
  on, and the profile picks which events it writes (connections, data,
  a component's own).

Nothing of the old form is still accepted: a package built with syncbuild
1.0.x is refused ("has no syncbridge-manifest.json"), a profile with
`processorUri` is not a profile. Every package is changed, rebuilt and
uploaded again, and the profiles on a SyncBridge are made again.

Work through the steps in order; each ends with what to check. The
[checklist](#checklist) at the end finds what is left.

## 1. SyncBridge dependencies

Raise every `@syncbridge/*` range - in `peerDependencies` and
`devDependencies` alike - to the release that brings these changes:

| Package                                        | Range               |
| ---------------------------------------------- | ------------------- |
| `@syncbridge/common`                           | `^<common release>` |
| `@syncbridge/syncbuild`, `@syncbridge/testing` | `^<release>`        |
| `@syncbridge/builtins`, `hl7`, `sqb`, …        | `^2.0.0`            |

> The versions are set when SyncBridge is released; take them from its
> release notes. A range left at 1.1.x / 1.0.x still installs the old
> packages.

The SDK (`common`, `runtime`, `syncbuild`, `testing`, `plugin-api`) stays
on npm. The modules SyncBridge ships with every server - `builtins`,
`hl7`, `kafka`, `redis`, `serialport`, `sqb`, `ngrok`, `pinggy` - are no
longer on npm: they come from the SyncBridge registry. Add each one a
package uses with `spm add` in place of its npm range:

```bash
npx spm add @syncbridge/builtins@^2.0.0
```

It stays in `peerDependencies` and is imported under its own name, as
before. `spm add` writes the devDependency
`"@syncbridge/builtins": "npm:@sbext/syncbridge__builtins@^2.0.0"` - the
registry's npm mirror's copy, under that name - and sends `@sbext` to the
mirror in the workspace's `.npmrc` (`@sbext:registry=https://npm.syncbridge.io/`).

Then `npm install`.

## 2. Processor → app in the code

The renames, all from `@syncbridge/common`; there are no aliases:

| Before                                                          | After                                             |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `ProcessorBase`, `ProcessorBase.Events`, `.InitArgs`            | `AppBase`, `AppBase.Events`, `.InitArgs`    |
| `@Processor(options)`                                           | `@App(options)`                                |
| `@Processor.UseVariables()`                                     | `@App.UseVariables()`                          |
| `@Processor.UseComponent(...)`                                  | `@App.UseComponent(...)`                       |
| `@Processor.OnCreateProfile()`, `.OnUpdateProfile()`            | `@App.OnCreateProfile()`, `.OnUpdateProfile()` |
| `ProcessorFactory.createProcessor(...)` → `{ processor }`       | `AppFactory.createApp(...)` → `{ app }`  |
| `ProcessorFactory.updateProcessor(...)`                         | `AppFactory.updateApp(...)`                 |
| `ProcessorMetadata`, `isProcessorBase()`                        | `AppMetadata`, `isAppBase()`                |
| `ExtensionRegistry.processors`, `findProcessor`, `getProcessor` | `.apps`, `findApp`, `getApp`             |
| `this.processor` in a component                                 | `this.app`                                     |
| `{ processor: … }` creating a component by hand (tests)         | `{ app: … }`                                   |

**Class names and URIs.** An app's URI is `<package>:<class name>`, and
the class name is kept whole: `FooProcessor` is `@vendor/pkg:FooProcessor`,
`FooApp` is `@vendor/pkg:FooApp`. Rename the classes too
(`Urit500CProcessor` → `Urit500CApp`), so the names say what they are;
the profiles are made again anyway (step 3). To keep a URI, keep the class
name or give it: `@App({ className: 'FooProcessor' })`.

Rename what carries the old word as well:

- files: `*.processor.ts` → `*.app.ts`, `*.processor.spec.ts` →
  `*.app.spec.ts`, and the imports of them;
- namespaces and their uses: `export namespace FooProcessor { Variables }`,
  `extends FooProcessor.Variables`;
- descriptions and docs: `description: 'Processor for …'`, `"description":
"IoMT processor for …"` in `package.json`, comments, READMEs;
- test names and variables: `describe('FooProcessor')`, `processorClass`,
  `const processor = …` (not required, but it keeps the code readable).

Check: `npx tsc --noEmit` passes, and

```bash
grep -rniE "processor" --include='*.ts' src test
```

finds nothing you did not decide to keep.

## 3. Profiles

Every profile names its app by `appUri` (and `appVersion`):

```yaml
# before
processorUri: '@abisena/ge-b125:GeB125Processor'
# after
appUri: '@abisena/ge-b125:GeB125App'
```

- The profiles `spm verify` uses (`test/verify/*.yml`): rename the field,
  the URI when the class was renamed, and the file
  (`GeB125Processor.yml` → `GeB125App.yml`) with its `id`.
- Profiles on a running SyncBridge are not migrated: a profile without
  `appUri` is refused when the engine loads it. Make them again from the
  UI, or edit the files in `config/profiles/` the same way, after the new
  packages are installed.
- Remove `communicationLogs` and `communicationLogs_enabled` from the
  components' values (step 5): they are no longer settings.

## 4. The manifest

The manifest says what SyncBridge needs to know of the package. Its author
writes the registry dependencies (and the registry name, when it differs
from the npm name), in **one** of two places:

```jsonc
// syncbridge-manifest.json at the package's root - recommended
{ "dependencies": { "@abisena/iomt-common": "^0.15.0" } }
```

```jsonc
// or package.json
{ "syncbridge": { "dependencies": { "@abisena/iomt-common": "^0.15.0" } } }
```

Never both: syncbuild refuses the package. The file keeps tool-written
content out of `package.json`, which every release rewrites.

- Moving it: cut the `syncbridge` object out of `package.json` into
  `syncbridge-manifest.json`. An empty manifest is `{}`.
- Remove hand-written `processors` / `components` lists, if any: syncbuild
  finds the classes. Unknown fields are passed over with a warning.
- `spm add @vendor/name@<range>` writes the dependency where the manifest
  is (a new `syncbridge-manifest.json` when there is none), with its
  `@sbext` devDependency and tsconfig `paths` entry.

The built package always has `syncbridge-manifest.json`, never a
`syncbridge` field in its `package.json`, and no `metadata/` directory.
Each app, component and plugin is listed with its definition, the name
it is exported under (`exportName`) and the module its class is declared
in (`entryPoint`), so a worker loads only the code it runs:

```json
{
  "dependencies": { "@abisena/iomt-common": "^0.15.0" },
  "apps": [
    {
      "exportName": "GeB125App",
      "entryPoint": "./ge-b125.app.js",
      "classType": "app",
      "className": "GeB125App",
      "displayName": "GE B125"
    }
  ]
}
```

For that the class must be exported from the entry point (`src/index.ts`),
as before; `export *` from its own module is enough.

## 5. Communication logs

`TransmitLogger` (`@syncbridge/builtins`) is removed, and with it the
`communicationLogs` / `communicationLogs_enabled` variables of the IO
components and the `comm-logs/` files in the data directory.

**Components log by themselves, when turned on.** The IO components -
TCP, UDP, serial, the tunnels, HTTP, HL7 client and server - and Kafka and
Redis write their traffic to their `communication` channel; SQB writes the
SQL it runs to its `queries` channel. In the worker's log, shown in the
UI's log view. These channels are **off by default**: traffic grows the
logs fast, and the devices on the other side often keep it themselves. A
worker's profile turns one on for a component, and may pick which of its
events are written - from the channel's settings in the Logs tab, or in
the profile:

```yaml
components:
  deviceIo:
    uri: '@syncbridge/net:TcpClient'
    settings:
      logs:
        channels:
          communication:
            enabled: true
            events: [connect, disconnect] # the connections, not the data
            retentionDays: 30 # default: 14
```

Without `events`, every event of the channel is written. A channel or an
event the component does not have is warned of in the worker's console
when the profile is read; the worker still runs. The events:

| Component | Channel | Events |
|---|---|---|
| TCP / UDP client, UDP listener, serial, ngrok, pinggy, TCP server, HL7 client and server | `communication` | `connect`, `disconnect`, `read`, `write` |
| HTTP server | `communication` | `request`, `response` (method, URL, status and time; not the bodies) |
| Kafka consumer, producer | `communication` | `connect`, `disconnect`, `read`, `write` (a message's value, its topic, partition and offset) |
| Redis | `communication` | `connect`, `disconnect`, `reconnecting` |
| SQB client | `queries` | `execute` (the SQL and its parameters), `error` |

`read` and `write` are the data received and sent: a record with
`direction: 'in'` or `'out'` is of that event without saying so.

A component of your own that extends the IO bases needs nothing for this,
as long as its `_init` calls `await super._init()` and it emits `data` /
`transmit` for the data and `connect` / `disconnect` for its connection.
A client tells what it connects to by `peerAddress` (`host:port`, a
serial port's path), written with its connects and disconnects:

```ts
get peerAddress() {
  return `${this.values.host}:${this.values.port}`;
}
```
The ngrok and pinggy tunnels now emit `transmit` for what they send, as
every IO component does; their `write` event is gone.

**Give your own events where they help.** A channel names the events its
records can be of, and a profile picks some of them; a component that
knows more than `read` and `write` tells it, so a site can keep what
matters and leave the bulk out. Places worth an event:

- a device protocol's own steps: a handshake, an ACK / NAK, a retry, a
  session opened or closed (`ack`, `nak`, `retry`, `session`);
- a message recognised in the data: a result, an order, a query
  (`result`, `order`, `query`), next to the raw `read` / `write`;
- what went wrong on the line: a checksum or framing error (`error`).

Name them in the channel's definition, and give each record its `event`:

```ts
@LogChannel({
  name: 'communication',
  kind: 'transmit',
  enabled: false,
  events: ['connect', 'disconnect', 'read', 'write', 'ack', 'nak'],
})
declare readonly communicationLog: LogChannel;

// on an acknowledgement received
this.communicationLog?.write({ direction: 'in', event: 'ack', data: frame });
```

A subclass that declares a channel of the same name replaces the base's,
events and all: the HTTP server does so for its `request` / `response`.

**Traffic you logged yourself** - a component that created a
`TransmitLogger`, or an app that recorded a conversation - is written to
a channel of its own instead. Declare it, and write to it:

```ts
import { peerOf } from '@syncbridge/builtins';
import { Component, ComponentBase, LogChannel } from '@syncbridge/common';

@Component({ abstract: true })
export class HisBaseComponent extends ComponentBase {
  /** What is sent to and received from the HIS */
  @LogChannel({
    name: 'communication',
    title: 'HIS',
    kind: 'transmit',
    enabled: false,
    events: ['read', 'write'],
  })
  declare readonly communicationLog: LogChannel;

  protected async _init() {
    await super._init();
    this.on('transmit', (data, peer) =>
      this.communicationLog?.write({
        direction: 'out',
        data,
        details: peerOf(peer),
      }),
    );
    this.on('data', (data, peer) =>
      this.communicationLog?.write({
        direction: 'in',
        data,
        details: peerOf(peer),
      }),
    );
  }
}
```

- `declare readonly` is required: a class field would overwrite the channel
  SyncBridge gives the element.
- Write with `?.`: an element made outside SyncBridge (by hand in a test)
  has no channels.
- `details` is a short note shown and searched with the record, here the
  other side (`peerOf` writes a socket address as `address:port`).
- `kind: 'text'` (the default) makes a channel of messages with levels
  (`this.audit?.info('Order sent', { orderId })`), for a log of its own
  besides the console.
- Options: `name` (default: the property's), `title`, `description`,
  `kind`, `level`, `retentionDays`, `enabled` (default: true; a channel of
  traffic is better off by default), `events`.

Remove the `TransmitLogger` imports, the `communicationLogs` fields of the
variable classes, and the code that created and configured the logger.

## 6. Tests

**Test data.** `readTransmitLog` and the transmit log files are replaced by
fixture files, read with `FixtureReader` (see the
[@syncbridge/testing README](../testing/README.md#fixtures)). A fixture
file holds any number of pieces of data - recorded at a site, copied from
a manual or written by hand - set apart by a boundary as in multipart
MIME, each with headers such as `name`, `encoding` (`text`, `hex`,
`base64`), `eol: cr` and `escapes: true`.

Convert each old file once with
[`migration/convert-transmit-log.mjs`](migration/convert-transmit-log.mjs)
(Node.js, no dependencies):

```bash
node convert-transmit-log.mjs test/_data/ge-b125.data   # writes test/_data/ge-b125.fixtures
```

Every block becomes a fixture, in the same order and with the same bytes,
its direction (`in` for R, `out` for T, `info` for I, W, E), time and
peer as headers. Text is written as it is (lines ending with CR one per
line, `eol: cr`), text with control characters by their names (`escapes:
true`), binary data as hex. Remove the old file once converted, and give
the fixtures the tests use a `name:` header.

```ts
// before
import { readTransmitLog } from '@syncbridge/testing';
const [recorded] = readTransmitLog(path.join(dir, '_data/ge-b125.data'));
send(recorded.data.toString());

// after: the file name is relative to the test file
import { FixtureReader } from '@syncbridge/testing';
const fixtures = new FixtureReader('_data/ge-b125.fixtures');
send(fixtures.text('oru-r01')); // or fixtures.at(0), by position
```

`env.replay` is removed: a test sends the data it needs when the scenario
needs it, and a device that answers is played by the test's own simulator
on `env.serve` / `env.connect`.

**Asserting on traffic.** What a component wrote to its channels is
`env.channelLogs(app, '<component path>/communication')`:

```ts
const traffic = env.channelLogs(app, 'deviceIo/communication');
expect(traffic.map(e => e.direction)).toEqual(['out', 'in']);
```

**The test environment** keeps its API (`createTestEnv`, `start`, `create`,
`mock`, `connect`, `logs`, `serve`, `reset`, `dispose`); it now takes
app classes, and says "not an app" for a class without `@App`.

**`.mocharc`**: `SB_LOG_FILE`, `SB_LOG_CONSOLE` and `SB_LOG_DB` were never
read by tests; remove them. (The engine's own log settings are now
`SB_LOG_STORE*` and `SB_LOG_TARGETS_*`.)

Check: `npm test` passes.

## 7. Build, verify, pack

```bash
spm check  --tsconfig tsconfig-build.json
spm build  --tsconfig tsconfig-build.json -o build
spm verify --tsconfig tsconfig-build.json --profile test/verify
spm pack   --tsconfig tsconfig-build.json -o dist
```

- `build/syncbridge-manifest.json` lists every app and component, each
  with its own `entryPoint`; `build/package.json` has no `syncbridge`
  field; there is no `build/metadata/`.
- `spm verify` installs the package as SyncBridge does and creates each
  app from the profiles in `test/verify/`.
- Upload the new zip. Packages it depends on (`@abisena/iomt-common`) are
  uploaded first, in their new versions.
- `spm init` makes new packages in this form; its `--processor` option is
  `--app` now.

## 8. Optional: plugins

A package can now also extend SyncBridge itself, in its main process: a
log target sending the logs to a service, for example. See
[`@syncbridge/plugin-api`](../plugin-api/README.md). Nothing in this
migration needs one.

## Checklist

Run in the package (or the repository of packages); each should print
nothing:

```bash
# processor names left in code, profiles, manifests
grep -rnE "Processor(Base|Factory|Metadata)|@Processor|processorUri|processorVersion|this\.processor\b|isProcessorBase" \
  --include='*.ts' --include='*.yml' --include='*.yaml' --include='*.json' . | grep -v node_modules
# removed APIs
grep -rnE "TransmitLogger|communicationLogs|readTransmitLog|env\.replay|on\('write'" \
  --include='*.ts' --include='*.yml' --include='*.yaml' . | grep -v node_modules
# a manifest in both places
for d in $(dirname $(find . -name syncbridge-manifest.json -not -path '*/node_modules/*')); do
  grep -l '"syncbridge"' "$d/package.json"
done
# old SyncBridge ranges
grep -rnE '"@syncbridge/[a-z-]+": "[^"]*1\.[01]\.' --include=package.json . | grep -v node_modules
```

Then `npm test`, and `spm verify` for every package.
