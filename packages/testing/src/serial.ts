import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { Duplex } from 'node:stream';
import { storage } from './network.js';

/**
 * Virtual serial ports, as if the machine had them. serialport's platform
 * binding is wrapped so that its list includes them and opening one gives a
 * port whose other end is the test's (env.serialPort): the real SerialPort
 * and its stream run, only the operating system's side is virtual.
 *
 * They are in the list from the moment @syncbridge/testing is imported: an
 * extension may read the list once, when its module loads - the serialport
 * extension makes its `port` variable an enum of it - so the ports must be
 * there before the extension is imported.
 */
export const VIRTUAL_SERIAL_PORTS: readonly string[] = Array.from(
  { length: 10 },
  (_, i) => `/dev/ttyVSB${i}`,
);

/** A device on a virtual serial port: called with each port opened */
export type SerialDevice = (stream: Duplex) => void;

class CanceledError extends Error {
  readonly canceled = true;
}

/**
 * One open of a virtual port: what serialport's stream calls (the
 * BindingPortInterface of @serialport/bindings-interface), with the test's
 * end as a Duplex.
 */
class VirtualPortBinding {
  isOpen = true;
  /** Written by the test, not yet read by the component */
  protected _data = Buffer.alloc(0);
  protected _pendingRead?: (err?: Error) => void;
  /** The device ended its side */
  protected _gone = false;
  readonly device: Duplex;

  constructor(readonly openOptions: any) {
    const binding = this;
    this.device = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        binding._emitData(chunk);
        callback();
      },
      final(callback) {
        /* The device went away, as a cable pulled out */
        binding._disconnect();
        callback();
      },
    });
  }

  async close() {
    if (!this.isOpen) throw new Error('Port is not open');
    this.isOpen = false;
    this._data = Buffer.alloc(0);
    this._pendingRead?.(new CanceledError('Port is closed'));
    this._pendingRead = undefined;
    this.device.push(null);
    this.device.destroy();
  }

  async read(buffer: Buffer, offset: number, length: number): Promise<any> {
    if (!this.isOpen) throw new CanceledError('Read canceled');
    if (!this._data.length && this._gone)
      throw new Error('The device disconnected');
    if (!this._data.length) {
      await new Promise<void>((resolve, reject) => {
        this._pendingRead = err => (err ? reject(err) : resolve());
      });
      return this.read(buffer, offset, length);
    }
    const bytesRead = this._data.copy(buffer, offset, 0, length);
    this._data = this._data.subarray(bytesRead);
    return { bytesRead, buffer };
  }

  async write(buffer: Buffer) {
    if (!this.isOpen) throw new Error('Port is not open');
    this.device.push(Buffer.from(buffer));
  }

  async update(options: { baudRate: number }) {
    this.openOptions.baudRate = options.baudRate;
  }

  async set() {}

  async get() {
    return { cts: true, dsr: false, dcd: false };
  }

  async getBaudRate() {
    return { baudRate: this.openOptions.baudRate };
  }

  async flush() {
    this._data = Buffer.alloc(0);
  }

  async drain() {}

  protected _emitData(chunk: Buffer) {
    if (!this.isOpen) return;
    this._data = Buffer.concat([this._data, chunk]);
    const pending = this._pendingRead;
    this._pendingRead = undefined;
    pending?.();
  }

  /** A read error that is not a cancel: the stream closes as disconnected */
  protected _disconnect() {
    this._gone = true;
    const pending = this._pendingRead;
    this._pendingRead = undefined;
    pending?.(new Error('The device disconnected'));
  }
}

/**
 * Not a dependency of @syncbridge/testing: the copy the project under test
 * and its extensions resolve is the one wrapped
 */
const SERIALPORT = 'serialport';

/** serialport copies wrapped, by the file of their module */
const wrapped = new Set<string>();

/**
 * Wraps the platform binding of the serialport package that `fromFiles`
 * resolve, once per copy. Files that do not reach serialport are skipped.
 */
export function installSerialHooks(fromFiles: string[]) {
  for (const from of fromFiles) {
    const require = createRequire(from);
    let file: string;
    try {
      file = require.resolve(SERIALPORT);
    } catch {
      continue;
    }
    if (wrapped.has(file)) continue;
    wrapped.add(file);
    const SerialPort = require(SERIALPORT).SerialPort;
    const binding = SerialPort?.binding;
    if (!binding) continue;

    const open = binding.open.bind(binding);
    binding.open = (options: any) => {
      const portPath = options?.path;
      if (!VIRTUAL_SERIAL_PORTS.includes(portPath)) return open(options);
      const device = storage.getStore()?.serialDevice(portPath);
      if (!device)
        return Promise.reject(
          new Error(
            `Error: No such file or directory, cannot open ${portPath} (no device: env.serialPort)`,
          ),
        );
      const port = new VirtualPortBinding({ ...options });
      device(port.device);
      return Promise.resolve(port);
    };
    /* SerialPort.list was copied from the binding when the class was made */
    const list = binding.list.bind(binding);
    const withVirtual = async () => [
      ...(await list().catch(() => [])),
      ...VIRTUAL_SERIAL_PORTS.map(p => ({
        path: p,
        manufacturer: '@syncbridge/testing',
      })),
    ];
    binding.list = withVirtual;
    SerialPort.list = withVirtual;
  }
}

/* The serialport the project under test resolves, before its extensions
 * are imported */
installSerialHooks([path.join(process.cwd(), 'package.json')]);
