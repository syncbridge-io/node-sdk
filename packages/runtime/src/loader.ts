/**
 * Loaded into every worker with `--import`, before anything else, when the
 * worker has a plan (`SB_WORKER_PLAN`). It resolves module specifiers the way
 * the plan says:
 *
 * - `sb:@vendor/name` -> the one version of that registry package the plan
 *   selected. So is one of SyncBridge's modules imported under its own
 *   name, `@syncbridge/builtins`.
 * - A shared package (`@syncbridge/common`, and every peer the plan's
 *   packages declare) -> the host's copy, even when the importing extension
 *   carries its own. Those modules hold the registry, the decorators'
 *   metadata and the error classes, and must be one instance.
 * - A bare specifier an installed extension cannot resolve -> the host. An
 *   extension directory is outside the engine's tree, so Node's lookup never
 *   reaches the engine's `node_modules`; `NODE_PATH` does not help, ESM ignores
 *   it.
 * - Everything else -> Node's own resolution.
 *
 * `module.registerHooks` runs in the worker's own thread and covers both
 * `import` and `require`.
 */
import fs from 'node:fs';
import nodeModule from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isSyncBridgeModule, parseSbSpecifier } from '@syncbridge/common';
import type { WorkerPlan } from './plan.js';

/** Starts with `.`, `/` or a URL scheme such as `node:` or `file:` */
const NOT_BARE = /^(\.|\/|[a-zA-Z][a-zA-Z\d+.-]*:)/;

/**
 * Installs the resolve hook for a plan. Returns the hooks handle, so a test
 * can deregister it.
 */
export function installWorkerHooks(plan: WorkerPlan) {
  if (typeof nodeModule.registerHooks !== 'function') {
    throw new Error(
      'SyncBridge workers require Node.js 22.15 or later (module.registerHooks)',
    );
  }
  /* Both the path as planned and its real path: Node reports the importing
   * module by its real path, which differs when a directory is a symlink */
  const installedDirs = Object.values(plan.packages)
    .filter(p => p.source === 'installed')
    .flatMap(p => [p.path, realpath(p.path)])
    .map(p => pathToFileURL(p + path.sep).href);
  const isShared = (specifier: string) =>
    plan.shared.some(n => specifier === n || specifier.startsWith(n + '/'));
  const fromInstalled = (parentURL?: string) =>
    !!parentURL && installedDirs.some(d => parentURL.startsWith(d));

  return nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const sb = parseSbSpecifier(specifier) || plannedModule(specifier, plan);
      if (sb) {
        const pkg = plan.packages[sb.name];
        if (!pkg) {
          throw new Error(
            `"${specifier}" is not in this worker's plan. Planned packages: ` +
              (Object.keys(plan.packages).join(', ') || 'none'),
          );
        }
        const url =
          sb.subpath === '.'
            ? toFileURL(pkg.entryPoint)
            : pathToFileURL(path.join(pkg.path, sb.subpath)).href;
        return { url, shortCircuit: true };
      }
      if (isShared(specifier)) {
        try {
          return next(specifier, { ...context, parentURL: plan.hostURL });
        } catch (e: any) {
          /* Node names the host as the importer; the file that imports it
           * says more */
          if (isNotFound(e) && context.parentURL)
            e.message += ` (shared, provided by the host; imported by ${context.parentURL})`;
          throw e;
        }
      }
      try {
        return next(specifier, context);
      } catch (e: any) {
        if (
          isNotFound(e) &&
          !NOT_BARE.test(specifier) &&
          fromInstalled(context.parentURL)
        ) {
          try {
            return next(specifier, { ...context, parentURL: plan.hostURL });
          } catch (hostError: any) {
            /* Not in the host either: the error that names the importing
             * file says who is missing a dependency, the host's does not */
            if (isNotFound(hostError)) throw e;
            throw hostError;
          }
        }
        throw e;
      }
    },
  });
}

/**
 * One of SyncBridge's modules imported under its own name -
 * `@syncbridge/builtins/sub` - that the plan has a version of: resolved as
 * `sb:@syncbridge/builtins/sub` is. One the plan has none of is left to
 * the rest of the resolution, the host's copy.
 */
function plannedModule(
  specifier: string,
  plan: WorkerPlan,
): { name: string; subpath: string } | undefined {
  const m = /^(@syncbridge\/[^/]+)(\/.*)?$/.exec(specifier);
  if (!m || !isSyncBridgeModule(m[1]) || !plan.packages[m[1]]) return;
  return { name: m[1], subpath: m[2] ? '.' + m[2] : '.' };
}

/**
 * Whether resolving failed for want of the module. Another loader in the
 * chain may throw its own error for it, so the message is checked as well
 * as Node's codes.
 */
function isNotFound(e: any): boolean {
  return (
    e?.code === 'ERR_MODULE_NOT_FOUND' ||
    e?.code === 'MODULE_NOT_FOUND' ||
    /Cannot find (module|package)/.test(e?.message)
  );
}

/** Reads the plan the host wrote for this worker, if it wrote one */
export function readWorkerPlan(): WorkerPlan | undefined {
  const filename = process.env.SB_WORKER_PLAN;
  if (!filename) return;
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function realpath(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function toFileURL(p: string) {
  return p.startsWith('file:') ? p : pathToFileURL(p).href;
}

/* Runs when the worker preloads this module with `--import` */
if (process.env.SB_WORKER_PLAN) {
  installWorkerHooks(readWorkerPlan()!);
}
