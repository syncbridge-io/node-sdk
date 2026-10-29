import 'reflect-metadata';
import { omit } from '@jsopen/objects';
import type { StrictOmit } from 'ts-gems';
import { AppBase } from '../classes/app-base.js';
import { ComponentBase } from '../classes/component-base.js';
import { CLASS_METADATA } from '../constants.js';
import { ElementComponentMetadata } from '../models/index.js';
import { defineOwnMetadata, formerNames } from './decorator-helpers.js';

export function UseComponent<T extends AppBase | ComponentBase>(
  options: UseComponent.Options = {},
) {
  return function (target: T, propertyKey: string | symbol) {
    /** c8 ignore next */
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');

    /* One of several: each a class, or its uri */
    const oneOf = options.oneOf?.map(c => {
      const u = typeof c === 'string' ? c : c?.uri;
      if (!u)
        throw new TypeError(
          `${String(propertyKey)}: oneOf takes components - classes with @Component, or their uris`,
        );
      return u;
    });
    let uri = options.uri ?? oneOf?.[0];

    if (!uri) {
      const designType = Reflect.getMetadata(
        'design:type',
        target,
        propertyKey,
      );
      if (typeof designType === 'function' && designType.uri) {
        uri = designType.uri;
      }
    }

    const metadata = defineOwnMetadata(target.constructor, CLASS_METADATA);
    metadata.components = metadata.components || {};
    const formerly = formerNames(options.formerly);
    /* Redeclared, its description not told: the base's kept - the texts
     * its locales give it with it */
    const { description } = metadata.components[propertyKey] ?? {};
    metadata.components[propertyKey] = {
      ...(description !== undefined ? { description } : {}),
      interfaceUri: uri,
      ...omit(options as any, [
        'classUri',
        'interfaceUri',
        'oneOf',
        'formerly',
      ]),
      ...(oneOf?.length ? { oneOf } : {}),
      ...(formerly ? { formerly } : {}),
      propertyKey,
    };
  };
}

export namespace UseComponent {
  export interface Options extends Partial<
    StrictOmit<
      ElementComponentMetadata,
      'classUri' | 'interfaceUri' | 'oneOf' | 'formerly'
    >
  > {
    uri?: string;
    /** The slot's name in earlier versions, or several */
    formerly?: string | string[];
    /**
     * A slot taking a class of one of these, not of one interface alone:
     * `oneOf: [HL7Client, HL7Server]` - its property typed as either
     */
    oneOf?: (string | { uri: string })[];
  }
}
