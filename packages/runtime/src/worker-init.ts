import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ILogger } from '@syncbridge/common';
import { SbError } from '@syncbridge/common';
import { packageManager } from './package-manager.js';
import type { WorkerPlan, WorkerPlanPackage } from './plan.js';

/**
 * A worker's installation, as its last successful init left it. Written to
 * `init.json` in the worker's directory.
 */
export interface WorkerInitRecord {
  /** planDigest of the plan it was installed for */
  digest: string;
  /** The installed registry packages: name -> version */
  packages: Record<string, string>;
  /** The directory the installation is in, relative to the worker's */
  depsDir: string;
  /** When the init finished, ISO 8601 */
  initializedAt: string;
  /** How long it took, in ms */
  duration: number;
  /**
   * The host's packages it is linked to: name -> real directory. Another
   * host (another version of SyncBridge) is linked anew.
   */
  host?: Record<string, string>;
}

export type WorkerInitState =
  /** The plan installs nothing: every package is the host's */
  | 'not-needed'
  /** Installed for this plan */
  | 'ready'
  /** Installed for this plan, but the files are gone: reinstall the same versions */
  | 'needs-restore'
  /**
   * Installed for this plan, linked to another host's packages (SyncBridge
   * updated): installed again, the lockfile seeding it - the same versions -
   * the host's packages linked anew
   */
  | 'needs-relink'
  /** Never installed, or installed for another plan */
  | 'needs-init';

export interface InitWorkerOptions {
  plan: WorkerPlan;
  /** The worker's directory: init.json and the deps-<digest> installations */
  workerDir: string;
  /** pnpm's store; on the same filesystem as workerDir, for hardlinks */
  storeDir: string;
  /** The host's directory, whose node_modules provides the shared packages */
  hostDir: string;
  /**
   * Reinstall the versions of the last init from its lockfile rather than
   * resolve the ranges again (`needs-restore`)
   */
  frozen?: boolean;
  /**
   * A copy of the last init's lockfile kept elsewhere, used when the
   * installation's own is gone too
   */
  lockfile?: string;
  /** See packageManager.install */
  pnpm?: string[];
  logger?: ILogger;
  abortSignal?: AbortSignal;
}

/**
 * A library installed in more than one version because the packages that
 * use it ask for ranges no single version satisfies: objects passed between
 * them are of different classes.
 */
export interface WorkerDuplicate {
  name: string;
  /** version -> the packages that use it */
  versions: Record<string, string[]>;
}

export interface InitWorkerResult {
  record: WorkerInitRecord;
  /** Libraries the installed packages use in different versions */
  duplicates: WorkerDuplicate[];
  /** The plan, its installed packages pointing at the installation */
  plan: WorkerPlan;
}

const INIT_FILE = 'init.json';
const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Identifies what a plan installs: its installed packages and their
 * versions. Two plans with the same digest share an installation.
 */
export function planDigest(plan: WorkerPlan): string {
  const list = installedPackages(plan)
    .map(p => `${p.name}@${p.version}`)
    .sort();
  return createHash('sha256')
    .update(list.join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** The worker's last successful init, if it had one */
export function readWorkerInit(
  workerDir: string,
): WorkerInitRecord | undefined {
  const file = path.join(workerDir, INIT_FILE);
  if (!fs.existsSync(file)) return;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
}

/**
 * Whether the worker can start with `plan` as it is installed; with
 * `hostDir`, linked to that host's packages too
 */
export function workerInitState(
  plan: WorkerPlan,
  workerDir: string,
  hostDir?: string,
): WorkerInitState {
  if (!installedPackages(plan).length) return 'not-needed';
  const record = readWorkerInit(workerDir);
  if (record?.digest !== planDigest(plan)) return 'needs-init';
  const dir = path.join(workerDir, record.depsDir);
  if (!fs.existsSync(path.join(dir, 'node_modules'))) return 'needs-restore';
  if (hostDir && !sameLinks(record.host, hostLinks(plan, hostDir)))
    return 'needs-relink';
  return 'ready';
}

const sameLinks = (
  a: Record<string, string> | undefined,
  b: Record<string, string>,
) =>
  !!a &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(b).every(([name, dir]) => a[name] === dir);

/**
 * The host's packages an installation links, and where they are: the
 * shared packages and the module packages the host has
 */
export function hostLinks(
  plan: WorkerPlan,
  hostDir: string,
): Record<string, string> {
  const links: Record<string, string> = {};
  const provided = new Set([
    ...plan.shared,
    ...Object.values(plan.packages)
      .filter(p => p.source === 'module')
      .map(p => p.name),
  ]);
  for (const name of [...provided].sort()) {
    const dir = findHostPackage(name, hostDir);
    if (dir) links[name] = dir;
  }
  return links;
}

/**
 * The plan as the worker runs it once installed: each installed package
 * is the copy in the worker's installation. `undefined` when the worker is
 * not installed for the plan; the plan itself when it installs nothing.
 */
export function installedWorkerPlan(
  plan: WorkerPlan,
  workerDir: string,
  hostDir?: string,
): WorkerPlan | undefined {
  const state = workerInitState(plan, workerDir, hostDir);
  if (state === 'not-needed') return plan;
  if (state !== 'ready') return;
  const record = readWorkerInit(workerDir)!;
  return rewritePlan(plan, path.join(workerDir, record.depsDir));
}

/**
 * Installs what a worker loads, together, as one project would: the plan's
 * installed packages with `file:`, the packages the host provides with
 * `link:` to the host's copies, and pnpm resolves the rest - npm
 * dependencies and the peers nobody provides - into one tree, a single copy
 * of each library where the ranges allow it.
 *
 * Installs into a new directory and switches init.json to it only when
 * pnpm succeeded and the installed versions are the plan's, so a failed
 * init leaves the previous installation as it was. The previous lockfile
 * seeds the new one: packages the plan did not change keep their versions.
 */
export async function initWorker(
  options: InitWorkerOptions,
): Promise<InitWorkerResult> {
  const started = Date.now();
  const { plan, workerDir, logger } = options;
  const digest = planDigest(plan);
  const packages = installedPackages(plan);
  const previous = readWorkerInit(workerDir);
  const depsDir = 'deps-' + digest;
  const target = path.join(workerDir, depsDir);
  fs.mkdirSync(workerDir, { recursive: true });

  logger?.info(
    `Initializing for ${packages.map(p => `${p.name}@${p.version}`).join(', ') || 'no packages'}` +
      (options.frozen ? ', from the last lockfile' : ''),
  );
  const temp = path.join(workerDir, `.${depsDir}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(temp, { recursive: true });
  try {
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify(
        {
          name: 'sb-worker',
          private: true,
          dependencies: repoDependencies(plan, options.hostDir),
        },
        null,
        2,
      ),
    );
    /* Restoring takes this plan's lockfile only; a new init starts from the
     * previous one, whatever plan it was for */
    const seed = [
      path.join(target, LOCKFILE),
      options.frozen
        ? options.lockfile
        : previous && path.join(workerDir, previous.depsDir, LOCKFILE),
    ].find(f => f && fs.existsSync(f));
    if (seed) fs.copyFileSync(seed, path.join(temp, LOCKFILE));
    else if (options.frozen)
      throw new SbError(
        `There is no lockfile to restore the worker's packages from`,
        { code: 'WORKER_INIT_FAILED' },
      );

    await packageManager.install({
      cwd: temp,
      storeDir: options.storeDir,
      pnpm: options.pnpm,
      args: options.frozen
        ? ['--frozen-lockfile', '--prefer-offline']
        : ['--prefer-offline'],
      outputLevel: 'info',
      logger,
      abortSignal: options.abortSignal,
    });

    const wrong: string[] = [];
    for (const p of packages) {
      const file = path.join(temp, 'node_modules', p.name, 'package.json');
      const version = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8')).version
        : undefined;
      if (version !== p.version)
        wrong.push(
          `${p.name}: planned ${p.version}, installed ${version ?? 'none'}`,
        );
    }
    if (wrong.length)
      throw new SbError(
        `The installation does not match the plan:\n  ${wrong.join('\n  ')}`,
        { code: 'WORKER_INIT_FAILED' },
      );

    /* The switch: the previous installation of this digest, if any, goes
     * aside first, so init.json never names a half-replaced directory */
    const aside = fs.existsSync(target) ? target + '.old-' + Date.now() : '';
    if (aside) fs.renameSync(target, aside);
    fs.renameSync(temp, target);
    const record: WorkerInitRecord = {
      digest,
      packages: Object.fromEntries(packages.map(p => [p.name, p.version])),
      depsDir,
      initializedAt: new Date().toISOString(),
      duration: Date.now() - started,
      host: hostLinks(plan, options.hostDir),
    };
    const initFile = path.join(workerDir, INIT_FILE);
    fs.writeFileSync(initFile + '.tmp', JSON.stringify(record, null, 2));
    fs.renameSync(initFile + '.tmp', initFile);
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
    const installed = rewritePlan(plan, target);
    const duplicates = findDuplicates(installed);
    for (const d of duplicates)
      logger?.warn(
        `${d.name} is installed in ${Object.keys(d.versions).length} versions: ` +
          Object.entries(d.versions)
            .map(([v, by]) => `${v} for ${by.join(', ')}`)
            .join('; ') +
          `. Objects passed between these packages are of different classes`,
      );
    logger?.info(`Initialized in ${(record.duration / 1000).toFixed(1)} s`);
    return { record, duplicates, plan: installed };
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Removes the worker's installations other than the current one - those of
 * earlier inits. Not while a worker process may still run from one.
 */
export function removeStaleInstallations(workerDir: string): string[] {
  const record = readWorkerInit(workerDir);
  if (!fs.existsSync(workerDir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(workerDir)) {
    const stale =
      (entry.startsWith('deps-') && entry !== record?.depsDir) ||
      entry.startsWith('.deps-');
    if (!stale) continue;
    fs.rmSync(path.join(workerDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

/**
 * The libraries the installed packages depend on directly - dependencies
 * and peers - resolved from each package's copy, that are not the same
 * version for all of them
 */
function findDuplicates(plan: WorkerPlan): WorkerDuplicate[] {
  const used = new Map<string, Map<string, string[]>>();
  for (const p of installedPackages(plan)) {
    const json = JSON.parse(
      fs.readFileSync(path.join(p.path, 'package.json'), 'utf8'),
    );
    const names = new Set([
      ...Object.keys(json.dependencies || {}),
      ...Object.keys(json.peerDependencies || {}),
    ]);
    for (const name of names) {
      const version = resolvedVersion(name, p.path);
      if (!version) continue;
      const versions = used.get(name) || new Map<string, string[]>();
      versions.set(version, [...(versions.get(version) || []), p.name]);
      used.set(name, versions);
    }
  }
  return [...used]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({
      name,
      versions: Object.fromEntries(versions),
    }));
}

/** The version of `name` Node.js finds from the package in `dir` */
function resolvedVersion(name: string, dir: string): string | undefined {
  for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) {
    if (path.basename(d) === 'node_modules') continue;
    const file = path.join(d, 'node_modules', name, 'package.json');
    if (fs.existsSync(file))
      return JSON.parse(fs.readFileSync(file, 'utf8')).version;
  }
}

function installedPackages(plan: WorkerPlan): WorkerPlanPackage[] {
  return Object.values(plan.packages).filter(p => p.source === 'installed');
}

/**
 * The installation's package.json dependencies: the installed packages
 * from their directories, and what the host provides - the shared packages
 * and the module packages - linked to the host's copies, which the
 * packages' peers resolve to
 */
function repoDependencies(
  plan: WorkerPlan,
  hostDir: string,
): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const [name, dir] of Object.entries(hostLinks(plan, hostDir)))
    deps[name] = 'link:' + dir;
  for (const p of installedPackages(plan)) deps[p.name] = 'file:' + p.path;
  return deps;
}

/** The real directory of a package the host resolves from `hostDir` */
function findHostPackage(name: string, hostDir: string): string | undefined {
  for (let dir = path.resolve(hostDir); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json')))
      return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) return;
  }
}

/** The plan with its installed packages at their copies in `depsDir` */
function rewritePlan(plan: WorkerPlan, depsDir: string): WorkerPlan {
  const packages: Record<string, WorkerPlanPackage> = {};
  for (const [name, p] of Object.entries(plan.packages)) {
    if (p.source !== 'installed') {
      packages[name] = p;
      continue;
    }
    const dir = fs.realpathSync(path.join(depsDir, 'node_modules', p.name));
    const entry = p.entryPoint.startsWith('file:')
      ? fileURLToPath(p.entryPoint)
      : p.entryPoint;
    packages[name] = {
      ...p,
      path: dir,
      entryPoint: path.join(dir, path.relative(p.path, entry)),
    };
  }
  return { ...plan, packages };
}
