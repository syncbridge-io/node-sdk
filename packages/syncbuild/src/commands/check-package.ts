import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  type ExtensionPackageJson,
  fromSbextName,
  manifestOf,
  parseSbSpecifier,
  SBEXT_SCOPE,
  toSbextName,
  validateRegistryName,
} from '@syncbridge/common';
import semver from 'semver';
import { parseTsConfig } from '../builder/utils/parse-tsconfig.js';
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
  /** `paths` keys of which one must be there, per dependency */
  const pathKeys = new Map<string, string[]>();
  for (const [name, range] of Object.entries(registryDeps)) {
    const problems = validateRegistryName(name);
    if (problems.length) {
      for (const p of problems) errors.push(`manifest dependencies: ${p}`);
      continue;
    }
    if (name === (manifest?.name || pkgJson.name)) {
      errors.push(`manifest dependencies: "${name}" is the package itself`);
      continue;
    }
    const scopeKey = `sb:@${name.slice(1).split('/')[0]}/*`;
    const workspace = findWorkspacePackage(name, packageDir);
    pathKeys.set(name, workspace ? [`sb:${name}`, scopeKey] : [scopeKey]);
    if (!semver.validRange(range))
      errors.push(
        `manifest dependencies["${name}"]: "${range}" is not a semver range`,
      );
    const sbext = toSbextName(name);
    if (
      workspace &&
      semver.validRange(range) &&
      !semver.satisfies(workspace.pkgJson.version, range)
    )
      errors.push(
        `manifest dependencies["${name}"]: the workspace has version ${workspace.pkgJson.version}, which does not satisfy ${range}`,
      );
    else if (!workspace && pkgJson.devDependencies?.[sbext] !== range)
      errors.push(
        `devDependencies["${sbext}"] must be "${range}", the types of "${name}". Run: spm add ${name}@${range}`,
      );
    if (pkgJson.dependencies?.[name] || pkgJson.peerDependencies?.[name])
      errors.push(
        `"${name}" is a registry package; declare it only in manifest dependencies`,
      );
  }

  for (const name of Object.keys(pkgJson.dependencies || {}))
    if (name.startsWith('@syncbridge/') && name !== '@syncbridge/common')
      warnings.push(
        `dependencies["${name}"]: SyncBridge provides the @syncbridge packages; declare it in peerDependencies, so the package uses the host's copy rather than a second one of its own`,
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
      if (sb && !(sb.name in registryDeps))
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
