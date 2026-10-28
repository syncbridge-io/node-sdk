import {
  isAny,
  isBase64,
  isBigint,
  isBoolean,
  isDateString,
  isEmail,
  isHex,
  isNumber,
  isString,
  isTime,
  isURL,
  type Validator,
  validator,
  vg,
} from 'valgen';
import { SbValidationError } from '../classes/sb-error.js';
import { StackExecutor } from '../classes/stack-executor.js';
import {
  AppMetadata,
  ElementComponentMetadata,
  Profile,
  ProfileComponent,
  VariableMetadataRecord,
  VariableType,
} from '../models/index.js';
import { getModelsDocument } from '../models-document.js';
import { secretDecryptor, secretEncryptor } from './encrypt-helpers.js';
import { materializeMetadataSilent } from './materialize-metadata.js';
import { hasValueRef } from './value-refs.js';

export interface CodecOptions {
  setDefaultValues?: boolean;
  cryptoSecretKey?: string;
  /**
   * The profile's references not resolved yet (`${{ vars.NAME }}`, see
   * value-refs): a value holding one is kept as written, unchecked, of
   * whatever type its variable is - checked once resolved. A profile
   * edited or stored; never one a worker runs with.
   */
  unresolved?: boolean;
}

/**
 * Decodes profile
 */
export function decodeProfile(
  profile: Profile,
  options?: CodecOptions,
): Profile {
  const r1 = decodeProfileSilent(profile, options);
  if (!r1.result) {
    const msg =
      'Worker profile decoding error.\n  ' +
      r1.issues
        .map(issue => `- ${issue.message}. Location: /${issue.location}`)
        .join('\n  ');
    r1.issues.forEach(issue => {
      if (issue instanceof SbValidationError) delete issue.stack;
    });
    throw new SbValidationError(msg, {
      workerId: profile.id,
      issues: r1.issues,
    });
  }
  return r1.profile;
}

export function decodeProfileSilent(
  profile: Profile,
  options?: CodecOptions,
):
  | {
      result: true;
      profile: Profile;
      metadata: AppMetadata;
      issues?: StackExecutor.Issue[];
    }
  | {
      result: false;
      issues: StackExecutor.Issue[];
    } {
  const modelsDocument = getModelsDocument();
  const r1 = materializeMetadataSilent(profile);
  if (!r1.result) {
    return { result: false, issues: r1.issues };
  }
  const t = modelsDocument.node.getComplexType(Profile);
  const fn = t.generateCodec('decode');
  const out = fn(profile) as Profile;
  const stackExecutor = new StackExecutor();
  _codecProcessElement(stackExecutor, 'decode', r1.metadata, out, options);
  if (
    stackExecutor.issues.find(
      i => !(i.severity === 'warning' || i.severity === 'info'),
    )
  ) {
    return { result: false, issues: stackExecutor.issues };
  }
  return {
    result: true,
    profile: out,
    metadata: r1.metadata,
    issues: stackExecutor.issues,
  };
}

/**
 * Encodes profile
 */
export function encodeProfile(
  rawProfile: Profile,
  options?: CodecOptions,
): Profile {
  const r1 = encodeProfileSilent(rawProfile, options);
  if (!r1.result) {
    const msg =
      'Worker profile encoding error.\n  ' +
      r1.issues
        .map(issue => `- ${issue.message}. Location: /${issue.location}`)
        .join('\n  ');
    r1.issues.forEach(issue => {
      if (issue instanceof SbValidationError) delete issue.stack;
    });
    throw new SbValidationError(msg, {
      workerId: rawProfile.id,
      issues: r1.issues,
    });
  }
  return r1.profile;
}

/**
 * Encodes profile
 */
export function encodeProfileSilent(
  profile: Profile,
  options?: CodecOptions,
):
  | {
      result: true;
      profile: Profile;
      issues?: StackExecutor.Issue[];
    }
  | {
      result: false;
      issues: StackExecutor.Issue[];
    } {
  const modelsDocument = getModelsDocument();
  const r1 = materializeMetadataSilent(profile);
  if (!r1.result) {
    return { result: false, issues: r1.issues };
  }
  const t = modelsDocument.node.getComplexType(Profile);
  const fn = t.generateCodec('encode', { coerce: true });
  const out = fn({
    id: profile.id,
    appUri: profile.appUri,
    displayName: profile.displayName,
    group: profile.group,
    description: profile.description,
    iconUrl: profile.iconUrl,
    settings: {
      autostart: profile.settings?.autostart ?? false,
      logs: profile.settings?.logs ?? {},
      ...profile.settings,
    },
    values: profile.values,
    ...(profile as any),
  }) as Profile;
  const stackExecutor = new StackExecutor();
  _codecProcessElement(stackExecutor, 'encode', r1.metadata, out, options);
  if (
    stackExecutor.issues.find(
      i => !(i.severity === 'warning' || i.severity === 'info'),
    )
  ) {
    return { result: false, issues: stackExecutor.issues };
  }
  return { result: true, profile: out, issues: stackExecutor.issues };
}

/**
 *
 * @private
 */
function _codecProcessElement<T extends Profile | ProfileComponent>(
  stackExecutor: StackExecutor,
  codec: 'decode' | 'encode',
  metadata: AppMetadata | ElementComponentMetadata,
  profile: T,
  options?: CodecOptions,
): void {
  if (codec === 'decode') _checkLogChannels(stackExecutor, metadata, profile);
  profile.values = profile.values || {};
  if (metadata.variables) {
    stackExecutor.execute('values', () => {
      _decodeVariables(stackExecutor, codec, metadata, profile, options);
    });
  } else delete profile.values;

  if (metadata.components) {
    stackExecutor.execute('components', () => {
      profile.components = profile.components || {};
      for (const [k, defComponent] of Object.entries(metadata.components!)) {
        if (!profile.components![k]) {
          if (defComponent.required) {
            stackExecutor.issues.push(
              new SbValidationError(`Component "${k}" is required`),
            );
          }
          continue;
        }
        stackExecutor.execute(k, () => {
          _codecProcessElement(
            stackExecutor,
            codec,
            defComponent,
            profile.components![k],
            options,
          );
        });
      }
    });
  } else delete profile?.components;
}

/**
 * Warns of an element's log channel settings that name what it does not
 * have: a channel, or an event its channel does not write. Warnings only:
 * a package's next version may drop either, and a worker does not stop
 * for a log setting.
 */
function _checkLogChannels(
  stackExecutor: StackExecutor,
  metadata: AppMetadata | ElementComponentMetadata,
  profile: Profile | ProfileComponent,
) {
  const settings = profile.settings?.logs?.channels;
  if (!settings) return;
  const at = stackExecutor.stack.join('/');
  const warn = (location: string, message: string) =>
    stackExecutor.issues.push({
      message,
      severity: 'warning',
      location: (at ? at + '/' : '') + location,
    } as StackExecutor.Issue);
  for (const [name, channelSettings] of Object.entries(settings)) {
    const where = `settings/logs/channels/${name}`;
    const definition = metadata.logChannels?.[name];
    if (!definition) {
      /* The app's settings keep the worker's console, defined by none */
      if (!(name === 'console' && !at))
        warn(where, `"${name}" is not a log channel of this element`);
      continue;
    }
    const unknown = (channelSettings?.events || []).filter(
      event => !definition.events?.includes(event),
    );
    if (unknown.length)
      warn(
        `${where}/events`,
        `${unknown.map(e => `"${e}"`).join(', ')} ${unknown.length === 1 ? 'is not an event' : 'are not events'} of the "${name}" channel. It has: ${definition.events?.join(', ') || 'none'}`,
      );
  }
}

/**
 * Decodes values by the variables that define them - checks each against
 * its type and rules and sets the defaults - as a profile's values are.
 * Values no variable defines are left out. Issues are located by the
 * values' keys, below `location` when one is given.
 */
export function decodeValues(
  variables: VariableMetadataRecord,
  values: Record<string, any> | undefined,
  options?: CodecOptions & { location?: string },
):
  | { result: true; values: Record<string, any>; issues: StackExecutor.Issue[] }
  | { result: false; issues: StackExecutor.Issue[] } {
  const stackExecutor = new StackExecutor();
  let out: Record<string, any> = {};
  const run = () => {
    out = _codecValues(stackExecutor, 'decode', variables, values, options);
  };
  if (options?.location) stackExecutor.execute(options.location, run);
  else run();
  if (
    stackExecutor.issues.find(
      i => !(i.severity === 'warning' || i.severity === 'info'),
    )
  )
    return { result: false, issues: stackExecutor.issues };
  return { result: true, values: out, issues: stackExecutor.issues };
}

function _decodeVariables<T extends Profile | ProfileComponent>(
  stackExecutor: StackExecutor,
  codec: 'decode' | 'encode',
  metadata: AppMetadata | ElementComponentMetadata,
  profile: T,
  options?: CodecOptions,
) {
  if (!metadata.variables) {
    delete profile.values;
    return;
  }
  profile.values = _codecValues(
    stackExecutor,
    codec,
    metadata.variables,
    profile.values,
    options,
  );
}

/** The values the variables define, decoded or encoded */
function _codecValues(
  stackExecutor: StackExecutor,
  codec: 'decode' | 'encode',
  variables: VariableMetadataRecord,
  oldValues: Record<string, any> | undefined,
  options?: CodecOptions,
): Record<string, any> {
  const values: Record<string, any> = {};
  const process = (defs: VariableMetadataRecord, target: any, oldVals: any) => {
    for (const [k, defVariable] of Object.entries(defs)) {
      stackExecutor.execute(k, () => {
        if (defVariable == null) return;
        /* A reference not resolved yet: kept as written */
        const given = oldVals?.[k];
        if (
          options?.unresolved &&
          (hasValueRef(given) ||
            (Array.isArray(given) && given.some(hasValueRef)))
        ) {
          target[k] = given;
          return;
        }
        let valueFn: Validator = isAny;
        /* If variable is ignored and no default value is set, field should be undefined  */
        if (defVariable.ignored && defVariable.default === undefined) {
          target[k] = vg.isUndefined({ coerce: true });
          return;
        }
        /* If variable is ignored and a default value is set, field should be set to default value  */
        if (defVariable.ignored && defVariable.default !== undefined) {
          if (defVariable.default === null) {
            target[k] = null;
            return;
          }
          valueFn = vg.fixed(defVariable.default);
        }
        switch (defVariable.type) {
          case VariableType.String: {
            switch (defVariable.format) {
              case 'hex':
                valueFn = isHex;
                break;
              case 'base64':
                valueFn = isBase64;
                break;
              case 'url':
                valueFn = isURL;
                break;
              case 'email':
                valueFn = isEmail;
                break;
              case 'date':
                valueFn = vg.isDateString({
                  precisionMin: 'day',
                  precisionMax: 'day',
                  trim: true,
                });
                break;
              case 'date-time':
                valueFn = isDateString;
                break;
              case 'time':
                valueFn = isTime;
                break;
              default:
                valueFn = isString;
            }
            break;
          }
          case VariableType.Secret: {
            valueFn = isString;
            if (options?.cryptoSecretKey) {
              if (codec === 'decode')
                valueFn = secretDecryptor(options.cryptoSecretKey);
              else valueFn = secretEncryptor(options.cryptoSecretKey);
            }
            break;
          }
          case VariableType.Number: {
            valueFn = isNumber;
            break;
          }
          case VariableType.BigInt: {
            valueFn = isBigint;
            break;
          }
          case VariableType.Boolean: {
            valueFn = isBoolean;
            break;
          }
          case VariableType.Enum: {
            /* Not strict: enumValues are suggestions and any other value
             * is accepted - as a string, like the listed ones, which the
             * metadata keeps as strings */
            valueFn =
              defVariable.enumStrict === false
                ? isString
                : vg.isEnum(defVariable.enumValues);
            break;
          }
          case VariableType.Nested: {
            if (!defVariable.variables) {
              delete target[k];
            } else {
              valueFn = validator(old => {
                if (!old) return;
                const v = {};
                process(defVariable.variables!, v, old);
                return v;
              });
            }
            break;
          }
        }
        /* */
        let hasDefault = false;
        if (
          defVariable.default !== undefined &&
          (options?.setDefaultValues ?? true)
        ) {
          hasDefault = true;
          valueFn = vg.required(valueFn, { default: defVariable.default });
        }

        /* Validation rules for each data value. They run after the type
         * codec and the default, on the value those produce, so they are
         * piped after valueFn rather than replacing it */
        if (codec === 'decode') {
          const fns: Validator[] = [];
          if (defVariable.type === VariableType.String) {
            if (defVariable.pattern) fns.push(vg.matches(defVariable.pattern));
          }
          if (defVariable.minValue != null)
            fns.push(vg.isGte(defVariable.minValue));
          if (defVariable.maxValue != null)
            fns.push(vg.isLte(defVariable.maxValue));
          if (fns.length) valueFn = vg.pipe([valueFn, ...fns]);
        }

        if (defVariable.isArray) {
          valueFn = vg.isArray(valueFn);
          /* Validation rules for each array  */
          if (codec === 'decode') {
            const fns: Validator[] = [];
            if (defVariable.minOccurs != null)
              fns.push(vg.lengthMin(defVariable.minOccurs));
            if (defVariable.maxOccurs != null)
              fns.push(vg.lengthMax(defVariable.maxOccurs));
            if (fns.length) valueFn = vg.pipe([valueFn, ...fns]);
          }
        }
        /* A required value that is missing is told as such, not as a value
         * of the wrong type */
        if (defVariable.required && !hasDefault && codec === 'decode')
          valueFn = vg.required(valueFn);
        if (!defVariable.required && !hasDefault) {
          valueFn = defVariable.nullable
            ? vg.nullable(valueFn)
            : vg.optional(valueFn);
        }
        target[k] = valueFn(oldVals?.[k], { coerce: true });
      });
    }
  };
  process(variables, values, oldValues);
  return values;
}
