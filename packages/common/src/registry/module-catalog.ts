import type { LocalizedText } from './localized-text.js';
import { DOC_TYPES, DOCS_DIR, isDocsLanguage } from './package-docs.js';

/*
 * How an app or a component is told in the Marketplace: what it is for, in
 * a sentence (its summary), and how it looks (its screenshots, among its
 * documents - not installed). Told by its makers on @App / @Component,
 * checked by spm as it packs and by the registry as it takes the package.
 * Where it is shown - what it does, what it talks to - is not its own to
 * tell: the registry's groups, asked for in Console and decided there.
 */

export const SUMMARY_MAX_LENGTH = 160;
export const SCREENSHOTS_MAX = 8;

/** A summary as told: one in the package's docs language, or one per language */
export type ModuleSummary = LocalizedText;

/** What the Marketplace is told of a module, as its makers wrote it */
export interface ModuleCatalogInput {
  className: string;
  summary?: ModuleSummary;
  screenshots?: string[];
}

/** What is kept of it: its summary by language, its screenshots' paths */
export interface ModuleCatalog {
  summary?: Record<string, string>;
  screenshots?: string[];
}

/**
 * A module's Marketplace fields checked, and made what is kept: its
 * summary by language (one alone, in the package's docs language), its
 * screenshots as paths in the package (docs/<ClassName>/...), each among
 * its documents. Problems told, none thrown: spm and the registry tell
 * them their own way.
 */
export function checkModuleCatalog(
  input: ModuleCatalogInput,
  context: {
    /** The package's docs language */
    docsLanguage: string;
    /** A file is among the package's documents */
    hasDoc: (file: string) => boolean;
  },
): { catalog: ModuleCatalog; problems: string[] } {
  const problems: string[] = [];
  const catalog: ModuleCatalog = {};
  const name = input.className;

  if (input.summary !== undefined) {
    const told: Record<string, unknown> =
      typeof input.summary === 'string'
        ? { [context.docsLanguage]: input.summary }
        : input.summary && typeof input.summary === 'object'
          ? input.summary
          : {};
    if (typeof input.summary !== 'string' && !Object.keys(told).length)
      problems.push(
        `${name}'s summary is a sentence, or one per language: { en: '...', tr: '...' }`,
      );
    const summary: Record<string, string> = {};
    for (const [language, text] of Object.entries(told)) {
      if (!isDocsLanguage(language)) {
        problems.push(
          `${name}'s summary is told in "${language}", not a language: en, tr, pt-BR...`,
        );
        continue;
      }
      if (typeof text !== 'string' || !text.trim()) {
        problems.push(`${name}'s summary in ${language} is empty`);
        continue;
      }
      const sentence = text.trim().replace(/\s+/g, ' ');
      if (sentence.length > SUMMARY_MAX_LENGTH) {
        problems.push(
          `${name}'s summary in ${language} is ${sentence.length} characters: ${SUMMARY_MAX_LENGTH} at most, a sentence`,
        );
        continue;
      }
      summary[language] = sentence;
    }
    if (Object.keys(summary).length) catalog.summary = summary;
  }

  if (input.screenshots !== undefined) {
    const own = `${DOCS_DIR}/${name}/`;
    const screenshots: string[] = [];
    for (const shot of input.screenshots) {
      /* Told within its own documents' folder, or as a path in the package */
      const file =
        typeof shot === 'string'
          ? shot.startsWith(own)
            ? shot
            : own + shot.replace(/^\.?\//, '')
          : '';
      if (!file.startsWith(own) || file.includes('..')) {
        problems.push(
          `${name}'s screenshot ${String(shot)} is not in ${own}: its own documents`,
        );
        continue;
      }
      const type = DOC_TYPES[extensionOf(file)];
      if (type?.kind !== 'image') {
        problems.push(
          `${name}'s screenshot ${file} is not an image: PNG, JPEG, GIF, WebP or SVG`,
        );
        continue;
      }
      if (!context.hasDoc(file)) {
        problems.push(
          `${name}'s screenshot ${file} is not among the package's documents`,
        );
        continue;
      }
      screenshots.push(file);
    }
    if (screenshots.length > SCREENSHOTS_MAX)
      problems.push(
        `${name} tells ${screenshots.length} screenshots: ${SCREENSHOTS_MAX} at most`,
      );
    else if (screenshots.length)
      catalog.screenshots = [...new Set(screenshots)];
  }

  return { catalog, problems };
}

/** A file's extension, lower-cased: ".png" */
function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}
