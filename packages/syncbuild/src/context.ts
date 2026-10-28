import type { SyncBridgeManifest } from '@syncbridge/common';
import type typescript from 'typescript';
import type { LocaleBase } from './builder/pack-locales.js';
import type { PackageBuildConfig, PackageJson } from './types.js';

export class Context {
  declare pkgJson: PackageJson;
  declare outPkgJson: PackageJson;
  /** The manifest of the package built, written to syncbridge-manifest.json */
  declare manifest: SyncBridgeManifest;
  /**
   * The class names of the abstract apps and components the package
   * exports: bases of others, left out of the manifest - as extractExports
   * finds them
   */
  declare abstractClassNames?: string[];
  /**
   * What locales/ may tell the texts of besides the manifest's classes:
   * the abstract apps and components, and the classes of settings, the
   * package exports - for the classes built on them
   */
  declare localeBases?: Map<string, LocaleBase>;
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
