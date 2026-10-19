import fs from 'node:fs';
import path from 'node:path';
import { SbError } from '../classes/sb-error.js';
import type {
  AppMetadata,
  ComponentMetadata,
  PluginMetadata,
} from '../models/index.js';

/** The file an extension package's manifest is in, at its root */
export const MANIFEST_FILE = 'syncbridge-manifest.json';

/**
 * An extension package's manifest: what it brings and what it needs.
 *
 * Its author writes `name` and `dependencies`, in the `syncbridge` field of
 * `package.json` or in `syncbridge-manifest.json` at the package's root -
 * never both. `syncbuild` adds what the package brings and writes the
 * manifest of the package it builds to `syncbridge-manifest.json` only, so
 * an installed package's manifest is always that file.
 *
 * Fields SyncBridge does not know are passed over with a warning: one added
 * later breaks neither an older SyncBridge nor an older package.
 */
export interface SyncBridgeManifest {
  /** The name the package registers under, when it differs from `name` */
  name?: string;
  /** Registry packages this one depends on: registry name -> semver range */
  dependencies?: Record<string, string>;
  /** The apps the package brings, each with its definition */
  apps?: ManifestEntry<AppMetadata>[];
  /** The components the package brings, each with its definition */
  components?: ManifestEntry<ComponentMetadata>[];
  /** The plugins the package brings, each with its definition */
  plugins?: ManifestEntry<PluginMetadata>[];
  /**
   * The language of its documents that name none (README.md, not
   * README.tr.md): ISO 639-1, its region if any - `en` when not told
   */
  docsLanguage?: string;
}

/**
 * Something a package brings: its definition, and where its class is - the
 * module it is exported from, so a worker loads only what it runs
 */
export type ManifestEntry<T> = T & {
  /** The name the class is exported under from its module */
  exportName: string;
  /** Its module, relative to the package's root: `./hl7-bridge.app.js` */
  entryPoint: string;
};

/** The fields of a manifest SyncBridge knows */
const KNOWN_FIELDS = new Set([
  'name',
  'dependencies',
  'apps',
  'components',
  'plugins',
  'docsLanguage',
]);

/**
 * The parts of an extension package's `package.json` SyncBridge reads.
 */
export interface ExtensionPackageJson {
  name: string;
  version: string;
  description?: string;
  main?: string;
  module?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  syncbridge?: SyncBridgeManifest;
}

/** A package's manifest as read, with where it was and what was not known */
export interface ReadManifest {
  manifest: SyncBridgeManifest;
  /** `file`: syncbridge-manifest.json; `package.json`: its syncbridge field */
  source: 'file' | 'package.json';
  /** Fields of the manifest SyncBridge does not know, passed over */
  unknownFields: string[];
}

/**
 * Reads the manifest of the package in `packageDir`: its
 * syncbridge-manifest.json, or else the `syncbridge` field of its
 * package.json. Undefined when it has neither: it is not an extension
 * package. Throws when it has both, as which one counts would be unclear.
 */
export function readExtensionManifest(
  packageDir: string,
  pkgJson?: ExtensionPackageJson,
): ReadManifest | undefined {
  pkgJson =
    pkgJson ||
    (fs.existsSync(path.join(packageDir, 'package.json'))
      ? JSON.parse(
          fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
        )
      : undefined);
  const file = path.join(packageDir, MANIFEST_FILE);
  const inFile = fs.existsSync(file);
  const inPackageJson = pkgJson?.syncbridge != null;
  if (inFile && inPackageJson)
    throw new SbError(
      `"${pkgJson!.name}" has a manifest both in ${MANIFEST_FILE} and in the "syncbridge" field of package.json: keep one`,
    );
  let manifest: SyncBridgeManifest;
  if (inFile) {
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e: any) {
      throw new SbError(`${file} is not valid JSON: ${e.message}`);
    }
  } else if (inPackageJson) manifest = pkgJson!.syncbridge!;
  else return;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new SbError(
      `The manifest of "${pkgJson?.name || packageDir}" must be an object`,
    );
  return {
    manifest,
    source: inFile ? 'file' : 'package.json',
    unknownFields: Object.keys(manifest).filter(k => !KNOWN_FIELDS.has(k)),
  };
}

/**
 * The manifest of the package in `packageDir`, when it is an extension
 * package (see readExtensionManifest)
 */
export function manifestOf(
  packageDir: string,
  pkgJson?: ExtensionPackageJson,
): SyncBridgeManifest | undefined {
  return readExtensionManifest(packageDir, pkgJson)?.manifest;
}
