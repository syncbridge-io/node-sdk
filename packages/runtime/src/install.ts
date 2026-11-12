import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ILogger } from '@syncbridge/common';
import {
  ExtensionPackage,
  isSyncBridgeModule,
  MANIFEST_FILE,
  SbError,
  validateRegistryName,
} from '@syncbridge/common';
import AdmZip from 'adm-zip';
import * as jsonc from 'jsonc-parser';
import semver from 'semver';
import { loadExtensionPackage } from './load-extension-package.js';
import { moveDir } from './move-dir.js';
import { packageManager } from './package-manager.js';
import { HOST_SHARED } from './plan.js';

/**
 * The steps SyncBridge installs an extension package archive with, one
 * function each, so the engine's install task and `spm verify` run the same
 * code. In order: extractPackage, readPackage, verifyDependencies,
 * placePackage, installDependencies; installPackage runs them all.
 */

export interface ExtractedPackage {
  /** The archive's package.json */
  pkgJson: any;
  /** The temporary directory it was extracted to */
  directory: string;
}

/**
 * The file in an installed package's directory naming the archive it was
 * installed from: its SHA-256. A version installed again from another
 * archive is another installation to the workers using it (planDigest)
 */
export const INSTALL_STAMP_FILE = '.sb-install';

/** The archive an installed package came from, if its directory tells */
export function installStamp(directory: string): string | undefined {
  try {
    return (
      fs
        .readFileSync(path.join(directory, INSTALL_STAMP_FILE), 'utf8')
        .trim() || undefined
    );
  } catch {
    return;
  }
}

/**
 * Extracts a package archive into a new directory under `tempDir`, after
 * checking it has a package.json with a `syncbridge` field.
 */
export function extractPackage(
  zipFile: string,
  tempDir: string,
): ExtractedPackage {
  const zip = new AdmZip(zipFile);
  const filename = path.basename(zipFile);
  const entry = zip.getEntry('package.json');
  if (!entry) throw new SbError(`No package.json found`);
  let pkgJson: any;
  try {
    pkgJson = jsonc.parse(zip.readAsText(entry));
  } catch (err: any) {
    throw new SbError(
      `Cannot parse package.json in "${filename}": ${err.message}`,
    );
  }
  /* A built package: syncbuild writes its manifest to this file */
  if (!zip.getEntry(MANIFEST_FILE))
    throw new SbError(
      `"${filename}" has no ${MANIFEST_FILE}: it is not a package built by syncbuild`,
    );
  const directory = path.join(
    tempDir,
    String(pkgJson.name).replace(/^@/, '').replace(/\//g, '-') +
      `-${pkgJson.version}-${randomUUID().slice(0, 8)}`,
  );
  fs.rmSync(directory, { recursive: true, force: true });
  try {
    zip.extractAllTo(directory, true);
  } catch (err: any) {
    throw new SbError(`Unable to extract ${filename}: ${err.message}`);
  }
  /* Moved with the package to its install directory (placePackage) */
  fs.writeFileSync(
    path.join(directory, INSTALL_STAMP_FILE),
    createHash('sha256').update(fs.readFileSync(zipFile)).digest('hex') + '\n',
  );
  return { pkgJson, directory };
}

/**
 * Reads an extracted package: its manifest and the metadata of its
 * apps and components. Its name must be a valid registry name.
 * `path` is set to where it is installed.
 */
export async function readPackage(
  directory: string,
  installDir: string,
): Promise<ExtensionPackage> {
  const pkg = await loadExtensionPackage(directory);
  const problems = validateRegistryName(pkg.name);
  if (problems.length)
    throw new SbError(
      `Invalid package name "${pkg.name}". ${problems.join('. ')}`,
    );
  pkg.path = path.join(installDir, installDirName(pkg));
  return pkg;
}

export interface VerifyDependenciesOptions {
  /** Installed versions of a registry package */
  versionsOf: (name: string) => ExtensionPackage[] | undefined;
  /**
   * The version of a package the host shares (HOST_SHARED), if it has it.
   * Not given: those peers are not checked
   */
  hostVersionOf?: (name: string) => string | undefined;
}

/**
 * A package must find the registry packages it depends on already
 * installed, and the host the packages it shares with workers
 * (HOST_SHARED) at the versions its peers on them ask. Its other peers are
 * installed for the workers that load it (initWorker).
 */
export function verifyDependencies(
  pkg: ExtensionPackage,
  options: VerifyDependenciesOptions,
): void {
  const problems: string[] = [];
  for (const [name, range] of Object.entries(pkg.registryDependencies)) {
    const versions = options.versionsOf(name);
    if (!versions?.some(v => semver.satisfies(v.version, range)))
      problems.push(
        `"${name}" ${range} is not installed` +
          (versions?.length
            ? ` (installed: ${versions.map(v => v.version).join(', ')})`
            : ''),
      );
  }
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (!options.hostVersionOf || !HOST_SHARED.includes(name)) continue;
    const version = options.hostVersionOf(name);
    if (!version) problems.push(`The host does not provide "${name}"`);
    else if (!semver.satisfies(version, range))
      problems.push(
        `The host provides "${name}" ${version}, which does not satisfy ${range}`,
      );
  }
  if (problems.length) {
    throw new SbError(
      `${pkg.name}@${pkg.version} cannot be installed.\n  ` +
        problems.join('\n  '),
      { code: 'DEPENDENCIES_NOT_SATISFIED' },
    );
  }
}

/**
 * Moves an extracted package to its install directory (`pkg.path`),
 * replacing a previous install of the same version. Done before its
 * dependencies are installed: pnpm hardlinks files from the store, which
 * only works on the store's filesystem, and the temp directory is often on
 * another one.
 */
export async function placePackage(
  directory: string,
  pkg: ExtensionPackage,
): Promise<void> {
  fs.rmSync(pkg.path, { recursive: true, force: true });
  fs.mkdirSync(pkg.path, { recursive: true });
  await moveDir(directory, pkg.path);
}

/**
 * Installs the package's npm dependencies, resolved from its ranges, into
 * the shared store; the lockfile pnpm writes stays in its directory. On
 * failure the install directory is removed, so no
 * half-installed version is left to register.
 */
export async function installDependencies(
  pkg: ExtensionPackage,
  pkgJson: any,
  options: {
    storeDir: string;
    pnpm?: string[];
    /** See InstallPackageOptions.overrides */
    overrides?: Record<string, string>;
    /** See InstallPackageOptions.allowBuilds */
    allowBuilds?: string[];
    logger?: ILogger;
    abortSignal?: AbortSignal;
  },
): Promise<void> {
  if (!Object.keys(pkgJson.dependencies || {}).length) return;
  /* Its peers on what pnpm cannot or need not fetch are left unsaid to
   * pnpm, whose auto-install-peers installs the others: a SyncBridge
   * module (a registry package, not on npm) and what the host shares
   * (HOST_SHARED). Its package.json as it was, after */
  const file = path.join(pkg.path, 'package.json');
  const original = fs.readFileSync(file, 'utf8');
  const forPnpm = JSON.parse(original);
  const notFetched = (name: string) =>
    isSyncBridgeModule(name) || HOST_SHARED.includes(name);
  let changed = false;
  for (const field of ['peerDependencies', 'peerDependenciesMeta']) {
    for (const name of Object.keys(forPnpm[field] || {})) {
      if (!notFetched(name)) continue;
      delete forPnpm[field][name];
      changed = true;
    }
  }
  try {
    if (changed) fs.writeFileSync(file, JSON.stringify(forPnpm, null, 2));
    const settings: Record<string, unknown> = {};
    if (options.overrides && Object.keys(options.overrides).length)
      settings.overrides = options.overrides;
    if (options.allowBuilds?.length)
      settings.allowBuilds = Object.fromEntries(
        [...new Set(options.allowBuilds)].sort().map(name => [name, true]),
      );
    if (Object.keys(settings).length) {
      /* pnpm reads its settings from here; JSON is YAML */
      fs.writeFileSync(
        path.join(pkg.path, 'pnpm-workspace.yaml'),
        JSON.stringify(settings, null, 2),
      );
    }
    await packageManager.install({
      cwd: pkg.path,
      storeDir: options.storeDir,
      pnpm: options.pnpm,
      logger: options.logger,
      abortSignal: options.abortSignal,
    });
    fs.writeFileSync(file, original);
  } catch (e) {
    fs.rmSync(pkg.path, { recursive: true, force: true });
    throw e;
  }
}

export interface InstallPackageOptions extends VerifyDependenciesOptions {
  installDir: string;
  storeDir: string;
  tempDir: string;
  /** See packageManager.install */
  pnpm?: string[];
  /**
   * pnpm overrides for the package's dependencies, e.g. `link:` to a
   * package of the developer's workspace that is not published yet. For
   * `spm verify`; SyncBridge installs from the registry.
   */
  overrides?: Record<string, string>;
  /**
   * The packages whose install scripts run - a native addon built or
   * downloaded as it is installed. pnpm runs no other's. For `spm verify`,
   * the workspace's own `allowBuilds`; SyncBridge gives its reviewed list
   * to the workers' installations (initWorker)
   */
  allowBuilds?: string[];
  logger?: ILogger;
  abortSignal?: AbortSignal;
}

/**
 * Installs a package archive the way SyncBridge does, and returns the
 * installed package as loaded from its install directory. Registering it
 * is the caller's.
 */
export async function installPackage(
  zipFile: string,
  options: InstallPackageOptions,
): Promise<ExtensionPackage> {
  const extracted = extractPackage(zipFile, options.tempDir);
  try {
    const pkg = await readPackage(extracted.directory, options.installDir);
    verifyDependencies(pkg, options);
    await placePackage(extracted.directory, pkg);
    await installDependencies(pkg, extracted.pkgJson, options);
    return await loadExtensionPackage(pkg.path);
  } finally {
    fs.rmSync(extracted.directory, { recursive: true, force: true });
  }
}

/**
 * The directory a package version is installed in: `@abisena/iomt` 1.2.0 ->
 * `abisena__iomt@1.2.0`. Stable, so reinstalling a version replaces it
 * rather than leaving a second copy beside it.
 */
export function installDirName(
  pkg: Pick<ExtensionPackage, 'name' | 'version'>,
) {
  const name = pkg.name.startsWith('@')
    ? pkg.name.slice(1).replace('/', '__')
    : pkg.name;
  return `${name}@${pkg.version}`;
}

/**
 * The version of an npm package the host in `hostDir` provides, if it does:
 * the package.json Node.js would find in a node_modules directory from
 * there up. Read from disk, so a package whose exports hide its
 * package.json is found too.
 */
export function hostPackageVersion(
  name: string,
  hostDir: string,
): string | undefined {
  for (let dir = path.resolve(hostDir); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(file))
      return JSON.parse(fs.readFileSync(file, 'utf8')).version;
    if (dir === path.dirname(dir)) return;
  }
}
