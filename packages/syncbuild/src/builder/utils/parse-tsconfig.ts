import path from 'node:path';
import { inspect } from 'node:util';
import { SbError } from '@syncbridge/common';
import typescript from 'typescript';

/**
 * Reads a tsconfig file, with its `extends`, as TypeScript does.
 * `overwriteConfig` changes the raw config before it is parsed. Its
 * errors are printed unless `silent`.
 */
export function parseTsConfig(
  tsconfig: string,
  options?: {
    cwd?: string;
    overwriteConfig?: (config: any) => any;
    silent?: boolean;
  },
): typescript.ParsedCommandLine {
  const cwd = options?.cwd ?? process.cwd();
  const fileName = typescript.findConfigFile(
    cwd,
    typescript.sys.fileExists,
    tsconfig,
  );

  // if the value was provided, but no file, fail hard
  if (tsconfig !== undefined && !fileName) {
    throw new SbError(`Unable to locate tsconfig'`);
  }

  let loadedConfig: any = {};
  let baseDir = cwd;
  if (fileName) {
    const text = typescript.sys.readFile(fileName);
    if (text === undefined) throw new SbError(`failed to read '${fileName}'`);
    const result = typescript.parseConfigFileTextToJson(fileName, text);
    loadedConfig = result.config;
    baseDir = path.dirname(fileName);
  }

  if (options?.overwriteConfig)
    loadedConfig = options.overwriteConfig(loadedConfig) || loadedConfig;

  const parsedTsConfig = typescript.parseJsonConfigFileContent(
    loadedConfig,
    typescript.sys,
    baseDir,
  );
  if (parsedTsConfig.errors.length && !options?.silent) {
    console.log(inspect(parsedTsConfig.errors, false, 10, true));
  }
  return parsedTsConfig;
}
