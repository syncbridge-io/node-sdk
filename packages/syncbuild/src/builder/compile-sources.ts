import fs from 'node:fs';
import path from 'node:path';
import { SbError } from '@syncbridge/common';
import typescript from 'typescript';
import { Context } from '../context.js';
import { parseTsConfig } from './utils/parse-tsconfig.js';

/**
 * Compiles the package with TypeScript into the output directory: one
 * `.js` and one `.d.ts` per source file, nothing bundled. `sb:` imports and
 * every other specifier are emitted as written; the SyncBridge worker and
 * pnpm resolve them where the package is installed.
 */
export function compileSources(context: Context) {
  const tsconfigPath = path.resolve(
    context.packageDir,
    context.config.tsconfig || 'tsconfig.json',
  );
  if (!fs.existsSync(tsconfigPath))
    throw new SbError(`${path.basename(tsconfigPath)} not found`);
  const parsed = parseTsConfig(tsconfigPath, {
    cwd: context.packageDir,
    overwriteConfig: cfg => {
      const o = (cfg.compilerOptions = cfg.compilerOptions || {});
      Object.assign(o, {
        outDir: context.tmpDir,
        declaration: true,
        noEmit: false,
        emitDeclarationOnly: false,
        composite: false,
        incremental: false,
        sourceMap: false,
        declarationMap: false,
      });
      delete o.declarationDir;
      delete o.tsBuildInfoFile;
    },
  });
  const program = typescript.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  context.program = program;
  /* Where the compiler resolves the outputs of the sources from, when no
   * rootDir is given */
  context.tsConfig = {
    ...parsed,
    options: { ...parsed.options, configFilePath: tsconfigPath },
  };
  const emitted = program.emit();
  const diagnostics = [
    ...typescript.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ].filter(d => d.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length) {
    throw new SbError(
      'TypeScript compilation failed:\n' +
        typescript.formatDiagnostics(diagnostics, {
          getCanonicalFileName: f => f,
          getCurrentDirectory: () => context.packageDir,
          getNewLine: () => '\n',
        }),
    );
  }
  const entry = path.join(context.tmpDir, context.outEntryPoint);
  if (!fs.existsSync(entry))
    throw new SbError(
      `The compiled package has no ${context.outEntryPoint}. Its entry point ` +
        `must compile to the root of the output - set "rootDir" to the ` +
        `directory of the source entry (usually "src").`,
    );
}
