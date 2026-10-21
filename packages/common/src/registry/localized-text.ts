import { isDocsLanguage } from './package-docs.js';

/**
 * Text, or text by language: { en: 'Port number', tr: 'Port numarası' }.
 * A text alone is in the package's docs language.
 */
export type LocalizedText = string | Record<string, string>;

/**
 * A text in the language asked for: else in its base language ("pt" for
 * "pt-BR"), else in English, else the first told; a text alone as it is
 */
export function textIn(
  text: LocalizedText | undefined,
  language: string,
): string | undefined {
  if (text === undefined || typeof text === 'string') return text;
  return (
    text[language] ??
    text[language.split('-')[0]] ??
    text.en ??
    Object.values(text)[0]
  );
}

/**
 * What is wrong with a text told by language: a key not a language, a
 * text empty; a text alone, or none, is right
 */
export function localizedTextProblems(text: unknown, what: string): string[] {
  if (text === undefined || (typeof text === 'string' && text.trim()))
    return [];
  if (!text || typeof text !== 'object' || Array.isArray(text))
    return [`${what} is text, or text by language: { en: '...', tr: '...' }`];
  const entries = Object.entries(text);
  if (!entries.length)
    return [`${what} is text, or text by language: { en: '...', tr: '...' }`];
  const problems: string[] = [];
  for (const [language, value] of entries) {
    if (!isDocsLanguage(language))
      problems.push(
        `${what} is told in "${language}", not a language: en, tr, pt-BR...`,
      );
    else if (typeof value !== 'string' || !value.trim())
      problems.push(`${what} in ${language} is empty`);
  }
  return problems;
}

/** The settings of a definition: those of a group under it too */
interface VariableTexts {
  label?: unknown;
  description?: unknown;
  variables?: Record<string, VariableTexts>;
}

/**
 * What is wrong with the labels and descriptions of an app's, a
 * component's or a plugin's settings, those in groups too: each by its
 * path ("ClassName's tls.cert label")
 */
export function variableTextProblems(
  variables: Record<string, VariableTexts> | undefined,
  owner: string,
  at = '',
): string[] {
  const problems: string[] = [];
  for (const [key, v] of Object.entries(variables ?? {})) {
    if (!v || typeof v !== 'object') continue;
    const path = at + key;
    problems.push(
      ...localizedTextProblems(v.label, `${owner}'s ${path} label`),
      ...localizedTextProblems(v.description, `${owner}'s ${path} description`),
      ...variableTextProblems(v.variables, owner, `${path}.`),
    );
  }
  return problems;
}
