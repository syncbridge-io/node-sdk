import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLASS_METADATA,
  CLASS_TYPE,
  normalizeAppMetadata,
  normalizeComponentMetadata,
  normalizePluginMetadata,
} from '@syncbridge/common';
import typescript from 'typescript';
import { Context } from '../context.js';
import { installResolveHooks } from '../hooks.js';
import { describeLoadError } from './utils/load-error.js';

/**
 * Finds the apps, components and plugins the package exports from its
 * entry point and adds them to its manifest, each with its definition and
 * the module it is exported from: a worker loads only its app's and
 * components' code, the engine's main process only its plugins'.
 */
export async function extractExports(context: Context) {
  const { manifest } = context;
  /* The package imports its externals and its registry dependencies, from
   * the output directory; see installResolveHooks for how they resolve */
  const hooks = installResolveHooks();
  try {
    let pkgGlobal: Record<string, unknown>;
    try {
      pkgGlobal = await import(
        pathToFileURL(path.join(context.tmpDir, context.outEntryPoint)).href
      );
    } catch (e) {
      throw describeLoadError(e, context.pkgJson.name, context.packageDir);
    }
    const modules = definingModules(context);
    for (const [k, v] of Object.entries(pkgGlobal)) {
      if (typeof v !== 'function') continue;
      const classType = Reflect.getMetadata(CLASS_TYPE, v);
      const metadata = Reflect.getMetadata(CLASS_METADATA, v);
      if (!metadata || !['component', 'app', 'plugin'].includes(classType))
        continue;
      const entryPoint = await moduleOf(context, k, v, modules.get(k));
      if (classType === 'plugin') {
        (manifest.plugins = manifest.plugins || []).push({
          exportName: k,
          entryPoint,
          ...(await normalizePluginMetadata(metadata)),
        });
      } else if (classType === 'component') {
        (manifest.components = manifest.components || []).push({
          exportName: k,
          entryPoint,
          ...(await normalizeComponentMetadata(metadata)),
        });
      } else {
        (manifest.apps = manifest.apps || []).push({
          exportName: k,
          entryPoint,
          ...(await normalizeAppMetadata(metadata)),
        });
      }
    }
  } finally {
    hooks?.deregister();
  }
}

/**
 * The output module each export of the entry point is declared in, relative
 * to the output's root, as the compiler sees it
 */
function definingModules(context: Context): Map<string, string> {
  const result = new Map<string, string>();
  const { program, tsConfig } = context;
  if (!program || !tsConfig) return result;
  const outputOf = (file: typescript.SourceFile) =>
    typescript
      .getOutputFileNames(tsConfig, file.fileName, false)
      .find(f => f.endsWith('.js'));
  /* The source file compiled to the entry point */
  const entryOutput = path.join(context.tmpDir, context.outEntryPoint);
  const entry = program
    .getSourceFiles()
    .find(
      f =>
        !f.isDeclarationFile &&
        path.resolve(outputOf(f) || '') === path.resolve(entryOutput),
    );
  if (!entry) return result;
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) return result;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & typescript.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const file = symbol.declarations?.[0]?.getSourceFile();
    if (!file || file.isDeclarationFile) continue;
    const output = outputOf(file);
    if (!output) continue;
    result.set(
      exported.name,
      './' + path.relative(context.tmpDir, output).split(path.sep).join('/'),
    );
  }
  return result;
}

/**
 * The module to load an export from: the one it is declared in, when that
 * module exports the very class under the same name, or else the entry point
 */
async function moduleOf(
  context: Context,
  name: string,
  ctor: unknown,
  candidate?: string,
): Promise<string> {
  const entryPoint = './' + context.outEntryPoint;
  if (!candidate || candidate === entryPoint) return entryPoint;
  try {
    /* By its real path, as the entry point's own imports resolve to */
    const module = await import(
      pathToFileURL(fs.realpathSync(path.join(context.tmpDir, candidate))).href
    );
    if (module[name] === ctor) return candidate;
  } catch {
    /* The entry point loads it */
  }
  return entryPoint;
}
