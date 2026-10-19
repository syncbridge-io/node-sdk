import type { SyncBridgeManifest } from '@syncbridge/common';
import type typescript from 'typescript';
import type { PackageBuildConfig, PackageJson } from './types.js';

export class Context {
  declare pkgJson: PackageJson;
  declare outPkgJson: PackageJson;
  /** The manifest of the package built, written to syncbridge-manifest.json */
  declare manifest: SyncBridgeManifest;
  /** The TypeScript program the package was compiled with, and its config */
  declare program?: typescript.Program;
  declare tsConfig?: typescript.ParsedCommandLine;
  declare packageDir: string;
  declare tmpDir: string;
  declare outEntryPoint: string;
  declare outDir: string;
  declare outFile: string;
  declare config: PackageBuildConfig;
  declare cwd: string;
  declare entryPoint: string;
  declare logger?: typeof console.log;
}
