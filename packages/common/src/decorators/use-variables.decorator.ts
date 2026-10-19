import 'reflect-metadata';
import type { Type } from 'ts-gems';
import type { AppBase } from '../classes/app-base.js';
import type { ComponentBase } from '../classes/component-base.js';
import { CLASS_METADATA, VARIABLE_CONTAINER } from '../constants.js';
import { defineOwnMetadata } from './decorator-helpers.js';

export function UseVariables<T extends AppBase | ComponentBase>(
  variablesClass?: Type,
) {
  return function (target: T, propertyKey: 'values') {
    /** c8 ignore next */
    if (propertyKey !== 'values')
      throw new TypeError('Property key must be "values"');

    variablesClass =
      variablesClass || Reflect.getMetadata('design:type', target, propertyKey);

    if (!(typeof variablesClass === 'function')) {
      throw new TypeError('type of "variables" must be a class');
    }

    const metadata = defineOwnMetadata(target.constructor, CLASS_METADATA);
    metadata.variables =
      Reflect.getMetadata(VARIABLE_CONTAINER, variablesClass.prototype) || {};
  };
}
