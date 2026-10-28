import { clone, merge } from '@jsopen/objects';
import semver from 'semver';
import {
  ElementComponentMetadata,
  ElementComponentMetadataRecord,
  Profile,
  ProfileComponent,
  VariableMetadataRecord,
  VariableType,
} from '../models/index.js';
import type {
  AppExtension,
  ComponentExtension,
} from '../registry/extension-package.js';
import { ExtensionRegistry } from '../registry/extension-registry.js';
import { SECRET_PREFIX } from './encrypt-helpers.js';
import { hasValueRef } from './value-refs.js';

/**
 * What carrying a profile changed in it, one thing each: located as a
 * profile's issues are (`values/host`, `components/server/values/port`)
 */
export interface ProfileCarryChange {
  /** migrated: a class's own migrateProfile carried its values */
  kind: 'class' | 'component' | 'value' | 'choice' | 'dropped' | 'migrated';
  location: string;
  /** What it was: a class's uri, a slot's or a setting's name, a choice */
  from: string;
  /** What it is now; none for a value dropped */
  to?: string;
  /** Told in English: `Setting "address" renamed "host"` */
  message: string;
}

export interface CarryProfileOptions {
  /** The app a profile takes: the registry's newest of its range, unless told */
  findApp?: (uri: string, range?: string) => AppExtension | undefined;
  /** A component a profile names: the registry's newest, unless told */
  findComponent?: (uri: string) => ComponentExtension | undefined;
}

/**
 * Carries a profile written for earlier versions of its app and components
 * to the versions it takes now, by what their classes declare of their
 * changes - no code of theirs run (profile-migration.md):
 *
 * - a class renamed (`@App` / `@Component({ formerly })`): its uri read as
 *   the new one's, in its own package;
 * - a slot renamed (`@UseComponent({ formerly })`): its component moved;
 * - a setting renamed (`@DefineVariable({ formerly })`): its value moved;
 * - a choice renamed (`formerlyValues`): the value replaced;
 * - a setting no longer defined: its value dropped.
 *
 * An element's values are carried when they were written with an earlier
 * version than the one taken - or with one not told, as all profiles saved
 * before `writtenWith` - and a component's also when what holds it is,
 * its slot's settings being of that. Written with a newer one, they are
 * left as they are. The profile given is not changed.
 */
export function carryProfile(
  profile: Profile,
  options?: CarryProfileOptions,
): { profile: Profile; changes: ProfileCarryChange[] } {
  const findApp =
    options?.findApp ??
    ((uri: string, range?: string) => ExtensionRegistry.findApp(uri, range));
  const findComponent =
    options?.findComponent ??
    ((uri: string) => ExtensionRegistry.findComponent(uri));
  const out = clone(profile, { deep: 'full' }) as Profile;
  const changes: ProfileCarryChange[] = [];

  let app = out.appUri ? findApp(out.appUri, out.appVersion) : undefined;
  if (!app && out.appUri) {
    const renamed = renamedClass(out.appUri, ExtensionRegistry.apps);
    app = renamed ? findApp(renamed, out.appVersion) : undefined;
    if (app) {
      changes.push(classChange('appUri', out.appUri, app.uri));
      out.appUri = app.uri;
    }
  }
  if (!app) return { profile: out, changes };

  const carried = earlier(out.writtenWith, app.version);
  if (carried) {
    out.values = carryValues(
      out.values,
      app.metadata.variables,
      'values',
      changes,
      !migrates(app),
    );
    carrySlots(out, app.metadata.components, '', changes);
  }
  carryComponents(
    out,
    app.metadata.components,
    '',
    carried,
    findComponent,
    changes,
  );
  return { profile: out, changes };
}

/** Values written with `written` are of an earlier version than `version` */
function earlier(written: string | undefined, version: string): boolean {
  if (!written || !semver.valid(written) || !semver.valid(version))
    return !written;
  return semver.lt(written, version);
}

/**
 * The uri of the class now named for `uri`'s former one: in the same
 * package, the one whose `formerly` names it
 */
function renamedClass(
  uri: string,
  all: { values(): Iterable<(AppExtension | ComponentExtension)[]> },
): string | undefined {
  const at = uri.lastIndexOf(':');
  if (at < 1) return;
  const packageName = uri.slice(0, at);
  const className = uri.slice(at + 1);
  for (const versions of all.values())
    for (const ext of versions)
      if (
        ext?.pkg?.name === packageName &&
        ext.metadata?.formerly?.includes(className)
      )
        return ext.uri;
}

function classChange(
  location: string,
  from: string,
  to: string,
): ProfileCarryChange {
  return {
    kind: 'class',
    location,
    from,
    to,
    message: `Class "${from}" renamed "${to}"`,
  };
}

/** Its slots renamed: the component of a former name moved to the new */
function carrySlots(
  element: Profile | ProfileComponent,
  slots: ElementComponentMetadataRecord | undefined,
  at: string,
  changes: ProfileCarryChange[],
) {
  const components = element.components;
  if (!slots || !components) return;
  for (const [slot, def] of Object.entries(slots)) {
    if (components[slot] || !def.formerly) continue;
    const old = def.formerly.find(n => components[n] && !(n in slots));
    if (!old) continue;
    components[slot] = components[old];
    delete components[old];
    changes.push({
      kind: 'component',
      location: `${at}components/${slot}`,
      from: old,
      to: slot,
      message: `Component "${old}" renamed "${slot}"`,
    });
  }
}

/** The components in its slots: each of its class now, its values carried */
function carryComponents(
  element: Profile | ProfileComponent,
  slots: ElementComponentMetadataRecord | undefined,
  at: string,
  holderCarried: boolean,
  findComponent: (uri: string) => ComponentExtension | undefined,
  changes: ProfileCarryChange[],
) {
  if (!slots || !element.components) return;
  for (const [slot, def] of Object.entries<ElementComponentMetadata>(slots)) {
    const component = element.components[slot];
    if (!component?.uri) continue;
    const where = `${at}components/${slot}/`;
    let reg = findComponent(component.uri);
    if (!reg) {
      const renamed = renamedClass(component.uri, ExtensionRegistry.components);
      reg = renamed ? findComponent(renamed) : undefined;
      if (!reg) continue;
      changes.push(classChange(`${where}uri`, component.uri, reg.uri));
      component.uri = reg.uri;
    }
    const carried =
      holderCarried || earlier(component.writtenWith, reg.version);
    if (carried) {
      /* Its class's settings, as its slot overrides them */
      const variables = merge(
        {},
        [reg.metadata.variables || {}, def.variables || {}],
        { deep: 'full' },
      ) as VariableMetadataRecord;
      component.values = carryValues(
        component.values,
        variables,
        `${where}values`,
        changes,
        !migrates(reg),
      );
      carrySlots(component, reg.metadata.components, where, changes);
    }
    carryComponents(
      component,
      reg.metadata.components,
      where,
      carried,
      findComponent,
      changes,
    );
  }
}

/** Values carried to the settings defined now */
function carryValues(
  values: Record<string, any> | undefined,
  variables: VariableMetadataRecord | undefined,
  at: string,
  changes: ProfileCarryChange[],
  /* What is no longer defined dropped: not for a class migrating its own */
  drop = true,
): Record<string, any> | undefined {
  if (!values || !variables) return values;
  /* Renamed: moved, where the new name has none */
  for (const [name, def] of Object.entries(variables)) {
    if (!def || values[name] !== undefined || !def.formerly) continue;
    const old = def.formerly.find(
      n => values[n] !== undefined && !(n in variables),
    );
    if (!old) continue;
    values[name] = values[old];
    delete values[old];
    changes.push({
      kind: 'value',
      location: `${at}/${name}`,
      from: old,
      to: name,
      message: `Setting "${old}" renamed "${name}"`,
    });
  }
  for (const [name, def] of Object.entries(variables)) {
    const value = values[name];
    if (!def || value === undefined || value === null) continue;
    const where = `${at}/${name}`;
    /* A choice renamed: replaced; a reference left to what it takes */
    if (def.formerlyValues) {
      const renamed = def.formerlyValues;
      const swap = (v: any) => {
        if (
          (typeof v !== 'string' && typeof v !== 'number') ||
          hasValueRef(v) ||
          !Object.prototype.hasOwnProperty.call(renamed, String(v))
        )
          return v;
        const to = renamed[String(v)];
        changes.push({
          kind: 'choice',
          location: where,
          from: String(v),
          to: String(to),
          message: `Setting "${name}": "${v}" renamed "${to}"`,
        });
        return to;
      };
      values[name] = Array.isArray(value) ? value.map(swap) : swap(value);
    }
    /* A group of settings: its own carried within it */
    if (def.type === VariableType.Nested && def.variables) {
      if (Array.isArray(value))
        value.forEach((item, i) => {
          if (isRecord(item))
            carryValues(item, def.variables, `${where}/${i}`, changes, drop);
        });
      else if (isRecord(value))
        carryValues(value, def.variables, where, changes, drop);
    }
  }
  /* No longer defined: dropped - kept for a class's own migrateProfile,
   * which reads what it was; what it leaves is dropped as it is decoded */
  if (!drop) return values;
  for (const name of Object.keys(values)) {
    if (name in variables) continue;
    delete values[name];
    changes.push({
      kind: 'dropped',
      location: `${at}/${name}`,
      from: name,
      message: `Setting "${name}" no longer defined: its value dropped`,
    });
  }
  return values;
}

/** Whether a class carries its own values: its migrateProfile */
function migrates(ext: AppExtension | ComponentExtension): boolean {
  return !!(ext.metadata as any)?.staticEvents?.migrateProfile;
}

function isRecord(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * What a class's own migrateProfile is given (@App.MigrateProfile,
 * @Component.MigrateProfile): its own values alone, after what it
 * declares is carried
 */
export interface ProfileMigration {
  /** The app's values, or one component's */
  values: Record<string, any>;
  /** The version of the class they were written with, if told */
  from?: string;
  /** The version of the class they are carried to */
  to: string;
  /** Where in the profile: "" its app, "components/server" a component */
  path: string;
}

/** A class of a profile whose own migrateProfile is to run */
export interface ProfileMigrationStep {
  kind: 'app' | 'component';
  /** Where in the profile: "" its app, "components/server" a component */
  path: string;
  uri: string;
  /** The version taken: what it carries to */
  version: string;
  /** The version its values were written with, if told */
  from?: string;
  /** Its static method */
  method: string;
}

/**
 * The classes of a profile whose own migrateProfile is to run, the app
 * first, then its components down: each that declares one and whose
 * values were written with an earlier version than the one taken, or
 * with one not told. Of a profile as carryProfile leaves it.
 */
export function profileMigrations(
  profile: Profile,
  options?: CarryProfileOptions,
): ProfileMigrationStep[] {
  const findApp =
    options?.findApp ??
    ((uri: string, range?: string) => ExtensionRegistry.findApp(uri, range));
  const findComponent =
    options?.findComponent ??
    ((uri: string) => ExtensionRegistry.findComponent(uri));
  const steps: ProfileMigrationStep[] = [];
  const app = profile.appUri
    ? findApp(profile.appUri, profile.appVersion)
    : undefined;
  if (!app) return steps;
  const step = (
    kind: ProfileMigrationStep['kind'],
    path: string,
    ext: AppExtension | ComponentExtension,
    written: string | undefined,
  ) => {
    const method = (ext.metadata as any).staticEvents?.migrateProfile;
    if (method && earlier(written, ext.version))
      steps.push({
        kind,
        path,
        uri: ext.uri,
        version: ext.version,
        ...(written ? { from: written } : {}),
        method,
      });
  };
  step('app', '', app, profile.writtenWith);
  const walk = (
    element: Profile | ProfileComponent,
    slots: ElementComponentMetadataRecord | undefined,
    at: string,
  ) => {
    for (const slot of Object.keys(slots || {})) {
      const component = element.components?.[slot];
      if (!component?.uri) continue;
      const reg = findComponent(component.uri);
      if (!reg) continue;
      const where = `${at}components/${slot}`;
      step('component', where, reg, component.writtenWith);
      walk(component, reg.metadata.components, `${where}/`);
    }
  };
  walk(profile, app.metadata.components, '');
  return steps;
}

/**
 * Runs the classes' own migrateProfile on a profile, in turn: each given
 * its values, its answer taken as them. A sealed secret is a token to it,
 * moved or dropped: one it answers that it was not given is refused. The
 * profile given is not changed.
 */
export async function runProfileMigrations(
  profile: Profile,
  steps: ProfileMigrationStep[],
  classOf: (step: ProfileMigrationStep) => Promise<any> | any,
): Promise<Profile> {
  const out = clone(profile, { deep: 'full' }) as Profile;
  for (const s of steps) {
    const element = elementAt(out, s.path);
    if (!element) continue;
    const ctor = await classOf(s);
    const fn = ctor?.[s.method];
    if (typeof fn !== 'function')
      throw new Error(`${s.uri} ${s.version} has no static ${s.method}`);
    const given = element.values ?? {};
    const answered = await fn.call(ctor, {
      values: clone(given, { deep: 'full' }),
      from: s.from,
      to: s.version,
      path: s.path,
    } satisfies ProfileMigration);
    if (!isRecord(answered))
      throw new Error(
        `${s.uri} ${s.version}: ${s.method} answered no values, an object`,
      );
    const had = new Set(secretsIn(given));
    const made = secretsIn(answered).filter(t => !had.has(t));
    if (made.length)
      throw new Error(
        `${s.uri} ${s.version}: ${s.method} answered a secret it was not given - a sealed secret is moved or dropped, never made or changed`,
      );
    element.values = JSON.parse(JSON.stringify(answered));
  }
  return out;
}

/** The app ("") or a component ("components/a/components/b") of a profile */
function elementAt(
  profile: Profile,
  at: string,
): Profile | ProfileComponent | undefined {
  let element: Profile | ProfileComponent | undefined = profile;
  const parts = at ? at.split('/') : [];
  for (let i = 0; i < parts.length; i += 2)
    element = element?.components?.[parts[i + 1]];
  return element;
}

/** The sealed secrets in values, down objects and lists */
function secretsIn(value: unknown): string[] {
  if (typeof value === 'string')
    return value.startsWith(SECRET_PREFIX) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(secretsIn);
  if (isRecord(value)) return Object.values(value).flatMap(secretsIn);
  return [];
}
