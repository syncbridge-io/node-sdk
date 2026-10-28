import 'reflect-metadata';
import { deepClone, merge, omitUndefined } from '@jsopen/objects';
import type { DeepPartial, StrictOmit, Type } from 'ts-gems';
import { VARIABLE_CONTAINER } from '../constants.js';
import {
  VariableMetadata,
  VariableMetadataRecord,
  VariableType,
} from '../models/index.js';
import { formerNames } from './decorator-helpers.js';

export function DefineVariable(options: DefineVariable.Options = {}) {
  return function (target: Object, propertyKey: string | symbol) {
    /** c8 ignore next */
    if (typeof propertyKey !== 'string')
      throw new TypeError('Property key must be a string');

    const designType = Reflect.getMetadata('design:type', target, propertyKey);
    if (designType === Array) options.isArray = true;

    const base = Object.getPrototypeOf(target);
    const baseMetadata: any = Reflect.hasMetadata(VARIABLE_CONTAINER, base)
      ? deepClone(Reflect.getMetadata(VARIABLE_CONTAINER, base))
      : {};

    let metadata: DefineVariable.Options = merge(
      options,
      baseMetadata[propertyKey] || {},
      {
        deep: 'full',
        ignoreNulls: false,
        ignoreUndefined: false,
        keepExisting: true,
      },
    );

    if (typeof options.variables === 'function') {
      metadata.type = VariableType.Nested;
      metadata.variables = Reflect.getMetadata(
        VARIABLE_CONTAINER,
        options.variables.prototype,
      );
    }
    if ((metadata.enumValues || metadata.enumSource) && !metadata.type) {
      metadata.type = VariableType.Enum;
    }
    if (metadata.type !== VariableType.Enum) {
      delete metadata.enumValues;
      delete metadata.enumSource;
      delete metadata.enumStrict;
    }
    /* A server's list: what was seen when it was read, a suggestion */
    if (metadata.enumSource && metadata.enumStrict === undefined)
      metadata.enumStrict = false;

    if (!metadata.type) {
      if (designType === String) metadata.type = VariableType.String;
      else if (designType === Boolean) metadata.type = VariableType.Boolean;
      else if (designType === Number) metadata.type = VariableType.Number;
      else if (designType === BigInt) metadata.type = VariableType.BigInt;
      else if (
        typeof designType === 'function' &&
        Reflect.hasMetadata(VARIABLE_CONTAINER, designType.prototype)
      ) {
        metadata.type = VariableType.Nested;
        metadata.variables = Reflect.getMetadata(
          VARIABLE_CONTAINER,
          designType.prototype,
        );
      }
    }
    if (metadata.formerly !== undefined)
      metadata.formerly = formerNames(metadata.formerly);
    if (metadata.type !== VariableType.Enum) delete metadata.formerlyValues;
    if (metadata.isArray && !metadata.type)
      throw new TypeError(
        'Array variables must have type defined. ' +
          (target.constructor.name +
            '.' +
            propertyKey +
            ' is an array variable'),
      );
    metadata = omitUndefined(metadata, 'full');

    const metadataRecord: DefineVariable.Options = Reflect.hasOwnMetadata(
      VARIABLE_CONTAINER,
      target,
    )
      ? Reflect.getMetadata(VARIABLE_CONTAINER, target)
      : {};
    merge(metadataRecord, baseMetadata);
    metadataRecord[propertyKey] = metadata;
    Reflect.defineMetadata(VARIABLE_CONTAINER, metadataRecord, target);
  };
}

type TEnumValue = (string | number)[] | Record<string, string | number>;
type TVariable = DeepPartial<VariableMetadataRecord> | Type;

export namespace DefineVariable {
  export interface Options extends Partial<
    StrictOmit<
      VariableMetadata,
      'variables' | 'enumValues' | 'choice' | 'formerly'
    >
  > {
    /**
     * Its name in earlier versions of the module, or several: a profile
     * written with one has its value moved here
     */
    formerly?: string | string[];
    variables?: TVariable | Promise<TVariable>;
    /**
     * Values known when the module is written. Ones that depend on the
     * server - its serial ports, its addresses - are an `enumSource`: a
     * module computes nothing at its import
     */
    enumValues?: TEnumValue;
    choice?: string[] | Promise<string[]>;
    index?: number;
  }
}
