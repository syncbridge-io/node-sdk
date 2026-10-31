import 'reflect-metadata';
import net from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import {
  AppBase,
  AppFactory,
  ComponentBase,
  ExtensionRegistry,
  type LogChannel,
  ServiceStatus,
  type WidgetMetadata,
} from '@syncbridge/common';
import type { Type } from 'ts-gems';
import { callerFile } from './caller.js';
import { type Framing, TestConnection } from './connection.js';
import { type DashboardData, TestDashboards } from './dashboards.js';
import { collectExtensionEntries, findPackageDir } from './discovery.js';
import { LogRecord, MemoryLogger } from './memory-logger.js';
import {
  type ComponentClass,
  MockComponent,
  type MockImplementation,
  type MockOptions,
} from './mock.js';
import { VirtualNetwork } from './network.js';
import { buildProfile, type ProfileOptions } from './profile-builder.js';
import { installSerialHooks, VIRTUAL_SERIAL_PORTS } from './serial.js';

export interface TestEnvOptions {
  /**
   * A file or directory of the package under test; default: the file that
   * calls createTestEnv. Pass `import.meta.url` when that is not the test.
   */
  from?: string;
  /** Prints every log entry as it is written; also SB_TEST_LOGS=1 */
  echoLogs?: boolean;
  /**
   * `virtual` (default): the ports apps listen on and connect to are
   * stood in for by ephemeral ones, so tests never collide on a port and
   * reach components through env.connect and env.serve. `real`: as given.
   */
  network?: 'virtual' | 'real';
}

export interface ConnectOptions {
  /** Default: none, every chunk is a message */
  framing?: Framing;
  /** The port to connect to; default: the component's `port` value */
  port?: number;
}

export interface ServeOptions {
  /** The port a client component connects to */
  port: number;
  framing?: Framing;
}

export interface SerialPortOptions {
  framing?: Framing;
}

export interface WaitOptions {
  /** Milliseconds; default 5000 */
  timeout?: number;
}

/**
 * A SyncBridge runtime for tests, without SyncBridge: the package under test
 * and the extension packages it depends on, registered in a registry of
 * its own, and apps created from profiles exactly as a worker does.
 */
export class TestEnv {
  readonly packageDir: string;
  readonly registry = new ExtensionRegistry();
  protected _ready?: Promise<void>;
  protected _apps: AppBase[] = [];
  protected _logs = new WeakMap<AppBase, MemoryLogger>();
  /** The records of each app's log channels, by channel */
  protected _channels = new WeakMap<AppBase, Map<string, LogChannel.Entry[]>>();
  /** Each app's dashboards, as SyncBridge would hold them */
  protected _dashboards = new WeakMap<AppBase, TestDashboards>();
  protected _mocks: MockComponent<any>[] = [];
  /** Ends each use of this env's registry as the current one */
  protected _releases: (() => void)[] = [];
  protected readonly _echo: boolean;
  protected readonly _network?: VirtualNetwork;
  protected _closers: (() => Promise<void>)[] = [];
  /** Virtual serial ports with a device (env.serialPort) */
  protected readonly _serialPorts = new Set<string>();

  constructor(options: TestEnvOptions = {}) {
    const from = options.from || callerFile() || process.cwd();
    this.packageDir = findPackageDir(from);
    this._echo = options.echoLogs ?? process.env.SB_TEST_LOGS === '1';
    if (options.network !== 'real') this._network = new VirtualNetwork();
    this.registry.setResolver(specifier => specifier);
  }

  /**
   * Registers the package under test and its extension dependencies; the
   * first create or start does it, so calling it is only needed to see
   * registration errors on their own.
   */
  ready(): Promise<void> {
    this._activate();
    return (this._ready ||= this._register());
  }

  /** Builds an app's profile and creates it, without starting it */
  async create<T extends AppBase>(
    appClass: Type<T>,
    options?: ProfileOptions<T>,
  ): Promise<T> {
    await this.ready();
    const profile = await buildProfile(this.registry, appClass, options);
    const logger = new MemoryLogger([], {}, this._echo);
    const channels = new Map<string, LogChannel.Entry[]>();
    const logSink: LogChannel.Sink = (channel, entry) => {
      let entries = channels.get(channel);
      if (!entries) channels.set(channel, (entries = []));
      entries.push(entry);
    };
    const dashboards = new TestDashboards(message => logger.warn(message));
    const app = await this._inNetwork(() =>
      AppFactory.createApp<T>(profile, {
        logger,
        logSink,
        dashboardSink: op => dashboards.apply(op),
        dashboardCounters: dashboards.counters,
      }),
    ).catch(e => {
      throw this._explainSerial(e);
    });
    dashboards.metadata = app[AppFactory.METADATA_KEY];
    this._dashboards.set(app, dashboards);
    /* Whoever starts it, its components listen and connect in the network */
    if (this._network)
      for (const method of ['init', 'start', 'stop'] as const) {
        const original = app[method].bind(app);
        (app as any)[method] = (...args: any[]) =>
          this._inNetwork(() => (original as any)(...args));
      }
    this._apps.push(app);
    this._logs.set(app, logger);
    this._channels.set(app, channels);
    return app;
  }

  /**
   * Creates an app and starts it. An app whose components are
   * still connecting is unhealthy for a moment, as in SyncBridge: it is
   * given `startTimeout` (default 5000ms) to become started.
   */
  async start<T extends AppBase>(
    appClass: Type<T>,
    options?: ProfileOptions<T> & { startTimeout?: number },
  ): Promise<T> {
    const app = await this.create(appClass, options);
    await app.start();
    if (app.status === ServiceStatus.unhealthy)
      await this.waitFor(app, ServiceStatus.started, {
        timeout: options?.startTimeout,
      }).catch(() => undefined);
    if (app.status !== ServiceStatus.started)
      throw new Error(
        `${appClass.name} did not start: ${app.status}` +
          (app.statusMessage ? ` - ${app.statusMessage}` : ''),
      );
    return app;
  }

  /**
   * A component standing in for `target` in a profile: pass it in
   * `components`. Its methods are `target`'s, with those in `impl`
   * replaced, and every call is recorded.
   */
  mock<T extends ComponentBase>(
    target: ComponentClass<T>,
    impl?: MockImplementation<T>,
    options?: MockOptions,
  ): MockComponent<T> {
    const mock = new MockComponent(target, impl, options);
    this._mocks.push(mock);
    return mock;
  }

  /**
   * Connects to a component that listens, as a device or a peer system
   * would. `component` is its name in the profile, `a/b` for a nested one.
   */
  async connect(
    app: AppBase,
    component: string,
    options: ConnectOptions = {},
  ): Promise<TestConnection> {
    const element = findComponent(app, component);
    const port = options.port ?? Number(element.values?.port);
    if (!Number.isInteger(port))
      throw new Error(
        `"${component}" has no port value; give one in options.port`,
      );
    const realPort = this._network ? this._network.resolve(port) : port;
    if (realPort === undefined)
      throw new Error(
        `Nothing listens on port ${port}: is "${component}" started?`,
      );
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(realPort, '127.0.0.1', () => {
        s.off('error', reject);
        resolve(s);
      });
      s.once('error', reject);
    });
    const connection = new TestConnection(socket, options.framing);
    this._closers.push(() => connection.close());
    return connection;
  }

  /**
   * Stands in for what a client component connects to, a device or a peer
   * system, at `port` on any host: set it up before the app starts.
   */
  serve(options: ServeOptions): TestPeer {
    if (!this._network) throw new Error('env.serve needs the virtual network');
    const peer = new TestPeer(options.framing);
    const server = net.createServer(socket => peer._accept(socket));
    const listening = new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        this._network!.map(options.port, address.port);
        resolve();
      }),
    );
    peer._ready = listening;
    this._closers.push(async () => {
      this._network!.unmap(options.port);
      await peer.closeAll();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    return peer;
  }

  /**
   * Stands in for the device on virtual serial port `portPath`, one of
   * VIRTUAL_SERIAL_PORTS (`/dev/ttyVSB0`...): a component that opens it gets
   * a port whose other end is the returned peer, one connection per open.
   * Set it up before the app starts. The component's own serialport
   * is used; only the operating system's side is virtual.
   */
  serialPort(portPath: string, options: SerialPortOptions = {}): TestPeer {
    if (!this._network)
      throw new Error('env.serialPort needs the virtual network');
    if (!VIRTUAL_SERIAL_PORTS.includes(portPath))
      throw new Error(
        `"${portPath}" is not a virtual serial port; use one of ${VIRTUAL_SERIAL_PORTS.join(', ')}`,
      );
    installSerialHooks([
      path.join(this.packageDir, 'package.json'),
      ...collectExtensionEntries(this.packageDir),
    ]);
    this._serialPorts.add(portPath);
    const peer = new TestPeer(options.framing);
    this._network.mapSerial(portPath, stream => peer._accept(stream));
    this._closers.push(async () => {
      this._serialPorts.delete(portPath);
      this._network!.unmapSerial(portPath);
      await peer.closeAll();
    });
    return peer;
  }

  /**
   * The records written to a log channel of the app or its
   * components, by the channel's full name: `listener/communication`
   */
  channelLogs(app: AppBase, channel: string): LogChannel.Entry[] {
    const channels = this._channels.get(app);
    if (!channels) throw new Error('This app was not created by this env');
    return channels.get(channel) || [];
  }

  /**
   * A widget's data as the app's dashboards show it, by its path:
   * `ops/queue`, a component's `io/device/errors`. Writes count at once
   */
  dashboard(app: AppBase, widget: string): DashboardData | undefined {
    return this._dashboardsOf(app).get(widget);
  }

  /**
   * What the app's charts counted (`count()`) written as points now, each
   * series' sum as one - SyncBridge writes them each interval
   */
  flushCounts(app: AppBase): void {
    this._dashboardsOf(app).counters.flush();
  }

  /** The widgets the app defined as it ran into a dashboard: `ops` */
  definedWidgets(app: AppBase, dashboard: string): WidgetMetadata[] {
    return this._dashboardsOf(app).defined(dashboard);
  }

  /**
   * What is wrong with the definitions of the app's widgets - its
   * classes' and those defined as it ran - by path: SyncBridge would draw
   * none of them. Empty when all are right
   */
  dashboardIssues(app: AppBase): Record<string, string[]> {
    return this._dashboardsOf(app).issues();
  }

  protected _dashboardsOf(app: AppBase): TestDashboards {
    const dashboards = this._dashboards.get(app);
    if (!dashboards) throw new Error('This app was not created by this env');
    return dashboards;
  }

  /** What the app and its components logged */
  logs(app: AppBase): LogRecord {
    const logger = this._logs.get(app);
    if (!logger) throw new Error('This app was not created by this env');
    return LogRecord.from(logger.entries) as LogRecord;
  }

  /** Resolves when `element` reaches `status` */
  waitFor(
    element: AppBase | ComponentBase,
    status: ServiceStatus | `${ServiceStatus}`,
    options?: WaitOptions,
  ): Promise<void> {
    if (element.status === status) return Promise.resolve();
    return this.waitForEvent(
      element as any,
      'status-change',
      (s: string) => s === status,
      options,
    ).then(() => undefined);
  }

  /**
   * Resolves with the arguments of the next `event` for which `filter`
   * (if given) returns true
   */
  waitForEvent(
    emitter: NodeJS.EventEmitter,
    event: string,
    filter?: (...args: any[]) => boolean,
    options?: WaitOptions,
  ): Promise<any[]> {
    const timeout = options?.timeout ?? 5000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emitter.off(event, listener);
        reject(
          new Error(`Timed out after ${timeout}ms waiting for "${event}"`),
        );
      }, timeout);
      const listener = (...args: any[]) => {
        if (filter && !filter(...args)) return;
        clearTimeout(timer);
        emitter.off(event, listener);
        resolve(args);
      };
      emitter.on(event, listener);
    });
  }

  /**
   * Stops every app this env created and forgets them, and clears
   * the calls mocks recorded: for afterEach
   */
  async reset(): Promise<void> {
    const closers = this._closers.splice(0);
    await Promise.all(closers.map(close => close().catch(() => undefined)));
    const apps = this._apps.splice(0);
    await Promise.all(apps.map(p => p.stop().catch(() => undefined)));
    for (const mock of this._mocks) mock.clear();
  }

  /** Resets and gives the global registry back: for after */
  async dispose(): Promise<void> {
    await this.reset();
    for (const release of this._releases.splice(0).reverse()) release();
  }

  /**
   * A virtual serial port refused as "not one of the enumeration" was
   * missing from the port list an extension read when its module loaded
   */
  protected _explainSerial(e: any) {
    if (this._serialPorts.size && /enumeration/.test(e?.message))
      e.message +=
        '\n  The virtual serial ports were not in the port list when the extension read it. ' +
        'Import @syncbridge/testing before the app or extension under test, and keep one copy of serialport.';
    return e;
  }

  protected _inNetwork<R>(fn: () => R): R {
    return this._network ? this._network.run(fn) : fn();
  }

  /**
   * Makes this env's registry the one AppFactory uses, again if
   * another env took over meanwhile
   */
  protected _activate() {
    if (ExtensionRegistry.current === this.registry) return;
    this._releases.push(ExtensionRegistry.use(this.registry));
  }

  protected async _register() {
    for (const entry of collectExtensionEntries(this.packageDir)) {
      const pkg = await this.registry.registerPackage(entry).catch(e => {
        e.message = `Could not register "${path.relative(this.packageDir, entry)}": ${e.message}`;
        throw e;
      });
      if (pkg.errors?.length)
        throw new Error(
          `${pkg.name} has invalid metadata:\n  - ` +
            pkg.errors.map((e: Error) => e.message).join('\n  - '),
        );
    }
  }
}

/**
 * A test environment for the package the calling test belongs to.
 *
 * ```ts
 * const env = createTestEnv();
 * afterEach(() => env.reset());
 * after(() => env.dispose());
 * ```
 */
export function createTestEnv(options?: TestEnvOptions): TestEnv {
  const from = options?.from || callerFile();
  return new TestEnv({ ...options, from });
}

/**
 * The test's side of the endpoint a client component connects to, a TCP
 * endpoint or a serial port: it accepts the component's connections,
 * framed as given.
 */
export class TestPeer {
  /** @internal */
  _ready?: Promise<void>;
  protected readonly _connections: TestConnection[] = [];
  protected readonly _waiting: ((c: TestConnection) => void)[] = [];

  constructor(protected readonly _framing?: Framing) {}

  /** The next connection the component makes, or the first one made */
  async connection(options: WaitOptions = {}): Promise<TestConnection> {
    await this._ready;
    const made = this._connections.at(0);
    if (made) return made;
    const timeout = options.timeout ?? 5000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiting.splice(this._waiting.indexOf(done), 1);
        reject(new Error(`No connection was made in ${timeout}ms`));
      }, timeout);
      const done = (c: TestConnection) => {
        clearTimeout(timer);
        resolve(c);
      };
      this._waiting.push(done);
    });
  }

  /** Connections made so far */
  get connections(): readonly TestConnection[] {
    return this._connections;
  }

  /** @internal */
  _accept(socket: Duplex) {
    const connection = new TestConnection(socket, this._framing);
    this._connections.push(connection);
    for (const waiting of this._waiting.splice(0)) waiting(connection);
  }

  /** @internal */
  async closeAll() {
    await Promise.all(this._connections.map(c => c.close()));
  }
}

/** A component of an app by its path in the profile, `a/b` nested */
function findComponent(app: AppBase, componentPath: string): any {
  let element: any = app;
  for (const name of componentPath.split('/')) {
    element = element?.components?.[name];
    if (!element)
      throw new Error(
        `${app.constructor.name} has no component "${componentPath}"`,
      );
  }
  return element;
}
