/**
 * The entry module of a worker started with `startWorker`. The worker's
 * plan is already in place: `loader.ts` was preloaded with `--import` and
 * installed its resolve hooks. This module registers the planned packages,
 * then runs the app of the profile the host sends with
 * AppWorker, as a SyncBridge worker does, and reports back over IPC.
 * Sent `create` rather than `start`, it loads every class of the planned
 * packages and creates the app, without initializing or starting it;
 * sent `load`, it only loads them - a package of components alone.
 * Its host gone (crashed, killed) or a stop signal, it stops and ends: it
 * is never left running alone.
 */
import process from 'node:process';
import type { ILogger, Profile } from '@syncbridge/common';
import { AppWorker } from './app-worker.js';
import { readWorkerPlan } from './loader.js';
import {
  componentPaths,
  loadPlanClasses,
  planClasses,
  registerPlanPackages,
} from './register.js';
import type { WorkerMessage } from './worker-messages.js';

const LEVELS = [
  'fatal',
  'critical',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

const worker = new AppWorker({
  dataDirectory: process.env.SB_WORKER_DATA_DIRECTORY || '',
});
const logger = createLogger();
worker.on('error', err => logger.error(err));
worker.on('status-change', (status, message) =>
  send({ type: 'status', status, message }),
);
worker.on('component-status-change', (_component, info) =>
  send({
    type: 'component-status',
    path: info.path,
    status: info.status,
    message: info.statusMessage,
  }),
);

/** Sent while the host is there: a message to none is dropped */
function send(msg: WorkerMessage) {
  if (process.connected) process.send?.(msg);
}

function text(value: any): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  return JSON.stringify(value);
}

/** A logger that sends every record to the host */
function createLogger(source?: string): ILogger {
  const out: any = { level: 'trace' };
  for (const level of LEVELS) {
    out[level] = (message: any) => {
      send({ type: 'log', level, source, message: text(message) });
      return out;
    };
  }
  out.child = (options: any) =>
    createLogger(options?.label || options?.name || options?.path || source);
  out.close = () => undefined;
  return out;
}

/** Registers the plan's packages and creates the app; false if invalid */
async function create(profile: Profile, loadAll: boolean): Promise<boolean> {
  const plan = readWorkerPlan();
  if (!plan) throw new Error('The worker was started without a plan');
  const errors = await registerPlanPackages(plan);
  if (loadAll && !errors.length) errors.push(...(await loadPlanClasses(plan)));
  if (errors.length) throw new Error(errors.map(e => e.message).join('\n'));
  const { issues } = await worker.updateProfile(profile, logger);
  if (issues?.length) {
    send({
      type: 'invalid',
      issues: issues.map(i => ({
        message: i.message,
        location: (i as any).location,
      })),
    });
    return false;
  }
  return true;
}

async function start(profile: Profile) {
  if (await create(profile, false)) await worker.start();
}

/** Registers the plan's packages and loads each of their classes alone */
async function loadOnly() {
  const plan = readWorkerPlan();
  if (!plan) throw new Error('The worker was started without a plan');
  const errors = await registerPlanPackages(plan);
  if (!errors.length) errors.push(...(await loadPlanClasses(plan)));
  if (errors.length) throw new Error(errors.map(e => e.message).join('\n'));
  send({ type: 'loaded', classes: planClasses(plan) });
}

async function createOnly(profile: Profile) {
  if (await create(profile, true))
    send({ type: 'created', components: componentPaths(worker.app!) });
}

/** How long ending waits for what the app left open */
const END_MS = 2000;

let stopping: Promise<void> | undefined;
/** Stops the app, tells the host, and ends: what it left open too */
function stop(): Promise<void> {
  return (stopping ??= (async () => {
    try {
      await worker.stop();
    } finally {
      send({ type: 'stopped' });
      setTimeout(() => {
        if (process.connected) process.disconnect?.();
        setTimeout(() => process.exit(0), END_MS).unref();
      }, 100).unref();
    }
  })());
}

/* Its host gone, or told to end: stopped well, not left running */
const end = () => {
  stop().catch(() => process.exit(1));
};
process.on('disconnect', end);
process.on('SIGTERM', end);
process.on('SIGINT', end);

process.on('message', (msg: any) => {
  if (msg?.type === 'start') {
    start(msg.profile).catch(e => send({ type: 'failed', message: text(e) }));
  } else if (msg?.type === 'load') {
    loadOnly().catch(e => send({ type: 'failed', message: text(e) }));
  } else if (msg?.type === 'create') {
    createOnly(msg.profile).catch(e =>
      send({ type: 'failed', message: text(e) }),
    );
  } else if (msg?.type === 'stop') {
    end();
  }
});
process.on('uncaughtException', e =>
  send({ type: 'log', level: 'error', message: text(e) }),
);
send({ type: 'ready' });
