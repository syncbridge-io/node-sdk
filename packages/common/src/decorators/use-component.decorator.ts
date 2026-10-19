import 'reflect-metadata';
import { omit } from '@jsopen/objects';
import type { StrictOmit } from 'ts-gems';
import { AppBase } from '../classes/app-base.js';
import { ComponentBase } from '../classes/component-base.js';
import { CLASS_METADATA } from '../constants.js';
import { ElementComponentMetadata } from '../models/index.js';
import { defineOwnMetadata } from './decorator-helpers.js';

export function UseComponent<T extends AppBase | ComponentBase>(
  options: UseComponent.Options = {},
) {
  return function (target: T, propertyKey: string | symbol) {
    /** c8 ignore next */
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');

    let uri = options.uri;

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
    metadata.components[propertyKey] = {
      interfaceUri: uri,
      ...omit(options as any, ['classUri', 'interfaceUri']),
      propertyKey,
    };
  };
}

export namespace UseComponent {
  export interface Options extends Partial<
    StrictOmit<ElementComponentMetadata, 'classUri' | 'interfaceUri'>
  > {
    uri?: string;
  }
}
