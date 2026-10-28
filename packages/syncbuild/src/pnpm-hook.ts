import fs from 'node:fs';
import path from 'node:path';
import { SBEXT_SCOPE, SDK_PACKAGES } from '@syncbridge/common';

/*
 * pnpm and SyncBridge's modules. A module (`@syncbridge/builtins`,
 * `@syncbridge/hl7`, ...) is not on npm: in development it is the npm
 * mirror's copy, `@sbext/syncbridge__<name>`, installed under its own name
 * by an alias. npm installs flatly, and the alias a package declares serves
 * whatever else asks for the module. pnpm installs each package with what
 * it declares alone: a mirror package naming a module by its own name - a
 * peer, as modules once were, or a dependency - is looked for on npm.
 *
 * So a workspace installed with pnpm gets a `.pnpmfile.cjs` whose
 * readPackage hook hands each module a mirror package names to it from the
 * mirror, the range kept: the ranges stay in the packages alone, and the
 * modules' own peers (`hl7v2`, `@sqb/postgres`) install as any peer.
 */

/** The file pnpm reads its hooks from, at the workspace root */
export const PNPMFILE = '.pnpmfile.cjs';

/** The first line of the file spm writes: what tells it is spm's */
const MARKER = '// Written by spm (@syncbridge/syncbuild)';

/**
 * A range as an alias takes it: pnpm does not parse one with spaces
 * (`npm:@sbext/x@>=2.0.1 <3`). The same range spaceless where there is
 * one - `>=2.0.1 <3` as `^2.0.1`, `>=1.2.0 <1.3.0` as `~1.2.0` - else its
 * lowest version up to the next major. Self-contained: written into the
 * hook as it is.
 */
export function aliasRange(range: string): string {
  const text = String(range).trim();
  if (!/\s/.test(text)) return text;
  const m =
    /^>=\s*(\d+)\.(\d+)\.(\d+)\s+<\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-0)?$/.exec(
      text,
    );
  if (m) {
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const upper = [Number(m[4]), Number(m[5] || 0), Number(m[6] || 0)];
    const min = `${major}.${minor}.${m[3]}`;
    if (major > 0 && upper[0] === major + 1 && !upper[1] && !upper[2])
      return `^${min}`;
    if (upper[0] === major && upper[1] === minor + 1 && !upper[2])
      return major === 0 ? `^${min}` : `~${min}`;
  }
  const low = /(\d+\.\d+\.\d+)/.exec(text);
  return low ? `^${low[1]}` : '*';
}

/** The hook as spm writes it */
export function pnpmfileSource(): string {
  return `${MARKER}: spm add keeps it current - edit it there, not here.
//
// SyncBridge's modules (@syncbridge/builtins, @syncbridge/hl7, ...) are not
// on npm: in development they come from the registry's npm mirror as
// @${SBEXT_SCOPE}/syncbridge__<name>. A package of the mirror naming one by its
// own name - a peer, or a dependency - would be looked for on npm: this
// hands it to it from the mirror, its range kept. Nothing else is changed.
const SDK = new Set(${JSON.stringify(SDK_PACKAGES)});
const SCOPE = '@syncbridge/';
const MIRROR = '@${SBEXT_SCOPE}/syncbridge__';

const aliasRange = ${aliasRange.toString()};

function readPackage(pkg, context) {
  if (!String(pkg.name || '').startsWith('@${SBEXT_SCOPE}/')) return pkg;
  const take = (name, range, from) => {
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies[name] = 'npm:' + MIRROR + name.slice(SCOPE.length) + '@' + aliasRange(range);
    context.log(pkg.name + ': ' + name + ' ' + range + ' (' + from + ') from the mirror');
  };
  for (const [name, range] of Object.entries(pkg.peerDependencies || {})) {
    if (!name.startsWith(SCOPE) || SDK.has(name)) continue;
    delete pkg.peerDependencies[name];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
    take(name, range, 'a peer');
  }
  for (const [name, range] of Object.entries(pkg.dependencies || {})) {
    if (name.startsWith(SCOPE) && !SDK.has(name) && !String(range).startsWith('npm:'))
      take(name, range, 'a dependency');
    /* The mirror's own name for a module: under the name it is imported by too */
    else if (name.startsWith(MIRROR) && !pkg.dependencies[SCOPE + name.slice(MIRROR.length)])
      take(SCOPE + name.slice(MIRROR.length), range, name);
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
`;
}

/** Whether a workspace is installed with pnpm */
export function usesPnpm(root: string): boolean {
  if (
    ['pnpm-lock.yaml', 'pnpm-workspace.yaml'].some(f =>
      fs.existsSync(path.join(root, f)),
    )
  )
    return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    return String(pkg.packageManager || '').startsWith('pnpm@');
  } catch {
    return false;
  }
}

/**
 * The workspace's `.pnpmfile.cjs`: none, spm's as it writes it now, an
 * older one of spm's, or one of the workspace's own
 */
export function pnpmHookState(
  root: string,
): 'missing' | 'current' | 'outdated' | 'own' {
  const file = path.join(root, PNPMFILE);
  if (!fs.existsSync(file)) return 'missing';
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith(MARKER)) return 'own';
  return text === pnpmfileSource() ? 'current' : 'outdated';
}

/**
 * Writes spm's hook into a workspace installed with pnpm, or brings an
 * older one up to date. One of the workspace's own is kept: `spm check`
 * tells what it must do. Whether it was written.
 */
export function ensurePnpmHook(root: string): boolean {
  if (!usesPnpm(root)) return false;
  const state = pnpmHookState(root);
  if (state === 'current' || state === 'own') return false;
  fs.writeFileSync(path.join(root, PNPMFILE), pnpmfileSource());
  return true;
}
