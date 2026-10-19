import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestOf } from '@syncbridge/common';

/** Packages a test environment never registers: the host's own */
const HOST_PACKAGES = new Set([
  '@syncbridge/common',
  '@syncbridge/syncbuild',
  '@syncbridge/testing',
]);

/** The directory of the nearest package.json at or above `from` */
export function findPackageDir(from: string): string {
  let dir = from.startsWith('file:') ? fileURLToPath(from) : from;
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir)
      throw new Error(`No package.json found at or above "${from}"`);
    dir = parent;
  }
}

/**
 * The entry points to register for a package under test: the extension
 * packages it depends on, theirs first, then its own. A dependency counts
 * as an extension package when its manifest has a `syncbridge` field or it
 * depends on @syncbridge/common; anything else is a plain library the
 * extension imports itself.
 */
export function collectExtensionEntries(packageDir: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (dir: string, isRoot: boolean) => {
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const pkgJson = readJson(path.join(dir, 'package.json'));
    const names = new Set([
      ...Object.keys(pkgJson.dependencies || {}),
      ...Object.keys(pkgJson.peerDependencies || {}),
      /* A test may use extensions its package only develops against */
      ...(isRoot ? Object.keys(pkgJson.devDependencies || {}) : []),
    ]);
    for (const name of names) {
      if (HOST_PACKAGES.has(name)) continue;
      const depDir = findInstalled(name, dir);
      if (!depDir) continue;
      if (
        isExtensionPackage(depDir, readJson(path.join(depDir, 'package.json')))
      )
        visit(depDir, false);
    }
    out.push(entryPoint(dir, pkgJson));
  };

  visit(packageDir, true);
  return out;
}

function isExtensionPackage(dir: string, pkgJson: any): boolean {
  if (HOST_PACKAGES.has(pkgJson.name)) return false;
  return (
    manifestOf(dir, pkgJson) != null ||
    !!pkgJson.dependencies?.['@syncbridge/common'] ||
    !!pkgJson.peerDependencies?.['@syncbridge/common']
  );
}

/** Looks a package up in every node_modules from `fromDir` to the root */
function findInstalled(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * A package of the workspace is loaded from its sources, which the test
 * runner compiles; an installed one from what it publishes.
 */
function entryPoint(dir: string, pkgJson: any): string {
  const real = fs.realpathSync(dir);
  const source = path.join(real, 'src', 'index.ts');
  if (!real.split(path.sep).includes('node_modules') && fs.existsSync(source))
    return source;
  const root = pkgJson.exports?.['.'];
  const entry =
    (typeof root === 'string' ? root : root?.import || root?.default) ||
    pkgJson.module ||
    pkgJson.main ||
    'index.js';
  return path.join(real, entry);
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
