import fs from 'node:fs';
import path from 'node:path';
import type {
  AppExtension,
  AppMetadata,
  ElementComponentMetadataRecord,
  ExtensionPackage,
} from '@syncbridge/common';
import { SbError } from '@syncbridge/common';
import semver from 'semver';

/**
 * One registry package a worker loads, at the one version it loads.
 */
export interface WorkerPlanPackage {
  name: string;
  version: string;
  /** The package's directory */
  path: string;
  /** The module the package's classes are imported from */
  entryPoint: string;
  /**
   * `installed` packages live in an extension directory and are registered
   * from their metadata files; `module` packages are npm packages the engine
   * resolves itself (`config.extensions`) and are registered by importing them.
   */
  source: 'installed' | 'module';
}

/**
 * What a worker is allowed to load, decided before it starts: one version of
 * each registry package, and the modules it must share with the host.
 */
export interface WorkerPlan {
  packages: Record<string, WorkerPlanPackage>;
  /**
   * Bare specifiers always resolved from the host, never from an extension's
   * own directory - the packages whose classes and metadata must be the
   * host's instance.
   */
  shared: string[];
  /** The URL shared and unresolvable specifiers are resolved from */
  hostURL: string;
}

/** Where the packages a plan picks versions of are found */
export interface ComputePlanSource {
  /** Installed versions of a package, newest first */
  versionsOf: (name: string) => ExtensionPackage[] | undefined;
  isInstalled: (pkg: ExtensionPackage) => boolean;
  hostURL: string;
  /**
   * Refuse packages a process could not load from disk. Off only to check
   * versions when nothing is about to be started.
   */
  requireFiles?: boolean;
}

export interface ComputeWorkerPlanArgs extends ComputePlanSource {
  app: AppExtension;
  metadata?: AppMetadata;
}

/** A package a plan starts from, and the range it is wanted at */
export interface PlanRoot {
  name: string;
  range: string;
  /** Who wants it, for the errors: `the profile`, `plugin "x"` */
  by: string;
}

export interface ComputePlanArgs extends ComputePlanSource {
  roots: PlanRoot[];
}

/** Always shared, whether or not a package declares it as a peer */
const ALWAYS_SHARED = ['@syncbridge/common'];

/** A selection that keeps changing after this many rounds is a conflict */
const MAX_ROUNDS = 20;

interface Requirement {
  range: string;
  by: string;
}

/**
 * Picks one version of every registry package a worker needs.
 *
 * The roots are the app, at the version the profile resolved to, and
 * the package of every component its metadata assigns; see computePlan.
 */
export function computeWorkerPlan(args: ComputeWorkerPlanArgs): WorkerPlan {
  const roots: PlanRoot[] = [
    {
      name: args.app.pkg.name,
      range: args.app.version,
      by: 'the profile',
    },
  ];
  const walk = (components?: ElementComponentMetadataRecord) => {
    for (const [key, cmp] of Object.entries(components || {})) {
      const name = cmp.classUri?.split(':')[0];
      if (name) roots.push({ name, range: '*', by: `component "${key}"` });
      walk(cmp.components);
    }
  };
  walk(args.metadata?.components);
  return computePlan({ ...args, roots });
}

/**
 * Picks one version of every registry package that the roots need.
 *
 * Each selected package's manifest `dependencies` add requirements, and
 * each package gets the newest installed version that satisfies all of
 * them. Selecting a different version can change the requirements it
 * brings, so the selection is repeated until it stops changing.
 *
 * Throws an SbError listing every package that could not be resolved, with
 * who asked for which range.
 */
export function computePlan(args: ComputePlanArgs): WorkerPlan {
  const roots = new Map<string, Requirement[]>();
  const addTo = (
    map: Map<string, Requirement[]>,
    name: string,
    req: Requirement,
  ) => {
    let list = map.get(name);
    if (!list) map.set(name, (list = []));
    list.push(req);
  };
  for (const r of args.roots)
    addTo(roots, r.name, { range: r.range, by: r.by });

  let selected = new Map<string, ExtensionPackage>();
  let problems: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reqs = new Map<string, Requirement[]>();
    for (const [name, list] of roots)
      for (const r of list) addTo(reqs, name, r);
    for (const pkg of selected.values()) {
      for (const [name, range] of Object.entries(pkg.registryDependencies))
        addTo(reqs, name, { range, by: `${pkg.name}@${pkg.version}` });
    }

    const next = new Map<string, ExtensionPackage>();
    problems = [];
    for (const [name, list] of reqs) {
      const versions = args.versionsOf(name);
      if (!versions?.length) {
        problems.push(
          `"${name}" is not installed (required by ${list.map(r => r.by).join(', ')})`,
        );
        continue;
      }
      const pkg = versions.find(v =>
        list.every(r => semver.satisfies(v.version, r.range)),
      );
      if (!pkg) {
        problems.push(
          `No installed version of "${name}" satisfies ` +
            list.map(r => `${r.range} (${r.by})`).join(', ') +
            `. Installed: ${versions.map(v => v.version).join(', ')}`,
        );
        continue;
      }
      next.set(name, pkg);
    }

    const stable =
      next.size === selected.size &&
      [...next].every(([name, pkg]) => selected.get(name) === pkg);
    selected = next;
    if (stable) break;
    if (round === MAX_ROUNDS - 1)
      problems.push('Dependency versions did not settle on one selection');
  }
  /* A class registered directly (`ExtensionRegistry.registerClass`) has no
   * package on disk for a worker process to load */
  for (const pkg of selected.values()) {
    if (args.requireFiles !== false && (!pkg.path || !pkg.entryPoint))
      problems.push(
        `"${pkg.name}@${pkg.version}" was registered without a package directory and cannot be loaded from disk`,
      );
  }
  if (problems.length) {
    throw new SbError(
      'Unable to resolve extension package versions.\n  ' +
        problems.join('\n  '),
      { code: 'WORKER_PLAN_FAILED' },
    );
  }

  const shared = new Set(ALWAYS_SHARED);
  const packages: Record<string, WorkerPlanPackage> = {};
  for (const pkg of selected.values()) {
    for (const name of Object.keys(pkg.peerDependencies)) shared.add(name);
    packages[pkg.name] = {
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      entryPoint: pkg.entryPoint,
      source: args.isInstalled(pkg) ? 'installed' : 'module',
    };
  }
  return { packages, shared: [...shared], hostURL: args.hostURL };
}

/** Writes the plan where the worker reads it from, returning its path */
export function writeWorkerPlan(plan: WorkerPlan, directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'worker-plan.json');
  fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
  return filename;
}
