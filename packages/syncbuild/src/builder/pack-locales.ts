import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  isDocsLanguage,
  type LocalizedText,
  toSbextName,
} from '@syncbridge/common';
import * as jsonc from 'jsonc-parser';
import { findWorkspacePackage } from '../workspace.js';

/*
 * A package's texts in other languages, kept out of its code: locales/
 * <language>.json at its root, by the class they are of -
 *
 *   { "HL7Client": { "displayName": "HL7 İstemcisi", "description": "...",
 *     "summary": "...", "variables": { "host": { "label": "Sunucu" },
 *     "tls.cert": { "label": "Sertifika" } } } }
 *
 * taken into its manifest as it is packed: each text its code tells - in
 * the package's own language - becomes text by language, the others' added
 * ({ en: 'HL7 Client', tr: 'HL7 İstemcisi' }). A plugin's name is its
 * `title`.
 *
 * A class built on another's - a base class, a class of settings - takes
 * its texts with "@extends": "<ClassName>", or "@vendor/name:<ClassName>"
 * for one of a registry dependency, as a class or as a group of settings:
 *
 *   { "GeDashApp": { "@extends": "@abisena/iomt-common:IomtBaseApp",
 *     "variables": { "channels": { "@extends":
 *     "@abisena/iomt-common:TestConfigurationVariables" } } } }
 *
 * A class's component slots are told by their names, a slot within one by
 * its dotted path: { "components": { "hl7Client": { "description": ...
 * } } }.
 *
 * Its dashboards by their names; in each, its sections and widgets by id,
 * a widget's columns by field and its chart's series by name:
 *
 *   { "dashboards": { "monitor": { "title": "Monitör",
 *     "sections": { "beds": { "title": "Yataklar" } },
 *     "widgets": { "traffic": { "title": "Trafik", "unit": "B/sn",
 *       "series": { "rx": "Alınan" } },
 *       "devices": { "columns": { "seen": "Son görülme" } } } } } }
 *
 * A column with no title, a series with no label, is named by its field
 * or its name in the package's language.
 *
 * The base's texts first - all but its name - then its own over them. So a
 * file may tell the texts of what the package exports for others to build
 * on: its abstract classes, its classes of settings. locales/ is packed
 * with each "@extends" taken in, for the packages built on it.
 */

/** Where a package's translations are */
export const LOCALES_DIR = 'locales';

/** What a class takes its texts from */
const EXTENDS = '@extends';

/** The texts of an element a locale file tells */
const ELEMENT_TEXTS = ['displayName', 'description', 'summary'] as const;
const PLUGIN_TEXTS = ['title', 'description'] as const;
const VARIABLE_TEXTS = ['label', 'description'] as const;
const DASHBOARD_TEXTS = ['title', 'description'] as const;
/** What a class built on another does not take of it: its own name */
const NOT_INHERITED = ['displayName', 'title'];

interface Element {
  className: string;
  variables?: Record<string, any>;
  dashboards?: Record<string, any>;
  settings?: Record<string, any>;
  [key: string]: any;
}

interface Manifest {
  apps?: Element[];
  components?: Element[];
  plugins?: Element[];
  dependencies?: Record<string, string>;
}

/** A class's texts in one language, its "@extends" taken in */
interface Texts {
  fields: Record<string, string>;
  /** By the settings' dotted paths */
  variables: Record<string, Record<string, string>>;
  /** By the component slots' dotted paths */
  components: Record<string, Record<string, string>>;
  /**
   * By dashboard texts' paths: "monitor", "monitor.sections.beds",
   * "monitor.widgets.traffic", its ".columns" and ".series"
   */
  dashboards: Record<string, Record<string, string>>;
}

/** The texts of a component slot a locale file tells */
const SLOT_TEXTS = ['description'] as const;

const noTexts = (): Texts => ({
  fields: {},
  variables: {},
  components: {},
  dashboards: {},
});

export interface PackLocalesOptions {
  /**
   * What the package exports that is not in its manifest, by class name:
   * its abstract apps and components, its classes of settings - a file
   * may tell their texts, for the classes built on them
   */
  bases?: Map<string, LocaleBase>;
  /** Where a registry dependency is, to read its locales/; else found */
  dependencyDir?: (name: string) => string | undefined;
}

/** A class a file may tell the texts of, not in the manifest */
export interface LocaleBase {
  /** An abstract app or component, or a class of settings alone */
  kind: 'class' | 'variables';
  variables?: Record<string, any>;
  /** Its component slots: an abstract app's or component's */
  components?: Record<string, any>;
  /** Its dashboards: an abstract app's or component's */
  dashboards?: Record<string, any>;
}

export interface PackedLocales {
  errors: string[];
  /** Each language's file as packed: by class, "@extends" taken in */
  files: Record<string, Record<string, any>>;
}

/**
 * Takes the package's locales/ into its manifest's apps, components and
 * plugins. What is wrong - a file not of a language, a class or a setting
 * the package has not, a text not text, an "@extends" not found - told as
 * errors; what a language lacks of what the code tells, as one warning a
 * language.
 */
export function packLocales(
  packageDir: string,
  manifest: Manifest,
  /** The package's own language: what its code tells is in */
  language: string,
  warn: (message: string) => void,
  options?: PackLocalesOptions,
): PackedLocales {
  const dir = path.join(packageDir, LOCALES_DIR);
  const packed: PackedLocales = { errors: [], files: {} };
  if (!fs.existsSync(dir)) return packed;
  const { errors } = packed;
  const elements = new Map<string, { element: Element; plugin: boolean }>();
  for (const e of [...(manifest.apps ?? []), ...(manifest.components ?? [])])
    elements.set(e.className, { element: e, plugin: false });
  for (const p of manifest.plugins ?? [])
    elements.set(p.className, { element: p, plugin: true });
  const bases = options?.bases ?? new Map();
  const dependencyDir =
    options?.dependencyDir ?? (name => registryPackageDir(name, packageDir));

  const files = fs
    .readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .sort();
  for (const file of files) {
    const at = `${LOCALES_DIR}/${file}`;
    const lang = file.replace(/\.json$/, '');
    if (!file.endsWith('.json') || !isDocsLanguage(lang)) {
      errors.push(
        `${at} is not a language's: locales/<language>.json - tr.json, pt-BR.json`,
      );
      continue;
    }
    if (lang === language) {
      errors.push(
        `${at} is in "${language}", the package's own language: its code tells those texts`,
      );
      continue;
    }
    const texts = readLocale(path.join(dir, file));
    if (!texts) {
      errors.push(`${at} is not a JSON object, by class name`);
      continue;
    }
    const resolver = new Resolver(
      lang,
      texts,
      dependencyDir,
      manifest,
      className => elements.has(className) || bases.has(className),
    );
    const out: Record<string, any> = {};
    const missing: string[] = [];
    /* A base's text where the class's code tells none: not taken */
    const leftOut: string[] = [];
    for (const [className, told] of Object.entries(texts)) {
      const found = elements.get(className);
      const base = bases.get(className);
      if (!found && !base) {
        errors.push(`${at}: "${className}" is not a class of the package`);
        continue;
      }
      if (!isMap(told)) {
        errors.push(`${at}: ${className}'s texts are an object`);
        continue;
      }
      const plugin = !!found?.plugin;
      /* A class of settings has its settings' texts alone */
      const fields: readonly string[] = plugin
        ? PLUGIN_TEXTS
        : base?.kind === 'variables'
          ? []
          : ELEMENT_TEXTS;
      const variables = found
        ? plugin
          ? found.element.settings
          : found.element.variables
        : base!.variables;
      /* An app's or a component's slots: a plugin and a class of settings
       * have none */
      const slots = plugin
        ? undefined
        : found
          ? found.element.components
          : base!.components;
      const hasSlots = !plugin && base?.kind !== 'variables';
      const dashboards = found ? found.element.dashboards : base!.dashboards;
      /* Its own: checked against the class */
      for (const [key, value] of Object.entries(told)) {
        if (key === 'variables' || key === EXTENDS) continue;
        if ((key === 'components' || key === 'dashboards') && hasSlots)
          continue;
        if (!fields.includes(key)) {
          errors.push(
            `${at}: ${className}'s "${key}" is not a text of it: ${[...fields, 'variables', ...(hasSlots ? ['components', 'dashboards'] : []), EXTENDS].join(', ')}`,
          );
          continue;
        }
        if (!isText(value))
          errors.push(`${at}: ${className}'s ${key} is empty, or not text`);
      }
      if (told[EXTENDS] !== undefined && !isText(told[EXTENDS]))
        errors.push(`${at}: ${className}'s ${EXTENDS} names no class`);
      if (told.variables !== undefined && !isMap(told.variables)) {
        errors.push(
          `${at}: ${className}'s variables are an object, by setting`,
        );
        continue;
      }
      for (const [setting, vt] of Object.entries<any>(told.variables ?? {})) {
        if (!variableAt(variables, setting)) {
          errors.push(`${at}: ${className} has no setting "${setting}"`);
          continue;
        }
        if (!isMap(vt)) {
          errors.push(`${at}: ${className}'s ${setting} texts are an object`);
          continue;
        }
        for (const [key, value] of Object.entries(vt)) {
          if (key === EXTENDS) {
            if (!isText(value))
              errors.push(
                `${at}: ${className}'s ${setting} ${EXTENDS} names no class`,
              );
            continue;
          }
          if (!(VARIABLE_TEXTS as readonly string[]).includes(key)) {
            errors.push(
              `${at}: ${className}'s ${setting} "${key}" is not a text of it: label, description, ${EXTENDS}`,
            );
            continue;
          }
          if (!isText(value))
            errors.push(
              `${at}: ${className}'s ${setting} ${key} is empty, or not text`,
            );
        }
      }

      if (hasSlots && told.components !== undefined) {
        if (!isMap(told.components))
          errors.push(
            `${at}: ${className}'s components are an object, by component`,
          );
        else
          for (const [slot, st] of Object.entries<any>(told.components)) {
            if (!slotAt(slots, slot)) {
              errors.push(`${at}: ${className} has no component "${slot}"`);
              continue;
            }
            if (!isMap(st)) {
              errors.push(
                `${at}: ${className}'s ${slot} component texts are an object`,
              );
              continue;
            }
            for (const [key, value] of Object.entries(st)) {
              if (!(SLOT_TEXTS as readonly string[]).includes(key)) {
                errors.push(
                  `${at}: ${className}'s ${slot} component "${key}" is not a text of it: ${SLOT_TEXTS.join(', ')}`,
                );
                continue;
              }
              if (!isText(value))
                errors.push(
                  `${at}: ${className}'s ${slot} component ${key} is empty, or not text`,
                );
            }
          }
      }

      if (hasSlots && told.dashboards !== undefined) {
        const flat = flatDashboards(told.dashboards, `${className}'s`);
        errors.push(...flat.errors.map(e => `${at}: ${e}`));
        for (const [p, toldTexts] of Object.entries(flat.texts)) {
          const textSlots = dashboardSlots(dashboards, p);
          if (!textSlots) {
            errors.push(
              `${at}: ${className} has no dashboard ${dashboardWhat(p)}`,
            );
            continue;
          }
          for (const [key, value] of Object.entries(toldTexts)) {
            if (!textSlots[key]) {
              errors.push(
                `${at}: ${className}'s dashboard ${dashboardWhat(p)} "${key}" is not a text of it: ${Object.keys(textSlots).join(', ')}`,
              );
              continue;
            }
            if (!isText(value))
              errors.push(
                `${at}: ${className}'s dashboard ${dashboardWhat(p)} ${key} is empty, or not text`,
              );
          }
        }
      }

      /* With what it extends: the base's first, its own over them */
      const resolved = resolver.resolve('', className);
      errors.push(...resolver.errors.splice(0).map(e => `${at}: ${e}`));
      out[className] = packedTexts(resolved);
      if (!found) continue;
      const { element } = found;
      /*
       * A text the file tells of the class itself: taken, the code telling
       * it or not. One of what it extends: only where the code tells it -
       * else a text in this language alone, none in the package's own
       */
      const take = (
        target: Record<string, any>,
        key: string,
        value: string,
        own: unknown,
        what: string,
      ) => {
        if (isText(own) || target[key] !== undefined)
          target[key] = withLanguage(target[key], language, lang, value);
        else leftOut.push(`${className}${what} ${key}`);
      };
      for (const [key, value] of Object.entries(resolved.fields))
        if (fields.includes(key)) take(element, key, value, told[key], '');
      /* What a base tells of a setting the class has not: left */
      for (const [setting, vt] of Object.entries(resolved.variables)) {
        const variable = variableAt(variables, setting);
        if (!variable) continue;
        for (const [key, value] of Object.entries(vt))
          take(
            variable,
            key,
            value,
            told.variables?.[setting]?.[key],
            `'s ${setting}`,
          );
      }
      /* Likewise a dashboard's text: a column's, a series', named by its
       * field or name where the code tells no text */
      const toldDashboards = isMap(told.dashboards)
        ? flatDashboards(told.dashboards, '').texts
        : {};
      for (const [p, dt] of Object.entries(resolved.dashboards)) {
        const textSlots = dashboardSlots(dashboards, p);
        if (!textSlots) continue;
        for (const [key, value] of Object.entries(dt)) {
          const slot = textSlots[key];
          if (!slot) continue;
          if (slot.own !== undefined || isText(toldDashboards[p]?.[key]))
            slot.set(withLanguage(slot.own, language, lang, value));
          else leftOut.push(`${className}'s dashboard ${p} ${key}`);
        }
      }
      /* Likewise a slot */
      for (const [slotPath, st] of Object.entries(resolved.components)) {
        const slot = slotAt(slots, slotPath);
        if (!slot) continue;
        for (const [key, value] of Object.entries(st))
          take(
            slot,
            key,
            value,
            told.components?.[slotPath]?.[key],
            `'s ${slotPath} component`,
          );
      }
    }
    if (leftOut.length)
      warn(
        `${at}: ${leftOut.length} text${leftOut.length > 1 ? 's' : ''} of what a class extends left out, its code telling none in ${language}: ` +
          leftOut.slice(0, 8).join(', ') +
          (leftOut.length > 8 ? `, and ${leftOut.length - 8} more` : ''),
      );
    packed.files[lang] = out;
    /* What the code tells that this language has not */
    for (const [className, { element, plugin }] of elements) {
      const fields = plugin ? PLUGIN_TEXTS : ELEMENT_TEXTS;
      for (const key of fields)
        if (lacks(element[key], lang)) missing.push(`${className} ${key}`);
      walkVariables(plugin ? element.settings : element.variables, (p, v) => {
        for (const key of VARIABLE_TEXTS)
          if (lacks(v[key], lang)) missing.push(`${className}'s ${p} ${key}`);
      });
      if (!plugin) {
        walkSlots(element.components, (p, slot) => {
          for (const key of SLOT_TEXTS)
            if (lacks(slot[key], lang))
              missing.push(`${className}'s ${p} component ${key}`);
        });
        walkDashboardTexts(element.dashboards, (p, key, text) => {
          if (lacks(text, lang))
            missing.push(`${className}'s dashboard ${p} ${key}`);
        });
      }
    }
    if (missing.length)
      warn(
        `${at} lacks ${missing.length} text${missing.length > 1 ? 's' : ''}, shown in ${language} meanwhile: ` +
          missing.slice(0, 8).join(', ') +
          (missing.length > 8 ? `, and ${missing.length - 8} more` : ''),
      );
  }
  return packed;
}

/**
 * The texts of classes in one language, their "@extends" taken in: of
 * the package's own file, and of its registry dependencies' locales/ -
 * each read once
 */
class Resolver {
  readonly errors: string[] = [];
  private readonly _files = new Map<string, Record<string, any> | undefined>();
  private readonly _done = new Map<string, Texts>();

  constructor(
    private readonly _lang: string,
    own: Record<string, any>,
    private readonly _dependencyDir: (name: string) => string | undefined,
    private readonly _manifest: Manifest,
    /** A class of the package: one with no texts in the file is no error */
    private readonly _known: (className: string) => boolean,
  ) {
    this._files.set('', own);
  }

  /** A class's texts: of the package (''), or of a registry dependency */
  resolve(pkg: string, className: string, stack: string[] = []): Texts {
    const key = `${pkg}:${className}`;
    const done = this._done.get(key);
    if (done) return done;
    const out = noTexts();
    if (stack.includes(key)) {
      this.errors.push(
        `${EXTENDS} goes round: ${[...stack, key].map(k => k.replace(/^:/, '')).join(' -> ')}`,
      );
      return out;
    }
    const told = this._fileOf(pkg)?.[className];
    if (!isMap(told)) {
      if (pkg === '' && stack.length && !this._known(className))
        this.errors.push(
          `${EXTENDS} "${className}": not a class of the package`,
        );
      return out;
    }
    const inner = [...stack, key];
    if (isText(told[EXTENDS])) {
      const base = this._ref(told[EXTENDS], pkg, inner);
      for (const [k, v] of Object.entries(base.fields))
        if (!NOT_INHERITED.includes(k)) out.fields[k] = v;
      Object.assign(out.variables, base.variables);
      Object.assign(out.components, base.components);
      for (const [p, t] of Object.entries(base.dashboards))
        out.dashboards[p] = { ...out.dashboards[p], ...t };
    }
    for (const [k, v] of Object.entries(told))
      if (k !== 'variables' && k !== EXTENDS && isText(v)) out.fields[k] = v;
    if (isMap(told.dashboards))
      for (const [p, t] of Object.entries(
        flatDashboards(told.dashboards, '').texts,
      ))
        for (const [k, v] of Object.entries(t))
          if (isText(v)) (out.dashboards[p] ??= {})[k] = v;
    for (const [slot, st] of Object.entries<any>(
      isMap(told.components) ? told.components : {},
    )) {
      if (!isMap(st)) continue;
      for (const [k, v] of Object.entries(st))
        if (isText(v)) (out.components[slot] ??= {})[k] = v;
    }
    for (const [setting, vt] of Object.entries<any>(
      isMap(told.variables) ? told.variables : {},
    )) {
      if (!isMap(vt)) continue;
      /* A group of settings: its settings' texts those of the class named */
      if (isText(vt[EXTENDS])) {
        const group = this._ref(vt[EXTENDS], pkg, inner);
        for (const [p, t] of Object.entries(group.variables))
          out.variables[`${setting}.${p}`] = {
            ...out.variables[`${setting}.${p}`],
            ...t,
          };
      }
      for (const [k, v] of Object.entries(vt))
        if (k !== EXTENDS && isText(v)) (out.variables[setting] ??= {})[k] = v;
    }
    this._done.set(key, out);
    return out;
  }

  /** "Name" of the package `pkg`, or "@vendor/name:Name" of another */
  private _ref(ref: string, pkg: string, stack: string[]): Texts {
    const at = ref.lastIndexOf(':');
    if (at < 0) return this.resolve(pkg, ref, stack);
    const name = ref.slice(0, at);
    const className = ref.slice(at + 1);
    if (pkg === '' && !this._manifest.dependencies?.[name]) {
      this.errors.push(
        `${EXTENDS} "${ref}": ${name} is not among the package's registry dependencies`,
      );
      return noTexts();
    }
    return this.resolve(name, className, stack);
  }

  private _fileOf(pkg: string): Record<string, any> | undefined {
    if (this._files.has(pkg)) return this._files.get(pkg);
    const dir = this._dependencyDir(pkg);
    let texts: Record<string, any> | undefined;
    if (!dir)
      this.errors.push(
        `${EXTENDS}: ${pkg} is not installed - its texts cannot be read`,
      );
    else
      for (const d of [dir, path.join(dir, 'build')]) {
        const file = path.join(d, LOCALES_DIR, `${this._lang}.json`);
        if (fs.existsSync(file)) {
          texts = readLocale(file);
          break;
        }
      }
    this._files.set(pkg, texts);
    return texts;
  }
}

/** A class's texts as packed: "@extends" taken in, settings by path */
function packedTexts(texts: Texts): Record<string, any> {
  return {
    ...texts.fields,
    ...(Object.keys(texts.variables).length
      ? { variables: texts.variables }
      : {}),
    ...(Object.keys(texts.components).length
      ? { components: texts.components }
      : {}),
    ...(Object.keys(texts.dashboards).length
      ? { dashboards: unflatDashboards(texts.dashboards) }
      : {}),
  };
}

/**
 * A file's dashboards' texts by path - "monitor", "monitor.sections.beds",
 * "monitor.widgets.traffic", "monitor.widgets.traffic.columns" - what is
 * not of their shape told
 */
function flatDashboards(
  dashboards: unknown,
  whose: string,
): { texts: Record<string, Record<string, unknown>>; errors: string[] } {
  const texts: Record<string, Record<string, unknown>> = {};
  const errors: string[] = [];
  const of = (p: string) => `${whose} dashboard ${dashboardWhat(p)}`.trim();
  if (!isMap(dashboards)) {
    errors.push(`${whose} dashboards are an object, by dashboard`.trim());
    return { texts, errors };
  }
  const own = (p: string, told: Record<string, any>, nested: string[]) => {
    const t: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(told))
      if (!nested.includes(k)) t[k] = v;
    if (Object.keys(t).length) texts[p] = t;
  };
  for (const [name, d] of Object.entries<any>(dashboards)) {
    if (!isMap(d)) {
      errors.push(`${of(name)}: its texts are an object`);
      continue;
    }
    own(name, d, ['sections', 'widgets']);
    for (const group of ['sections', 'widgets'] as const) {
      if (d[group] === undefined) continue;
      if (!isMap(d[group])) {
        errors.push(`${of(name)}: its ${group} are an object, by id`);
        continue;
      }
      for (const [id, it] of Object.entries<any>(d[group])) {
        const p = `${name}.${group}.${id}`;
        if (!isMap(it)) {
          errors.push(`${of(p)}: its texts are an object`);
          continue;
        }
        own(p, it, group === 'widgets' ? ['columns', 'series'] : []);
        if (group !== 'widgets') continue;
        for (const by of ['columns', 'series'] as const) {
          if (it[by] === undefined) continue;
          if (!isMap(it[by]))
            errors.push(`${of(p)}: its ${by} are an object, by name`);
          else texts[`${p}.${by}`] = { ...it[by] };
        }
      }
    }
  }
  return { texts, errors };
}

/** Dashboards' texts by path, as a file tells them */
function unflatDashboards(
  flat: Record<string, Record<string, string>>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [p, t] of Object.entries(flat)) {
    const [name, group, id, by] = p.split('.');
    const d = (out[name] ??= {});
    if (!group) Object.assign(d, t);
    else {
      const it = ((d[group] ??= {})[id] ??= {});
      if (by) it[by] = { ...it[by], ...t };
      else Object.assign(it, t);
    }
  }
  return out;
}

/** "monitor", widget "traffic" of "monitor", its "columns"... in words */
function dashboardWhat(p: string): string {
  const [name, group, id, by] = p.split('.');
  if (!group) return `"${name}"`;
  const what = `${group === 'sections' ? 'section' : 'widget'} "${id}" of "${name}"`;
  return by ? `${by} of ${what}` : what;
}

/** A text a dashboard's metadata holds: the code's, and where it goes */
interface DashboardSlot {
  own: LocalizedText | undefined;
  set(text: LocalizedText): void;
}

/**
 * The texts a dashboard's path names, by key: a dashboard's, a section's,
 * a widget's - its unit where its code tells one - a widget's columns by
 * field, its series by name. None where the path names nothing
 */
function dashboardSlots(
  dashboards: Record<string, any> | undefined,
  p: string,
): Record<string, DashboardSlot> | undefined {
  const [name, group, id, by] = p.split('.');
  const d = dashboards?.[name];
  if (!isMap(d)) return;
  const fields = (target: Record<string, any>, keys: readonly string[]) =>
    Object.fromEntries(
      keys.map(k => [
        k,
        { own: target[k], set: (t: LocalizedText) => (target[k] = t) },
      ]),
    );
  if (!group) return fields(d, DASHBOARD_TEXTS);
  const list: any[] = Array.isArray(d[group]) ? d[group] : [];
  const it = list.find(x => isMap(x) && x.id === id);
  if (!it || (group !== 'sections' && group !== 'widgets')) return;
  if (group === 'sections') return by ? undefined : fields(it, DASHBOARD_TEXTS);
  const props: Record<string, any> = it.properties ?? {};
  if (!by)
    return {
      ...fields(it, DASHBOARD_TEXTS),
      ...(props.unit !== undefined ? fields(props, ['unit']) : {}),
    };
  if (by === 'columns') {
    const columns: any[] = Array.isArray(props.columns) ? props.columns : [];
    return Object.fromEntries(
      columns
        .filter(c => isMap(c) && typeof c.field === 'string')
        .map(c => [
          c.field,
          {
            own: c.title ?? c.field,
            set: (t: LocalizedText) => (c.title = t),
          },
        ]),
    );
  }
  if (by === 'series') {
    const series: string[] = Array.isArray(it.data?.series)
      ? it.data.series
      : [];
    return Object.fromEntries(
      series.map(s => [
        s,
        {
          own: props.labels?.[s] ?? s,
          set: (t: LocalizedText) =>
            (((it.properties ??= {}).labels ??= {})[s] = t),
        },
      ]),
    );
  }
}

/**
 * Each text a dashboard's code tells, with its path and key: a column's
 * title, a series' label only where told
 */
function walkDashboardTexts(
  dashboards: Record<string, any> | undefined,
  fn: (path: string, key: string, text: LocalizedText) => void,
) {
  const each = (p: string, target: any, keys: readonly string[]) => {
    for (const k of keys) if (target?.[k] !== undefined) fn(p, k, target[k]);
  };
  for (const [name, d] of Object.entries<any>(dashboards ?? {})) {
    if (!isMap(d)) continue;
    each(name, d, DASHBOARD_TEXTS);
    for (const s of Array.isArray(d.sections) ? d.sections : [])
      each(`${name}.sections.${s?.id}`, s, DASHBOARD_TEXTS);
    for (const w of Array.isArray(d.widgets) ? d.widgets : []) {
      const p = `${name}.widgets.${w?.id}`;
      each(p, w, DASHBOARD_TEXTS);
      each(p, w?.properties, ['unit']);
      for (const c of Array.isArray(w?.properties?.columns)
        ? w.properties.columns
        : [])
        if (c?.title !== undefined) fn(`${p}.columns`, c.field, c.title);
      for (const [s, label] of Object.entries<any>(w?.properties?.labels ?? {}))
        fn(`${p}.series`, s, label);
    }
  }
}

/**
 * Where a registry dependency is, as the package's build finds it: a
 * package of the workspace, its sources; else installed - as the npm
 * mirror publishes it, or by its own name
 */
export function registryPackageDir(
  name: string,
  fromDir: string,
): string | undefined {
  const workspace = findWorkspacePackage(name, fromDir);
  if (workspace) return workspace.dir;
  const require = createRequire(path.join(fromDir, 'package.json'));
  for (const n of [toSbextName(name), name]) {
    try {
      return path.dirname(require.resolve(`${n}/package.json`));
    } catch {
      /* Not by this name */
    }
  }
}

function readLocale(file: string): Record<string, any> | undefined {
  const parseErrors: jsonc.ParseError[] = [];
  const texts = jsonc.parse(fs.readFileSync(file, 'utf8'), parseErrors);
  return parseErrors.length || !isMap(texts) ? undefined : texts;
}

const isMap = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === 'string' && !!v.trim();

/**
 * A text with another language's added: a text alone is in the package's
 * own language. None told by the code: the translation alone - a text the
 * file tells of the class itself, not one of what it extends.
 */
function withLanguage(
  text: LocalizedText | undefined,
  own: string,
  lang: string,
  value: string,
): LocalizedText {
  const byLanguage: Record<string, string> =
    text === undefined
      ? {}
      : typeof text === 'string'
        ? { [own]: text }
        : { ...text };
  byLanguage[lang] = value;
  return byLanguage;
}

/** Whether a text told is not told in a language */
function lacks(text: LocalizedText | undefined, lang: string): boolean {
  if (text === undefined) return false;
  if (typeof text === 'string') return true;
  return !text[lang] && !text[lang.split('-')[0]];
}

/** A setting by its dotted path, down groups' settings: "tls.cert" */
function variableAt(
  variables: Record<string, any> | undefined,
  dotted: string,
): Record<string, any> | undefined {
  let at: any = { variables };
  for (const key of dotted.split('.')) {
    at = at?.variables?.[key];
    if (!isMap(at)) return;
  }
  return at;
}

/** A component slot by its dotted path, down the slots within: "server.inner" */
function slotAt(
  components: Record<string, any> | undefined,
  dotted: string,
): Record<string, any> | undefined {
  let at: any = { components };
  for (const key of dotted.split('.')) {
    at = at?.components?.[key];
    if (!isMap(at)) return;
  }
  return at;
}

/** Each component slot, down the slots within, with its dotted path */
function walkSlots(
  components: Record<string, any> | undefined,
  fn: (path: string, slot: Record<string, any>) => void,
  at = '',
) {
  for (const [key, slot] of Object.entries(components ?? {})) {
    if (!isMap(slot)) continue;
    fn(at + key, slot);
    walkSlots(slot.components, fn, `${at}${key}.`);
  }
}

/** Each setting, down groups, with its dotted path */
function walkVariables(
  variables: Record<string, any> | undefined,
  fn: (path: string, variable: Record<string, any>) => void,
  at = '',
) {
  for (const [key, v] of Object.entries(variables ?? {})) {
    if (!isMap(v)) continue;
    fn(at + key, v);
    walkVariables(v.variables, fn, `${at}${key}.`);
  }
}
