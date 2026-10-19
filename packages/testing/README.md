# @syncbridge/testing

Test SyncBridge apps and components without running SyncBridge. The
package under test and the extension packages it depends on are registered
in a registry of their own, and apps are created from profiles the
way a SyncBridge worker creates them: the same metadata, validation and
defaults.

Works with any test runner (mocha, vitest, node:test).

```sh
npm i -D @syncbridge/testing
```

## An app test

```ts
import { createTestEnv } from '@syncbridge/testing';

describe('MyApp', () => {
  const env = createTestEnv(); // the package this test belongs to
  const his = env.mock(HisComponent, {
    getPatient: async () => ({ id: 'pid-1' }),
  });

  afterEach(() => env.reset()); // stops apps, clears recorded calls
  after(() => env.dispose()); // gives the global registry back

  it('should send the result', async () => {
    const app = await env.start(MyApp, {
      values: { threshold: 5 },
      components: { his, server: { values: { port: 17001 } } },
    });
    // ...drive the app...
    const [bundle] = await his.waitForCall('processBundle');
    expect(env.logs(app).errors).toEqual([]);
  });
});
```

## createTestEnv(options?)

Finds the package from the file that calls it, so tests run the same from
the package or from a monorepo's root. `from` names another file or
directory; `echoLogs` (or `SB_TEST_LOGS=1`) prints what apps log.

Its extension dependencies (packages with a `syncbridge` field in their
manifest, or depending on `@syncbridge/common`) are registered first. A
package of the workspace is loaded from `src/index.ts`, an installed one
from what it publishes.

## env.create / env.start(App, options)

Builds the profile SyncBridge would store and creates the app;
`start` also starts it and fails when it does not reach `started`; an
app that is unhealthy while its components connect gets
`startTimeout` (default 5000ms) to get there.

- `values`: the app's values. The app's `@OnCreateProfile`
  hook fills in its defaults first, as SyncBridge does for a new worker.
- `components`: by the name the app gives them.
  - `true`: the declared class, with default values
  - a component class, or a mock
  - `{ use?, values?, components?, disabled? }`
  - `false`: left out

  A required component that is not given gets its declared class; an
  optional one is left out. A component the app declares only as an
  interface needs a class or a mock.

Invalid values fail with the message SyncBridge would give.

The options are typed from the app class: `values` from its
`values` type, `components` from its public component properties, each
with its own `values` and `components`. A wrong variable or component name,
or a value of the wrong type, is a compile error. With `use`, which may be a
subclass with variables of its own, a component's `values` are not typed.

## env.mock(Component, impl?, { lifecycle? })

A subclass of `Component` standing in for it: the methods in `impl` are
replaced, and calls to its public and protected methods are recorded.
Replacing a protected method lets the component's own flow run and stops
it at the step that reaches outside:

```ts
const his = env.mock(TestIomtHostComponent, {
  writeDiagnosticReport: async () => true, // protected: processBundle runs for real
});
const [args, bundle] = await his.waitForCall('writeDiagnosticReport');
```

Public methods are typed from the class; protected ones are taken by name,
and a name the class does not have is refused when the mock is made.

- `mock.calls('method')`: the arguments of each call
- `mock.waitForCall('method', { timeout })`: the next (or first) call
- `mock.instance`: the instance the app created
- `lifecycle: false`: its init, start and stop do nothing; for a
  connection the test does not have

## The network

By default a test environment stands ephemeral ports of 127.0.0.1 in for
the ports its apps use: a component listening on 17001 really
listens elsewhere, and its connections to port 17001, from any host, reach
it. Tests never collide on a port and can run in parallel. Only code run
by the environment's apps is redirected; the test's own connections
(a database, an HTTP client) are left alone. `network: 'real'` turns it off.

```ts
// A device connecting to a component that listens
const monitor = await env.connect(app, 'hl7Server', { framing: 'mllp' });
const ack = await monitor.request(oruMessage);

// What a client component connects to, set up before the app starts
const analyzer = env.serve({
  port: 4001,
  framing: { start: '\x02', end: '\x03' },
});
await env.start(MyApp, {
  components: { deviceIo: { values: { host: 'lab-1', port: 4001 } } },
});
const conn = await analyzer.connection();
conn.send(result);
```

- `framing`: `'none'` (every chunk is a message), `'mllp'` (HL7), or
  `{ start?, end }` for any other envelope
- `conn.send`, `conn.receive({ timeout })`, `conn.request`, `conn.close`

## Serial ports

The machine gets virtual serial ports, `/dev/ttyVSB0` to `/dev/ttyVSB9`
(`VIRTUAL_SERIAL_PORTS`): serialport lists them like real ones, so a
component whose port must be one of the listed ports accepts them. The test
plays the device on one:

```ts
const device = env.serialPort('/dev/ttyVSB0', {
  framing: { start: '\x02', end: '\x03' },
});
await env.start(MyApp, {
  components: { line: { values: { port: '/dev/ttyVSB0' } } },
});
const conn = await device.connection();
const answer = await conn.request(query);
await conn.close(); // the device goes away: the component sees a disconnect
```

The component's own `SerialPort` and its stream run; only the operating
system's side is virtual. Each time the component opens the port, the
device gets a new connection (`device.connections`).

Import `@syncbridge/testing` before the app or extension under test:
an extension may read the port list once, when its module loads, and the
virtual ports must be in it by then.

## Fixtures

The data a test sends or expects - a message as a device sent it at a
site, an example from a manual, a frame written by hand - is kept in a
fixture file beside the test and read with `FixtureReader`:

```text
syncbridge-fixtures; boundary=sb-7f3a9c

Text up to the first boundary describes the file; it is not read.

--sb-7f3a9c
name: oru-r01
eol: cr

MSH|^~\&|VSP|GE Healthcare|||20250827142700||ORU^R01|0040972856FF|P|2.6
PID|||33426^^^PID^MR
--sb-7f3a9c
name: connect-indication
encoding: hex
note: manual, p. 42

00 01 00 2a e1 00 00 02
--sb-7f3a9c
name: ack
escapes: true

<VT>MSH|^~\&|SB|||||20250101||ACK|1|P|2.6<CR>MSA|AA|1<CR><FS><CR>
--sb-7f3a9c--
```

```ts
import { FixtureReader } from '@syncbridge/testing';

/* Relative to this test file */
const fixtures = new FixtureReader('_data/monitor.fixtures');

monitor.send(fixtures.get('oru-r01')); // Buffer
fixtures.text('ack'); // string
fixtures.at(0); // by position
fixtures.headers('connect-indication'); // { name, encoding, note }
fixtures.filter(f => f.headers.direction === 'in');
```

The file declares a boundary on its first line, and every fixture starts
at a `--<boundary>` line, as in multipart MIME. The boundary is chosen to
appear in no fixture, so a fixture holds anything - `<<`, `--`, control
characters, binary data. A fixture is its headers (`name: value`), an
empty line, and its content up to the next boundary line, the line break
before which is not the content's; one without headers starts with the
empty line. The file ends with `--<boundary>--`.

| Header     | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `name`     | What a test gets it by; without one, by position (`at`)                                   |
| `encoding` | `text` (default), `hex` (whitespace ignored), `base64`                                    |
| `eol`      | `cr`, `lf`, `crlf`: the line breaks text content is given - HL7 ends its segments with CR |
| `escapes`  | `true`: `<CR>`, `<VT>`, `<FS>`, `<0x1C>`… are the characters they name                    |
| `charset`  | Of text that `eol` or `escapes` change; default `utf8`                                    |
| any other  | Kept, for the reader of the file and for `filter`                                         |

Content nothing changes is the bytes as written. The reader's options are
every fixture's defaults: `new FixtureReader(file, { eol: 'cr' })`, and
escapes of a device's manual with `{ escapes: { '<SB>': 0x0b, '<EB>':
'\x1c\r' } }`, or another notation with `escapePattern`. Without a file,
`FixtureReader.parse(content)` reads one's content, and
`FixtureReader.decode('<VT>MSH…<CR>', { escapes: true })` one piece of
data.

What a component sends and receives at run time is in its `communication`
channel: `env.channelLogs(app, 'hl7Server/communication')`. In
SyncBridge that channel is off unless a worker's profile turns it on; in a
test every channel writes, unless the app is created with
`logChannels: 'defaults'`.

## Waiting and logs

- `env.waitFor(element, 'started', { timeout })`
- `env.waitForEvent(emitter, 'event', filter?, { timeout })`
- `env.logs(app)`: every entry of the app and its components,
  with `.errors`, `.warnings` and `.messages`
- `env.channelLogs(app, 'device/communication')`: the records written
  to a log channel, by its full name

## expectSnapshot(value, name, { ignore? })

Compares `value` with a snapshot kept beside the test in
`__snapshots__/<test file>.json`. A missing snapshot is written (under CI it
fails instead); `UPDATE_SNAPSHOTS=1` rewrites them. `ignore` names
properties whose values change from run to run.
