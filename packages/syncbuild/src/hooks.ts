import fs from 'node:fs';
import nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type ExtensionPackageJson,
  manifestOf,
  parseSbSpecifier,
  SbError,
  toSbextName,
} from '@syncbridge/common';
import semver from 'semver';
import { findWorkspacePackage, type WorkspacePackage } from './workspace.js';

/**
 * Resolve hooks for running an extension package outside SyncBridge - its
 * tests, and syncbuild reading its metadata:
 *
 * - `sb:@vendor/name` -> a package of the same workspace, from its build
 *   output; else `@sbext/vendor__name` (the registry package as the npm
 *   mirror publishes it); else `@vendor/name` as installed. The importing package must declare it in its own
 *   the manifest's `dependencies`, the resolved version must satisfy that
 *   range, and only one version of a registry package may be loaded - the
 *   rule a SyncBridge worker enforces.
 * - A bare specifier that resolves to a workspace package whose exports
 *   exist only in its build output (`rman build`'s `<package>/build`) is
 *   resolved from there.
 *
 * Returns the hooks handle, or `undefined` on a Node.js without
 * `module.registerHooks` (before 22.15).
 */
export function installResolveHooks() {
  if (typeof nodeModule.registerHooks !== 'function') return;
  /** Registry name -> the package root it resolved to */
  const loaded = new Map<string, string>();
  const workspaces = new Map<string, WorkspacePackage | undefined>();
  /** Package directory -> its registry dependencies, read once */
  const dependenciesOf = new Map<string, Record<string, string> | undefined>();

  return nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const sb = parseSbSpecifier(specifier);
      if (!sb) {
        try {
          return next(specifier, context);
        } catch (e: any) {
          if (!isNotFound(e) || !context.parentURL) throw e;
          const url = resolveFromBuildDir(specifier, context.parentURL);
          if (!url) throw e;
          return { url, shortCircuit: true };
        }
      }

      const importer = context.parentURL?.startsWith('file:')
        ? findPackageJson(fileURLToPath(context.parentURL))
        : undefined;
      if (importer && !dependenciesOf.has(importer.dir))
        dependenciesOf.set(
          importer.dir,
          manifestOf(importer.dir, importer.json)?.dependencies,
        );
      const range = importer && dependenciesOf.get(importer.dir)?.[sb.name];
      if (!range) {
        throw new SbError(
          `"${specifier}" is imported by ${importer?.json.name || context.parentURL}, ` +
            `which does not declare "${sb.name}" in manifest dependencies. ` +
            `Run: spm add ${sb.name}@<range>`,
        );
      }

      const subpath = sb.subpath === '.' ? '' : sb.subpath.slice(1);
      let url: string | undefined;
      const workspace = findWorkspacePackage(
        sb.name,
        path.dirname(fileURLToPath(context.parentURL!)),
        workspaces,
      );
      if (workspace) {
        const file = subpath
          ? path.join(workspace.outDir, subpath)
          : workspace.entry;
        if (!fs.existsSync(file))
          throw new SbError(
            `"${specifier}" is the workspace package in ${workspace.dir}, ` +
              `which is not built: ${path.relative(workspace.dir, file)} does not exist`,
          );
        url = pathToFileURL(file).href;
      }
      for (const name of url ? [] : [toSbextName(sb.name), sb.name]) {
        try {
          url = next(name + subpath, context).url;
        } catch (e: any) {
          if (!isNotFound(e)) throw e;
          url = resolveFromBuildDir(name + subpath, context.parentURL!);
        }
        if (url) break;
      }
      if (!url) {
        throw new SbError(
          `"${specifier}" cannot be resolved: ${sb.name} is neither a package ` +
            `of the workspace nor installed as ${toSbextName(sb.name)} or ${sb.name}`,
        );
      }

      const found = findPackageJson(fileURLToPath(url));
      if (found) {
        if (!semver.satisfies(found.json.version, range)) {
          throw new SbError(
            `"${specifier}" resolved to version ${found.json.version}, ` +
              `which does not satisfy ${range} required by ${importer!.json.name}`,
          );
        }
        const seen = loaded.get(sb.name);
        if (seen && seen !== found.dir) {
          throw new SbError(
            `Two copies of "${sb.name}" are loaded (${seen} and ${found.dir}). ` +
              `A SyncBridge worker loads one version of each registry package`,
          );
        }
        loaded.set(sb.name, found.dir);
      }
      return { url, shortCircuit: true };
    },
  });
}

function isNotFound(e: any) {
  return (
    e?.code === 'ERR_MODULE_NOT_FOUND' ||
    e?.code === 'MODULE_NOT_FOUND' ||
    /Cannot find (module|package)/.test(e?.message)
  );
}

/** The nearest package.json above a file, with its directory */
function findPackageJson(
  file: string,
): { dir: string; json: ExtensionPackageJson } | undefined {
  for (let dir = path.dirname(file); dir !== path.dirname(dir);) {
    const f = path.join(dir, 'package.json');
    if (fs.existsSync(f))
      return { dir, json: JSON.parse(fs.readFileSync(f, 'utf8')) };
    dir = path.dirname(dir);
  }
}

/**
 * Resolves a bare specifier against the `build` directory of the package it
 * names, the layout `rman build` writes: `<package>/build/package.json`.
 */
export function resolveFromBuildDir(
  specifier: string,
  parentURL: string,
): string | undefined {
  const m = /^((?:@[^/]+\/)?[^/.:][^/:]*)(\/.*)?$/.exec(specifier);
  if (!m) return;
  const [, name, subpath] = m;
  let pkgDir: string;
  try {
    const require = nodeModule.createRequire(fileURLToPath(parentURL));
    pkgDir = path.dirname(require.resolve(name + '/package.json'));
  } catch {
    return;
  }
  const buildDir = path.join(pkgDir, 'build');
  const manifest = path.join(buildDir, 'package.json');
  if (!fs.existsSync(manifest)) return;
  if (subpath) return pathToFileURL(path.join(buildDir, subpath)).href;
  const pkgJson = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const root = pkgJson.exports?.['.'];
  const entry =
    (typeof root === 'string' ? root : root?.import || root?.default) ||
    pkgJson.module ||
    pkgJson.main ||
    'index.js';
  return pathToFileURL(path.join(buildDir, entry)).href;
}
