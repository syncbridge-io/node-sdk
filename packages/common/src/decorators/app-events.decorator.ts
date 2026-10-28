import 'reflect-metadata';
import type { Type } from 'ts-gems';
import type { AppBase } from '../classes/app-base.js';
import type { ComponentBase } from '../classes/component-base.js';
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

/**
 * Marks a static method that carries the class's own values, written for
 * an earlier version of it, to the version it is now: given a
 * ProfileMigration, it returns the values. SyncBridge runs it in the
 * worker's process, after what the class declares (formerly...) is
 * carried, when a worker takes a newer version (profile-migration.md)
 */
export function MigrateProfile<
  T extends Type<AppBase> | Type<ComponentBase>,
>() {
  return function (target: T, propertyKey: string | symbol) {
    defineOwnMetadata(target, CLASS_METADATA, {
      staticEvents: {
        migrateProfile: propertyKey,
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
