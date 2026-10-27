import fs from 'node:fs';
import path from 'node:path';
import {
  isSdkPackage,
  isSyncBridgeModule,
  MANIFEST_FILE,
  SbError,
  toSbextName,
  validateRegistryName,
} from '@syncbridge/common';
import * as jsonc from 'jsonc-parser';
import semver from 'semver';
import {
  ensureMirrorScope,
  nodeModulesDirs,
  workspaceRoot,
} from '../npm-mirror.js';
import { findWorkspacePackage } from '../workspace.js';

/**
 * `spm add @vendor/name@<range>`: declares a registry dependency and the two
 * things that follow from it, so they cannot drift apart:
 *
 * - `dependencies[name] = range` in the package's manifest - the runtime
 *   contract a SyncBridge worker reads: its syncbridge-manifest.json, or the
 *   `syncbridge` field of its package.json when it is kept there.
 * - `devDependencies["@sbext/vendor__name"] = range` - the package from the
 *   npm mirror, which carries the types and the code tests run against.
 * - tsconfig `paths["sb:@vendor/*"]` - where TypeScript finds those types.
 *   TypeScript allows one `*` per pattern, so `@vendor/name` cannot be
 *   mapped to `vendor__name` generically: one entry per vendor scope.
 *
 * A package of the same workspace is not on the npm mirror: it needs no
 * `@sbext` devDependency, and its `paths` entry, under its own name, points
 * at the declarations its build writes.
 *
 * SyncBridge's own modules (`@syncbridge/builtins`, `@syncbridge/hl7`, ...)
 * are registry packages too, but imported under their own name: the
 * mirror's copy is installed under that name for development
 * (`npm:@sbext/...`), and no `paths` entry is needed. A server comes with a
 * version of each and installs a newer one a package needs.
 *
 * Any package from the mirror needs the workspace's `.npmrc` to send
 * `@sbext` there: written when it does not.
 */
export function addDependency(
  dir: string,
  spec: string,
  tsconfig = 'tsconfig.json',
): { name: string; range: string; changed: string[] } {
  /* Real paths throughout: a workspace package's directory is one */
  const packageDir = fs.realpathSync(path.resolve(dir));
  const at = spec.lastIndexOf('@');
  if (at <= 0)
    throw new SbError(
      `"${spec}" needs a version range, for example @vendor/name@^1.2.0`,
    );
  const name = spec.slice(0, at);
  const range = spec.slice(at + 1);
  const problems = validateRegistryName(name);
  if (problems.length) throw new SbError(problems.join('. '));
  if (!semver.validRange(range))
    throw new SbError(`"${range}" is not a semver range`);
  if (isSdkPackage(name))
    throw new SbError(
      `"${name}" is part of the SDK, on npm: declare it in peerDependencies (npm install -D ${name})`,
    );
  const scope = name.slice(1).split('/')[0];
  const changed: string[] = [];
  const workspace = findWorkspacePackage(name, packageDir);
  const mirror = () => {
    const root = workspaceRoot(packageDir);
    if (ensureMirrorScope(root))
      changed.push(path.relative(packageDir, path.join(root, '.npmrc')));
  };

  const isModule = isSyncBridgeModule(name);
  const pkgFile = path.join(packageDir, 'package.json');
  let text = fs.readFileSync(pkgFile, 'utf8');
  const before = text;
  const manifestFile = path.join(packageDir, MANIFEST_FILE);
  const inPackageJson = jsonc.parse(text)?.syncbridge != null;
  if (inPackageJson)
    text = modify(text, ['syncbridge', 'dependencies', name], range);
  if (isModule) {
    /* Once a peer the host provided */
    if (jsonc.parse(text)?.peerDependencies?.[name] != null)
      text = modify(text, ['peerDependencies', name], undefined);
    if (!workspace)
      text = modify(
        text,
        ['devDependencies', name],
        `npm:${toSbextName(name)}@${range}`,
      );
  } else if (!workspace)
    text = modify(text, ['devDependencies', toSbextName(name)], range);
  if (text !== before) {
    fs.writeFileSync(pkgFile, text);
    changed.push('package.json');
  }
  if (!inPackageJson) {
    const manifestText = fs.existsSync(manifestFile)
      ? fs.readFileSync(manifestFile, 'utf8')
      : '{}\n';
    const updated = modify(manifestText, ['dependencies', name], range);
    if (updated !== manifestText) {
      fs.writeFileSync(manifestFile, updated);
      changed.push(MANIFEST_FILE);
    }
  }

  if (!workspace) mirror();
  if (isModule) return { name, range, changed };

  const tsFile = path.resolve(packageDir, tsconfig);
  if (!fs.existsSync(tsFile)) throw new SbError(`${tsconfig} not found`);
  let tsText = fs.readFileSync(tsFile, 'utf8');
  const tsJson = jsonc.parse(tsText) || {};
  const baseDir = tsJson.compilerOptions?.baseUrl
    ? path.resolve(path.dirname(tsFile), tsJson.compilerOptions.baseUrl)
    : path.dirname(tsFile);
  const relative = (to: string) => {
    const rel = path.relative(baseDir, to).split(path.sep).join('/');
    return rel.startsWith('.') ? rel : './' + rel;
  };
  const key = workspace ? `sb:${name}` : `sb:@${scope}/*`;
  const targets = workspace
    ? [relative(workspace.types)]
    : nodeModulesDirs(packageDir).map(
        nmDir => `${relative(nmDir)}/@sbext/${scope}__*/index.d.ts`,
      );
  /* A scope's entry, once there, may have been edited and is kept; a
   * workspace package's follows its build */
  const current = tsJson.compilerOptions?.paths?.[key];
  const upToDate = workspace
    ? JSON.stringify(current) === JSON.stringify(targets)
    : !!current;
  if (!upToDate) {
    tsText = modify(tsText, ['compilerOptions', 'paths', key], targets);
    fs.writeFileSync(tsFile, tsText);
    changed.push(path.relative(packageDir, tsFile) || tsconfig);
  }
  return { name, range, changed };
}

function modify(text: string, at: jsonc.JSONPath, value: any): string {
  const edits = jsonc.modify(text, at, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  });
  return jsonc.applyEdits(text, edits);
}
