import {
  AppBase,
  ComponentBase,
  type ElementComponentMetadataRecord,
  ExtensionRegistry,
  type LogChannelMetadataRecord,
  type LogChannelSettingsRecord,
  Profile,
  type ProfileComponent,
} from '@syncbridge/common';
import type { DeepPartial, Type } from 'ts-gems';
import { isMockComponent, MockComponent } from './mock.js';

/** True when T is `any` */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The values a profile gives an element, typed from its `values`: any of
 * its variables, nested ones in part. Untyped when the class declares no
 * values type of its own.
 */
export type ValuesOf<T> = T extends { values: infer V }
  ? IsAny<V> extends true
    ? Record<string, any>
    : string extends keyof V
      ? Record<string, any>
      : DeepPartial<V>
  : Record<string, any>;

/** The names of T's components: its public properties holding one */
export type ComponentKeys<T> = {
  [K in keyof T]-?: K extends 'components'
    ? never
    : NonNullable<T[K]> extends ComponentBase
      ? K
      : never;
}[keyof T] &
  string;

/**
 * The components a profile gives an element, by the name the class gives
 * them, each typed from the class it declares. Untyped for `any`.
 */
export type ComponentsOf<T> =
  IsAny<T> extends true
    ? Record<string, ComponentSpec<any> | undefined>
    : {
        [K in ComponentKeys<T>]?: ComponentSpec<
          Extract<NonNullable<T[K]>, ComponentBase>
        >;
      };

/**
 * What a component of the profile is:
 * - `true`: the class the app declares, with default values
 * - a component class or a mock: that class, with default values
 * - an object: `use` (a class, a mock or a uri; default: the declared
 *   class), its `values` and its own `components`
 * - `false`: left out
 *
 * `values` and `components` are typed from the declared class; with `use`,
 * which may be a subclass with variables of its own, they are not.
 */
export type ComponentSpec<C extends ComponentBase = ComponentBase> =
  | boolean
  | Type<C>
  | MockComponent<C>
  | {
      use?: undefined;
      values?: ValuesOf<C>;
      components?: ComponentsOf<C>;
      disabled?: boolean;
    }
  | {
      use: Type<C> | MockComponent<C> | string;
      values?: Record<string, any>;
      components?: Record<string, ComponentSpec<any> | undefined>;
      disabled?: boolean;
    };

export interface ProfileOptions<T = AppBase> {
  /** Display name of the app; default: its class name */
  name?: string;
  /** Typed from the app's `values` */
  values?: ValuesOf<T>;
  /**
   * Components by the name the app gives them, typed from the class
   * each is declared with. A required component that is not given is
   * added with its declared class; an optional one is left out.
   */
  components?: ComponentsOf<T>;
  /**
   * `all` (default): every log channel writes, so a test sees what is
   * written to one its definition turns off, as a component's
   * communication; `defaults`: as their definitions say
   */
  logChannels?: 'all' | 'defaults';
}

let profileSeq = 0;

/**
 * Builds the profile SyncBridge would store for `appClass`, from its
 * metadata in the registry. Classes the profile names but the registry
 * does not have (a mock, a class the test declares) are registered first.
 */
export async function buildProfile<T extends AppBase>(
  registry: ExtensionRegistry,
  appClass: Type<T>,
  options: ProfileOptions<T> = {},
): Promise<Profile> {
  const uri: string = (appClass as any).uri;
  if (!uri)
    throw new TypeError(
      `${appClass.name} is not an app: it has no @App decorator`,
    );
  if (!registry.findApp(uri)) await registry.registerClass(appClass);
  const metadata = registry.getApp(uri).metadata;
  const profile = new Profile({
    id: `test-${++profileSeq}`,
    displayName: options.name || appClass.name,
    appUri: uri,
    values: options.values || {},
    components: await buildComponents(
      registry,
      metadata.components,
      options.components,
      appClass.name,
      options.logChannels !== 'defaults',
    ),
  });
  if (options.logChannels !== 'defaults')
    profile.settings = { logs: { channels: allOn(metadata.logChannels) } };
  /* As SyncBridge does when a worker is created: the app fills in
   * its defaults, keeping what is already there */
  const hook = (metadata as any).staticEvents?.onCreateProfile;
  if (hook && typeof (appClass as any)[hook] === 'function')
    await (appClass as any)[hook].call(appClass, profile);
  return profile;
}

async function buildComponents(
  registry: ExtensionRegistry,
  declared: ElementComponentMetadataRecord | undefined,
  given: Record<string, ComponentSpec<any> | undefined> = {},
  owner: string,
  channelsOn: boolean,
): Promise<Record<string, ProfileComponent> | undefined> {
  if (!declared) return;
  for (const key of Object.keys(given))
    if (!declared[key])
      throw new TypeError(
        `${owner} has no component "${key}". It has: ${Object.keys(declared).join(', ') || 'none'}`,
      );
  const out: Record<string, ProfileComponent> = {};
  for (const [key, decl] of Object.entries(declared)) {
    let spec = given[key];
    if (spec === undefined) {
      if (!decl.required) continue;
      spec = true;
    }
    if (spec === false) continue;
    const obj: Exclude<
      ComponentSpec<any>,
      boolean | Type<ComponentBase> | MockComponent<any>
    > = typeof spec === 'object' && !isMockComponent(spec)
      ? spec
      : { use: spec === true ? undefined : spec };
    const use = obj.use;
    const componentUri = await resolveUri(
      registry,
      use,
      decl,
      `${owner}.${key}`,
    );
    const reg = registry.getComponent(componentUri);
    out[key] = {
      uri: componentUri,
      values: obj.values || {},
      ...(obj.disabled ? { disabled: true } : {}),
      ...(channelsOn
        ? { settings: { logs: { channels: allOn(reg.metadata.logChannels) } } }
        : {}),
      components: await buildComponents(
        registry,
        reg.metadata.components,
        obj.components,
        `${owner}.${key}`,
        channelsOn,
      ),
    } as ProfileComponent;
  }
  return out;
}

/** Every channel of an element turned on */
function allOn(
  channels: LogChannelMetadataRecord | undefined,
): LogChannelSettingsRecord {
  return Object.fromEntries(
    Object.keys(channels || {}).map(name => [name, { enabled: true }]),
  );
}

async function resolveUri(
  registry: ExtensionRegistry,
  use: Type<ComponentBase> | MockComponent<any> | string | undefined,
  decl: { interfaceUri: string; classUri?: string; oneOf?: string[] },
  where: string,
): Promise<string> {
  if (typeof use === 'string') return use;
  const cls: Type<ComponentBase> | undefined = isMockComponent(use)
    ? use.class
    : use;
  if (cls) {
    const uri: string = (cls as any).uri;
    if (!uri)
      throw new TypeError(
        `${cls.name} (${where}) is not a component: it has no @Component decorator`,
      );
    if (!registry.findComponent(uri)) await registry.registerClass(cls);
    return uri;
  }
  /* One of several: which, the test's to tell */
  if (!decl.classUri && (decl.oneOf?.length ?? 0) > 1)
    throw new TypeError(
      `${where} takes one of ${decl.oneOf!.join(', ')}: give one in components`,
    );
  const declaredUri = decl.classUri || decl.interfaceUri;
  const reg = registry.findComponent(declaredUri);
  if (!reg || reg.metadata.abstract)
    throw new TypeError(
      `${where} needs a class: "${decl.interfaceUri}" is an interface. ` +
        `Give one in components, e.g. a class implementing it or env.mock(...)`,
    );
  return declaredUri;
}
