import { clone, merge, omit, omitUndefined } from '@jsopen/objects';
import { SbValidationError } from '../classes/sb-error.js';
import { StackExecutor } from '../classes/stack-executor.js';
import {
  AppMetadata,
  ElementComponentMetadata,
  ElementComponentMetadataRecord,
  Profile,
  ProfileComponent,
  VariableMetadata,
  VariableMetadataRecord,
  VariableType,
} from '../models/index.js';
import { ExtensionRegistry } from '../registry/extension-registry.js';
import { slotInterfaces, slotTakes } from './slot-interfaces.js';

/**
 * Materializes metadata from profile.
 */
export function materializeMetadata(
  profile: Profile,
  options?: {
    returnUndefinedComponentsAsAbstract?: boolean;
    removeIgnoredVariables?: boolean;
  },
): AppMetadata {
  const r = materializeMetadataSilent(profile, options);
  if (!r.result) {
    const msg =
      'Worker profile validation error.\n  ' +
      r.issues
        .map(issue => `- ${issue.message}. Location: /${issue.location}`)
        .join('\n  ');
    r.issues.forEach(issue => {
      if (issue instanceof SbValidationError) delete issue.stack;
    });
    throw new SbValidationError(msg, {
      workerId: profile.id,
      issues: r.issues,
    });
  }
  return r.metadata;
}

/**
 *
 */
export function materializeMetadataSilent(
  profile: Profile,
  options?: {
    returnUndefinedComponentsAsAbstract?: boolean;
    removeIgnoredVariables?: boolean;
  },
):
  | {
      result: true;
      metadata: AppMetadata;
      issues: StackExecutor.Issue[];
    }
  | {
      result: false;
      issues: StackExecutor.Issue[];
    } {
  const stackExecutor = new StackExecutor();
  const appRec = ExtensionRegistry.getApp(profile.appUri, profile.appVersion);
  const metadata = omitUndefined<AppMetadata>(
    clone(
      {
        classType: appRec.metadata.classType,
        className: appRec.metadata.className,
        version: appRec.version,
        displayName: appRec.metadata.displayName,
        description: appRec.metadata.description,
        iconUrl: appRec.metadata.iconUrl,
        tags: appRec.metadata.tags,
        variables: appRec.metadata.variables,
        components: appRec.metadata.components,
        ...(appRec.metadata as any),
      } satisfies AppMetadata,
      { deep: 'full' },
    ),
  ) as any;
  if (metadata.variables) {
    /* Remove ignored variables */
    for (const [k, variable] of Object.entries<VariableMetadata>(
      metadata.variables!,
    )) {
      if (variable.ignored && options?.removeIgnoredVariables)
        delete metadata.variables![k];
    }
  }
  /* Materialize components */
  if (metadata.components) {
    stackExecutor.execute('components', () => {
      metadata!.components = _materializeComponents(
        stackExecutor,
        metadata.components,
        profile,
        options,
      );
    });
  }
  if (stackExecutor.issues?.length)
    return { result: false, issues: stackExecutor.issues };
  return { result: true, metadata, issues: stackExecutor.issues };
}

/**
 *
 * @private
 */
function _materializeComponents(
  stackExecutor: StackExecutor,
  srcMetadata: ElementComponentMetadataRecord,
  profile?: Profile | ProfileComponent,
  options?: {
    returnUndefinedComponentsAsAbstract?: boolean;
    removeIgnoredVariables?: boolean;
  },
): ElementComponentMetadataRecord {
  const out: ElementComponentMetadataRecord = {};
  for (const [
    componentName,
    metadataComponent,
  ] of Object.entries<ElementComponentMetadata>(srcMetadata)) {
    stackExecutor.execute(componentName, () => {
      /** Check if component defined in profile */
      let materializedComponent: ElementComponentMetadata;
      const profileComponent = profile?.components?.[componentName];
      if (!profileComponent) {
        if (!options?.returnUndefinedComponentsAsAbstract) {
          if (metadataComponent.required)
            throw new SbValidationError(
              `Component "${componentName}" should be configured`,
              { rule: 'required' },
            );
          return;
        }
        materializedComponent = {
          interfaceUri: metadataComponent.interfaceUri,
          ...(metadataComponent.oneOf
            ? { oneOf: metadataComponent.oneOf }
            : {}),
          description: metadataComponent.description,
          required: metadataComponent.required,
        } satisfies ElementComponentMetadata;
        out[componentName] = materializedComponent;
      } else {
        /** istanbul ignore next */
        if (!profileComponent.uri)
          throw new SbValidationError(`"uri" property required`);
        const reg = ExtensionRegistry.getComponent(profileComponent.uri);
        if (
          !slotTakes(
            metadataComponent,
            profileComponent.uri,
            reg.metadata.interfaces,
          )
        )
          throw new SbValidationError(
            `Selected component "${profileComponent.uri}" do not implement ${slotInterfaces(metadataComponent).join(' or ')}.`,
          );
        if (profileComponent.disabled && metadataComponent.required) {
          throw new SbValidationError(
            `Component "${componentName}" is disabled but it is required.`,
          );
        }
        materializedComponent = {
          classUri: profileComponent.uri,
          version: reg.version,
          ...omit(metadataComponent, ['classUri', 'variables', 'version']),
        };
        materializedComponent.variables = merge(
          {},
          [reg.metadata.variables || {}, metadataComponent.variables || {}],
          { deep: 'full' },
        );
        materializedComponent.variables = sortVariables(
          materializedComponent.variables,
        );
        if (reg.metadata.logChannels)
          materializedComponent.logChannels = clone(reg.metadata.logChannels, {
            deep: 'full',
          });
        out[componentName] = materializedComponent;
        /** Remove ignored variables */
        for (const [k, variable] of Object.entries<VariableMetadata>(
          materializedComponent.variables!,
        )) {
          if (variable.ignored && options?.removeIgnoredVariables)
            delete materializedComponent.variables![k];
        }

        if (reg.metadata.components) {
          stackExecutor.execute('components', () => {
            materializedComponent.components = _materializeComponents(
              stackExecutor,
              reg.metadata.components!,
              profileComponent,
              options,
            );
          });
        }
      }
    });
  }
  return out;
}

function sortVariables(
  variables?: VariableMetadataRecord,
): VariableMetadataRecord | undefined {
  if (!variables) return;
  const keys = Object.keys(variables);
  return [...keys]
    .sort((a, b) => {
      const va = variables[a];
      const vb = variables[b];
      const indexA = va.index ?? Number.MAX_SAFE_INTEGER;
      const indexB = vb.index ?? Number.MAX_SAFE_INTEGER;
      if (indexA > indexB) return 1;
      if (indexA < indexB) return -1;
      if (va.type === VariableType.Nested && vb.type !== VariableType.Nested)
        return 1;
      if (vb.type === VariableType.Nested && va.type !== VariableType.Nested)
        return -1;
      return keys.indexOf(a) > keys.indexOf(b) ? 1 : -1;
    })
    .reduce((a, k) => {
      a[k] = variables[k];
      return a;
    }, {});
}
