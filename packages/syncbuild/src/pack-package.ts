import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  MANIFEST_FILE,
  readExtensionManifest,
  SbError,
} from '@syncbridge/common';
import AdmZip from 'adm-zip';
import colors from 'ansi-colors';
import * as jsonc from 'jsonc-parser';
import { compileSources } from './builder/compile-sources.js';
import { extractExports } from './builder/extract-exports.js';
import { packDocs } from './builder/pack-docs.js';
import {
  checkOutDir,
  makeTempDir,
  moveContents,
  prepareBuildDir,
  removeTempDir,
} from './builder/utils/out-dir.js';
import { checkPackage } from './commands/check-package.js';
import { Context } from './context.js';
import type { PackageBuildConfig, PackageJson } from './types.js';

/** The entry point every package exposes */
const ENTRY_POINT = 'index.js';

/**
 * Builds a package: the TypeScript output with its declarations, a
 * `package.json`, and the package's manifest in syncbridge-manifest.json -
 * what it needs, and its apps and components, each with its definition
 * and the module it is exported from. No lockfile: its dependencies' ranges are resolved where
 * it is installed, and locked there.
 * Nothing is bundled - npm dependencies are installed where the package is,
 * registry packages are loaded by SyncBridge, peers come from the host.
 */
export async function packPackage(config: PackageBuildConfig) {
  const packageDir = path.resolve(process.cwd(), config.packageDir || './');
  const pkgJson: PackageJson = jsonc.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
  );
  const sourceManifest = readExtensionManifest(packageDir, pkgJson)?.manifest;
  const { errors, warnings } = checkPackage(packageDir, config.tsconfig);
  for (const w of warnings) config.logger?.(colors.yellow('⚠ ' + w));
  if (errors.length)
    throw new SbError(
      `${pkgJson.name} has problems to fix before it can be packed:\n  - ` +
        errors.join('\n  - '),
    );
  const sourceEntry = (pkgJson.module || pkgJson.main || ENTRY_POINT).replace(
    /^\.\//,
    '',
  );
  if (sourceEntry !== ENTRY_POINT)
    throw new SbError(
      `"module" must be "./${ENTRY_POINT}" (found "${sourceEntry}"): ` +
        `packages are imported, and their types found, through it`,
    );

  config.logger?.(`Packing ${colors.magenta(pkgJson.name)}...`);
  const outDir = path.resolve(packageDir, config.outDir ?? './');
  checkOutDir(outDir, packageDir);
  /* A zip is a file among others: nothing else in the directory is
   * touched. A build is the directory: emptied only when it is one */
  if (!config.pack) prepareBuildDir(outDir, pkgJson.name, config.clean);
  fs.mkdirSync(outDir, { recursive: true });
  const context = new Context();
  Object.assign(context, {
    config,
    logger: config.logger,
    pkgJson,
    packageDir,
    outDir,
    cwd: process.cwd(),
    tmpDir: makeTempDir(packageDir, config.tempDir),
    entryPoint: sourceEntry,
    outEntryPoint: ENTRY_POINT,
    outFile:
      pkgJson.name.replace(/^@/, '').replace(/\//g, '-') +
      '-' +
      pkgJson.version,
    outPkgJson: {
      name: pkgJson.name,
      version: pkgJson.version,
      description: pkgJson.description,
      author: pkgJson.author,
      license: pkgJson.license,
      /* Where it lives: shown with it in the registry */
      homepage: pkgJson.homepage,
      repository: pkgJson.repository,
      private: true,
      type: 'module',
      module: './' + ENTRY_POINT,
      /* For Node's own resolution of the package; no "exports", which would
       * close the subpaths `sb:@vendor/name/sub` imports */
      main: './' + ENTRY_POINT,
      types: './index.d.ts',
      dependencies: pkgJson.dependencies,
      peerDependencies: pkgJson.peerDependencies,
    } satisfies PackageJson,
    /* What the author wrote; what the package brings is added as found */
    manifest: {
      ...(sourceManifest?.name ? { name: sourceManifest.name } : {}),
      dependencies: sourceManifest?.dependencies,
      ...(sourceManifest?.docsLanguage !== undefined
        ? { docsLanguage: sourceManifest.docsLanguage }
        : {}),
    },
  });
  const writeManifest = () => {
    fs.writeFileSync(
      path.join(context.tmpDir, 'package.json'),
      JSON.stringify(context.outPkgJson, null, 2),
    );
    fs.writeFileSync(
      path.join(context.tmpDir, MANIFEST_FILE),
      JSON.stringify(context.manifest, null, 2),
    );
  };

  try {
    compileSources(context);
    /* Before the output is imported: "type": "module" makes it ESM */
    writeManifest();
    await extractExports(context);
    /* docs/ whole, each of them its README: docs/<ClassName>/README.md */
    packDocs(context);
    /* With the apps and components extractExports found */
    writeManifest();
    if (config.pack) {
      const zipFileName = path.join(outDir, context.outFile + '.zip');
      const zip = new AdmZip();
      zip.addLocalFolder(context.tmpDir);
      /* Written whole, then put in place: a failed pack leaves the last
       * zip of the version as it was */
      const partial = zipFileName + '.partial';
      zip.writeZip(partial);
      fs.renameSync(partial, zipFileName);
      config.logger?.(
        `Generated package: ${colors.magenta(path.basename(zipFileName))}`,
      );
    } else {
      moveContents(context.tmpDir, outDir);
      config.logger?.(`Generated package directory: ${colors.magenta(outDir)}`);
    }
  } finally {
    removeTempDir(context.tmpDir, packageDir);
  }
}
