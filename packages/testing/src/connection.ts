import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

/**
 * How messages are delimited on the wire:
 * - `none`: every chunk received is a message
 * - `mllp`: HL7's minimal lower layer protocol, `\x0b` ... `\x1c\r`
 * - `{ start?, end }`: any other envelope, e.g. ASTM's STX ... ETX
 */
export type Framing = 'none' | 'mllp' | { start?: string; end: string };

export interface ReceiveOptions {
  /** Milliseconds; default 5000 */
  timeout?: number;
}

const MLLP = { start: '\x0b', end: '\x1c\r' };

/**
 * The test's end of a connection with an app's component, over TCP
 * or a virtual serial port: it sends what a device or a peer system would,
 * and reads back what the component answers, a framed message at a time.
 */
export class TestConnection {
  protected readonly _frame?: { start?: string; end: string };
  protected readonly _received: Buffer[] = [];
  protected readonly _events = new EventEmitter();
  protected _pending = Buffer.alloc(0);
  protected _closed = false;

  constructor(
    readonly socket: Duplex,
    framing: Framing = 'none',
  ) {
    this._frame =
      framing === 'mllp' ? MLLP : framing === 'none' ? undefined : framing;
    socket.on('data', (chunk: Buffer) => this._onData(chunk));
    socket.on('close', () => {
      this._closed = true;
      this._events.emit('close');
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Sends a message, framed */
  send(message: string | Buffer): void {
    const body = Buffer.isBuffer(message) ? message : Buffer.from(message);
    const f = this._frame;
    this.socket.write(
      f
        ? Buffer.concat([Buffer.from(f.start || ''), body, Buffer.from(f.end)])
        : body,
    );
  }

  /** The next message received, unframed */
  receive(options: ReceiveOptions = {}): Promise<Buffer> {
    const next = this._received.shift();
    if (next) return Promise.resolve(next);
    const timeout = options.timeout ?? 5000;
    return new Promise((resolve, reject) => {
      const onMessage = () => {
        cleanup();
        resolve(this._received.shift()!);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('The connection closed before a message arrived'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`No message received in ${timeout}ms`));
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        this._events.off('message', onMessage);
        this._events.off('close', onClose);
      };
      this._events.once('message', onMessage);
      this._events.once('close', onClose);
    });
  }

  /** Sends a message and resolves with the answer */
  async request(
    message: string | Buffer,
    options?: ReceiveOptions,
  ): Promise<Buffer> {
    const answer = this.receive(options);
    this.send(message);
    return answer;
  }

  close(): Promise<void> {
    if (this._closed) return Promise.resolve();
    return new Promise(resolve => {
      this.socket.once('close', () => resolve());
      this.socket.end();
    });
  }

  protected _onData(chunk: Buffer) {
    const f = this._frame;
    if (!f) return this._push(chunk);
    this._pending = Buffer.concat([this._pending, chunk]);
    for (;;) {
      const end = this._pending.indexOf(f.end);
      if (end < 0) return;
      let body = this._pending.subarray(0, end);
      if (f.start) {
        const start = body.indexOf(f.start);
        if (start >= 0) body = body.subarray(start + f.start.length);
      }
      this._pending = this._pending.subarray(end + f.end.length);
      this._push(Buffer.from(body));
    }
  }

  protected _push(message: Buffer) {
    this._received.push(message);
    this._events.emit('message');
  }
}
