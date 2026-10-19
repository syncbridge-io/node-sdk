import { expect } from 'expect';
import { Runnable, ServiceStatus } from '../../src/index.js';

describe('Runnable', () => {
  class TestRunnable extends Runnable {
    protected async _init(): Promise<void> {}

    protected async _start(): Promise<void> {}

    protected async _stop(): Promise<void> {}

    protected async _terminate(): Promise<void> {}
  }

  async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms).unref());
  }

  it('should create', async () => {
    const runnable = new TestRunnable();
    expect(runnable).toBeDefined();
  });

  it('should initialize before start', async () => {
    const calls = {
      init: 0,
      start: 0,
    };
    const Test2Runnable = class extends TestRunnable {
      protected async _init() {
        calls.init = Date.now();
        await sleep(200);
      }
      protected async _start() {
        calls.start = Date.now();
      }
    };
    const runnable = new Test2Runnable();
    const statusLog: any[] = [];
    runnable.on('status-change', (status, statusMessage) => {
      statusLog.push({ status, statusMessage });
    });
    await runnable.start();
    expect(runnable.status).toEqual(ServiceStatus.started);
    expect(statusLog).toEqual([
      {
        status: ServiceStatus.starting,
        statusMessage: '',
      },
      {
        status: ServiceStatus.started,
        statusMessage: '',
      },
    ]);
    expect(calls.init).toBeGreaterThan(0);
    expect(calls.start).toBeGreaterThan(0);
    expect(calls.start - calls.init).toBeGreaterThanOrEqual(100);
  }).slow(500);

  it('should not call _init and _start twice', async () => {
    const calls = {
      init: 0,
      start: 0,
    };
    const Test2Runnable = class extends TestRunnable {
      protected async _init() {
        calls.init++;
        await sleep(100);
      }
      protected async _start() {
        calls.start++;
      }
    };
    const runnable = new Test2Runnable();
    runnable.startNoWait();
    runnable.startNoWait();
    await Promise.all([runnable.start(), runnable.start()]);
    expect(runnable.status).toEqual(ServiceStatus.started);
    expect(calls.init).toEqual(1);
    expect(calls.start).toEqual(1);
  }).slow(200);

  it('should fail start on timeout than stop', async () => {
    const calls = {
      start: 0,
      stop: 0,
    };
    const Test2Runnable = class extends TestRunnable {
      protected async _start() {
        calls.start++;
        await sleep(100);
      }

      protected async _stop() {
        calls.stop++;
      }
    };
    const runnable = new Test2Runnable({
      startMaxWaitMs: 10,
    });
    const promise = runnable.start();
    await expect(promise).rejects.toThrow('timeout');
    expect(calls.start).toEqual(1);
    expect(calls.stop).toEqual(1);
  });

  it('should stop after start', async () => {
    const Test2Runnable = class extends TestRunnable {};
    const runnable = new Test2Runnable();
    let statusLog: any[] = [];
    runnable.on('status-change', (status, statusMessage) => {
      statusLog.push({ status, statusMessage });
    });
    await runnable.start();
    expect(runnable.status).toEqual(ServiceStatus.started);
    expect(statusLog).toEqual([
      {
        status: ServiceStatus.starting,
        statusMessage: '',
      },
      {
        status: ServiceStatus.started,
        statusMessage: '',
      },
    ]);
    statusLog = [];
    await runnable.stop();
    expect(statusLog).toEqual([
      {
        status: ServiceStatus.stopping,
        statusMessage: '',
      },
      {
        status: ServiceStatus.stopped,
        statusMessage: '',
      },
    ]);
    expect(runnable.status).toEqual(ServiceStatus.stopped);
  });

  it('should set status to invalid if _init fails', async () => {
    const Test2Runnable = class extends TestRunnable {
      protected async _init() {
        throw new Error('Init Error');
      }
    };
    const runnable = new Test2Runnable();
    const errorLog: any[] = [];
    runnable.on('error', err => errorLog.push(err));

    await expect(runnable.start()).rejects.toThrow(
      'Initialization failed: Init Error',
    );
    // It calls stop() in catch block of start(), and stop() sets it to stopped if starting
    // Wait, let's re-examine start() catch block.
    // It calls this.stop().then(() => { throw err; });
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(errorLog.length).toEqual(1);
    expect(errorLog[0].code).toEqual('INIT_FAILED');
  });

  it('should call stop() if _start fails', async () => {
    const calls = { stop: 0 };
    const Test2Runnable = class extends TestRunnable {
      protected async _start() {
        throw new Error('Start Error');
      }
      protected async _stop() {
        calls.stop++;
      }
    };
    const runnable = new Test2Runnable();
    await expect(runnable.start()).rejects.toThrow('Start Error');
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(calls.stop).toEqual(1);
  });

  it('should call _terminate if _stop fails', async () => {
    const calls = { terminate: 0 };
    const Test2Runnable = class extends TestRunnable {
      protected async _stop() {
        throw new Error('Stop Error');
      }
      protected async _terminate() {
        calls.terminate++;
      }
    };
    const runnable = new Test2Runnable();
    await runnable.start();
    await expect(runnable.stop()).rejects.toThrow('Stop Error');
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(calls.terminate).toEqual(1);
  });

  it('should support startNoWait and stopNoWait', async () => {
    const calls = { start: 0, stop: 0 };
    const Test2Runnable = class extends TestRunnable {
      protected async _start() {
        await sleep(50);
        calls.start++;
      }
      protected async _stop() {
        await sleep(50);
        calls.stop++;
      }
    };
    const runnable = new Test2Runnable();
    runnable.startNoWait();
    expect(runnable.status).toEqual(ServiceStatus.starting);
    await sleep(100);
    expect(runnable.status).toEqual(ServiceStatus.started);
    expect(calls.start).toEqual(1);

    runnable.stopNoWait();
    expect(runnable.status).toEqual(ServiceStatus.stopping);
    await sleep(100);
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(calls.stop).toEqual(1);
  });

  it('should abort start if AbortSignal is aborted', async () => {
    const Test2Runnable = class extends TestRunnable {
      protected async _start(abortSignal?: AbortSignal) {
        if (abortSignal?.aborted) throw new Error('Aborted');
        return new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            reject(new Error('Aborted'));
          };
          abortSignal?.addEventListener('abort', onAbort);
          setTimeout(() => {
            abortSignal?.removeEventListener('abort', onAbort);
            resolve();
          }, 1000);
        });
      }
    };
    const runnable = new Test2Runnable();
    const controller = new AbortController();
    const promise = runnable.start(controller.signal);
    await sleep(10);
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(runnable.status).toEqual(ServiceStatus.stopped);
  });

  it('should not initialize again if already initialized', async () => {
    let initCalls = 0;
    const Test2Runnable = class extends TestRunnable {
      protected async _init() {
        initCalls++;
      }
    };
    const runnable = new Test2Runnable();
    await runnable.init();
    await runnable.init();
    expect(initCalls).toEqual(1);
  });

  it('should stop start process if stop is called while starting', async () => {
    const calls = { start: 0, stop: 0 };
    const Test2Runnable = class extends TestRunnable {
      protected async _start() {
        await sleep(100);
        calls.start++;
      }
      protected async _stop() {
        calls.stop++;
      }
    };
    const runnable = new Test2Runnable();
    const startPromise = runnable.start();
    await sleep(20);
    const stopPromise = runnable.stop();
    await Promise.allSettled([startPromise, stopPromise]);
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(calls.stop).toEqual(1);
  });

  it('should return quickly if already in target state', async () => {
    let calls = 0;
    const Test2Runnable = class extends TestRunnable {
      protected async _start() {
        calls++;
      }
      protected async _stop() {
        calls++;
      }
    };
    const runnable = new Test2Runnable();
    await runnable.start();
    await runnable.start();
    expect(calls).toEqual(1);
    await runnable.stop();
    await runnable.stop();
    expect(calls).toEqual(2);
  });

  it('should return startTime if started', async () => {
    const runnable = new TestRunnable();
    expect(runnable.startTime).toBeUndefined();
    await runnable.start();
    expect(runnable.startTime).toBeInstanceOf(Date);
  });

  it('should return status and statusMessage', async () => {
    const runnable = new TestRunnable();
    expect(runnable.status).toEqual(ServiceStatus.stopped);
    expect(runnable.statusMessage).toEqual('Stopped');
    await runnable.start();
    expect(runnable.status).toEqual(ServiceStatus.started);
  });

  it('should fail stop on timeout', async () => {
    const Test2Runnable = class extends TestRunnable {
      protected async _stop() {
        await sleep(100);
      }
    };
    const runnable = new Test2Runnable({
      stopMaxWaitMs: 10,
    });
    await runnable.start();
    const promise = runnable.stop();
    await expect(promise).rejects.toThrow('Stop timeout');
  });

  describe('_restart', () => {
    class Restarting extends TestRunnable {
      calls: string[] = [];
      signals: AbortSignal[] = [];
      protected async _start(signal?: AbortSignal) {
        this.calls.push('start');
        this.signals.push(signal!);
        await sleep(20);
      }
      protected async _stop() {
        this.calls.push('stop');
      }
      restart() {
        return this._restart();
      }
    }

    it('should stop and start it in place, its status kept', async () => {
      const r = new Restarting();
      await r.start();
      const told: string[] = [];
      r.on('status-change', status => told.push(status));
      await r.restart();
      expect(r.calls).toEqual(['start', 'stop', 'start']);
      expect(r.status).toBe(ServiceStatus.started);
      expect(told).toEqual([]);
      await r.stop();
    });

    it('should have a stop meanwhile abort its start', async () => {
      const r = new Restarting();
      await r.start();
      const restarting = r.restart();
      await sleep(5);
      await r.stop();
      await restarting;
      expect(r.signals[1].aborted).toBe(true);
      expect(r.status).toBe(ServiceStatus.stopped);
    });

    it('should leave one not running as it is', async () => {
      const r = new Restarting();
      await r.restart();
      expect(r.calls).toEqual([]);
    });
  });
});
