import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { SBEXT_SCOPE } from '@syncbridge/common';

/**
 * The registry's npm mirror: its packages under `@sbext`, for development
 * and tests. Public ones need no sign-in.
 */
export const NPM_MIRROR =
  process.env.SB_NPM_MIRROR || 'https://npm.syncbridge.io/';

/** The `.npmrc` line that sends `@sbext` to the mirror */
const MIRROR_SCOPE_LINE = `@${SBEXT_SCOPE}:registry=`;

/** The SDK: on npm, not in the registry */
const SDK_PACKAGES = [
  '@syncbridge/common',
  '@syncbridge/runtime',
  '@syncbridge/syncbuild',
  '@syncbridge/testing',
  '@syncbridge/plugin-api',
];

/** Whether a name is one of the SDK's packages, which come from npm */
export const isSdkPackage = (name: string) => SDK_PACKAGES.includes(name);

/**
 * Whether a registry package is one SyncBridge ships with every server
 * (`@syncbridge/builtins`, `@syncbridge/hl7`, ...): a package using it
 * imports it under its own name and declares it in `peerDependencies`, as
 * it does the SDK, rather than as a registry dependency. In development
 * it is the mirror's copy under that name (npm's alias).
 */
export const isHostProvided = (name: string) =>
  name.startsWith('@syncbridge/') && !isSdkPackage(name);

/**
 * The workspace root of a package: the first directory, from it upwards,
 * with a lockfile or a `.git` - else the topmost one
 */
export function workspaceRoot(packageDir: string): string {
  return path.dirname(nodeModulesDirs(packageDir).at(-1)!);
}

/**
 * Every `node_modules` a package's dependencies can be installed in: its
 * own, and its ancestors' up to the workspace root - the first directory
 * with a lockfile or a `.git`.
 */
export function nodeModulesDirs(packageDir: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(packageDir);
  for (;;) {
    out.push(path.join(dir, 'node_modules'));
    const isRoot = [
      '.git',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
    ].some(f => fs.existsSync(path.join(dir, f)));
    const parent = path.dirname(dir);
    if (isRoot || parent === dir) break;
    dir = parent;
  }
  return out;
}

/** Whether the workspace's `.npmrc` sends `@sbext` somewhere */
export function hasMirrorScope(root: string): boolean {
  const file = path.join(root, '.npmrc');
  return (
    fs.existsSync(file) &&
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .some(line => line.trim().startsWith(MIRROR_SCOPE_LINE))
  );
}

/**
 * Sends `@sbext` to the mirror in the workspace's `.npmrc`, unless it is
 * sent somewhere already. Whether it was written.
 */
export function ensureMirrorScope(root: string): boolean {
  if (hasMirrorScope(root)) return false;
  const file = path.join(root, '.npmrc');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(
    file,
    text +
      (text && !text.endsWith('\n') ? '\n' : '') +
      `${MIRROR_SCOPE_LINE}${NPM_MIRROR}\n`,
  );
  return true;
}
