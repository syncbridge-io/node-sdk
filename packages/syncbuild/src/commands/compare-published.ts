import type {
  ElementComponentMetadataRecord,
  VariableMetadata,
  VariableMetadataRecord,
} from '@syncbridge/common';
import semver from 'semver';
import { credentialsOf } from '../registry/credentials.js';
import { RegistryError, registryFetch } from '../registry/registry-client.js';
import { anonymousFetch } from './view-package.js';

/** An app's or a component's definition, as a manifest lists it */
export interface ElementDefinition {
  classType: string;
  className: string;
  formerly?: string[];
  variables?: VariableMetadataRecord;
  components?: ElementComponentMetadataRecord;
}

export interface ComparedResult {
  errors: string[];
  warnings: string[];
}

/**
 * What a version changes of its package's last published one that a
 * profile written for that one cannot be carried across, with nothing
 * declared to carry it (profile-migration.md): a class, a slot, a setting
 * or a choice gone, a setting or a slot newly required with no default -
 * an error in a version that is not a major, told in a major. What is
 * declared is checked too: a former name still in use is an error.
 */
export function compareMetadata(
  previous: ElementDefinition[],
  current: ElementDefinition[],
  options: { major: boolean },
): ComparedResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const breaking = (message: string) =>
    (options.major ? warnings : errors).push(message);
  const elements = current.filter(
    e => e.classType === 'app' || e.classType === 'component',
  );
  const byName = new Map(elements.map(e => [e.className, e]));

  for (const element of elements)
    for (const old of element.formerly || [])
      if (byName.has(old))
        errors.push(
          `${element.className}: formerly "${old}", a class of the package still`,
        );

  for (const before of previous) {
    if (before.classType !== 'app' && before.classType !== 'component')
      continue;
    const now =
      byName.get(before.className) ??
      elements.find(e => e.formerly?.includes(before.className));
    if (!now) {
      breaking(
        `${before.className}: no longer in the package - a worker taking it cannot be carried; declare its new name with formerly`,
      );
      continue;
    }
    compareVariables(
      before.variables,
      now.variables,
      now.className,
      breaking,
      errors,
    );
    compareSlots(before.components, now.components, now.className, breaking);
    /* Its slots' settings, as it overrides them */
    for (const [slot, def] of Object.entries(now.components || {})) {
      const was =
        before.components?.[slot] ?? findFormer(before.components, def);
      compareVariables(
        was?.variables,
        def.variables,
        `${now.className}.${slot}`,
        breaking,
        errors,
        true,
      );
    }
  }
  return { errors, warnings };
}

/** The previous slot or setting a renamed one was */
function findFormer<T>(
  record: Record<string, T> | undefined,
  def: { formerly?: string[] },
): T | undefined {
  const name = def.formerly?.find(n => record?.[n]);
  return name ? record![name] : undefined;
}

function compareSlots(
  before: ElementComponentMetadataRecord | undefined,
  now: ElementComponentMetadataRecord | undefined,
  at: string,
  breaking: (message: string) => void,
) {
  const taken = new Set<string>();
  for (const [slot, def] of Object.entries(now || {})) {
    const was = before?.[slot] ? slot : def.formerly?.find(n => before?.[n]);
    if (was) taken.add(was);
    else if (def.required)
      breaking(
        `${at}.${slot}: a component newly required - a worker written before has none`,
      );
  }
  for (const slot of Object.keys(before || {}))
    if (!taken.has(slot))
      breaking(
        `${at}.${slot}: a component slot no longer there - declare its new name with formerly`,
      );
}

function compareVariables(
  before: VariableMetadataRecord | undefined,
  now: VariableMetadataRecord | undefined,
  at: string,
  breaking: (message: string) => void,
  errors: string[],
  overrides = false,
) {
  const taken = new Set<string>();
  for (const [name, def] of Object.entries(now || {})) {
    if (!def) continue;
    const where = `${at}.${name}`;
    for (const old of def.formerly || [])
      if (now![old])
        errors.push(`${where}: formerly "${old}", a setting still`);
    const wasName = before?.[name]
      ? name
      : def.formerly?.find(n => before?.[n]);
    const was = wasName ? before![wasName] : undefined;
    if (wasName) taken.add(wasName);
    for (const old of Object.keys(def.formerlyValues || {}))
      if ((def.enumValues || []).map(String).includes(old))
        errors.push(`${where}: formerlyValues "${old}", a choice still`);
    if (overrides) continue;
    if (
      def.required &&
      def.default === undefined &&
      !(was?.required && was.default === undefined)
    )
      breaking(
        `${where}: ${was ? 'made required' : 'a setting newly required'} with no default - a worker written before has no value for it`,
      );
    if (was) compareChoices(was, def, where, breaking);
    if (was?.variables || def.variables)
      compareVariables(was?.variables, def.variables, where, breaking, errors);
  }
  if (overrides) return;
  for (const name of Object.keys(before || {}))
    if (!taken.has(name))
      breaking(
        `${at}.${name}: a setting no longer there - its values are dropped; declare its new name with formerly`,
      );
}

function compareChoices(
  was: VariableMetadata,
  now: VariableMetadata,
  where: string,
  breaking: (message: string) => void,
) {
  const values = (now.enumValues || []).map(String);
  const renamed = now.formerlyValues || {};
  if (!now.enumValues || now.enumStrict === false || !was.enumValues) return;
  for (const old of was.enumValues.map(String))
    if (!values.includes(old) && !(old in renamed))
      breaking(
        `${where}: choice "${old}" no longer there - declare what it is now with formerlyValues`,
      );
}

/** The version a package's last published one is to this one: a major */
export function isMajorChange(previous: string, version: string): boolean {
  const a = semver.parse(previous);
  const b = semver.parse(version);
  if (!a || !b) return false;
  if (b.major !== a.major) return b.major > a.major;
  /* 0.x: a minor is as a major */
  return b.major === 0 && b.minor > a.minor;
}

/**
 * The definitions of the package's last published version - its apps
 * and components, as the registry keeps them - as whoever publishes it
 * sees them: its signed-in user, else anybody. None when it is not
 * published, or not to be seen.
 */
export async function publishedDefinitions(
  registry: string,
  name: string,
): Promise<{ version: string; definitions: ElementDefinition[] } | undefined> {
  const signedIn = !!credentialsOf(registry);
  const get = (p: string) =>
    signedIn
      ? registryFetch(registry, p).catch(e => {
          if (e instanceof RegistryError && e.status === 404) return undefined;
          throw e;
        })
      : anonymousFetch(registry, p);
  const listed = await get(`registry/pkg/${name}/ext`);
  if (!listed) return;
  const records = ((await listed.json()) as { payload?: any[] }).payload || [];
  const elements = records.filter(
    r => r.classType === 'app' || r.classType === 'component',
  );
  if (!elements.length) return;
  const definitions: ElementDefinition[] = [];
  for (const record of elements) {
    const resp = await get(
      `registry/pkg/${name}/ext/${encodeURIComponent(record.className)}`,
    );
    const rec = resp ? ((await resp.json()) as any) : undefined;
    if (rec?.definition)
      definitions.push({
        ...rec.definition,
        classType: record.classType,
        className: record.className,
      });
  }
  const version = elements
    .map(r => r.version as string)
    .filter(v => semver.valid(v))
    .sort(semver.rcompare)[0];
  return version ? { version, definitions } : undefined;
}
