import { AsyncLocalStorage } from 'node:async_hooks';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import type { SerialDevice } from './serial.js';

/**
 * Ports a test environment hands out instead of the ones its apps
 * ask for. An app listening on 17001 really listens on an ephemeral
 * port of 127.0.0.1, and its connections to port 17001, from any host,
 * reach that port; so do connections to an endpoint the test serves
 * (env.serve). Nothing else is touched: the redirection applies only while
 * an app of the environment runs, which AsyncLocalStorage tells.
 */
export class VirtualNetwork {
  /** Requested port -> the real port standing in for it */
  protected readonly _ports = new Map<number, number>();
  /** Serial port path -> the device on it (env.serialPort) */
  protected readonly _serial = new Map<string, SerialDevice>();

  /** The real port standing in for `port`, if any */
  resolve(port: number): number | undefined {
    return this._ports.get(port);
  }

  map(port: number, realPort: number) {
    this._ports.set(port, realPort);
  }

  unmap(port: number) {
    this._ports.delete(port);
  }

  /** The device on serial port `path`, if the test put one there */
  serialDevice(path: string | undefined): SerialDevice | undefined {
    return path === undefined ? undefined : this._serial.get(path);
  }

  mapSerial(path: string, device: SerialDevice) {
    this._serial.set(path, device);
  }

  unmapSerial(path: string) {
    this._serial.delete(path);
  }

  /** Runs `fn` with this network in effect for everything it starts */
  run<T>(fn: () => T): T {
    installHooks();
    return storage.run(this, fn);
  }
}

export const storage = new AsyncLocalStorage<VirtualNetwork>();
let installed = false;

/**
 * Wraps listen and connect once for the process. Outside a virtual
 * network's context they behave exactly as before.
 */
function installHooks() {
  if (installed) return;
  installed = true;

  const listen = net.Server.prototype.listen as (...args: any[]) => any;
  net.Server.prototype.listen = function (this: net.Server, ...args: any[]) {
    const network = storage.getStore();
    const port = listenPort(args);
    if (!network || port === undefined) return listen.apply(this, args);
    const callback =
      typeof args.at(-1) === 'function'
        ? (args.at(-1) as () => void)
        : undefined;
    this.once('listening', () => {
      const address = this.address();
      if (address && typeof address === 'object')
        network.map(port, address.port);
    });
    this.once('close', () => network.unmap(port));
    return listen.call(this, 0, '127.0.0.1', callback);
  } as typeof net.Server.prototype.listen;

  const redirect = <F extends (...args: any[]) => any>(fn: F): F =>
    function (this: any, ...args: any[]) {
      const network = storage.getStore();
      const target = connectTarget(args);
      const realPort =
        network && target?.port !== undefined
          ? network.resolve(target.port)
          : undefined;
      if (realPort === undefined) return fn.apply(this, args);
      const options = {
        ...target!.options,
        host: '127.0.0.1',
        port: realPort,
        /* TLS still names the host it was asked for */
        servername: target!.options.servername || target!.host,
      };
      return fn.call(this, options, target!.callback);
    } as F;

  net.connect = redirect(net.connect);
  net.createConnection = redirect(net.createConnection);
  tls.connect = redirect(tls.connect);
  /* `import { connect } from 'node:net'` reads the exports as they were */
  syncBuiltinESMExports();
}

/** The port of a listen call, when it listens on a TCP port */
function listenPort(args: any[]): number | undefined {
  const first = args[0];
  const value =
    first && typeof first === 'object' && !Array.isArray(first)
      ? first.path !== undefined
        ? undefined
        : first.port
      : first;
  const port = typeof value === 'string' ? Number(value) : value;
  /* Port 0 already asks for an ephemeral port: nothing to stand in for */
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

/** The host and port of a connect call, normalized to options */
function connectTarget(args: any[]):
  | {
      host?: string;
      port?: number;
      options: Record<string, any>;
      callback?: () => void;
    }
  | undefined {
  const callback =
    typeof args.at(-1) === 'function' ? (args.at(-1) as () => void) : undefined;
  let options: Record<string, any>;
  if (args[0] && typeof args[0] === 'object') options = { ...args[0] };
  else if (typeof args[0] === 'number' || /^\d+$/.test(String(args[0])))
    options = {
      port: Number(args[0]),
      host: typeof args[1] === 'string' ? args[1] : undefined,
    };
  else return; /* a socket path */
  if (options.path) return;
  const port = Number(options.port);
  if (!Number.isInteger(port)) return;
  return { host: options.host, port, options, callback };
}
