import 'reflect-metadata';
import type { Type } from 'ts-gems';
import type { AppBase } from '../classes/app-base.js';
import { CLASS_METADATA } from '../constants.js';
import { defineOwnMetadata } from './decorator-helpers.js';

export function OnCreateProfile<T extends Type<AppBase>>() {
  return function (target: T, propertyKey: string | symbol) {
    defineOwnMetadata(target, CLASS_METADATA, {
      staticEvents: {
        onCreateProfile: propertyKey,
      },
    });
  };
}

export function OnUpdateProfile<T extends Type<AppBase>>() {
  return function (target: T, propertyKey: string | symbol) {
    defineOwnMetadata(target, CLASS_METADATA, {
      staticEvents: {
        onUpdateProfile: propertyKey,
      },
    });
  };
}
