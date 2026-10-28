import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import semver from 'semver';
import YAML from 'yaml';

export { aliasRange } from '@syncbridge/pnpm-config';

/*
 * pnpm and SyncBridge's modules. A module (`@syncbridge/builtins`,
 * `@syncbridge/hl7`, ...) is not on npm: in development it is the npm
 * mirror's copy, `@sbext/syncbridge__<name>`, installed under its own name
 * by an alias. pnpm installs each package with what it declares alone: a
 * mirror package naming a module by its own name would be looked for on
 * npmjs.org.
 *
 * `@syncbridge/pnpm-config` holds the readPackage hook that gives the
 * mirror's packages those modules from the mirror. It is a pnpm config
 * dependency - in pnpm-workspace.yaml's `configDependencies`, installed
 * before anything else - and the workspace's `.pnpmfile.cjs` is one line
 * taking its hooks: on a fresh clone too, the hook is in place before the
 * packages are resolved.
 */

/** The file pnpm reads its hooks from, at the workspace root */
export const PNPMFILE = '.pnpmfile.cjs';

/** The config dependency holding the hook */
export const PNPM_CONFIG_PACKAGE = '@syncbridge/pnpm-config';

/** The first line of the file spm writes: what tells it is spm's */
const MARKER = '// Written by spm (@syncbridge/syncbuild)';

/** The workspace's `.pnpmfile.cjs` as spm writes it */
export const PNPMFILE_SOURCE = `${MARKER}: SyncBridge's modules from the npm mirror.
// The hooks of ${PNPM_CONFIG_PACKAGE}, a config dependency (pnpm-workspace.yaml):
// pnpm installs it before anything else.
module.exports = require('./node_modules/.pnpm-config/${PNPM_CONFIG_PACKAGE}');
`;

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

/** The version of `@syncbridge/pnpm-config` this syncbuild takes */
export function pnpmConfigVersion(): string {
  const require = createRequire(import.meta.url);
  return JSON.parse(
    fs.readFileSync(
      require.resolve(`${PNPM_CONFIG_PACKAGE}/package.json`),
      'utf8',
    ),
  ).version;
}

/** The version of `@syncbridge/pnpm-config` the workspace takes as a config dependency */
export function configuredVersion(root: string): string | undefined {
  const file = path.join(root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(file)) return;
  const spec = YAML.parse(fs.readFileSync(file, 'utf8'))?.configDependencies?.[
    PNPM_CONFIG_PACKAGE
  ];
  /* "1.0.0+sha512-...": the version, then its integrity */
  const version = typeof spec === 'string' ? spec.split('+')[0] : undefined;
  return version && semver.valid(version) ? version : undefined;
}

/**
 * The workspace's hook: none (no `.pnpmfile.cjs`, or no config dependency),
 * spm's as it is now, spm's with an older `@syncbridge/pnpm-config`, or a
 * `.pnpmfile.cjs` of the workspace's own
 */
export function pnpmHookState(
  root: string,
): 'missing' | 'current' | 'outdated' | 'own' {
  const file = path.join(root, PNPMFILE);
  if (!fs.existsSync(file)) return 'missing';
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith(MARKER)) return 'own';
  if (text !== PNPMFILE_SOURCE) return 'outdated';
  const configured = configuredVersion(root);
  if (!configured) return 'missing';
  return semver.lt(configured, pnpmConfigVersion()) ? 'outdated' : 'current';
}

/**
 * How the config dependency is added: by pnpm, which writes it with its
 * integrity into pnpm-workspace.yaml and installs it. An object, so tests
 * can stand in for it.
 */
export const pnpmConfig = {
  add(root: string, spec: string): void {
    const [node, ...pnpm] = pnpmCommand();
    execFileSync(node, [...pnpm, 'add', '--config', spec], {
      cwd: root,
      stdio: 'pipe',
    });
  },
};

/**
 * Puts spm's hook into a workspace installed with pnpm, or brings it up
 * to date: `@syncbridge/pnpm-config` as a config dependency and the
 * one-line `.pnpmfile.cjs`. One of the workspace's own is kept: `spm
 * check` tells what it must do. The files written, relative to the root.
 */
export function ensurePnpmHook(root: string): string[] {
  if (!usesPnpm(root) || pnpmHookState(root) === 'own') return [];
  const written: string[] = [];
  const own = pnpmConfigVersion();
  const configured = configuredVersion(root);
  if (!configured || semver.lt(configured, own)) {
    pnpmConfig.add(root, `${PNPM_CONFIG_PACKAGE}@${own}`);
    written.push('pnpm-workspace.yaml');
  }
  const file = path.join(root, PNPMFILE);
  if (
    !fs.existsSync(file) ||
    fs.readFileSync(file, 'utf8') !== PNPMFILE_SOURCE
  ) {
    fs.writeFileSync(file, PNPMFILE_SOURCE);
    written.push(PNPMFILE);
  }
  return written;
}

/**
 * The pnpm syncbuild depends on, through its Node.js entry rather than the
 * native binary its install script puts in place, which is platform-specific
 * and missing where install scripts are blocked
 */
export function pnpmCommand(): string[] {
  const require = createRequire(import.meta.url);
  const bin = path.join(
    path.dirname(require.resolve('pnpm/package.json')),
    'bin',
    'pnpm.mjs',
  );
  return [process.execPath, bin];
}
