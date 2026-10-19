import 'reflect-metadata';
import { deepClone, merge } from '@jsopen/objects';
import type { Type } from 'ts-gems';
import type { Validator } from 'valgen';
import { SbValidationError } from '../classes/sb-error.js';
import { StackExecutor } from '../classes/stack-executor.js';
import { VARIABLE_CONTAINER } from '../constants.js';
import {
  AppMetadata,
  ComponentMetadata,
  ElementComponentMetadataRecord,
  PluginMetadata,
  VariableMetadataRecord,
} from '../models/index.js';
import { initializeModelsDocument } from '../models-document.js';
import { resolvePromisesDeep } from './resolve-promises.js';

export async function normalizeAppMetadata(metadata: AppMetadata) {
  const { metadata: out, issues } = await normalizeAppMetadataSilent(metadata);
  if (issues?.length) {
    const msg =
      'Worker profile decoding error.\n  ' +
      issues
        .map(issue => `- ${issue.message}. Location: /${issue.location}`)
        .join('\n  ');
    issues.forEach(issue => {
      if (issue instanceof SbValidationError) delete issue.stack;
    });
    throw new SbValidationError(msg, {
      issues,
    });
  }
  return out;
}

export async function normalizeAppMetadataSilent(
  metadata: AppMetadata,
): Promise<{
  metadata: AppMetadata;
  issues?: StackExecutor.Issue[];
}> {
  const decoder = await getProcMetadataTypeDecoder();
  let cloned: AppMetadata = deepClone({
    classType: 'app',
    className: metadata.className,
    displayName: metadata.displayName,
    description: metadata.description,
    iconUrl: metadata.iconUrl,
    tags: metadata.tags,
    abstract: metadata.abstract,
    variables: metadata.variables,
    components: metadata.components,
    ...(metadata as any),
  });
  cloned = await resolvePromisesDeep(cloned);
  cloned.variables = normalizeVariables(cloned.variables);
  cloned.components = normalizeComponents(cloned.components);
  const { value, errors } = decoder.silent(cloned);
  if (value) merge(value, metadata, { keepExisting: true, deep: 'full' });
  return {
    metadata: value || cloned,
    issues: errors?.map(x => ({
      message: x.message,
      severity: 'error',
      location: x.location,
      code: 'validation-error:' + x.rule,
    })),
  };
}

export async function normalizeComponentMetadata(metadata: ComponentMetadata) {
  const { metadata: out, issues } =
    await normalizeComponentMetadataSilent(metadata);
  if (issues?.length) {
    const msg =
      'Worker profile decoding error.\n  ' +
      issues
        .map(issue => `- ${issue.message}. Location: /${issue.location}`)
        .join('\n  ');
    issues.forEach(issue => {
      if (issue instanceof SbValidationError) delete issue.stack;
    });
    throw new SbValidationError(msg, {
      issues,
    });
  }
  return out;
}

export async function normalizeComponentMetadataSilent(
  metadata: ComponentMetadata,
): Promise<{
  metadata: ComponentMetadata;
  issues?: StackExecutor.Issue[];
}> {
  const decoder = await getCompMetadataTypeDecoder();
  let cloned: ComponentMetadata = deepClone({
    classType: 'component',
    className: metadata.className,
    displayName: metadata.displayName,
    description: metadata.description,
    iconUrl: metadata.iconUrl,
    interfaces: metadata.interfaces,
    tags: metadata.tags,
    abstract: metadata.abstract,
    variables: metadata.variables,
    components: metadata.components,
    ...(metadata as any),
  });
  cloned = await resolvePromisesDeep(cloned);
  cloned.variables = normalizeVariables(cloned.variables);
  cloned.components = normalizeComponents(cloned.components);
  const { value, errors } = decoder.silent(cloned);
  if (value) merge(value, metadata, { keepExisting: true, deep: 'full' });
  return {
    metadata: value || cloned,
    issues: errors?.map(x => ({
      message: x.message,
      severity: 'error',
      location: x.location,
      code: 'validation-error:' + x.rule,
    })),
  };
}

/**
 * A plugin's definition checked and given its defaults; throws an
 * SbValidationError listing what is wrong
 */
export async function normalizePluginMetadata(
  metadata: PluginMetadata,
): Promise<PluginMetadata> {
  if (!_pluginMetadataTypeDecoder) {
    const apiDoc = await initializeModelsDocument();
    _pluginMetadataTypeDecoder = apiDoc.node
      .getComplexType(PluginMetadata)
      .generateCodec('decode', { coerce: true });
  }
  const cloned: PluginMetadata = await resolvePromisesDeep(
    deepClone({ ...metadata, classType: 'plugin' }),
  );
  cloned.settings = normalizeVariables(cloned.settings);
  const { value, errors } = _pluginMetadataTypeDecoder.silent(cloned);
  if (!errors?.length) return value;
  throw new SbValidationError(
    'Invalid plugin definition.\n  ' +
      errors.map(e => `- ${e.message}. Location: /${e.location}`).join('\n  '),
    {
      issues: errors.map(e => ({
        message: e.message,
        severity: 'error',
        location: e.location,
        code: 'validation-error:' + e.rule,
      })),
    },
  );
}

function normalizeComponents(
  components?: ElementComponentMetadataRecord,
): ElementComponentMetadataRecord | undefined {
  if (!components) return;
  for (const component of Object.values(components)) {
    if (component.variables)
      component.variables = normalizeVariables(component.variables);
    if (component.components)
      component.components = normalizeComponents(component.components);
  }
  return components;
}

/**
 * The variables a class defines with @DefineVariable, as they are now: read
 * them when the class is defined, as metadata read later may be gone if
 * another copy of reflect-metadata took over the global Reflect since.
 * Undefined when the class defines none.
 */
export function readVariables(
  variablesClass: Type,
): VariableMetadataRecord | undefined {
  const variables = Reflect.getMetadata(
    VARIABLE_CONTAINER,
    variablesClass.prototype,
  );
  return variables ? deepClone(variables) : undefined;
}

/**
 * Variables as the metadata of an element holds them: what they are given
 * as promises resolved, enum values as arrays
 */
export async function normalizeVariablesMetadata(
  variables: VariableMetadataRecord,
): Promise<VariableMetadataRecord> {
  return normalizeVariables(await resolvePromisesDeep(deepClone(variables)))!;
}

function normalizeVariables(
  variables?: VariableMetadataRecord,
): VariableMetadataRecord | undefined {
  if (!variables) return;
  /** Convert object enumValues to arrays */
  for (const v of Object.values(variables)) {
    if (
      v.enumValues &&
      typeof v.enumValues === 'object' &&
      !Array.isArray(v.enumValues)
    ) {
      let values: any = v.enumValues;
      const keys = Object.keys(values).filter(k => !/^\d+$/.test(k));
      values = keys.reduce((a, k) => {
        if (values[k] != null) a.push(values[k]);
        return a;
      }, [] as any[]);
      v.enumValues = values;
    }
  }
  return variables;
}

// ************************************************************************
// ************************************************************************
let _compMetadataTypeDecoder: Validator | undefined;
let _procMetadataTypeDecoder: Validator | undefined;
let _pluginMetadataTypeDecoder: Validator | undefined;

async function getCompMetadataTypeDecoder() {
  if (!_compMetadataTypeDecoder) {
    const apiDoc = await initializeModelsDocument();
    const compMetadataType = apiDoc.node.getComplexType(ComponentMetadata);
    _compMetadataTypeDecoder = compMetadataType.generateCodec('decode', {
      coerce: true,
    });
  }
  return _compMetadataTypeDecoder;
}

async function getProcMetadataTypeDecoder() {
  if (!_procMetadataTypeDecoder) {
    const apiDoc = await initializeModelsDocument();
    const procMetadataType = apiDoc.node.getComplexType(AppMetadata);
    _procMetadataTypeDecoder = procMetadataType.generateCodec('decode', {
      coerce: true,
    });
  }
  return _procMetadataTypeDecoder;
}
