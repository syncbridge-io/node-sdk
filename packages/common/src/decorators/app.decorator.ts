import 'reflect-metadata';
import path from 'node:path';
import { omit } from '@jsopen/objects';
import callerCallsite from 'caller-callsite';
import type { DeepPartial, StrictOmit, Type } from 'ts-gems';
import type { AppBase } from '../classes/app-base.js';
import { CLASS_METADATA, CLASS_TYPE } from '../constants.js';
import { AppMetadata } from '../models/index.js';
import { readExtensionManifest } from '../registry/package-manifest.js';
import {
  locatePackageJson,
  resolvePackageJson,
} from '../utils/locate-package-json.js';
import {
  OnCreateProfile as _OnCreateProfile,
  OnUpdateProfile as _OnUpdateProfile,
} from './app-events.decorator.js';
import { defineOwnMetadata } from './decorator-helpers.js';
import { UseComponent as _UseComponent } from './use-component.decorator.js';
import { UseVariables as _UseVariables } from './use-variables.decorator.js';

const NAME_PATTERN = /^([A-Z][A-Za-z0-9_]*)(App)?$/;

export function App<T extends AppBase>(options?: App.Options) {
  const callerFile = callerCallsite()?.getFileName();
  const pkgDir = callerFile && locatePackageJson(path.dirname(callerFile));
  const pkgjson = pkgDir && resolvePackageJson(pkgDir);
  if (!pkgjson) throw new Error('Could not find package.json');

  return function (target: Type<T>) {
    const classType = Reflect.getMetadata(CLASS_TYPE, target);
    if (classType && classType !== 'app')
      throw new TypeError(`${target.name} already decorated as "${classType}"`);

    /** Determine class name */
    let className = options?.className;
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
    Reflect.defineMetadata(CLASS_TYPE, 'app', target);
    const packageName =
      readExtensionManifest(pkgDir, pkgjson)?.manifest.name || pkgjson.name;
    const uri = packageName + ':' + className;
    const metadata = defineOwnMetadata(target, CLASS_METADATA, {
      classType: 'app',
      uri,
      className,
      displayName: className,
      version: pkgjson.version,
      abstract: !!options?.abstract,
      ...omit(options as any, [
        'uri',
        'classType',
        'className',
        'components',
        'variables',
        'version',
      ]),
    });
    /* What its base reaches, it reaches too */
    const baseMetadata = Reflect.getMetadata(
      CLASS_METADATA,
      Object.getPrototypeOf(target),
    );
    if (baseMetadata?.permissions?.length)
      metadata.permissions = Array.from(
        new Set([...baseMetadata.permissions, ...(metadata.permissions || [])]),
      );
    (target as any).uri = uri;
    (target as any).packageName = packageName;
    (target as any).className = className;
  };
}

export namespace App {
  /**
   *
   */
  export function UseVariables<T extends AppBase>(variablesClass?: Type) {
    return _UseVariables<T>(variablesClass);
  }

  /**
   *
   */
  export function UseComponent<T extends AppBase>(
    options?: _UseComponent.Options,
  ) {
    return _UseComponent<T>(options);
  }

  /**
   *
   */
  export function OnCreateProfile<T extends AppBase>() {
    return _OnCreateProfile<Type<T>>();
  }

  /**
   *
   */
  export function OnUpdateProfile<T extends AppBase>() {
    return _OnUpdateProfile<Type<T>>();
  }
}

export namespace App {
  export type Options = DeepPartial<
    StrictOmit<
      AppMetadata,
      'uri' | 'classType' | 'className' | 'components' | 'variables' | 'version'
    >
  > & {
    className?: string;
  };
}
