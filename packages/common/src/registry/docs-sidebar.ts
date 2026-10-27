import { SbError } from '../classes/sb-error.js';
import type { LocalizedText } from './localized-text.js';
import {
  CLASS_DIR_PATTERN,
  DOCS_DIR,
  isDocsLanguage,
  README_FILE,
} from './package-docs.js';

/**
 * How a package's documents are listed, where its author tells it: a
 * sidebar.json in docs/ (the package's own) or in docs/<ClassName>/ (an
 * app's, component's or plugin's). Without one they are listed by their
 * front matter's order and titles.
 *
 *   {
 *     "items": [
 *       "README.md",
 *       { "doc": "user-guide.pdf",
 *         "title": { "tr": "Kullanım kılavuzu", "en": "User guide" } },
 *       { "label": { "tr": "Ağ", "en": "Network" },
 *         "items": ["network.md", "firewall.md"] }
 *     ]
 *   }
 *
 * A document is named as it is in the package's own language, from where
 * the sidebar is - its languages are found by its name (network.md for
 * network.tr.md). A title is text, or text by language. A document not
 * listed is read by a link to it alone.
 *
 * A module's sidebar may list documents beyond its directory, shared by
 * the modules listing them: "../shared/setup.md". Listed by one, a
 * document of no module's directory is that module's - not the package's
 * own, unless the package's sidebar lists it too. A README.md it lists is
 * its page, when it has none of its own; it lists one at most. The
 * package's sidebar lists none of a module's directory.
 */
export const SIDEBAR_FILE = 'sidebar.json';

/** Text, or text by language: { "tr": "Ağ", "en": "Network" } */
export type SidebarText = LocalizedText;

/** An item of a sidebar, as its author writes it */
export type SidebarItemSource =
  | string
  | { doc: string; title?: SidebarText }
  | { label: SidebarText; items: SidebarItemSource[] };

/** An item of a sidebar as kept: each document by its path in the package */
export type SidebarItem =
  | { doc: string; title?: SidebarText }
  | { label: SidebarText; items: SidebarItem[] };

/** A sidebar as kept: its items, each document by its path in the package */
export interface DocsSidebar {
  items: SidebarItem[];
}

/** Categories within categories, at most */
const MAX_DEPTH = 3;

/**
 * Whose a sidebar is, by its path in the package: '' for docs/sidebar.json
 * (the package's own), the class for docs/<ClassName>/sidebar.json; none
 * if it is not where a sidebar may be
 */
export function sidebarOwner(file: string): string | undefined {
  const parts = file.split('/');
  if (parts[0] !== DOCS_DIR || parts[parts.length - 1] !== SIDEBAR_FILE) return;
  if (parts.length === 2) return '';
  if (parts.length === 3 && CLASS_DIR_PATTERN.test(parts[1])) return parts[1];
}

/**
 * Reads a sidebar: what its author wrote, each document found among `docs`
 * - the paths, in the package's own language, the package's documents are
 * read by (docs/Gw/network.md, for network.md and network.tr.md alike).
 * Throws, telling every problem, when it is not one.
 */
export function parseSidebar(
  file: string,
  source: unknown,
  docs: ReadonlySet<string>,
): DocsSidebar {
  const owner = sidebarOwner(file);
  if (owner === undefined)
    throw new SbError(
      `${file}: a sidebar is ${DOCS_DIR}/${SIDEBAR_FILE} or ${DOCS_DIR}/<ClassName>/${SIDEBAR_FILE}`,
    );
  const dir = owner ? `${DOCS_DIR}/${owner}` : DOCS_DIR;
  const errors: string[] = [];
  const listed = new Set<string>();

  const text = (value: unknown, at: string): SidebarText | undefined => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value);
      const bad = entries.filter(
        ([lang, t]) =>
          !isDocsLanguage(lang) || typeof t !== 'string' || !t.trim(),
      );
      if (entries.length && !bad.length)
        return Object.fromEntries(entries.map(([l, t]) => [l, t.trim()]));
    }
    errors.push(
      `${at}: text, or text by language ({ "tr": "...", "en": "..." })`,
    );
  };

  const doc = (name: unknown, at: string): string | undefined => {
    if (typeof name !== 'string' || !name) {
      errors.push(`${at}: a document's name, from where the sidebar is`);
      return;
    }
    const parts = dir.split('/');
    for (const part of name.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    if (!path.startsWith(DOCS_DIR + '/')) {
      errors.push(
        `${at}: "${name}" goes out of ${DOCS_DIR}/ - a sidebar lists the package's documents`,
      );
      return;
    }
    if (!owner && isModuleDoc(path)) {
      errors.push(
        `${at}: "${name}" is a module's - the package's sidebar lists its own documents`,
      );
      return;
    }
    if (!docs.has(path)) {
      errors.push(
        `${at}: "${name}" is not a document of the package - named as in its own language, without one (network.md, not network.tr.md)`,
      );
      return;
    }
    if (listed.has(path)) {
      errors.push(`${at}: "${name}" is listed twice`);
      return;
    }
    listed.add(path);
    return path;
  };

  const items = (value: unknown, at: string, depth: number): SidebarItem[] => {
    if (!Array.isArray(value)) {
      errors.push(`${at}: a list of items`);
      return [];
    }
    const out: SidebarItem[] = [];
    value.forEach((item, i) => {
      const here = `${at}[${i}]`;
      if (typeof item === 'string') {
        const path = doc(item, here);
        if (path) out.push({ doc: path });
        return;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`${here}: a document's name, or an object`);
        return;
      }
      const keys = Object.keys(item);
      if ('doc' in item) {
        const unknown = keys.filter(k => k !== 'doc' && k !== 'title');
        if (unknown.length)
          errors.push(`${here}: "${unknown.join('", "')}" is not read`);
        const path = doc(item.doc, `${here}.doc`);
        const title =
          item.title === undefined
            ? undefined
            : text(item.title, `${here}.title`);
        if (path) out.push(title ? { doc: path, title } : { doc: path });
      } else if ('label' in item) {
        const unknown = keys.filter(k => k !== 'label' && k !== 'items');
        if (unknown.length)
          errors.push(`${here}: "${unknown.join('", "')}" is not read`);
        if (depth >= MAX_DEPTH)
          errors.push(`${here}: categories go ${MAX_DEPTH} deep at most`);
        const label = text(item.label, `${here}.label`);
        const inner = items(item.items, `${here}.items`, depth + 1);
        if (label) out.push({ label, items: inner });
      } else
        errors.push(
          `${here}: a document ("doc") or a category ("label" and "items")`,
        );
    });
    return out;
  };

  let result: SidebarItem[] = [];
  if (!source || typeof source !== 'object' || Array.isArray(source))
    errors.push(`${file}: an object, its "items" listed`);
  else {
    const unknown = Object.keys(source).filter(k => k !== 'items');
    if (unknown.length)
      errors.push(`${file}: "${unknown.join('", "')}" is not read`);
    result = items((source as { items?: unknown }).items, `${file}: items`, 0);
  }
  /* A module's page: one README, its own or one it takes */
  const readmes = [...listed].filter(p => p.endsWith('/' + README_FILE));
  if (owner && readmes.length > 1)
    errors.push(
      `${file}: ${readmes.join(', ')} - a module has one ${README_FILE}, its page: list one`,
    );
  if (errors.length) throw new SbError(errors.join('\n'));
  return { items: result };
}

/** A path in docs/ that is a module's: in docs/<ClassName>/ */
function isModuleDoc(path: string) {
  const parts = path.split('/');
  return parts.length > 2 && CLASS_DIR_PATTERN.test(parts[1]);
}

/** The documents a sidebar lists, by their paths */
export function sidebarDocs(sidebar: DocsSidebar): string[] {
  const out: string[] = [];
  const walk = (items: SidebarItem[]) => {
    for (const item of items)
      if ('doc' in item) out.push(item.doc);
      else walk(item.items);
  };
  walk(sidebar.items);
  return out;
}
