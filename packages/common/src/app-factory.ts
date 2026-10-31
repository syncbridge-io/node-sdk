import { clone } from '@jsopen/objects';
import equal from 'fast-deep-equal';
import { AppBase } from './classes/app-base.js';
import { ComponentBase } from './classes/component-base.js';
import { DASHBOARD_CONTEXT } from './classes/dashboard-base.js';
import { LogChannelWriter } from './classes/log-channel-writer.js';
import { SbError, SbValidationError } from './classes/sb-error.js';
import { StackExecutor } from './classes/stack-executor.js';
import { DASHBOARD_CLASSES } from './constants.js';
import { dashboardPath } from './dashboard/limits.js';
import {
  DashboardRuntime,
  type DashboardSink,
  WidgetWriter,
} from './dashboard/widget-writer.js';
import type { LogChannel } from './decorators/log-channel.decorator.js';
import type { ILogger } from './interfaces/index.js';
import {
  AppMetadata,
  type DashboardMetadataRecord,
  ElementComponentMetadataRecord,
  type LogChannelMetadataRecord,
  type LogChannelSettingsRecord,
  Profile,
  ProfileComponentRecord,
  VariableMetadataRecord,
} from './models/index.js';
import { initializeModelsDocument } from './models-document.js';
import { ExtensionRegistry } from './registry/extension-registry.js';
import { decodeProfileSilent } from './utils/decode-profile.js';

export namespace AppFactory {
  export const METADATA_KEY = Symbol('METADATA');
  export const PROFILE_KEY = Symbol('PROFILE');

  export interface AppOptions {
    logger?: ILogger;
    dataDirectory?: string;
    /** Where the log channels hand their records; without it they drop them */
    logSink?: LogChannel.Sink;
    /**
     * Where the dashboards hand their widgets' writes and the widgets
     * defined as the worker runs; without it they drop them
     */
    dashboardSink?: DashboardSink;
  }

  interface ConfigureAppContext {
    stackExecutor: StackExecutor;
    app: AppBase;
    profile: Profile;
    options?: AppOptions;
    valueUpdates?: Map<AppBase | ComponentBase, Record<string, any>>;
  }

  interface ConfigureComponentsContext extends ConfigureAppContext {
    owner: AppBase | ComponentBase;
    curPath: string;
    newMetadataComponents?: ElementComponentMetadataRecord;
    newProfileComponents?: ProfileComponentRecord;
    oldMetadataComponents?: ElementComponentMetadataRecord;
    oldProfileComponents?: ProfileComponentRecord;
  }

  export async function createApp<T extends AppBase>(
    profile: Profile,
    options?: AppOptions,
  ): Promise<T> {
    const r1 = await createAppSilent(profile, options);
    if (!r1.result) {
      const msg =
        'Error while creating app.\n  ' +
        r1.issues
          .map(issue => `- ${issue.message}. Location: /${issue.location}`)
          .join('\n  ');
      r1.issues.forEach(issue => {
        if (issue instanceof SbValidationError) delete issue.stack;
      });
      throw new SbValidationError(msg, {
        issues: r1.issues,
      });
    }
    return r1.app as T;
  }

  export async function createAppSilent<T extends AppBase>(
    profile: Profile,
    options?: AppOptions,
  ): Promise<
    | {
        result: true;
        app: T;
        issues: StackExecutor.Issue[];
      }
    | {
        result: false;
        issues: StackExecutor.Issue[];
      }
  > {
    const ctx: ConfigureAppContext = {
      stackExecutor: new StackExecutor(),
      app: undefined as any,
      profile,
      options,
    };
    try {
      await initializeModelsDocument();
      if (!(await _configureApp(ctx))) {
        return {
          result: false,
          issues: ctx.stackExecutor.issues,
        };
      }
      return {
        result: true,
        app: ctx.app as T,
        issues: ctx.stackExecutor.issues,
      };
    } catch (error: any) {
      return {
        result: false,
        issues: [
          ...ctx.stackExecutor.issues,
          {
            message: error.message,
            type: 'error',
            severity: 'error',
            stack: error.stack,
          },
        ],
      };
    }
  }

  export async function updateApp(
    app: AppBase,
    profile: Profile,
    options?: AppOptions,
  ): Promise<void> {
    const r1 = await updateAppSilent(app, profile, options);
    if (!r1.result) {
      const msg =
        'Error while updating app.\n  ' +
        r1.issues
          .map(issue => `- ${issue.message}. Location: /${issue.location}`)
          .join('\n  ');
      r1.issues.forEach(issue => {
        if (issue instanceof SbValidationError) delete issue.stack;
      });
      throw new SbValidationError(msg, {
        issues: r1.issues,
      });
    }
  }

  export async function updateAppSilent(
    app: AppBase,
    profile: Profile,
    options?: AppOptions,
  ): Promise<{
    result: boolean;
    issues: StackExecutor.Issue[];
  }> {
    if (options?.logger) app.logger = options.logger;
    if (options?.dataDirectory) app.dataDirectory = options.dataDirectory;
    const ctx: ConfigureAppContext = {
      stackExecutor: new StackExecutor(),
      app,
      profile,
      options,
      valueUpdates: new Map(),
    };
    if (!(await _configureApp(ctx))) {
      return {
        result: false,
        issues: ctx.stackExecutor.issues,
      };
    }
    const signalUpdates = async (obj: AppBase | ComponentBase) => {
      if (obj.components) {
        for (const component of Object.values(obj.components)) {
          await signalUpdates(component);
        }
      }
      const properties = ctx.valueUpdates?.get(obj);
      if (properties?.length) {
        await obj.emitAsyncSafe('values-updated', properties);
      }
    };
    await signalUpdates(app);
    return {
      result: true,
      issues: ctx.stackExecutor.issues,
    };
  }

  async function _configureApp(ctx: ConfigureAppContext): Promise<boolean> {
    /* Decode profile */
    const r1 = decodeProfileSilent(ctx.profile);
    if (!r1.result) {
      ctx.stackExecutor.issues.push(...r1.issues);
      return false;
    }
    ctx.profile = r1.profile;

    const oldMetadata: AppMetadata = ctx.app?.[METADATA_KEY];
    const oldProfile: Profile = ctx.app?.[PROFILE_KEY];

    if (!ctx.app) {
      /* Create new app instance */
      const reg = ExtensionRegistry.getApp(
        r1.profile.appUri,
        r1.profile.appVersion,
      );
      const appClass = await reg.getClass();
      /* Create app instance */
      ctx.app = new appClass({
        name: r1.profile.displayName,
        logger: ctx.options?.logger,
        values: r1.profile.values ? clone(r1.profile.values) : {},
        dataDirectory: ctx.options?.dataDirectory,
      });
    } else {
      /* Update values */
      if (
        !ctx.stackExecutor.execute('values', () => {
          _patchValues(
            ctx,
            ctx.app,
            ctx.app.values,
            '',
            r1.profile.values!,
            r1.metadata.variables || {},
            oldProfile?.values,
            oldMetadata.variables,
          );
        })
      ) {
        return false;
      }
    }

    const cmpCtx: ConfigureComponentsContext = {
      ...ctx,
      owner: ctx.app,
      curPath: '',
      newMetadataComponents: r1.metadata.components,
      newProfileComponents: r1.profile.components,
      oldMetadataComponents: oldMetadata?.components,
      oldProfileComponents: oldProfile?.components,
    };
    if (!(
      _validateComponents(cmpCtx) && (await _configureComponents(cmpCtx))
    )) {
      return false;
    }
    _configureLogChannels(
      ctx.app,
      r1.metadata.logChannels,
      r1.profile.settings?.logs?.channels,
      '',
      ctx.options?.logSink,
    );
    _configureDashboards(
      ctx.app,
      r1.metadata.dashboards,
      '',
      ctx.options?.dashboardSink,
    );
    ctx.app[METADATA_KEY] = r1.metadata;
    ctx.app[PROFILE_KEY] = r1.profile;
    return true;
  }

  function _validateComponents(ctx: ConfigureComponentsContext): boolean {
    const {
      newMetadataComponents,
      newProfileComponents,
      oldMetadataComponents,
      oldProfileComponents,
      curPath,
      owner,
      stackExecutor,
    } = ctx;
    if (!newMetadataComponents) return true;
    return stackExecutor.execute('components', () => {
      for (const [key, newChildMetadata] of Object.entries(
        newMetadataComponents,
      )) {
        // Stack: components/componentName
        stackExecutor.execute(key, () => {
          const oldChildMetadata = oldMetadataComponents?.[key];
          const oldChildProfile = oldProfileComponents?.[key];
          const newChildProfile = newProfileComponents![key]!;
          const componentPath = curPath ? curPath + '/' + key : key;
          const componentInstance = owner.components?.[key];
          if (
            oldChildProfile?.uri &&
            oldChildProfile?.uri !== newChildProfile.uri
          )
            throw new SbError(
              `You should not change uri of the component (${componentPath})`,
            );
          /** Validate sub-components */
          if (newChildMetadata.components && componentInstance) {
            _validateComponents({
              ...ctx,
              owner: componentInstance,
              curPath: componentPath,
              newMetadataComponents: newChildMetadata.components,
              newProfileComponents: newChildProfile.components,
              oldMetadataComponents: oldChildMetadata?.components,
              oldProfileComponents: oldChildProfile?.components,
            });
          }
        });
      }
    });
  }

  async function _configureComponents(
    ctx: ConfigureComponentsContext,
  ): Promise<boolean> {
    const {
      newMetadataComponents,
      newProfileComponents,
      oldMetadataComponents,
      oldProfileComponents,
      curPath,
      owner,
      stackExecutor,
      app,
    } = ctx;
    if (!newMetadataComponents) return true;

    owner.components = owner.components || {};
    // Stack: components
    return await stackExecutor.executeAsync('components', async () => {
      for (const [key, newChildMetadata] of Object.entries(
        newMetadataComponents,
      )) {
        // Stack: components/componentName
        await stackExecutor.executeAsync(key, async () => {
          if (newProfileComponents?.[key]?.disabled) return;
          // Stack: components/componentName
          await stackExecutor.executeAsync(key, async () => {
            const oldChildMetadata = oldMetadataComponents?.[key];
            const oldChildProfile = oldProfileComponents?.[key];
            const newChildProfile = newProfileComponents![key]!;
            const componentPath = curPath ? curPath + '/' + key : key;
            let componentInstance = owner.components[key];

            /** Create the component */
            if (!componentInstance) {
              const compReg = ExtensionRegistry.getComponent(
                newChildMetadata.classUri!,
              );
              /** Create the component instance */
              const compClass = await compReg.getClass();
              const values = { ...newChildProfile.values };
              componentInstance = new compClass({
                app: app,
                parent: owner,
                name: key,
                path: componentPath,
                values,
              }) as any;
              owner.components[key] = componentInstance;
              if (newChildMetadata.propertyKey)
                owner[newChildMetadata.propertyKey] = componentInstance;
            } else {
              componentInstance.values = {};
              _patchValues(
                ctx,
                componentInstance,
                componentInstance.values,
                '',
                newChildProfile.values || {},
                newChildMetadata.variables || {},
                oldChildProfile?.values,
                oldChildMetadata?.variables,
              );
            }

            _configureLogChannels(
              componentInstance,
              newChildMetadata.logChannels,
              newChildProfile.settings?.logs?.channels,
              componentPath,
              ctx.options?.logSink,
            );

            /** Create the child logger */
            componentInstance.logger = owner.logger?.child({
              component: componentPath,
            });
            if (newChildProfile.settings?.logs?.level) {
              componentInstance.logger!.level =
                newChildProfile.settings?.logs?.level;
            }

            _configureDashboards(
              componentInstance,
              newChildMetadata.dashboards,
              componentPath,
              ctx.options?.dashboardSink,
            );

            /** Initialize sub-components */
            if (newChildMetadata.components) {
              await _configureComponents({
                ...ctx,
                owner: componentInstance,
                curPath: componentPath,
                newMetadataComponents: newChildMetadata.components,
                newProfileComponents: newChildProfile.components,
                oldMetadataComponents: oldChildMetadata?.components,
                oldProfileComponents: oldChildProfile?.components,
              });
            }
          });
        });
      }
    });
  }

  /**
   * A running element's values, patched with a new profile's: its hot-plug
   * settings alone - those of a hot-plug group all of them. A list - of
   * values or of groups - is replaced whole, never merged into an object.
   * The paths changed are kept for its 'values-updated' event.
   */
  function _patchValues(
    ctx: ConfigureComponentsContext | ConfigureAppContext,
    instance: AppBase | ComponentBase,
    target: Record<string, any>,
    valPath: string,
    newValues: Record<string, any> | undefined,
    newVariables: VariableMetadataRecord,
    oldValues?: Record<string, any>,
    oldVariables?: VariableMetadataRecord,
    hot = false,
  ) {
    if (oldValues) Object.assign(target, oldValues);
    const updatedValues = ctx.valueUpdates?.get(instance) || [];
    ctx.valueUpdates?.set(instance, updatedValues);
    if (newVariables) {
      for (const [varKey, varMeta] of Object.entries(newVariables)) {
        const keyPath = valPath ? valPath + '.' + varKey : varKey;
        /** Update only hotplug variables, and all of a hotplug group */
        if (!hot && varMeta?.hotPlug !== true) continue;
        if (varMeta.type === 'nested' && !varMeta.isArray) {
          target[varKey] = {};
          _patchValues(
            ctx,
            instance,
            target[varKey],
            keyPath,
            newValues?.[varKey],
            newVariables[varKey]?.variables || {},
            oldValues?.[varKey],
            oldVariables?.[varKey]?.variables,
            true,
          );
          continue;
        }
        const value = newValues?.[varKey];
        if (!equal(target[varKey], value)) {
          updatedValues.push(keyPath);
          /* Its own copy: the profile's left as it is */
          target[varKey] =
            value && typeof value === 'object' ? clone(value) : value;
        }
      }
    }
  }

  /**
   * Creates an element's log channels on first configuration - assigning
   * each to its property - and applies the profile's settings to them on
   * every one
   */
  function _configureLogChannels(
    element: AppBase | ComponentBase,
    definitions: LogChannelMetadataRecord | undefined,
    settings: LogChannelSettingsRecord | undefined,
    source: string,
    sink: LogChannel.Sink | undefined,
  ) {
    for (const [name, definition] of Object.entries(definitions || {})) {
      let channel = element.logChannels[name] as LogChannelWriter | undefined;
      if (!channel) {
        channel = new LogChannelWriter(definition, source, sink);
        element.logChannels[name] = channel;
        if (definition.propertyKey) element[definition.propertyKey] = channel;
      }
      channel.configure(settings?.[name], sink);
    }
  }

  /**
   * Makes an element's dashboards on first configuration - each an
   * instance of its class, assigned to its property, its widget properties
   * holding their writers - and points them at the sink on every one. What
   * they refuse is told in the element's log
   */
  function _configureDashboards(
    element: AppBase | ComponentBase,
    definitions: DashboardMetadataRecord | undefined,
    source: string,
    sink: DashboardSink | undefined,
  ) {
    if (!definitions) return;
    const classes = Reflect.getMetadata(DASHBOARD_CLASSES, element.constructor);
    const warn = (message: string) => element.logger?.warn(message);
    for (const [name, definition] of Object.entries(definitions)) {
      const key = definition.propertyKey || name;
      const path = dashboardPath(source, name);
      let dashboard = element[key];
      if (!dashboard) {
        const dashboardClass = classes?.[key];
        if (!dashboardClass) continue;
        dashboard = new dashboardClass();
        element[key] = dashboard;
      }
      const widgets = definition.widgets || [];
      let runtime: DashboardRuntime | undefined = dashboard[DASHBOARD_CONTEXT];
      if (!runtime) {
        runtime = new DashboardRuntime(
          path,
          definition.sections || [],
          new Set(widgets.map(w => w.id)),
          sink,
          warn,
        );
        dashboard[DASHBOARD_CONTEXT] = runtime;
      } else runtime.configure(path, sink, warn);
      for (const widget of widgets) {
        let writer = dashboard[widget.id] as WidgetWriter | undefined;
        if (!(writer instanceof WidgetWriter)) {
          writer = new WidgetWriter(widget, path, sink, warn);
          dashboard[widget.id] = writer;
        } else {
          (writer as { dashboard: string }).dashboard = path;
          writer.configure(sink, warn);
        }
      }
    }
  }
}
