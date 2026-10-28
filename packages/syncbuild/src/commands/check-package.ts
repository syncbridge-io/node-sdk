import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  type ExtensionPackageJson,
  fromSbextName,
  isSdkPackage,
  isSyncBridgeModule,
  manifestOf,
  parseSbSpecifier,
  SBEXT_SCOPE,
  toSbextName,
  validateRegistryName,
} from '@syncbridge/common';
import semver from 'semver';
import { parseTsConfig } from '../builder/utils/parse-tsconfig.js';
import { hasMirrorScope, workspaceRoot } from '../npm-mirror.js';
import { aliasRange, PNPMFILE, pnpmHookState, usesPnpm } from '../pnpm-hook.js';
import { findWorkspacePackage } from '../workspace.js';

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** `from 'x'`, `import('x')`, `require('x')` and `export ... from 'x'` */
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])(sb:[^'"]+)\1/g;

/**
 * Checks that a package is consistent before it is packed: its registry
 * dependencies are declared once, in the manifest's `dependencies`, and
 * everything derived from them - the `@sbext` devDependency that carries
 * the types, the tsconfig `paths` entry that maps `sb:` to them - is
 * present, and every `sb:` import the sources make is declared.
 *
 * A dependency that is a package of the same workspace needs no `@sbext`
 * devDependency: the workspace links it, and `paths` maps it, under its own
 * name or its scope, to its build.
 */
export function checkPackage(
  dir: string,
  tsconfig = 'tsconfig.json',
): CheckResult {
  const packageDir = path.resolve(dir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const pkgJson: ExtensionPackageJson & {
    devDependencies?: Record<string, string>;
  } = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
  );

  for (const p of validateRegistryName(pkgJson.name))
    errors.push(`package.json "name": ${p}`);

  const manifest = manifestOf(packageDir, pkgJson);
  const registryDeps = manifest?.dependencies || {};
  const root = workspaceRoot(packageDir);
  const pnpm = usesPnpm(root);
  /** `paths` keys of which one must be there, per dependency */
  const pathKeys = new Map<string, string[]>();
  for (const [name, range] of Object.entries(registryDeps)) {
    const problems = validateRegistryName(name);
    if (problems.length) {
      for (const p of problems) errors.push(`manifest dependencies: ${p}`);
      continue;
    }
    if (isSdkPackage(name)) {
      errors.push(
        `manifest dependencies["${name}"]: "${name}" is part of the SDK, on npm; declare it in peerDependencies`,
      );
      continue;
    }
    if (name === (manifest?.name || pkgJson.name)) {
      errors.push(`manifest dependencies: "${name}" is the package itself`);
      continue;
    }
    /* SyncBridge's modules are imported under their own name, which the
     * mirror's copy is installed under: no `sb:` path to map */
    const isModule = isSyncBridgeModule(name);
    const scopeKey = `sb:@${name.slice(1).split('/')[0]}/*`;
    const workspace = findWorkspacePackage(name, packageDir);
    if (!isModule)
      pathKeys.set(name, workspace ? [`sb:${name}`, scopeKey] : [scopeKey]);
    if (!semver.validRange(range))
      errors.push(
        `manifest dependencies["${name}"]: "${range}" is not a semver range`,
      );
    const sbext = toSbextName(name);
    const devName = isModule ? name : sbext;
    const devSpec = isModule ? `npm:${sbext}@${aliasRange(range)}` : range;
    /* An alias written before its range was made spaceless: as good to
     * npm, not to pnpm */
    const written = pkgJson.devDependencies?.[devName];
    const devSpecs =
      isModule && !pnpm ? [devSpec, `npm:${sbext}@${range}`] : [devSpec];
    if (
      workspace &&
      semver.validRange(range) &&
      !semver.satisfies(workspace.pkgJson.version, range)
    )
      errors.push(
        `manifest dependencies["${name}"]: the workspace has version ${workspace.pkgJson.version}, which does not satisfy ${range}`,
      );
    else if (!workspace && !devSpecs.includes(written as string))
      errors.push(
        `devDependencies["${devName}"] must be "${devSpec}", the types of "${name}". Run: spm add ${name}@${range}`,
      );
    if (pkgJson.dependencies?.[name] || pkgJson.peerDependencies?.[name])
      errors.push(
        `"${name}" is a registry package; declare it only in manifest dependencies`,
      );
  }

  for (const name of Object.keys(pkgJson.dependencies || {})) {
    if (isSyncBridgeModule(name) && !(name in registryDeps))
      warnings.push(
        `dependencies["${name}"]: a SyncBridge module is a registry package; declare it in manifest dependencies, so the server installs the version it needs. Run: spm add ${name}@<range>`,
      );
    else if (isSdkPackage(name) && name !== '@syncbridge/common')
      warnings.push(
        `dependencies["${name}"]: SyncBridge provides the SDK; declare it in peerDependencies, so the package uses the host's copy rather than a second one of its own`,
      );
  }

  /* SyncBridge's modules were once peers the host provided: such a package
   * still installs, a server takes the peer for a registry dependency */
  const devDeps = pkgJson.devDependencies || {};
  for (const [name, range] of Object.entries(pkgJson.peerDependencies || {}))
    if (isSyncBridgeModule(name) && !(name in registryDeps))
      warnings.push(
        `peerDependencies["${name}"]: a SyncBridge module is a registry package; declare it in manifest dependencies instead, so a server installs a newer version it needs. Run: spm add ${name}@${range}`,
      );

  /* The mirror's packages found only when .npmrc sends @sbext there: the
   * workspace's, else one's own (~/.npmrc) - so told, not refused */
  const fromMirror = Object.entries(devDeps).some(
    ([name, spec]) =>
      name.startsWith(`@${SBEXT_SCOPE}/`) ||
      String(spec).startsWith(`npm:@${SBEXT_SCOPE}/`),
  );
  if (fromMirror && !hasMirrorScope(root))
    warnings.push(
      `.npmrc: "@${SBEXT_SCOPE}:registry=" is not in the workspace's .npmrc; unless yours sends it, npm looks for the npm mirror's packages on npmjs.org. Run spm add again, or add: @${SBEXT_SCOPE}:registry=https://npm.syncbridge.io/`,
    );
  /* pnpm installs a mirror package with what it declares alone: the
   * modules it names come from the mirror by spm's hook */
  const hook = fromMirror && pnpm ? pnpmHookState(root) : 'current';
  if (hook === 'missing' || hook === 'outdated')
    warnings.push(
      `${PNPMFILE}: the workspace is installed with pnpm, which looks for the SyncBridge modules the npm mirror's packages name on npmjs.org. Run spm add again: it writes the hook that takes them from the mirror`,
    );
  else if (hook === 'own')
    warnings.push(
      `${PNPMFILE}: the workspace's own hook is kept; it must take the SyncBridge modules the npm mirror's packages name from the mirror, as spm's does (see syncbuild's README, "pnpm"), or pnpm looks for them on npmjs.org`,
    );

  if (pkgJson.dependencies?.['@syncbridge/common'])
    errors.push(
      '"@syncbridge/common" must be a peerDependency: the host provides it, and a private copy breaks its registry and metadata',
    );

  /* The npm mirror's copies are for development: a host installs registry
   * packages from the registry, and the mirror refuses it without a key */
  for (const field of ['dependencies', 'peerDependencies'] as const) {
    for (const name of Object.keys(pkgJson[field] || {})) {
      if (!name.startsWith(`@${SBEXT_SCOPE}/`)) continue;
      let hint = `move it to devDependencies`;
      try {
        const regName = fromSbextName(name);
        hint = `declare "${regName}" in manifest dependencies instead. Run: spm add ${regName}@<range>`;
      } catch {
        /* Not a valid mirror name; the generic hint stands */
      }
      errors.push(
        `${field}["${name}"] is the npm mirror's copy of a registry package, which a host cannot install; ${hint}`,
      );
    }
  }

  /* Extension packages listed as npm dependencies would be looked up on npm */
  const require = createRequire(path.join(packageDir, 'package.json'));
  for (const name of Object.keys(pkgJson.dependencies || {})) {
    if (name in registryDeps) continue;
    let depDir: string;
    try {
      depDir = path.dirname(require.resolve(name + '/package.json'));
    } catch {
      continue;
    }
    if (manifestOf(depDir))
      errors.push(
        `dependencies["${name}"] is a SyncBridge extension package; declare it in manifest dependencies and import it as "sb:${name}"`,
      );
  }

  const tsconfigPath = path.resolve(packageDir, tsconfig);
  if (!fs.existsSync(tsconfigPath)) {
    errors.push(`${tsconfig} not found`);
    return { errors, warnings };
  }
  const parsed = parseTsConfig(tsconfigPath, { cwd: packageDir });
  const paths = parsed.options.paths || {};
  for (const [name, keys] of pathKeys) {
    if (!keys.some(k => paths[k]))
      errors.push(
        `${tsconfig}: compilerOptions.paths has no "${keys[0]}" entry; TypeScript cannot find the types of "sb:${name}". Run: spm add ${name}@${registryDeps[name]}`,
      );
  }

  for (const file of parsed.fileNames) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPECIFIER_PATTERN)) {
      const where = path.relative(packageDir, file);
      let sb: ReturnType<typeof parseSbSpecifier>;
      try {
        sb = parseSbSpecifier(m[2]);
      } catch (e: any) {
        errors.push(`${where}: ${e.message}`);
        continue;
      }
      if (sb && isSyncBridgeModule(sb.name))
        errors.push(
          `${where}: imports "${m[2]}"; a SyncBridge module is imported under its own name: import it as "${m[2].slice(3)}"`,
        );
      else if (sb && !(sb.name in registryDeps))
        errors.push(
          `${where}: imports "${m[2]}", but "${sb.name}" is not in manifest dependencies. Run: spm add ${sb.name}@<range>`,
        );
    }
  }

  if (!pkgJson.peerDependencies?.['@syncbridge/common'])
    warnings.push(
      '"@syncbridge/common" is not a peerDependency; declare it so installation checks the host provides a compatible version',
    );
  return { errors, warnings };
}
