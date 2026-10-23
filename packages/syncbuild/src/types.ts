import type { SyncBridgeManifest } from '@syncbridge/common';

export interface PackageBuildConfig {
  /**
   * Represents the directory of the package to be built.
   */
  packageDir: string;

  /**
   * Represents the output directory of the build.
   */
  outDir?: string;

  /**
   * A directory to make the temporary build directory in; spm makes a new
   * one of its own inside, and removes that alone. By default, the
   * package's node_modules/.cache/spm.
   */
  tempDir?: string;

  /**
   * `spm build`: empty the output directory even when it holds something
   * other than a build of the package. Without it, such a directory is
   * left as it is and the build refused.
   */
  clean?: boolean;

  /**
   * Represents the path to the tsconfig file.
   */
  tsconfig?: string;

  /**
   * Creates a zip file of the package
   */
  pack?: boolean;

  /**
   * Custom logger function for output messages.
   */
  logger?: typeof console.log;
}

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  author?: any;
  license?: string;
  /** The package's web page, as npm has it */
  homepage?: string;
  /** Where its code is, as npm has it: a URL or shorthand, or an object */
  repository?: string | { type?: string; url: string; directory?: string };
  private?: boolean;
  type?: string;
  module?: string;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: any;
  /** The manifest, when its author keeps it here rather than in syncbridge-manifest.json */
  syncbridge?: SyncBridgeManifest;
}
