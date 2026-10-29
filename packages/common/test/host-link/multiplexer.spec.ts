import { Buffer } from 'node:buffer';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'expect';
import { Multiplexer, type MuxStream } from '../../src/index.js';

/** Two multiplexers linked, the frames passed on asynchronously */
function link() {
  const sent = { console: 0, host: 0 };
  const consoleMux: Multiplexer = new Multiplexer({
    side: 'console',
    send: frame => {
      sent.console += frame.length;
      setImmediate(() => host.receive(frame));
    },
  });
  const host: Multiplexer = new Multiplexer({
    side: 'host',
    send: frame => {
      sent.host += frame.length;
      setImmediate(() => consoleMux.receive(frame));
    },
  });
  return { consoleMux, host, sent };
}

const opened = (mux: Multiplexer) =>
  new Promise<[MuxStream, Record<string, any>]>(resolve =>
    mux.once('stream', (stream, meta) => resolve([stream, meta])),
  );

/** What a stream sends, to its end: its writing side left open */
const readAll = (stream: MuxStream) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });

describe('Multiplexer', () => {
  it('should pass data both ways, each side ending its own', async () => {
    const { consoleMux, host } = link();
    const a = consoleMux.open({ kind: 'test' });
    const [b, meta] = await opened(host);
    expect(meta).toEqual({ kind: 'test' });
    expect(a.id % 2).toBe(1);
    a.end('ping');
    expect((await readAll(b)).toString()).toBe('ping');
    b.end('pong');
    expect((await readAll(a)).toString()).toBe('pong');
  });

  it('should pass control messages on no stream', async () => {
    const { consoleMux, host } = link();
    const got = new Promise(resolve => host.once('control', resolve));
    consoleMux.control({ type: 'hello', version: '1' });
    expect(await got).toEqual({ type: 'hello', version: '1' });
  });

  it('should send no more than a slow reader has room for', async () => {
    const { consoleMux, host, sent } = link();
    const a = consoleMux.open();
    const [b] = await opened(host);
    const big = Buffer.alloc(4 * 1024 * 1024, 7);
    let written = false;
    a.end(big, () => (written = true));
    /* Nobody reads b: the sender stops at the window */
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(written).toBe(false);
    expect(sent.console).toBeLessThan(400 * 1024);
    const all = await readAll(b);
    expect(all.length).toBe(big.length);
    expect(all.equals(big)).toBe(true);
    expect(written).toBe(true);
  });

  it('should keep a slow stream from holding back another', async () => {
    const { consoleMux, host } = link();
    const slow = consoleMux.open({ n: 1 });
    const [, firstMeta] = await opened(host);
    expect(firstMeta).toEqual({ n: 1 });
    slow.write(Buffer.alloc(1024 * 1024));
    const fast = consoleMux.open({ n: 2 });
    const [fastPeer] = await opened(host);
    fast.end('through');
    expect((await readAll(fastPeer)).toString()).toBe('through');
  });

  it('should tear a stream down both ways, and all when the link closes', async () => {
    const { consoleMux, host } = link();
    const a = consoleMux.open();
    const [b] = await opened(host);
    const bClosed = new Promise<Error | undefined>(resolve =>
      b.once('error', resolve),
    );
    a.on('error', () => undefined);
    a.destroy(new Error('Gone'));
    expect((await bClosed)?.message).toBe('Gone');

    const c = consoleMux.open();
    await opened(host);
    const cClosed = new Promise<Error | undefined>(resolve =>
      c.once('error', resolve),
    );
    consoleMux.close('The link dropped');
    expect((await cClosed)?.message).toBe('The link dropped');
    expect(() => consoleMux.open()).toThrow('The link is closed');
  });

  it("should carry HTTP: a stream as a server's connection and a client's socket", async () => {
    const { consoleMux, host } = link();
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () =>
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            body,
            tunnel: req.socket.remoteAddress,
          }),
        ),
      );
    });
    host.on('stream', stream => server.emit('connection', stream));
    const ask = (path: string, body: string) =>
      new Promise<any>((resolve, reject) => {
        const req = http.request(
          {
            method: 'POST',
            path,
            headers: { 'content-type': 'text/plain' },
            createConnection: () => consoleMux.open({ kind: 'http' }) as any,
          },
          res => {
            let out = '';
            res.on('data', chunk => (out += chunk));
            res.on('end', () => resolve(JSON.parse(out)));
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    const answers = await Promise.all([
      ask('/a', 'one'),
      ask('/b?x=1', 'two'.repeat(50000)),
    ]);
    expect(answers[0]).toEqual({
      method: 'POST',
      url: '/a',
      body: 'one',
      tunnel: 'tunnel',
    });
    expect(answers[1].url).toBe('/b?x=1');
    expect(answers[1].body.length).toBe(150000);
    server.close();
    expect((server.address() as AddressInfo | null)?.port).toBeUndefined();
  });
});

describe('summarizeWorkers', () => {
  it('should count the workers, naming the first with a problem', async () => {
    const { summarizeWorkers, MAX_NAMED_PROBLEMS } =
      await import('../../src/index.js');
    const workers = [
      { id: 'a', status: 'started' },
      { id: 'b', status: 'stopped' },
      { id: 'c', status: 'starting' },
      { id: 'd', name: 'Line 4', status: 'unhealthy' },
      { id: 'e', status: 'needs-init' },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `x${i}`,
        status: 'invalid',
      })),
    ];
    const summary = summarizeWorkers(workers);
    expect(summary).toMatchObject({
      total: 17,
      started: 1,
      stopped: 1,
      other: 1,
      problem: 14,
    });
    expect(summary.problems.length).toBe(MAX_NAMED_PROBLEMS);
    expect(summary.problems[0]).toEqual({
      id: 'd',
      name: 'Line 4',
      status: 'unhealthy',
    });
    expect(summary.notices).toEqual([]);
  });

  it('should count a worker needing its configuration as a problem, and name those held or waiting for their migrations apart', async () => {
    const { summarizeWorkers } = await import('../../src/index.js');
    const held = {
      version: '1.0.0',
      newest: '2.0.0',
      reason: 'Not moved to 2.0.0',
    };
    const pending = { version: '2.0.0', from: '1.0.0' };
    const summary = summarizeWorkers([
      { id: 'a', status: 'needs-config' },
      { id: 'b', status: 'started', heldBack: held },
      { id: 'c', status: 'stopped', migrationPending: pending },
      { id: 'd', status: 'invalid', heldBack: held },
      { id: 'e', status: 'started' },
    ]);
    expect(summary).toMatchObject({
      total: 5,
      started: 2,
      stopped: 1,
      problem: 2,
      other: 0,
    });
    expect(summary.problems.map(w => w.id)).toEqual(['a', 'd']);
    /* A problem keeps what it is held on, on its own entry */
    expect(summary.problems[1].heldBack).toEqual(held);
    expect(summary.notices).toEqual([
      { id: 'b', status: 'started', heldBack: held },
      { id: 'c', status: 'stopped', migrationPending: pending },
    ]);
  });
});

describe('summarizeUsage', () => {
  it("should count each registry version's workers, 0 for none, mark one whose plugin runs, and leave out what is not from the registry", async () => {
    const { summarizeUsage } = await import('../../src/index.js');
    expect(
      summarizeUsage({
        installed: {
          '@acme/hl7': ['2.1.0', '2.0.3'],
          '@acme/oracle-client': ['1.0.0'],
        },
        workers: [
          { '@acme/hl7': '2.1.0', '@syncbridge/builtins': '1.0.0' },
          { '@acme/hl7': '2.1.0', '@acme/local': '0.1.0' },
        ],
        plugins: [
          { package: '@acme/oracle-client', version: '1.0.0' },
          { package: '@demo/plugin', version: '1.0.0' },
        ],
      }),
    ).toEqual({
      packages: {
        '@acme/hl7': { '2.1.0': { workers: 2 }, '2.0.3': { workers: 0 } },
        '@acme/oracle-client': { '1.0.0': { workers: 0, plugin: true } },
      },
    });
  });

  it('should tell no more than MAX_USAGE_VERSIONS versions', async () => {
    const { summarizeUsage, MAX_USAGE_VERSIONS } =
      await import('../../src/index.js');
    const installed: Record<string, string[]> = {};
    for (let i = 0; i < MAX_USAGE_VERSIONS + 5; i++)
      installed[`@acme/p${i}`] = ['1.0.0'];
    const { packages } = summarizeUsage({ installed, workers: [] });
    expect(Object.keys(packages).length).toBe(MAX_USAGE_VERSIONS);
  });
});
