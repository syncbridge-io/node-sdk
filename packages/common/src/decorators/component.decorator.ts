import 'reflect-metadata';
import path from 'node:path';
import { omit } from '@jsopen/objects';
import callerCallsite from 'caller-callsite';
import type { DeepPartial, StrictOmit, Type } from 'ts-gems';
import { ComponentBase } from '../classes/component-base.js';
import { CLASS_METADATA, CLASS_TYPE } from '../constants.js';
import { ComponentMetadata } from '../models/index.js';
import { readExtensionManifest } from '../registry/package-manifest.js';
import {
  locatePackageJson,
  resolvePackageJson,
} from '../utils/locate-package-json.js';
import { MigrateProfile as _MigrateProfile } from './app-events.decorator.js';
import { defineOwnMetadata, formerNames } from './decorator-helpers.js';
import { UseComponent as _UseComponent } from './use-component.decorator.js';
import { UseVariables as _UseVariables } from './use-variables.decorator.js';

const NAME_PATTERN = /^([A-Z][A-Za-z0-9_]*?)(Component)?$/;

export function Component<T extends ComponentBase>(options: Component.Options) {
  const callerFile = callerCallsite()?.getFileName();
  const pkgDir = callerFile && locatePackageJson(path.dirname(callerFile));
  const pkgjson = pkgDir && resolvePackageJson(pkgDir);
  if (!pkgjson) throw new Error('Could not find package.json');

  return function (target: Type<T>) {
    const classType = Reflect.getMetadata(CLASS_TYPE, target);
    if (classType && classType !== 'component')
      throw new TypeError(`${target.name} already decorated as "${classType}"`);

    /** Determine class name */
    let className = options.className;
    if (!className) {
      const m = NAME_PATTERN.exec((target as unknown as Function).name);
      if (!m)
        throw new TypeError(
          'Class name must be PascalCase and should contains only letters and numbers. Example: MyApp ',
        );
      if (m) className = m[1];
    }
    /* c8 ignore next */
    if (!className) throw new TypeError('Class name is required');

    /** Determine uri */
    Reflect.defineMetadata(CLASS_TYPE, 'component', target);
    /* As in @App: a package published under another name (the npm
     * mirror's @sbext/vendor__name) keeps its registry name here */
    const packageName =
      readExtensionManifest(pkgDir, pkgjson)?.manifest.name || pkgjson.name;
    const uri = packageName + ':' + className;
    const metadata = defineOwnMetadata(target, CLASS_METADATA, {
      classType: 'component',
      uri,
      className,
      displayName: className,
      version: pkgjson.version,
      abstract: !!options.abstract,
      ...omit(options as any, [
        'uri',
        'classType',
        'className',
        'components',
        'variables',
        'version',
      ]),
    });
    const base = Object.getPrototypeOf(target);
    const baseMetadata = Reflect.getMetadata(CLASS_METADATA, base);
    if (baseMetadata) {
      metadata.interfaces = Array.from(
        new Set([...(baseMetadata?.interfaces || []), base.uri]),
      );
      /* What its base reaches, it reaches too */
      if (baseMetadata.permissions?.length)
        metadata.permissions = Array.from(
          new Set([
            ...baseMetadata.permissions,
            ...(metadata.permissions || []),
          ]),
        );
    }

    /* The names it had: its own, never its base's */
    const formerly = formerNames(options.formerly);
    if (formerly) metadata.formerly = formerly;
    else delete metadata.formerly;

    (target as any).uri = uri;
    (target as any).packageName = packageName;
    (target as any).className = className;
    (target as any).interfaces = metadata.interfaces
      ? [...metadata.interfaces]
      : [];
  };
}

export namespace Component {
  export type Options = DeepPartial<
    StrictOmit<
      ComponentMetadata,
      | 'uri'
      | 'classType'
      | 'className'
      | 'components'
      | 'variables'
      | 'version'
      | 'formerly'
    >
  > & {
    className?: string;
    /** The class name it had in earlier versions, or several */
    formerly?: string | string[];
  };

  export function UseVariables<T extends ComponentBase>(variablesClass?: Type) {
    return _UseVariables<T>(variablesClass);
  }

  export function UseComponent<T extends ComponentBase>(
    options?: _UseComponent.Options,
  ) {
    return _UseComponent<T>(options);
  }

  /**
   * A static method carrying the component's own values from its earlier
   * versions: (migration: ProfileMigration) => values
   */
  export function MigrateProfile<T extends ComponentBase>() {
    return _MigrateProfile<Type<T>>();
  }
}
