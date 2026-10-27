import 'reflect-metadata';
import type { Type } from 'ts-gems';
import { AppBase } from '../classes/app-base.js';
import { BaseElement } from '../classes/base-element.js';
import { ComponentBase } from '../classes/component-base.js';
import { SbError } from '../classes/sb-error.js';
import { CLASS_TYPE } from '../constants.js';
import {
  AppMetadata,
  ComponentMetadata,
  ElementMetadata,
  PluginMetadata,
} from '../models/index.js';
import { isSyncBridgeModule } from '../utils/registry-names.js';
import { isAppBase, isComponentBase } from '../utils/type-guards.js';
import type {
  ExtensionPackageJson,
  SyncBridgeManifest,
} from './package-manifest.js';

/**
 *
 */
export class ExtensionPackage {
  declare name: string;
  declare version: string;
  declare description: string;
  declare path: string;
  declare entryPoint: string;
  /** Registry packages this one depends on: registry name -> semver range */
  registryDependencies: Record<string, string> = {};
  /** What the package expects the host to provide */
  peerDependencies: Record<string, string> = {};
  components: ComponentExtension[] = [];
  apps: AppExtension[] = [];
  plugins: PluginExtension[] = [];
  errors: Error[] = [];
  /** What was passed over reading the package: fields of its manifest SyncBridge does not know */
  warnings: string[] = [];

  /**
   * Takes the package's identity and dependencies from its `package.json`
   * and its manifest (see readExtensionManifest).
   *
   * SyncBridge's modules (`@syncbridge/builtins`, ...) were once peers the
   * host provided; a package that still declares one so depends on it as a
   * registry package, as one built now does in its manifest.
   */
  assignManifest(pkgJson: ExtensionPackageJson, manifest?: SyncBridgeManifest) {
    this.name = manifest?.name || pkgJson.name;
    this.version = pkgJson.version;
    this.description = pkgJson.description!;
    this.registryDependencies = { ...manifest?.dependencies };
    this.peerDependencies = {};
    for (const [name, range] of Object.entries(pkgJson.peerDependencies || {}))
      if (!isSyncBridgeModule(name)) this.peerDependencies[name] = range;
      else this.registryDependencies[name] ??= range;
  }
}

/**
 *
 */
export abstract class ExtensionBase {
  abstract readonly kind: 'component' | 'app';
  protected _ctor?: Type;
  readonly pkg: ExtensionPackage;
  readonly exportName: string;
  readonly metadata: ElementMetadata;
  readonly className: string;
  /**
   * The module the class is exported from: its own, given in the manifest,
   * or else the package's entry point
   */
  declare entryPoint?: string;

  protected constructor(
    pkg: ExtensionPackage,
    exportName: string,
    metadata: ElementMetadata,
    ctor?: Type<BaseElement>,
  ) {
    this.pkg = pkg;
    this.exportName = exportName;
    this.metadata = metadata;
    this._ctor = ctor;
    this.className = metadata.className;
  }

  get uri(): string {
    return this.pkg.name + ':' + this.metadata.className;
  }

  get displayName(): string {
    return this.metadata.displayName;
  }

  get version(): string {
    return this.pkg.version;
  }
}

/**
 *
 */
export class ComponentExtension extends ExtensionBase {
  readonly kind = 'component';
  declare protected _ctor?: Type<ComponentBase>;
  declare readonly metadata: ComponentMetadata;

  constructor(
    pkg: ExtensionPackage,
    exportName: string,
    metadata: ComponentMetadata,
    ctor?: Type<ComponentBase>,
  ) {
    super(pkg, exportName, metadata, ctor);
    if (ctor && !isComponentBase(ctor.prototype))
      throw new SbError(`${ctor.name} does not extends ComponentBase`);
  }

  async getClass(): Promise<Type<ComponentBase>> {
    if (this._ctor) return this._ctor;
    const module = await import(this.entryPoint || this.pkg.entryPoint);
    const ctor = module[this.exportName];
    if (!ctor)
      throw new SbError(
        `Exported component "${this.exportName}" not found in package "${this.pkg.name}"`,
      );
    if (typeof ctor !== 'function')
      throw new SbError(
        `Exported component "${this.exportName}" is not a class`,
      );
    if (!isComponentBase(ctor.prototype))
      throw new SbError(
        `Exported component "${this.exportName}" does not extends ComponentBase`,
      );
    this._ctor = ctor as any;
    return this._ctor!;
  }
}

/**
 *
 */
export class AppExtension extends ExtensionBase {
  readonly kind = 'app';
  declare protected _ctor?: Type<AppBase>;
  declare readonly metadata: AppMetadata;

  constructor(
    pkg: ExtensionPackage,
    exportName: string,
    metadata: AppMetadata,
    ctor?: Type<AppBase>,
  ) {
    super(pkg, exportName, metadata, ctor);
    if (ctor && !isAppBase(ctor.prototype))
      throw new SbError(`${ctor.name} does not extends AppBase`);
  }

  async getClass(): Promise<Type<AppBase>> {
    if (this._ctor) return this._ctor;
    const module = await import(this.entryPoint || this.pkg.entryPoint);
    const ctor = module[this.exportName];
    if (!ctor)
      throw new SbError(
        `Exported app "${this.exportName}" not found in package "${this.pkg.name}"`,
      );
    if (typeof ctor !== 'function')
      throw new SbError(`Exported app "${this.exportName}" is not a class`);
    if (!isAppBase(ctor.prototype))
      throw new SbError(
        `Exported app "${this.exportName}" does not extends AppBase`,
      );
    this._ctor = ctor as any;
    return this._ctor!;
  }
}

/**
 * A plugin a package brings: it extends SyncBridge itself, loaded in the
 * engine's main process, never in a worker
 */
export class PluginExtension {
  readonly kind = 'plugin';
  protected _ctor?: Type;
  /** The module the class is exported from */
  declare entryPoint?: string;

  constructor(
    readonly pkg: ExtensionPackage,
    readonly exportName: string,
    readonly metadata: PluginMetadata,
    ctor?: Type,
  ) {
    this._ctor = ctor;
  }

  /** The name it is set by: `plugins.<name>` */
  get name(): string {
    return this.metadata.name;
  }

  get version(): string {
    return this.pkg.version;
  }

  async getClass(): Promise<Type> {
    if (this._ctor) return this._ctor;
    const module = await import(this.entryPoint || this.pkg.entryPoint);
    const ctor = module[this.exportName];
    if (typeof ctor !== 'function')
      throw new SbError(
        `Exported plugin "${this.exportName}" not found in package "${this.pkg.name}"`,
      );
    if (Reflect.getMetadata(CLASS_TYPE, ctor) !== 'plugin')
      throw new SbError(
        `Exported plugin "${this.exportName}" is not decorated with @Plugin`,
      );
    this._ctor = ctor;
    return ctor;
  }
}
