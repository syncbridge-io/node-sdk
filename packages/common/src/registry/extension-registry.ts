import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateErrorMessage } from '@jsopen/objects';
import { ResponsiveMap } from '@opra/common';
import { AsyncEventEmitter } from 'node-events-async';
import semver from 'semver';
import type { Type } from 'ts-gems';
import { AppBase } from '../classes/app-base.js';
import { ComponentBase } from '../classes/component-base.js';
import { SbError } from '../classes/sb-error.js';
import { CLASS_METADATA, CLASS_TYPE } from '../constants.js';
import { locatePackageJson } from '../utils/locate-package-json.js';
import {
  normalizeAppMetadata,
  normalizeComponentMetadata,
  normalizePluginMetadata,
} from '../utils/normalize-metadata.js';
import { uriToId } from '../utils/uri-to-id.js';
import {
  AppExtension,
  ComponentExtension,
  ExtensionPackage,
  PluginExtension,
} from './extension-package.js';
import { readExtensionManifest } from './package-manifest.js';

const instanceSymbol = Symbol.for('instance');

/**
 * The `ExtensionRegistry` class is responsible for managing component and app extensions,
 * as well as handling the registration of extension packages. It provides methods to locate and
 * retrieve extensions by their class name and version, and offers the ability to dynamically register
 * packages, components, and apps at runtime.
 *
 * @class ExtensionRegistry
 */
export class ExtensionRegistry extends AsyncEventEmitter {
  protected static [instanceSymbol]: ExtensionRegistry =
    new ExtensionRegistry();

  /** The registry of the process, current while no other is in use */
  protected static readonly _default: ExtensionRegistry =
    ExtensionRegistry[instanceSymbol];

  /** Registries made current with `use`, the last one in effect */
  protected static readonly _inUse: { registry: ExtensionRegistry }[] = [];

  /**
   * The registry the static methods act on, and so AppFactory and
   * the metadata helpers: the process's own, unless another is in use.
   */
  static get current(): ExtensionRegistry {
    return this[instanceSymbol];
  }

  /**
   * Makes `registry` the current one, for code that needs a registry of its
   * own - a test environment registering the package under test apart from
   * everything else. Returns the function that ends it: the registry made
   * current before comes back, even when uses end in another order than
   * they began.
   */
  static use(registry: ExtensionRegistry): () => void {
    const entry = { registry };
    ExtensionRegistry._inUse.push(entry);
    ExtensionRegistry[instanceSymbol] = registry;
    return () => {
      const i = ExtensionRegistry._inUse.indexOf(entry);
      if (i < 0) return;
      ExtensionRegistry._inUse.splice(i, 1);
      ExtensionRegistry[instanceSymbol] =
        ExtensionRegistry._inUse.at(-1)?.registry ?? ExtensionRegistry._default;
    };
  }

  static get packages(): ResponsiveMap<ExtensionPackage[]> {
    return this[instanceSymbol].packages;
  }

  static get components(): ResponsiveMap<ComponentExtension[]> {
    return this[instanceSymbol].components;
  }

  static get componentsByClassName(): ResponsiveMap<ComponentExtension[]> {
    return this[instanceSymbol].componentsByClassName;
  }

  static get apps(): ResponsiveMap<AppExtension[]> {
    return this[instanceSymbol].apps;
  }

  static get appsByClassName(): ResponsiveMap<AppExtension[]> {
    return this[instanceSymbol].appsByClassName;
  }

  static setResolver(fn: ExtensionRegistry.PackageResolver | undefined) {
    this[instanceSymbol].setResolver(fn);
  }

  static findComponent(
    uri: string,
    version: string = '*',
  ): ComponentExtension | undefined {
    return this[instanceSymbol].findComponent(uri, version);
  }

  static getComponent(uri: string, version: string = '*'): ComponentExtension {
    return this[instanceSymbol].getComponent(uri, version);
  }

  static findApp(uri: string, version: string = '*'): AppExtension | undefined {
    return this[instanceSymbol].findApp(uri, version);
  }

  static getApp(uri: string, version: string = '*'): AppExtension {
    return this[instanceSymbol].getApp(uri, version);
  }

  static async registerPackage(specifier: string) {
    return this[instanceSymbol].registerPackage(specifier);
  }

  static async registerClass<T extends ComponentBase>(
    ctor: Type<T>,
  ): Promise<ComponentExtension>;
  static async registerClass<T extends AppBase>(
    ctor: Type<T>,
  ): Promise<AppExtension>;
  static async registerClass(
    ctor: Type,
  ): Promise<ComponentExtension | AppExtension> {
    return this[instanceSymbol].registerClass(ctor);
  }

  static storePackage(pkg: ExtensionPackage) {
    return this[instanceSymbol].storePackage(pkg);
  }

  static onRegisterPackage(fn: (pkg: ExtensionPackage) => void) {
    this[instanceSymbol].on('register-package', fn);
  }

  static onRegisterComponent(fn: (pkg: ComponentExtension) => void) {
    this[instanceSymbol].on('register-component', fn);
  }

  static onRegisterApp(fn: (pkg: AppExtension) => void) {
    this[instanceSymbol].on('register-app', fn);
  }

  constructor() {
    super();
    this.setMaxListeners(1000);
  }

  protected _resolver: ExtensionRegistry.PackageResolver = import.meta.resolve;
  readonly packages = new ResponsiveMap<ExtensionPackage[]>();
  readonly components = new ResponsiveMap<ComponentExtension[]>();
  readonly componentsByClassName = new ResponsiveMap<ComponentExtension[]>();
  readonly apps = new ResponsiveMap<AppExtension[]>();
  readonly appsByClassName = new ResponsiveMap<AppExtension[]>();

  /**
   *
   */
  setResolver(fn: ExtensionRegistry.PackageResolver | undefined) {
    this._resolver = fn || import.meta.resolve;
  }

  /**
   *
   */
  findComponent(
    uri: string,
    version: string = '*',
  ): ComponentExtension | undefined {
    return this.components
      .get(uriToId(uri))
      ?.find(v => semver.satisfies(v.version, version || '*'));
  }

  /**
   *
   */
  getComponent(uri: string, version: string = '*'): ComponentExtension {
    const cmp = this.findComponent(uri, version);
    if (!cmp) {
      throw new SbError(
        `Component "${uri}${version ? `:${version}` : ''}" not found in registry`,
      );
    }
    return cmp;
  }

  /**
   *
   */
  findApp(uri: string, version: string = '*'): AppExtension | undefined {
    return this.apps
      .get(uriToId(uri))
      ?.find(v => semver.satisfies(v.version, version || '*'));
  }

  /**
   *
   */
  getApp(uri: string, version: string = '*'): AppExtension {
    const cmp = this.findApp(uri, version);
    if (!cmp) {
      throw new SbError(
        `App "${uri}${version ? `:${version}` : ''}" not found in registry`,
      );
    }
    return cmp;
  }

  /**
   *
   */
  async registerPackage(specifier: string) {
    let entryPoint = this._resolver(specifier);
    const pkgDir = locatePackageJson(path.dirname(entryPoint));
    if (!pkgDir) {
      throw new SbError(`Can't locate package.json file for "${specifier}"`);
    }
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    );

    if (path.isAbsolute(entryPoint) && process.platform === 'win32') {
      entryPoint = pathToFileURL(entryPoint).href;
    }

    const read = readExtensionManifest(pkgDir, pkgJson);
    const pkg = new ExtensionPackage();
    pkg.assignManifest(pkgJson, read?.manifest);
    for (const field of read?.unknownFields || [])
      pkg.warnings.push(
        `The manifest of "${pkg.name}": "${field}" is not known, passed over`,
      );
    pkg.path = pkgDir;
    pkg.entryPoint = entryPoint;

    const module = await import(entryPoint);

    for (const [ctorName, v] of Object.entries(module)) {
      if (typeof v !== 'function') continue;
      const classType = Reflect.getMetadata(CLASS_TYPE, v);
      let metadata = Reflect.getMetadata(CLASS_METADATA, v);
      if (!metadata) continue;
      if (classType === 'component') {
        try {
          metadata = await normalizeComponentMetadata(metadata);
        } catch (e: any) {
          updateErrorMessage(
            e,
            `Component (${ctorName}) metadata validation error. ` + e.message,
          );
          pkg.errors.push(e);
          continue;
        }
        if (metadata.abstract) continue;
        pkg.components = pkg.components || [];
        pkg.components.push(new ComponentExtension(pkg, ctorName, metadata));
      } else if (classType === 'app') {
        try {
          metadata = await normalizeAppMetadata(metadata);
        } catch (e: any) {
          updateErrorMessage(
            e,
            `App (${ctorName}) metadata validation error. ` + e.message,
          );
          pkg.errors.push(e);
          continue;
        }
        if (metadata.abstract) continue;
        pkg.apps = pkg.apps || [];
        pkg.apps.push(new AppExtension(pkg, ctorName, metadata));
      } else if (classType === 'plugin') {
        try {
          metadata = await normalizePluginMetadata(metadata);
        } catch (e: any) {
          updateErrorMessage(
            e,
            `Plugin (${ctorName}) metadata validation error. ` + e.message,
          );
          pkg.errors.push(e);
          continue;
        }
        pkg.plugins.push(new PluginExtension(pkg, ctorName, metadata));
      }
    }
    this.storePackage(pkg);
    return pkg;
  }

  async registerClass<T extends ComponentBase>(
    ctor: Type<T>,
  ): Promise<ComponentExtension>;
  async registerClass<T extends AppBase>(ctor: Type<T>): Promise<AppExtension>;
  async registerClass(ctor: Type): Promise<ComponentExtension | AppExtension> {
    let metadata = Reflect.getMetadata(CLASS_METADATA, ctor);
    if (!metadata)
      throw new TypeError(`Class "${ctor.name}" has no component metadata.`);
    if (metadata.abstract)
      throw new TypeError('Can not register an abstract class');

    const classType = Reflect.getMetadata(CLASS_TYPE, ctor);
    if (classType === 'component') {
      metadata = await normalizeComponentMetadata(metadata);
    } else if (classType === 'app') {
      metadata = await normalizeAppMetadata(metadata);
    } else
      /* c8 ignore next */
      throw new TypeError(`Invalid CLASS_TYPE metadata in "${ctor.name}".`);

    const [packageName, className] = metadata.uri.split(':');
    /* c8 ignore next */
    if (!(packageName && className))
      throw new TypeError(`Invalid metadata.uri value in ${ctor.name}"`);
    const version = metadata.version || '0.0.0';

    let versions = this.packages.get(packageName);
    if (!versions) {
      versions = [];
      this.packages.set(packageName, versions);
    }
    let pkg = versions[0];
    if (!pkg) {
      pkg = new ExtensionPackage();
      pkg.name = packageName;
      pkg.version = version;
    }
    let out: ComponentExtension | AppExtension;
    if (classType === 'component') {
      out = new ComponentExtension(pkg, ctor.name, metadata, ctor);
      pkg.components.push(out);
    } else {
      out = new AppExtension(pkg, ctor.name, metadata, ctor);
      pkg.apps.push(out);
    }
    this.storePackage(pkg);
    return out;
  }

  /**
   *
   */
  storePackage(pkg: ExtensionPackage) {
    let pkgVersions = this.packages.get(pkg.name);
    if (!pkgVersions) {
      pkgVersions = [];
      this.packages.set(pkg.name, pkgVersions);
    }
    let i = pkgVersions.findIndex(v => v.version === pkg.version);
    if (i >= 0) pkgVersions[i] = pkg;
    else pkgVersions.push(pkg);
    pkgVersions.sort((a, b) => semver.compare(b.version, a.version));

    if (pkg.components?.length) {
      for (const cmp of pkg.components) {
        if (this.findApp(cmp.uri, '*'))
          throw new SbError(
            `Component "${cmp.uri}" is already registered as an app.`,
          );
        /** Store to components */
        const id = uriToId(cmp.uri);
        let items = this.components.get(id);
        if (!items) {
          items = [];
          this.components.set(id, items);
        }
        i = items.findIndex(v => v.version === cmp.version);
        if (i >= 0) items[i] = cmp;
        else items.push(cmp);
        /** Store to componentsByClassName */
        items = this.componentsByClassName.get(cmp.className);
        if (!items) {
          items = [];
          this.componentsByClassName.set(cmp.className, items);
        }
        i = items.findIndex(v => v.version === cmp.version);
        if (i >= 0) items[i] = cmp;
        else items.push(cmp);
        this.emitSafe('register-component', cmp);
      }
    }
    if (pkg.apps?.length) {
      for (const prc of pkg.apps) {
        if (this.findComponent(prc.uri, '*'))
          throw new SbError(
            `App "${prc.uri}" is already registered as a component.`,
          );
        /** Store to apps */
        const id = uriToId(prc.uri);
        let items = this.apps.get(id);
        if (!items) {
          items = [];
          this.apps.set(id, items);
        }
        i = items.findIndex(v => v.version === prc.version);
        if (i >= 0) items[i] = prc;
        else {
          items.push(prc);
          items.sort((a, b) => semver.compare(b.version, a.version));
        }
        /** Store to componentsByClassName */
        items = this.apps.get(prc.className);
        if (!items) {
          items = [];
          this.appsByClassName.set(prc.className, items);
        }
        i = items.findIndex(v => v.version === prc.version);
        if (i >= 0) items[i] = prc;
        else {
          items.push(prc);
          items.sort((a, b) => semver.compare(b.version, a.version));
        }
        this.emitSafe('register-app', prc);
      }
    }
    this.emitSafe('register-package', pkg);
  }
}

/**
 *
 * @namespace ExtensionRegistry
 */
export namespace ExtensionRegistry {
  export type PackageResolver = (specifier: string) => string;
}
