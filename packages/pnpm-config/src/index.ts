/*
 * pnpm and SyncBridge's modules. A module (`@syncbridge/builtins`,
 * `@syncbridge/hl7`, ...) is not on npm: in development it is the
 * registry's npm mirror's copy, `@sbext/syncbridge__<name>`, installed
 * under its own name by an alias. npm installs flatly, and the alias a
 * package declares serves whatever else asks for the module. pnpm installs
 * each package with what it declares alone: a mirror package naming a
 * module by its own name - a peer, as modules once were, or a dependency -
 * would be looked for on npmjs.org, where it is not.
 *
 * This package is a pnpm config dependency: pnpm installs it before
 * anything else, so the workspace's `.pnpmfile.cjs` can take its hooks on
 * a fresh clone. Its readPackage hook gives every mirror package the
 * modules it names from the mirror, their ranges kept. It has no
 * dependencies, as a config dependency may not.
 */

/** The SDK's packages: on npm, the host's; never taken from the mirror */
export const SDK_PACKAGES: readonly string[] = [
  '@syncbridge/common',
  '@syncbridge/runtime',
  '@syncbridge/syncbuild',
  '@syncbridge/testing',
  '@syncbridge/plugin-api',
  '@syncbridge/pnpm-config',
];

/** The scope of SyncBridge's packages: its modules and its SDK */
const SCOPE = '@syncbridge/';

/** The mirror's packages, and its name for a module's */
const MIRROR_SCOPE = '@sbext/';
const MIRROR_MODULE = '@sbext/syncbridge__';

/** Whether a name is one of SyncBridge's modules: not its SDK */
export const isModule = (name: string) =>
  name.startsWith(SCOPE) && !SDK_PACKAGES.includes(name);

/** The mirror's name for a module: `@syncbridge/hl7` as `@sbext/syncbridge__hl7` */
export const mirrorName = (name: string) =>
  MIRROR_MODULE + name.slice(SCOPE.length);

/**
 * A range as an alias takes it: pnpm does not parse one with spaces
 * (`npm:@sbext/x@>=2.0.1 <3`). The same range spaceless where there is
 * one - `>=2.0.1 <3` as `^2.0.1`, `>=1.2.0 <1.3.0` as `~1.2.0` - else its
 * lowest version up to the next major.
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

/** A module from the mirror, as an alias: `npm:@sbext/syncbridge__hl7@^2.0.1` */
export const mirrorAlias = (name: string, range: string) =>
  `npm:${mirrorName(name)}@${aliasRange(range)}`;

/** A package's manifest, as pnpm hands it to readPackage */
export interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * pnpm's readPackage hook: a mirror package's modules - named as a peer, a
 * dependency, or by the mirror's own name - its dependencies from the
 * mirror, their ranges kept. Every other package is left as it is.
 */
export function readPackage(
  pkg: PackageManifest,
  context?: { log(message: string): void },
): PackageManifest {
  if (!String(pkg.name || '').startsWith(MIRROR_SCOPE)) return pkg;
  const take = (name: string, range: string, from: string) => {
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies[name] = mirrorAlias(name, range);
    context?.log(`${pkg.name}: ${name} ${range} (${from}) from the mirror`);
  };
  for (const [name, range] of Object.entries(pkg.peerDependencies || {})) {
    if (!isModule(name)) continue;
    delete pkg.peerDependencies![name];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
    take(name, range, 'a peer');
  }
  for (const [name, range] of Object.entries(pkg.dependencies || {})) {
    if (isModule(name) && !String(range).startsWith('npm:'))
      take(name, range, 'a dependency');
    else if (name.startsWith(MIRROR_MODULE)) {
      /* The mirror's own name for a module: under the name it is imported by too */
      const own = SCOPE + name.slice(MIRROR_MODULE.length);
      if (!pkg.dependencies![own]) take(own, range, name);
    }
  }
  return pkg;
}

/** What pnpm takes from a pnpmfile */
export const hooks = { readPackage };
