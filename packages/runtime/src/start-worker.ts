import { type ChildProcess, fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { Profile } from '@syncbridge/common';
import { LOADER_URL, WORKER_URL } from './paths.js';
import { type WorkerPlan, writeWorkerPlan } from './plan.js';
import type { WorkerMessage } from './worker-messages.js';

export interface StartWorkerOptions {
  plan: WorkerPlan;
  /**
   * A decoded profile, as the host sends it to a SyncBridge worker; none
   * when its classes are loaded alone (`loadOnly`)
   */
  profile?: Profile;
  /** The worker's data directory; its plan is written there too */
  dataDirectory: string;
  /**
   * Only create the app - after loading every class of the plan's
   * packages - without initializing or starting it; the worker reaches
   * status `created`. What starting needs (devices, databases, services)
   * is the environment's, not the package's.
   */
  createOnly?: boolean;
  /**
   * Only register the plan's packages and load each of their classes - a
   * package of components alone, no app to create; the worker reaches
   * status `loaded`, its classes told as its components
   */
  loadOnly?: boolean;
  /** Node.js options for the worker, before the plan's loader */
  execArgv?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface WorkerLogRecord {
  level: string;
  source?: string;
  message: string;
}

/**
 * An app running in a worker process of its own, with its plan's
 * resolve hooks: the way SyncBridge runs it. Emits `status`,
 * `component-status`, `log` and `exit`.
 */
export class WorkerProcess extends EventEmitter {
  status = 'starting';
  statusMessage = '';
  /** Why the app could not be created or started, if it could not */
  failure?: string;
  readonly logs: WorkerLogRecord[] = [];
  readonly components = new Map<string, { status: string; message: string }>();
  protected _exited: Promise<number | null>;
  protected _stopping = false;

  constructor(protected _child: ChildProcess) {
    super();
    _child.on('message', (msg: WorkerMessage) => this._onMessage(msg));
    this._exited = new Promise(resolve =>
      _child.once('exit', code => {
        if (!this.failure && this.status !== 'stopped')
          this._fail(`The worker process exited with code ${code}`);
        this.emit('exit', code);
        resolve(code);
      }),
    );
  }

  get pid() {
    return this._child.pid;
  }

  /**
   * Waits until the app reaches one of `statuses`. Rejects when it
   * cannot be created, the worker exits, or `timeout` passes first.
   */
  waitForStatus(statuses: string[], timeout = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (statuses.includes(this.status)) done(() => resolve(this.status));
        else if (this.failure) done(() => reject(new Error(this.failure)));
        else if (this.status === 'stopped' && !this._stopping)
          done(() => reject(new Error(`The app stopped: ${this._reason()}`)));
      };
      const timer = setTimeout(
        () =>
          done(() =>
            reject(
              new Error(
                `The app did not become ${statuses.join(' or ')} in ${timeout}ms; it is ${this.status}: ${this._reason()}`,
              ),
            ),
          ),
        timeout,
      );
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.off('status', check);
        this.off('failure', check);
        fn();
      };
      this.on('status', check);
      this.on('failure', check);
      check();
    });
  }

  /** Stops the app and waits for the worker process to end */
  async stop(timeout = 10000): Promise<void> {
    this._stopping = true;
    if (this._child.exitCode !== null || this._child.signalCode) return;
    if (this._child.connected) this._child.send({ type: 'stop' });
    const killer = setTimeout(() => this._child.kill('SIGKILL'), timeout);
    await this._exited;
    clearTimeout(killer);
  }

  protected _onMessage(msg: WorkerMessage) {
    switch (msg.type) {
      case 'log':
        this.logs.push({
          level: msg.level,
          source: msg.source,
          message: msg.message,
        });
        this.emit('log', msg);
        break;
      case 'status':
        this.status = msg.status;
        this.statusMessage = msg.message;
        this.emit('status', msg.status, msg.message);
        break;
      case 'component-status':
        this.components.set(msg.path, {
          status: msg.status,
          message: msg.message,
        });
        this.emit('component-status', msg.path, msg.status, msg.message);
        break;
      case 'invalid':
        this._fail(
          'The app could not be created:\n  ' +
            msg.issues
              .map(
                i => `- ${i.message}${i.location ? ` (/${i.location})` : ''}`,
              )
              .join('\n  '),
        );
        break;
      case 'failed':
        this._fail(msg.message);
        break;
      case 'loaded':
        for (const uri of msg.classes)
          this.components.set(uri, { status: 'loaded', message: '' });
        this.status = 'loaded';
        this.emit('status', 'loaded', '');
        break;
      case 'created':
        for (const p of msg.components)
          this.components.set(p, { status: 'created', message: '' });
        this.status = 'created';
        this.emit('status', 'created', '');
        break;
      case 'stopped':
        this.status = 'stopped';
        this.emit('status', 'stopped', '');
        break;
    }
  }

  /** The status message, else the last error the worker logged */
  protected _reason(): string {
    if (this.statusMessage) return this.statusMessage;
    const error = this.logs.findLast(l =>
      ['fatal', 'critical', 'error'].includes(l.level),
    );
    return error?.message || 'no reason was given';
  }

  protected _fail(message: string) {
    if (this.failure) return;
    this.failure = message;
    this.emit('failure', message);
  }
}

/**
 * Starts `profile` in a new worker process with `plan`: the plan is written
 * to the data directory, the plan's loader is preloaded, the planned
 * packages are registered and the app is created and started.
 * Resolves once the worker has received the profile; follow it with
 * `waitForStatus`.
 */
export async function startWorker(
  options: StartWorkerOptions,
): Promise<WorkerProcess> {
  const planFile = writeWorkerPlan(options.plan, options.dataDirectory);
  const child = fork(fileURLToPath(WORKER_URL), [], {
    execArgv: [...(options.execArgv || []), '--import', LOADER_URL],
    env: {
      ...(options.env || process.env),
      SB_WORKER_PLAN: planFile,
      SB_WORKER_DATA_DIRECTORY: options.dataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const worker = new WorkerProcess(child);
  /* Output that does not go through the logger, such as a crash */
  const capture = (level: string) => (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/))
      if (line.trim()) worker.logs.push({ level, message: line });
  };
  child.stdout?.on('data', capture('info'));
  child.stderr?.on('data', capture('error'));
  await new Promise<void>((resolve, reject) => {
    const onMessage = (msg: WorkerMessage) => {
      if (msg?.type !== 'ready') return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `The worker process exited with code ${code} before it was ready` +
            tail(worker.logs),
        ),
      );
    };
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
  child.send({
    type: options.loadOnly ? 'load' : options.createOnly ? 'create' : 'start',
    profile: options.profile,
  });
  return worker;
}

function tail(logs: WorkerLogRecord[]): string {
  const lines = logs.slice(-15).map(l => '  ' + l.message);
  return lines.length ? ':\n' + lines.join('\n') : '';
}
