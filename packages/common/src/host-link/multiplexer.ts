import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';

/*
 * A frame: [type: u8][stream id: u32][payload]. The link (a WebSocket's
 * binary messages) keeps the frames whole and in order.
 */
const FrameType = {
  /** Opens a stream; payload: its meta, JSON */
  OPEN: 1,
  DATA: 2,
  /** Lets the peer send that many more bytes on the stream; payload: u32 */
  CREDIT: 3,
  /** The sender writes no more on the stream */
  END: 4,
  /** The stream is gone, both ways; payload: why, utf8 */
  RESET: 5,
  /** A message of the link itself, on no stream (id 0); payload: JSON */
  CONTROL: 6,
} as const;
type FrameType = (typeof FrameType)[keyof typeof FrameType];

const HEADER_SIZE = 5;
/** A DATA frame's payload at most: big writes are cut */
const MAX_DATA = 32 * 1024;
/** Bytes a stream's sender may have sent the receiver has not taken */
const WINDOW = 256 * 1024;

export namespace Multiplexer {
  export interface Options {
    /** Sends a frame over the link */
    send: (frame: Buffer) => void;
    /**
     * The side it is: the streams one side opens have odd ids, the other's
     * even, so both open without asking
     */
    side: 'console' | 'host';
  }

  export interface Events {
    /** The peer opened a stream */
    stream: [stream: MuxStream, meta: Record<string, any>];
    /** The peer sent a message of the link */
    control: [message: Record<string, any>];
  }
}

/**
 * Streams over one link: each a Duplex, with its own flow control - a
 * sender sends no more than its receiver has room for, so a slow stream
 * holds back itself, not the link or the others.
 */
export class Multiplexer extends EventEmitter<Multiplexer.Events> {
  protected _streams = new Map<number, MuxStream>();
  protected _nextId: number;
  protected _closed = false;

  constructor(readonly options: Multiplexer.Options) {
    super();
    this._nextId = options.side === 'console' ? 1 : 2;
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Opens a stream to the peer, with what it is for */
  open(meta: Record<string, any> = {}): MuxStream {
    if (this._closed) throw new Error('The link is closed');
    const id = this._nextId;
    this._nextId += 2;
    const stream = new MuxStream(this, id);
    this._streams.set(id, stream);
    this._send(FrameType.OPEN, id, Buffer.from(JSON.stringify(meta)));
    return stream;
  }

  /** Sends a message of the link itself */
  control(message: Record<string, any>): void {
    if (this._closed) return;
    this._send(FrameType.CONTROL, 0, Buffer.from(JSON.stringify(message)));
  }

  /** Takes a frame the link received */
  receive(frame: Buffer): void {
    if (this._closed || frame.length < HEADER_SIZE) return;
    const type = frame.readUInt8(0) as FrameType;
    const id = frame.readUInt32BE(1);
    const payload = frame.subarray(HEADER_SIZE);
    if (type === FrameType.CONTROL) {
      const message = parseJson(payload);
      if (message) this.emit('control', message);
      return;
    }
    if (type === FrameType.OPEN) {
      if (this._streams.has(id) || id % 2 === this._nextId % 2) {
        this._send(FrameType.RESET, id, Buffer.from('Bad stream id'));
        return;
      }
      const stream = new MuxStream(this, id);
      this._streams.set(id, stream);
      this.emit('stream', stream, parseJson(payload) || {});
      return;
    }
    const stream = this._streams.get(id);
    if (!stream) return;
    switch (type) {
      case FrameType.DATA:
        stream._receiveData(Buffer.from(payload));
        break;
      case FrameType.CREDIT:
        if (payload.length >= 4) stream._receiveCredit(payload.readUInt32BE(0));
        break;
      case FrameType.END:
        stream._receiveEnd();
        break;
      case FrameType.RESET:
        stream._receiveReset(payload.toString('utf8'));
        break;
    }
  }

  /** The link is gone: its streams too */
  close(reason = 'The link closed'): void {
    if (this._closed) return;
    this._closed = true;
    for (const stream of [...this._streams.values()])
      stream._receiveReset(reason);
    this._streams.clear();
  }

  /** @internal */
  _send(type: FrameType, id: number, payload?: Buffer): void {
    if (this._closed) return;
    const frame = Buffer.allocUnsafe(HEADER_SIZE + (payload?.length || 0));
    frame.writeUInt8(type, 0);
    frame.writeUInt32BE(id, 1);
    if (payload) payload.copy(frame, HEADER_SIZE);
    this.options.send(frame);
  }

  /** @internal */
  _sendCredit(id: number, bytes: number): void {
    const payload = Buffer.allocUnsafe(4);
    payload.writeUInt32BE(bytes, 0);
    this._send(FrameType.CREDIT, id, payload);
  }

  /** @internal */
  _sendData(id: number, data: Buffer): void {
    this._send(FrameType.DATA, id, data);
  }

  /** @internal */
  _sendEnd(id: number): void {
    this._send(FrameType.END, id);
  }

  /** @internal */
  _sendReset(id: number, reason: string): void {
    this._send(FrameType.RESET, id, Buffer.from(reason));
  }

  /** @internal */
  _forget(id: number): void {
    this._streams.delete(id);
  }
}

/**
 * A stream of a Multiplexer. It passes for a socket where a Node HTTP
 * server or client takes one: it has what they call on a socket.
 */
export class MuxStream extends Duplex {
  /** Bytes it may send: what the peer has room for */
  protected _credit = WINDOW;
  /** Bytes taken in but not yet given back as credit: the reader is slow */
  protected _owed = 0;
  /** A write waiting for credit */
  protected _pending?: { data: Buffer; callback: (e?: Error) => void };
  protected _ended = false;
  protected _peerEnded = false;
  protected _timeout?: NodeJS.Timeout;
  protected _timeoutMs = 0;
  /** Where it comes from, for a server's request: the link */
  readonly remoteAddress = 'tunnel';
  readonly remotePort = 0;

  constructor(
    protected _mux: Multiplexer,
    readonly id: number,
  ) {
    super({ allowHalfOpen: true });
  }

  /* What an HTTP server or client calls on a socket */

  setTimeout(ms: number, callback?: () => void): this {
    this._timeoutMs = ms;
    if (callback) this.once('timeout', callback);
    this._touch();
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  address() {
    return {};
  }

  /** @internal */
  _receiveData(data: Buffer): void {
    this._touch();
    if (this.destroyed) return;
    if (this.push(data)) this._mux._sendCredit(this.id, data.length);
    else this._owed += data.length;
  }

  /** @internal */
  _receiveCredit(bytes: number): void {
    this._credit += bytes;
    const pending = this._pending;
    if (pending) {
      this._pending = undefined;
      this._write(pending.data, 'binary', pending.callback);
    }
  }

  /** @internal */
  _receiveEnd(): void {
    this._peerEnded = true;
    this.push(null);
    this._settle();
  }

  /** @internal */
  _receiveReset(reason: string): void {
    this._peerEnded = true;
    this._ended = true;
    /* An error to who listens for one: else it is closed, not thrown */
    this.destroy(this.listenerCount('error') ? new Error(reason) : undefined);
  }

  override _read(): void {
    /* The reader has room again: what it was owed, the peer may send */
    if (this._owed) {
      const owed = this._owed;
      this._owed = 0;
      this._mux._sendCredit(this.id, owed);
    }
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (e?: Error) => void,
  ): void {
    this._touch();
    let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    while (data.length) {
      if (this._credit <= 0) {
        this._pending = { data, callback };
        return;
      }
      const size = Math.min(data.length, MAX_DATA, this._credit);
      this._mux._sendData(this.id, data.subarray(0, size));
      this._credit -= size;
      data = data.subarray(size);
    }
    callback();
  }

  override _final(callback: (e?: Error) => void): void {
    this._ended = true;
    this._mux._sendEnd(this.id);
    callback();
    this._settle();
  }

  override _destroy(
    error: Error | null,
    callback: (e: Error | null) => void,
  ): void {
    clearTimeout(this._timeout);
    if (!this._ended || !this._peerEnded)
      this._mux._sendReset(this.id, error?.message || 'Closed');
    this._ended = this._peerEnded = true;
    this._mux._forget(this.id);
    const pending = this._pending;
    this._pending = undefined;
    pending?.callback(error || new Error('Closed'));
    callback(error);
  }

  /** Done both ways: it is let go */
  protected _settle() {
    if (this._ended && this._peerEnded) {
      clearTimeout(this._timeout);
      this._mux._forget(this.id);
    }
  }

  /** Activity: the idle timeout starts over */
  protected _touch() {
    clearTimeout(this._timeout);
    if (this._timeoutMs > 0 && !this.destroyed)
      this._timeout = setTimeout(
        () => this.emit('timeout'),
        this._timeoutMs,
      ).unref();
  }
}

function parseJson(payload: Buffer): Record<string, any> | undefined {
  try {
    const value = JSON.parse(payload.toString('utf8'));
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}
