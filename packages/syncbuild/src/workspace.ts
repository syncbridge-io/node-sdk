import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionPackageJson } from '@syncbridge/common';
import { manifestOf, SbError } from '@syncbridge/common';
import { parseTsConfig } from './builder/utils/parse-tsconfig.js';

/**
 * An extension package of the same workspace as the package that depends
 * on it: linked into `node_modules`, its sources outside of it, and
 * compiled by the project's own build, not installed from the registry.
 */
export interface WorkspacePackage {
  /** The package's directory, the real path */
  dir: string;
  pkgJson: ExtensionPackageJson;
  /** The tsconfig file its output is compiled with, relative to `dir` */
  tsconfig: string;
  /** Where TypeScript writes its output: `outDir`, else the package itself */
  outDir: string;
  /** Its entry point in `outDir` */
  entry: string;
  /** Its declarations in `outDir` */
  types: string;
}

/** The tsconfig files a package's build output is looked up in, in order */
const BUILD_TSCONFIGS = ['tsconfig-build.json', 'tsconfig.json'];

/**
 * Finds the extension package `name` as Node.js would from `fromDir` and
 * returns it when it is a workspace package - a link to a directory outside
 * any `node_modules` - or `undefined` when it is not there, not an
 * extension package, or installed. `cache`, by the package's directory,
 * saves reading its tsconfig on every lookup.
 */
export function findWorkspacePackage(
  name: string,
  fromDir: string,
  cache?: Map<string, WorkspacePackage | undefined>,
): WorkspacePackage | undefined {
  const real = findLinked(name, fromDir);
  if (!real) return;
  if (cache?.has(real)) return cache.get(real);
  const found = readWorkspacePackage(real);
  cache?.set(real, found);
  return found;
}

/**
 * Finds the npm package `name` as Node.js would from `fromDir` and returns
 * it when it is a package of the same workspace that is not an extension
 * package: the directory it is published from - its `build` when that has
 * a `package.json` (`rman build`'s layout), else the package itself - and
 * its version.
 */
export function findWorkspaceNpmPackage(
  name: string,
  fromDir: string,
): { dir: string; version: string } | undefined {
  const real = findLinked(name, fromDir);
  if (!real) return;
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(real, 'package.json'), 'utf8'),
  );
  if (manifestOf(real, pkgJson)) return;
  const build = path.join(real, 'build');
  return {
    dir: fs.existsSync(path.join(build, 'package.json')) ? build : real,
    version: pkgJson.version,
  };
}

/** pnpm's workspace protocol: a package of the same workspace */
const WORKSPACE_PROTOCOL = 'workspace:';

/**
 * A dependency's range as the package is published with it: pnpm's
 * `workspace:` resolved as `pnpm publish` resolves it - `workspace:^` and
 * `workspace:~` the workspace package's version under that operator,
 * `workspace:*` the version itself, `workspace:<range>` the range. Any
 * other range as it is: SyncBridge, the registry and npm take no
 * `workspace:`.
 */
export function publishedRange(
  name: string,
  range: string,
  fromDir: string,
): string {
  if (!range.startsWith(WORKSPACE_PROTOCOL)) return range;
  const spec = range.slice(WORKSPACE_PROTOCOL.length).trim();
  if (!['', '*', '^', '~'].includes(spec)) {
    if (spec.includes('@') || /^[./]/.test(spec))
      throw new SbError(
        `"${name}": "${range}" names another package or a path; a package is published with a range of its own`,
      );
    return spec;
  }
  const dir = findLinked(name, fromDir);
  if (!dir)
    throw new SbError(
      `"${name}": "${range}", but no package of the workspace is "${name}"`,
    );
  const { version } = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  );
  return spec === '^' || spec === '~' ? spec + version : version;
}

/** Each of the dependencies' ranges as published: see publishedRange */
export function publishedRanges(
  dependencies: Record<string, string> | undefined,
  fromDir: string,
): Record<string, string> | undefined {
  if (!dependencies) return;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => [
      name,
      publishedRange(name, range, fromDir),
    ]),
  );
}

/**
 * The real directory of package `name` as Node.js would find it from
 * `fromDir`, when it is linked from outside any `node_modules`
 */
function findLinked(name: string, fromDir: string): string | undefined {
  for (let dir = path.resolve(fromDir); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      const real = fs.realpathSync(candidate);
      return real.split(path.sep).includes('node_modules') ? undefined : real;
    }
    if (dir === path.dirname(dir)) return;
  }
}

function readWorkspacePackage(dir: string): WorkspacePackage | undefined {
  const pkgJson: ExtensionPackageJson & { exports?: any; types?: string } =
    JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!manifestOf(dir, pkgJson)) return;
  const tsconfig =
    BUILD_TSCONFIGS.find(f => fs.existsSync(path.join(dir, f))) ||
    'tsconfig.json';
  const outDir = fs.existsSync(path.join(dir, tsconfig))
    ? parseTsConfig(tsconfig, { cwd: dir, silent: true }).options.outDir || dir
    : dir;
  const root = pkgJson.exports?.['.'] ?? pkgJson.exports;
  const entry =
    (typeof root === 'string' ? root : root?.import || root?.default) ||
    pkgJson.module ||
    pkgJson.main ||
    'index.js';
  const types =
    (typeof root === 'object' && root?.types) ||
    pkgJson.types ||
    entry.replace(/\.[cm]?js$/, '.d.ts');
  return {
    dir,
    pkgJson,
    tsconfig,
    outDir,
    entry: path.join(outDir, entry),
    types: path.join(outDir, types),
  };
}
