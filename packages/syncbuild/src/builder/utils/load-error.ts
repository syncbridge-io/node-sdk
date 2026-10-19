import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SbError } from '@syncbridge/common';

/**
 * Turns an error thrown while the built package is imported - to read its
 * metadata - into a message saying what to do about it. Node's own errors
 * name a file deep in `node_modules` or a temp directory, which is where
 * the problem shows, not where it is fixed.
 */
export function describeLoadError(
  e: any,
  packageName: string,
  packageDir: string,
): SbError {
  if (e instanceof SbError) return e;
  const message = String(e?.message ?? e).split('\n')[0];
  const intro = `${packageName} could not be loaded to read its metadata`;
  const m = /^Cannot find (?:module|package) '([^']+)'/.exec(message);
  if (m) {
    const hint = path.isAbsolute(m[1])
      ? describeMissingFile(m[1])
      : describeMissingPackage(m[1], packageDir, importerOf(message));
    if (hint) return wrap(e, `${intro}: ${hint}`);
  }
  return wrap(e, `${intro}: ${message}`);
}

/** A file a resolved import points to is not there */
function describeMissingFile(file: string): string | undefined {
  const owner = findPackage(path.dirname(file));
  if (owner) return describePackage(owner, path.relative(owner.dir, file));
}

/**
 * The file an unresolved import was in, as Node ("imported from ...") or
 * swc-node ("... cannot be resolved in ...") names it
 */
function importerOf(message: string): string | undefined {
  const m = /(?:imported from|cannot be resolved in) (\S+)/.exec(message);
  if (!m) return;
  try {
    return m[1].startsWith('file:') ? fileURLToPath(m[1]) : m[1];
  } catch {
    return;
  }
}

/** Where `name` is installed, looked for from `start` upwards */
function installedFrom(start: string, name: string): string | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) return pkgDir;
    if (path.dirname(dir) === dir) return;
  }
}

/**
 * A bare import, `name` or `name/sub`, did not resolve - from `importer`,
 * the built code, when it is known: installed for the package, but not
 * where the code is, is not a broken install
 */
function describeMissingPackage(
  specifier: string,
  packageDir: string,
  importer?: string,
): string {
  const name = /^(?:@[^/]+\/)?[^/]+/.exec(specifier)![0];
  const forPackage = installedFrom(packageDir, name);
  if (forPackage && importer && !installedFrom(path.dirname(importer), name))
    return (
      `"${name}" is installed for the package, but the built code in ` +
      `${path.dirname(importer)} cannot reach it: imports resolve from where ` +
      `the code is. Build within the package (leave --temp-dir out).`
    );
  if (forPackage) return describePackage({ dir: forPackage, name });
  return (
    `it imports "${name}", which is not installed. Add it to ` +
    `"dependencies" in package.json and install it.`
  );
}

/** What to do about a package that is there, but cannot be loaded */
function describePackage(
  owner: { dir: string; name: string },
  file?: string,
): string {
  const { dir, name } = owner;
  let realDir = dir;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    /* Not there to resolve; the path as given is all there is */
  }
  const what = file
    ? `${file} is missing from it`
    : `its entry point is missing`;
  if (realDir.split(path.sep).includes('node_modules'))
    return `"${name}" is installed, but ${what}. Reinstall the dependencies.`;
  /* A package of the workspace: its exports are in its build output */
  const buildDir = path.join(realDir, 'build');
  if (!fs.existsSync(path.join(buildDir, 'package.json')))
    return (
      `"${name}" is a package of this workspace and has not been built ` +
      `(${buildDir} not found). Build it first, then run spm again.`
    );
  return (
    `"${name}" is a package of this workspace, but its build output ` +
    `(${buildDir}) cannot be loaded. Rebuild it, then run spm again.`
  );
}

function findPackage(start: string): { dir: string; name: string } | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      try {
        return { dir, name: JSON.parse(fs.readFileSync(file, 'utf8')).name };
      } catch {
        return;
      }
    }
    if (path.dirname(dir) === dir) return;
  }
}

function wrap(cause: unknown, message: string): SbError {
  return new SbError(message, {
    cause: cause instanceof Error ? cause : undefined,
  });
}
