import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  decodeProfileSilent,
  type ExtensionPackage,
  ExtensionRegistry,
  initializeModelsDocument,
  isSyncBridgeModule,
  manifestOf,
  missingPermissionOf,
  nodePermissionArgs,
  Profile,
  SbError,
  toSbextName,
  WorkerPermission,
  workerPermissionsOf,
} from '@syncbridge/common';
import {
  computePlan,
  computeWorkerPlan,
  hostPackageVersion,
  installPackage,
  loadExtensionPackage,
  startWorker,
  type WorkerPlan,
} from '@syncbridge/runtime';
import * as jsonc from 'jsonc-parser';
import semver from 'semver';
import * as yaml from 'yaml';
import { packPackage } from '../pack-package.js';
import {
  findWorkspaceNpmPackage,
  findWorkspacePackage,
  type WorkspacePackage,
} from '../workspace.js';

export interface VerifyOptions {
  packageDir?: string;
  tsconfig?: string;
  /**
   * Profile files (YAML or JSON), or directories of them - one app
   * each; default: each app with its default values
   */
  profile?: string | string[];
  /** Archives of registry packages to install before the package */
  with?: string[];
  /** Leave the sandbox in place, for inspection */
  keep?: boolean;
  /**
   * pnpm's store the packages' npm dependencies are hardlinked from:
   * shared by every verify, so what is downloaded once is not again (a
   * workspace verifying its packages side by side). Default:
   * SB_SPM_STORE_DIR, else <XDG_CACHE_HOME or ~/.cache>/syncbridge/pnpm-store
   */
  storeDir?: string;
  /** How long creating an app may take, in ms */
  timeout?: number;
  /** Node.js options for the worker */
  execArgv?: string[];
  /**
   * Node's permission model, as SyncBridge holds a worker to it: native
   * addons and other programs as the app and its components declare them.
   * Default true; off only where the worker's own hooks are native code
   * (TypeScript sources run by a native transpiler, in tests)
   */
  permissionModel?: boolean;
  logger?: (message: string) => void;
}

export interface VerifyAppResult {
  /** The app; the package, when it has components or plugins alone */
  app: string;
  /** Created; loaded, for a package of components or plugins alone */
  created: boolean;
  /**
   * A package of components or plugins alone: its classes loaded, no app
   * created
   */
  loadOnly?: boolean;
  /**
   * Apps of a package loaded alone that were not created: none of their
   * default values is valid - a required component is to be chosen - so
   * creating them takes a profile
   */
  notCreated?: string[];
  /** Why it could not be created */
  message?: string;
  /**
   * The paths of the components it was created with; the URIs of the
   * classes loaded, for a package of components alone
   */
  components: string[];
}

export interface VerifyResult {
  ok: boolean;
  apps: VerifyAppResult[];
  /** The sandbox, when it was kept */
  sandbox?: string;
}

/**
 * `spm verify`: whether SyncBridge can install and load the package,
 * without SyncBridge. The package is packed, installed into a sandbox with
 * the engine's install steps, and in a worker process with its version plan
 * and resolve hooks, every app and component class of it is loaded
 * and each app is created from a profile. A package of components alone,
 * with no profile given, has its classes loaded, as its worker would; so
 * does one of plugins, whose classes the engine loads in its own process
 * from an installation like a worker's.
 *
 * Apps are not initialized or started: what starting needs - a
 * device, a database, a service - is the environment's, not the package's,
 * and verify cannot tell one from the other. Whether the app works is
 * for the package's tests.
 *
 * Registry packages it depends on come from `--with` archives, then from
 * the project: a package of the same workspace is packed and installed as
 * the package is, else the npm mirror's `@sbext/` copy in node_modules is
 * used as installed. The project is the host: peers such as
 * `@syncbridge/common` are its copies.
 */
export async function verifyPackage(
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const log = options.logger || (() => undefined);
  const packageDir = path.resolve(options.packageDir || '.');
  const pkgJson = readJson(path.join(packageDir, 'package.json'));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'spm-verify-'));
  const dirs = {
    dist: path.join(sandbox, 'dist'),
    installed: path.join(sandbox, 'extensions'),
    temp: path.join(sandbox, 'tmp'),
    data: path.join(sandbox, 'data'),
    host: path.join(sandbox, 'host'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  /* The store outlives the sandbox: what it holds is only ever added to */
  const storeDir = path.resolve(options.storeDir || defaultStoreDir());
  fs.mkdirSync(storeDir, { recursive: true });
  /* Pack's temporary directory stays in the project, where `spm pack` has
   * it: the package is imported from there to read its metadata, and
   * resolves its modules from the project */
  const cacheDir = path.join(packageDir, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const packTemp = fs.mkdtempSync(path.join(cacheDir, 'spm-verify-'));

  try {
    /* 1. Pack, as `spm pack` does */
    const buildConfig = {
      pack: true,
      packageDir,
      outDir: dirs.dist,
      tempDir: packTemp,
      tsconfig: options.tsconfig,
      logger: log,
    };
    await packPackage(buildConfig);
    const zip = fs.readdirSync(dirs.dist).find(f => f.endsWith('.zip'));
    if (!zip) throw new SbError(`Packing ${pkgJson.name} produced no archive`);

    /* 2. Install: the registry packages it needs, then the package itself */
    createHost(dirs.host);
    const packages = new Map<string, ExtensionPackage[]>();
    const add = (pkg: ExtensionPackage) => {
      const list = packages.get(pkg.name) || [];
      if (!list.some(p => p.version === pkg.version)) list.push(pkg);
      list.sort((a, b) => semver.rcompare(a.version, b.version));
      packages.set(pkg.name, list);
      ExtensionRegistry.storePackage(pkg);
    };
    /* `fromDir`: the sources of the archive, whose workspace's npm packages
     * are installed from there */
    const install = (file: string, fromDir?: string) =>
      installPackage(file, {
        installDir: dirs.installed,
        storeDir,
        tempDir: dirs.temp,
        pnpm: pnpmCommand(),
        overrides: fromDir
          ? workspaceOverrides(
              readJson(path.join(fromDir, 'package.json')),
              fromDir,
              log,
            )
          : undefined,
        versionsOf: name => packages.get(name),
        hostVersionOf: name => hostPackageVersion(name, dirs.host),
      });
    for (const file of options.with || []) {
      const pkg = await install(path.resolve(file));
      log(`Installed ${pkg.name}@${pkg.version} from ${file}`);
      add(pkg);
    }
    /* Packed as `spm pack` would, from its own directory, and installed:
     * once, whether a dependency, a peer the host provides or both */
    const installedWorkspaces = new Map<string, Promise<ExtensionPackage>>();
    const installWorkspace = (ws: WorkspacePackage) => {
      let installed = installedWorkspaces.get(ws.dir);
      if (!installed)
        installedWorkspaces.set(ws.dir, (installed = packWorkspace(ws)));
      return installed;
    };
    const packWorkspace = async (ws: WorkspacePackage) => {
      const outDir = fs.mkdtempSync(path.join(sandbox, 'workspace-'));
      const wsCache = path.join(ws.dir, 'node_modules', '.cache');
      fs.mkdirSync(wsCache, { recursive: true });
      const tempDir = fs.mkdtempSync(path.join(wsCache, 'spm-verify-'));
      try {
        await packPackage({
          pack: true,
          packageDir: ws.dir,
          outDir,
          tempDir,
          tsconfig: ws.tsconfig,
          logger: log,
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      const file = fs.readdirSync(outDir).find(f => f.endsWith('.zip'));
      if (!file)
        throw new SbError(`Packing ${ws.pkgJson.name} produced no archive`);
      return install(path.join(outDir, file), ws.dir);
    };
    const provide = (names: string[], fromDir: string) =>
      provideHostPackages(dirs.host, names, fromDir, installWorkspace, log);
    /* The host provides @syncbridge/common and the package's peers */
    await provide(
      ['@syncbridge/common', ...Object.keys(pkgJson.peerDependencies || {})],
      packageDir,
    );
    const local: LocalContext = {
      packages,
      add,
      installWorkspace,
      provide,
      log,
    };
    await addLocalDependencies(pkgJson, packageDir, local);
    const pkg = await install(path.join(dirs.dist, zip), packageDir);
    log(`Installed ${pkg.name}@${pkg.version}`);
    add(pkg);

    /* 3. Create each app in a worker */
    await initializeModelsDocument();
    const profileFiles = findProfiles(options.profile);
    /* With no profile given, each app with its default values; one that
     * has none that is valid - a required component to be chosen - is
     * not created, its classes loaded with the package's */
    const unprofiled: string[] = [];
    const profiles = profileFiles.length
      ? profileFiles.map(readProfile)
      : (pkg.apps || [])
          .map(
            p =>
              new Profile({
                id: 'verify-' + p.className,
                displayName: p.className,
                appUri: p.uri,
              }),
          )
          .filter(profile => {
            if (decodeProfileSilent(profile).result) return true;
            unprofiled.push(profile.displayName || profile.appUri);
            return false;
          });
    const workerOptions = {
      timeout: options.timeout ?? 30000,
      execArgv: options.execArgv,
      permissionModel: options.permissionModel ?? true,
    };
    const results: VerifyAppResult[] = [];
    if (!profiles.length || unprofiled.length) {
      if (!pkg.apps?.length && !pkg.components?.length && !pkg.plugins?.length)
        throw new SbError(
          `${pkg.name} has no apps, components or plugins; give a profile with --profile`,
        );
      const result = await loadPackage(pkg, {
        ...workerOptions,
        packages,
        hostDir: dirs.host,
        dataDir: path.join(dirs.data, 'load'),
      });
      if (unprofiled.length) result.notCreated = unprofiled;
      results.push(result);
    }
    /* What SyncBridge provides - @syncbridge/net and the like - the profiles
     * name; the engine registers them at its start, the project has them.
     * One of the same workspace - not built where it is linked - is packed
     * and installed, as a dependency of the workspace is */
    const provided = new Set<string>();
    for (const profile of profiles)
      for (const name of profilePackages(profile)) {
        if (packages.has(name)) continue;
        const ws = findWorkspacePackage(name, packageDir);
        if (ws) {
          await addWorkspacePackage(ws, packageDir, local);
          continue;
        }
        const provider = await registerProvided(name, packageDir);
        add(provider);
        provided.add(name);
        /* The worker shares a planned package's peers from the host; the engine
         * has them in its node_modules, the sandbox's host gets the
         * project's */
        await providePeers(provider.path, provide);
        log(
          `Using ${name}@${provider.version} from the project, as SyncBridge provides it`,
        );
      }
    for (const profile of profiles) {
      results.push(
        await runProfile(profile, {
          packages,
          provided,
          ...workerOptions,
          hostDir: dirs.host,
          dataDir: path.join(dirs.data, profile.id || 'profile'),
        }),
      );
    }
    return {
      ok: results.every(r => r.created),
      apps: results,
      sandbox: options.keep ? sandbox : undefined,
    };
  } finally {
    if (!options.keep) fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(packTemp, { recursive: true, force: true });
  }
}

async function runProfile(
  profile: Profile,
  ctx: {
    packages: Map<string, ExtensionPackage[]>;
    /** Packages registered from the project rather than installed */
    provided: Set<string>;
    hostDir: string;
    dataDir: string;
    timeout: number;
    execArgv?: string[];
    permissionModel: boolean;
  },
): Promise<VerifyAppResult> {
  const name = profile.displayName || profile.appUri;
  const result: VerifyAppResult = {
    app: name,
    created: false,
    components: [],
  };
  const extension = ExtensionRegistry.findApp(
    profile.appUri,
    profile.appVersion || '*',
  );
  if (!extension) {
    result.message = `No installed app "${profile.appUri}"`;
    return result;
  }
  const decoded = decodeProfileSilent(profile);
  if (!decoded.result) {
    result.message =
      'The profile is not valid:\n  ' +
      decoded.issues
        .map(i => `- ${i.message}. Location: /${(i as any).location}`)
        .join('\n  ');
    return result;
  }
  let plan;
  try {
    plan = computeWorkerPlan({
      app: extension,
      metadata: decoded.metadata,
      versionsOf: n => ctx.packages.get(n),
      isInstalled: p => !ctx.provided.has(p.name),
      hostURL: pathToFileURL(path.join(ctx.hostDir, 'package.json')).href,
    });
  } catch (e: any) {
    result.message = e.message;
    return result;
  }
  /* What the app and its components declare of the server: all a
   * worker reaches outside Node's permission model */
  const permissions = workerPermissionsOf(decoded.metadata, uri => {
    for (const versions of ctx.packages.values())
      for (const pkg of versions)
        for (const c of pkg.components) if (c.uri === uri) return c.metadata;
  });
  const worker = await startWorker({
    plan,
    profile: decoded.profile,
    dataDirectory: ctx.dataDir,
    execArgv: [
      ...(ctx.execArgv || []),
      ...(ctx.permissionModel ? nodePermissionArgs({ permissions }) : []),
    ],
    createOnly: true,
  });
  try {
    await worker.waitForStatus(['created'], ctx.timeout);
    result.created = true;
    result.components = [...worker.components.keys()];
  } catch (e: any) {
    result.message =
      e.message + missingModuleHint(e.message) + permissionHint(e.message);
  } finally {
    await worker.stop();
  }
  return result;
}

/**
 * Loads every class of a package of components or plugins alone in a
 * worker, under the permission model as what its classes declare permits:
 * its components are created by an app, verified with a profile of one.
 * A package of plugins alone is loaded outside the model: the engine runs
 * its plugins in its own process, which the model does not hold.
 */
async function loadPackage(
  pkg: ExtensionPackage,
  ctx: {
    packages: Map<string, ExtensionPackage[]>;
    hostDir: string;
    dataDir: string;
    timeout: number;
    execArgv?: string[];
    permissionModel: boolean;
  },
): Promise<VerifyAppResult> {
  const result: VerifyAppResult = {
    app: pkg.name,
    created: false,
    loadOnly: true,
    components: [],
  };
  let plan: WorkerPlan;
  try {
    plan = computePlan({
      roots: [{ name: pkg.name, range: pkg.version, by: 'the package' }],
      versionsOf: n => ctx.packages.get(n),
      isInstalled: () => true,
      hostURL: pathToFileURL(path.join(ctx.hostDir, 'package.json')).href,
    });
  } catch (e: any) {
    result.message = e.message;
    return result;
  }
  /* What any of the classes loaded declares: a component's are its
   * worker's once an app is given it */
  const pluginsAlone = !pkg.apps?.length && !pkg.components?.length;
  const permissions = new Set<WorkerPermission>();
  for (const planned of Object.values(plan.packages)) {
    const loaded = ctx.packages
      .get(planned.name)
      ?.find(p => p.version === planned.version);
    for (const e of [...(loaded?.apps || []), ...(loaded?.components || [])])
      for (const p of e.metadata?.permissions || []) permissions.add(p);
  }
  const worker = await startWorker({
    plan,
    dataDirectory: ctx.dataDir,
    execArgv: [
      ...(ctx.execArgv || []),
      ...(ctx.permissionModel && !pluginsAlone
        ? nodePermissionArgs({ permissions: [...permissions] })
        : []),
    ],
    loadOnly: true,
  });
  try {
    await worker.waitForStatus(['loaded'], ctx.timeout);
    result.created = true;
    result.components = [...worker.components.keys()];
  } catch (e: any) {
    result.message =
      e.message + missingModuleHint(e.message) + permissionHint(e.message);
  } finally {
    await worker.stop();
  }
  return result;
}

interface LocalContext {
  packages: Map<string, ExtensionPackage[]>;
  add: (pkg: ExtensionPackage) => void;
  installWorkspace: (ws: WorkspacePackage) => Promise<ExtensionPackage>;
  /** Adds npm packages, as `fromDir` resolves them, to the host */
  provide: (names: string[], fromDir: string) => Promise<void>;
  log: (message: string) => void;
}

/** A package of the workspace packed and installed, after its dependencies */
async function addWorkspacePackage(
  ws: WorkspacePackage,
  fromDir: string,
  ctx: LocalContext,
) {
  await addLocalDependencies(ws.pkgJson, ws.dir, ctx);
  await ctx.provide(Object.keys(ws.pkgJson.peerDependencies || {}), ws.dir);
  ctx.log(
    `Packing workspace dependency ${ws.pkgJson.name}@${ws.pkgJson.version} from ${path.relative(fs.realpathSync(fromDir), ws.dir)}`,
  );
  const pkg = await ctx.installWorkspace(ws);
  ctx.log(`Installed ${pkg.name}@${pkg.version}`);
  ctx.add(pkg);
}

/**
 * Finds the registry packages `pkgJson` depends on in the project, and
 * theirs, recursively: a package of the same workspace whose version
 * satisfies the range is packed and installed, after its own dependencies;
 * otherwise the npm mirror's `@sbext/` copy in node_modules is used as
 * installed - a SyncBridge module's under its own name. A package already
 * given with `--with` is not looked up. One that is not found is left for
 * the plan to report, with who asked for it.
 *
 * A SyncBridge module a package still declares as a peer is a registry
 * dependency, as a server takes it.
 */
async function addLocalDependencies(
  pkgJson: any,
  fromDir: string,
  ctx: LocalContext,
) {
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries<string>(
    pkgJson.peerDependencies || {},
  ))
    if (isSyncBridgeModule(name)) dependencies[name] = range;
  Object.assign(dependencies, manifestOf(fromDir, pkgJson)?.dependencies);
  for (const [name, range] of Object.entries(dependencies)) {
    if (ctx.packages.get(name)?.some(p => semver.satisfies(p.version, range)))
      continue;
    const ws = findWorkspacePackage(name, fromDir);
    if (ws && semver.satisfies(ws.pkgJson.version, range)) {
      await addWorkspacePackage(ws, fromDir, ctx);
      continue;
    }
    const dir =
      findInNodeModules(toSbextName(name), fromDir) ||
      (ws ? undefined : findInNodeModules(name, fromDir));
    if (!dir) continue;
    const pkg = await loadExtensionPackage(dir);
    if (pkg.errors.length)
      throw new SbError(
        `${name} in ${dir} cannot be loaded:\n  ` +
          pkg.errors.map(e => e.message).join('\n  '),
      );
    ctx.log(
      `Using ${name}@${pkg.version} from ${path.relative(fs.realpathSync(fromDir), dir)}`,
    );
    ctx.add(pkg);
    const depJson = readJson(path.join(dir, 'package.json'));
    await ctx.provide(Object.keys(depJson.peerDependencies || {}), dir);
    await addLocalDependencies(depJson, dir, ctx);
  }
}

/**
 * pnpm overrides that install the npm dependencies which are packages of
 * the same workspace from the workspace, when its version satisfies the
 * range: a package is verified before its release publishes them.
 * SyncBridge installs them from the registry.
 */
function workspaceOverrides(
  pkgJson: any,
  fromDir: string,
  log: (message: string) => void,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [name, range] of Object.entries<string>(
    pkgJson.dependencies || {},
  )) {
    const ws = findWorkspaceNpmPackage(name, fromDir);
    if (!ws || !semver.satisfies(ws.version, range)) continue;
    overrides[name] = 'link:' + ws.dir;
    log(
      `Using workspace package ${name}@${ws.version} from ${path.relative(fs.realpathSync(fromDir), ws.dir)}`,
    );
  }
  return overrides;
}

/**
 * The directory of an extension package `name` as Node.js would find it
 * from `fromDir`, or its `build/` when the package there is a workspace
 * source tree.
 */
function findInNodeModules(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    for (const d of [candidate, path.join(candidate, 'build')]) {
      const file = path.join(d, 'package.json');
      if (fs.existsSync(file) && manifestOf(d)) return fs.realpathSync(d);
    }
    if (dir === path.dirname(dir)) return;
  }
}

/**
 * The host the worker resolves shared and missing modules from, as the
 * SyncBridge engine is in production: it provides `@syncbridge/common` and the
 * package's peers - the project's copies of them - and nothing else. A
 * module the package uses without declaring it is therefore not found, as
 * it would not be in SyncBridge, rather than found in the project.
 */
function createHost(hostDir: string) {
  fs.mkdirSync(path.join(hostDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(hostDir, 'package.json'),
    JSON.stringify({ name: 'spm-verify-host', private: true, type: 'module' }),
  );
}

/**
 * Adds the copies `fromDir` resolves of npm packages to the host - the
 * peers of each registry package the package depends on, which SyncBridge
 * provides as well. One already provided is kept. An extension package of
 * the same workspace - its sources where it is linked, not a package to
 * load - is packed and installed, its own peers provided first, and the
 * host is given the installed copy, as SyncBridge has a built one.
 */
async function provideHostPackages(
  hostDir: string,
  names: string[],
  fromDir: string,
  installWorkspace: (ws: WorkspacePackage) => Promise<ExtensionPackage>,
  log: (message: string) => void,
) {
  for (const name of names) {
    const link = path.join(hostDir, 'node_modules', name);
    if (fs.existsSync(link)) continue;
    let dir: string | undefined;
    const ws = findWorkspacePackage(name, fromDir);
    if (ws) {
      await provideHostPackages(
        hostDir,
        Object.keys(ws.pkgJson.peerDependencies || {}),
        ws.dir,
        installWorkspace,
        log,
      );
      log(
        `Packing ${name}@${ws.pkgJson.version} from ${path.relative(fs.realpathSync(fromDir), ws.dir)}, as SyncBridge provides it`,
      );
      dir = (await installWorkspace(ws)).path;
      sharePeersOfHostCopy(hostDir, dir, ws.pkgJson);
    } else dir = findPackageRoot(name, fromDir);
    if (!dir) continue;
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(dir, link, 'junction');
  }
}

/**
 * Points the peers of a package the host provides, installed in `dir`, at
 * the host's copies: SyncBridge has it in its node_modules beside them.
 * Installed alone, pnpm gave it registry copies of its own (it installs
 * peers), which would shadow the host's for it.
 */
function sharePeersOfHostCopy(hostDir: string, dir: string, pkgJson: any) {
  for (const name of Object.keys(pkgJson.peerDependencies || {})) {
    const host = path.join(hostDir, 'node_modules', name);
    if (!fs.existsSync(host)) continue;
    const link = path.join(dir, 'node_modules', name);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fs.realpathSync(host), link, 'junction');
  }
}

/**
 * Adds the peers of the package in `dir` to the host, and theirs, as the
 * project resolves them from there
 */
async function providePeers(
  dir: string,
  provide: (names: string[], fromDir: string) => Promise<void>,
  seen = new Set<string>(),
) {
  if (seen.has(dir)) return;
  seen.add(dir);
  const peers = Object.keys(
    readJson(path.join(dir, 'package.json')).peerDependencies || {},
  );
  await provide(peers, dir);
  for (const name of peers) {
    const peerDir = findPackageRoot(name, dir);
    if (peerDir) await providePeers(peerDir, provide, seen);
  }
}

/**
 * Explains the error a worker reports for a module it cannot find: the
 * package uses a dependency it does not declare.
 */
/** What a worker refused by the permission model is to declare */
function permissionHint(message: string): string {
  const missing = missingPermissionOf(message);
  if (!missing) return '';
  return (
    `\n  SyncBridge runs it under Node's permission model: declare "${missing}" ` +
    `on the app or component that needs it - permissions: [WorkerPermission.${
      missing === 'native-code' ? 'NativeCode' : 'ChildProcesses'
    }] in @App() or @Component()`
  );
}

function missingModuleHint(message: string): string {
  const m = /Cannot find (?:package|module) '([^']+)'/.exec(message);
  if (!m || m[1].startsWith('.') || m[1].startsWith('/')) return '';
  const name = m[1].startsWith('@')
    ? m[1].split('/').slice(0, 2).join('/')
    : m[1].split('/')[0];
  return (
    `\n  "${name}" is not in the package's dependencies, so SyncBridge does not install it. ` +
    `Add it to "dependencies" (or to "peerDependencies" if SyncBridge provides it).`
  );
}

/** The root directory of an npm package as Node.js would find it from `fromDir` */
function findPackageRoot(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json')))
      return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) return;
  }
}

/**
 * The pnpm syncbuild depends on, through its Node.js entry rather than the
 * native binary its install script puts in place, which is platform-specific
 * and missing where install scripts are blocked
 */
function pnpmCommand(): string[] {
  const require = createRequire(import.meta.url);
  const bin = path.join(
    path.dirname(require.resolve('pnpm/package.json')),
    'bin',
    'pnpm.mjs',
  );
  return [process.execPath, bin];
}

const PROFILE_EXTENSIONS = ['.yml', '.yaml', '.json'];

/** The profile files given: files as they are, directories' profile files */
function findProfiles(given: string | string[] | undefined): string[] {
  const out: string[] = [];
  for (const p of [given || []].flat()) {
    const file = path.resolve(p);
    if (!fs.existsSync(file)) throw new SbError(`Profile ${p} not found`);
    if (!fs.statSync(file).isDirectory()) {
      out.push(file);
      continue;
    }
    const found = fs
      .readdirSync(file)
      .filter(f => PROFILE_EXTENSIONS.includes(path.extname(f)))
      .sort()
      .map(f => path.join(file, f));
    if (!found.length) throw new SbError(`${p} has no profile files`);
    out.push(...found);
  }
  return out;
}

function readProfile(file: string): Profile {
  const text = fs.readFileSync(file, 'utf8');
  const doc =
    path.extname(file) === '.json' ? jsonc.parse(text) : yaml.parse(text);
  if (!doc?.appUri)
    throw new SbError(`${file} is not a profile: it has no appUri`);
  return new Profile({
    id: 'verify-' + path.basename(file, path.extname(file)),
    displayName: doc.appUri,
    ...doc,
  });
}

/** The packages a profile's app and components come from */
function profilePackages(profile: Profile): Set<string> {
  const names = new Set<string>();
  const add = (uri?: string) => {
    if (uri) names.add(uri.split(':')[0]);
  };
  const walk = (components?: Record<string, any>) => {
    for (const c of Object.values(components || {})) {
      add(c?.uri);
      walk(c?.components);
    }
  };
  add(profile.appUri);
  walk(profile.components);
  return names;
}

/**
 * Registers an extension package SyncBridge provides - one of the packages
 * the engine registers at its start, such as @syncbridge/net - from the
 * project's copy, which the worker then loads as the engine's
 */
async function registerProvided(
  name: string,
  packageDir: string,
): Promise<ExtensionPackage> {
  let entry: string;
  try {
    entry = createRequire(path.join(packageDir, 'package.json')).resolve(name);
  } catch (e: any) {
    const dir = findInNodeModules(name, packageDir);
    throw new SbError(
      dir
        ? `The profile uses ${name}, which cannot be resolved from ${dir}: ${e.message}`
        : `The profile uses ${name}, which the project does not have. ` +
            `Add it to devDependencies, as the version SyncBridge provides`,
    );
  }
  const pkg = await ExtensionRegistry.registerPackage(
    pathToFileURL(entry).href,
  );
  if (pkg.errors.length)
    throw new SbError(
      `${name} cannot be registered:\n  ` +
        pkg.errors.map(e => e.message).join('\n  '),
    );
  return pkg;
}

function readJson(file: string): any {
  return jsonc.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Where spm keeps pnpm's store between verifies: SB_SPM_STORE_DIR, else
 * the user's cache - XDG_CACHE_HOME, or ~/.cache
 */
export function defaultStoreDir(): string {
  if (process.env.SB_SPM_STORE_DIR) return process.env.SB_SPM_STORE_DIR;
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cache, 'syncbridge', 'pnpm-store');
}
