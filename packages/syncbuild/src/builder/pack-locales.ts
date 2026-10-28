import fs from 'node:fs';
import path from 'node:path';
import { isDocsLanguage, type LocalizedText } from '@syncbridge/common';
import * as jsonc from 'jsonc-parser';

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
 * `title`. locales/ itself is not packed: the manifest has it all.
 */

/** Where a package's translations are */
export const LOCALES_DIR = 'locales';

/** The texts of an element a locale file tells */
const ELEMENT_TEXTS = ['displayName', 'description', 'summary'] as const;
const PLUGIN_TEXTS = ['title', 'description'] as const;
const VARIABLE_TEXTS = ['label', 'description'] as const;

interface Element {
  className: string;
  variables?: Record<string, any>;
  settings?: Record<string, any>;
  [key: string]: any;
}

interface Manifest {
  apps?: Element[];
  components?: Element[];
  plugins?: Element[];
}

/**
 * Takes the package's locales/ into its manifest's apps, components and
 * plugins. What is wrong - a file not of a language, a class or a setting
 * the package has not, a text not text - told as errors; what a language
 * lacks of what the code tells, as one warning a language.
 */
export function packLocales(
  packageDir: string,
  manifest: Manifest,
  /** The package's own language: what its code tells is in */
  language: string,
  warn: (message: string) => void,
): string[] {
  const dir = path.join(packageDir, LOCALES_DIR);
  if (!fs.existsSync(dir)) return [];
  const errors: string[] = [];
  const elements = new Map<string, { element: Element; plugin: boolean }>();
  for (const e of [...(manifest.apps ?? []), ...(manifest.components ?? [])])
    elements.set(e.className, { element: e, plugin: false });
  for (const p of manifest.plugins ?? [])
    elements.set(p.className, { element: p, plugin: true });

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
    const parseErrors: jsonc.ParseError[] = [];
    const texts = jsonc.parse(
      fs.readFileSync(path.join(dir, file), 'utf8'),
      parseErrors,
    );
    if (parseErrors.length || !isMap(texts)) {
      errors.push(`${at} is not a JSON object, by class name`);
      continue;
    }
    const missing: string[] = [];
    for (const [className, told] of Object.entries(texts)) {
      const found = elements.get(className);
      if (!found) {
        errors.push(`${at}: "${className}" is not a class of the package`);
        continue;
      }
      if (!isMap(told)) {
        errors.push(`${at}: ${className}'s texts are an object`);
        continue;
      }
      const { element, plugin } = found;
      const fields: readonly string[] = plugin ? PLUGIN_TEXTS : ELEMENT_TEXTS;
      for (const [key, value] of Object.entries(told)) {
        if (key === 'variables') continue;
        if (!fields.includes(key)) {
          errors.push(
            `${at}: ${className}'s "${key}" is not a text of it: ${fields.join(', ')}, variables`,
          );
          continue;
        }
        if (!isText(value)) {
          errors.push(`${at}: ${className}'s ${key} is empty, or not text`);
          continue;
        }
        element[key] = withLanguage(element[key], language, lang, value);
      }
      if (told.variables !== undefined) {
        if (!isMap(told.variables)) {
          errors.push(
            `${at}: ${className}'s variables are an object, by setting`,
          );
          continue;
        }
        const variables = plugin ? element.settings : element.variables;
        for (const [setting, vt] of Object.entries(told.variables)) {
          const variable = variableAt(variables, setting);
          if (!variable) {
            errors.push(`${at}: ${className} has no setting "${setting}"`);
            continue;
          }
          if (!isMap(vt)) {
            errors.push(`${at}: ${className}'s ${setting} texts are an object`);
            continue;
          }
          for (const [key, value] of Object.entries(vt)) {
            if (!(VARIABLE_TEXTS as readonly string[]).includes(key)) {
              errors.push(
                `${at}: ${className}'s ${setting} "${key}" is not a text of it: label, description`,
              );
              continue;
            }
            if (!isText(value)) {
              errors.push(
                `${at}: ${className}'s ${setting} ${key} is empty, or not text`,
              );
              continue;
            }
            variable[key] = withLanguage(variable[key], language, lang, value);
          }
        }
      }
    }
    /* What the code tells that this language has not */
    for (const [className, { element, plugin }] of elements) {
      const fields = plugin ? PLUGIN_TEXTS : ELEMENT_TEXTS;
      for (const key of fields)
        if (lacks(element[key], lang)) missing.push(`${className} ${key}`);
      walkVariables(plugin ? element.settings : element.variables, (p, v) => {
        for (const key of VARIABLE_TEXTS)
          if (lacks(v[key], lang)) missing.push(`${className}'s ${p} ${key}`);
      });
    }
    if (missing.length)
      warn(
        `${at} lacks ${missing.length} text${missing.length > 1 ? 's' : ''}, shown in ${language} meanwhile: ` +
          missing.slice(0, 8).join(', ') +
          (missing.length > 8 ? `, and ${missing.length - 8} more` : ''),
      );
  }
  return errors;
}

const isMap = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === 'string' && !!v.trim();

/**
 * A text with another language's added: a text alone is in the package's
 * own language. None told by the code: the translation alone.
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
