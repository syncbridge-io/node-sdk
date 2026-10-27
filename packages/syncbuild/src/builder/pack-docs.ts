import fs from 'node:fs';
import path from 'node:path';
import {
  checkModuleCatalog,
  CLASS_DIR_PATTERN,
  DEFAULT_DOCS_LANGUAGE,
  type DocPath,
  DOCS_DIR,
  DOCS_MAX_TOTAL_BYTES,
  type DocsSidebar,
  isDocContent,
  isDocsLanguage,
  parseDocPath,
  parseSidebar,
  README_FILE,
  SbError,
  SIDEBAR_FILE,
  sidebarDocs,
  sidebarOwner,
  variableTextProblems,
} from '@syncbridge/common';
import colors from 'ansi-colors';
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { visit } from 'unist-util-visit';
import * as yaml from 'yaml';
import type { Context } from '../context.js';

/** A link's scheme, when it has one: it leaves the package */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
/** The schemes a document may link out with */
const SCHEMES_TAKEN = new Set(['http', 'https', 'mailto']);
/** Its front matter: what it is titled, where it is listed */
const FRONT_MATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
/** The largest sidebar.json taken */
const SIDEBAR_MAX_BYTES = 64 * 1024;
/** What front matter tells */
const FRONT_MATTER_FIELDS = new Set(['title', 'order']);

/**
 * Packs the package's documents: docs/ whole, each file at its path (see
 * package-docs in @syncbridge/common). Each app, component and plugin is
 * told its README, docs/<ClassName>/README.md - or, without one, the one
 * its sidebar takes from elsewhere in docs/; one with neither is told of.
 *
 * Refused, all told at once: a file docs/ does not take or larger than its
 * type's limit, all of them larger than theirs; a directory named as a
 * class no extension has (a misspelt name); a document naming the
 * package's own language; front matter that is not a map, a title not
 * text, an order not a number; a link to a file not there, out of docs/,
 * or with a scheme other than http(s) or mailto; a sidebar.json that is
 * not one, or lists what is not there. Told of: an image no document
 * shows, front matter not read, HTML, a document a sidebar does not list.
 */
export function packDocs(context: Context) {
  const { manifest } = context;
  const extensions = [
    ...(manifest.components ?? []),
    ...(manifest.apps ?? []),
    ...(manifest.plugins ?? []),
  ];
  const docsDir = path.join(context.packageDir, DOCS_DIR);
  const files = fs.existsSync(docsDir) ? listFiles(context.packageDir) : [];
  const errors: string[] = [];
  const warn = (message: string) =>
    context.logger?.(colors.yellow('⚠ ' + message));

  const language = manifest.docsLanguage ?? DEFAULT_DOCS_LANGUAGE;
  if (!isDocsLanguage(language))
    errors.push(
      `"docsLanguage": "${language}" is not a language - ISO 639-1, its region if any: "tr", "pt-BR"`,
    );

  const classNames = new Set(extensions.map(e => e.className));
  const classDirs = fs.existsSync(docsDir)
    ? fs
        .readdirSync(docsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && CLASS_DIR_PATTERN.test(e.name))
        .map(e => e.name)
    : [];
  const abstract = new Set(context.abstractClassNames ?? []);
  const orphans = classDirs.filter(d => !classNames.has(d));
  const dirsOf = (names: string[]) =>
    names.map(d => `${DOCS_DIR}/${d}/`).join(', ');
  const unknown = orphans.filter(d => !abstract.has(d));
  if (unknown.length)
    errors.push(
      `${dirsOf(unknown)}: no app, component or plugin of ${context.pkgJson.name} has ${unknown.length > 1 ? 'these class names' : 'this class name'} - name its documents' directory after its class (${DOCS_DIR}/<ClassName>/${README_FILE})`,
    );
  /* An abstract class has no page of its own: documents named after it
   * would be shown nowhere, the package's own are */
  const ofAbstract = orphans.filter(d => abstract.has(d));
  if (ofAbstract.length) {
    const one = ofAbstract.length === 1;
    errors.push(
      `${dirsOf(ofAbstract)}: ${ofAbstract.join(', ')} ${one ? 'is' : 'are'} abstract - ${one ? 'a base' : 'bases'} of others, offered nowhere, so documents named after ${one ? 'it' : 'them'} are shown nowhere: put them among the package's own documents (${DOCS_DIR}/guides/, say) and link to them from the classes built on ${one ? 'it' : 'them'}`,
    );
  }

  /* What each file is, by its path and its bytes; a sidebar apart */
  const docs = new Map<string, DocPath>();
  const sidebars = new Map<string, string>();
  let total = 0;
  for (const file of files) {
    if (path.posix.basename(file) === SIDEBAR_FILE) {
      if (sidebarOwner(file) === undefined)
        errors.push(
          `${file}: a sidebar is ${DOCS_DIR}/${SIDEBAR_FILE} or ${DOCS_DIR}/<ClassName>/${SIDEBAR_FILE}`,
        );
      else if (
        fs.statSync(path.join(context.packageDir, file)).size >
        SIDEBAR_MAX_BYTES
      )
        errors.push(`${file} is larger than ${formatBytes(SIDEBAR_MAX_BYTES)}`);
      else
        sidebars.set(
          file,
          fs.readFileSync(path.join(context.packageDir, file), 'utf8'),
        );
      continue;
    }
    let doc: DocPath;
    try {
      doc = parseDocPath(file);
    } catch (e: any) {
      errors.push(e.message);
      continue;
    }
    const content = fs.readFileSync(path.join(context.packageDir, file));
    total += content.length;
    if (content.length > doc.type.maxBytes)
      errors.push(
        `${file} is larger than ${formatBytes(doc.type.maxBytes)}, the most a ${path.extname(file)} file may be`,
      );
    else if (!isDocContent(doc.type, content))
      errors.push(
        `${file} is not what its name says: ${doc.type.contentType.split(';')[0]}`,
      );
    docs.set(file, doc);
  }
  if (total > DOCS_MAX_TOTAL_BYTES)
    errors.push(
      `${DOCS_DIR}/ is ${formatBytes(total)}: the most a package's documents may be together is ${formatBytes(DOCS_MAX_TOTAL_BYTES)}`,
    );

  /* A language named: one not the package's own, named by none */
  for (const doc of docs.values()) {
    if (doc.language === language)
      errors.push(
        `${doc.path} is in "${language}", the language of ${path.posix.basename(doc.base)}: the package's own language is named by none`,
      );
  }

  /* What each document tells, and links to */
  const shown = new Set<string>();
  for (const doc of docs.values()) {
    if (!doc.path.endsWith('.md')) continue;
    const source = fs.readFileSync(
      path.join(context.packageDir, doc.path),
      'utf8',
    );
    checkMarkdown(doc.path, source, docs, shown, errors, warn);
  }
  for (const doc of docs.values())
    if (doc.type.kind === 'image' && !shown.has(doc.path))
      warn(`${doc.path} is shown by no document: is it needed?`);

  /* How they are listed, where told: each it lists among them */
  const bases = new Set(
    [...docs.values()].filter(d => d.type.kind === 'document').map(d => d.base),
  );
  const parsed = new Map<string, DocsSidebar>();
  for (const [file, source] of sidebars) {
    try {
      parsed.set(file, parseSidebar(file, JSON.parse(source), bases));
    } catch (e: any) {
      errors.push(
        ...(e instanceof SyntaxError
          ? [`${file} is not JSON: ${e.message}`]
          : String(e.message).split('\n')),
      );
    }
  }
  /* A module's sidebar taking documents of no module's directory: theirs,
   * shared - not the package's own for its sidebar to list */
  const taken = new Set<string>();
  for (const [file, sidebar] of parsed)
    if (sidebarOwner(file))
      for (const doc of sidebarDocs(sidebar)) taken.add(doc);
  /* A README a module's sidebar lists: its page, when it has none */
  const readmeOf = new Map<string, string>();
  for (const [file, sidebar] of parsed) {
    const owner = sidebarOwner(file) || undefined;
    const listed = new Set(sidebarDocs(sidebar));
    const readme = [...listed].find(d => d.endsWith('/' + README_FILE));
    if (owner && readme) readmeOf.set(owner, readme);
    const unlisted = [...bases].filter(
      b =>
        docs.get(firstOf(docs, b))?.module === owner &&
        !listed.has(b) &&
        (owner || !taken.has(b)),
    );
    if (unlisted.length)
      warn(
        `${file} does not list ${unlisted.join(', ')}: ${unlisted.length > 1 ? 'they are' : 'it is'} read by a link alone`,
      );
  }

  /* How each app and component is found in the Marketplace: checked, and
   * kept as the registry takes it - its summary by language, its
   * screenshots as paths among the documents */
  for (const ext of [
    ...(manifest.components ?? []),
    ...(manifest.apps ?? []),
  ]) {
    const { catalog, problems } = checkModuleCatalog(ext, {
      docsLanguage: language,
      hasDoc: file => docs.has(file),
    });
    errors.push(
      ...problems,
      ...variableTextProblems(ext.variables as any, ext.className),
    );
    Object.assign(ext, catalog);
    if (!catalog.summary)
      warn(
        `${ext.className} has no summary: tell what it is for, in a sentence (@${ext.classType === 'app' ? 'App' : 'Component'}({ summary })) - its card in the Marketplace`,
      );
  }

  /* A plugin's settings: their labels and descriptions, as told */
  for (const plugin of manifest.plugins ?? [])
    errors.push(
      ...variableTextProblems(plugin.settings as any, plugin.className),
    );

  if (errors.length)
    throw new SbError(
      `${context.pkgJson.name}'s documents have problems to fix before it can be packed:\n  - ` +
        errors.join('\n  - '),
    );

  for (const file of [...docs.keys(), ...sidebars.keys()]) {
    const target = path.join(context.tmpDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(context.packageDir, file), target);
  }
  if (docs.size) manifest.docsLanguage = language;
  else delete manifest.docsLanguage;

  for (const ext of extensions) {
    const file = `${DOCS_DIR}/${ext.className}/${README_FILE}`;
    /* Its own, else one its sidebar takes: shared by modules alike */
    const readme = docs.has(file) ? file : readmeOf.get(ext.className);
    if (readme) ext.readme = readme;
    else
      warn(
        `${ext.className} has no README: add ${file}, or list a shared one in its ${SIDEBAR_FILE} - it is shown on its page in the Marketplace`,
      );
  }
}

/**
 * The files in docs/, by their paths in the package (docs/...): hidden ones
 * (.DS_Store) passed over
 */
function listFiles(packageDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(packageDir, dir), {
      withFileTypes: true,
    })) {
      if (e.name.startsWith('.')) continue;
      const file = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(file);
      else files.push(file);
    }
  };
  walk(DOCS_DIR);
  return files.sort();
}

/**
 * Checks a document: its front matter, and where each link and image of it
 * goes. The images it shows are added to `shown`.
 */
function checkMarkdown(
  file: string,
  source: string,
  docs: Map<string, DocPath>,
  shown: Set<string>,
  errors: string[],
  warn: (message: string) => void,
) {
  const fm = FRONT_MATTER.exec(source);
  if (fm) {
    let data: unknown;
    try {
      data = fm[1] ? yaml.parse(fm[1]) : {};
    } catch (e: any) {
      errors.push(`${file}: its front matter is not YAML - ${e.message}`);
    }
    if (data != null && (typeof data !== 'object' || Array.isArray(data)))
      errors.push(`${file}: its front matter is not a map of fields`);
    else if (data) {
      const { title, order, ...rest } = data as Record<string, unknown>;
      if (title !== undefined && (typeof title !== 'string' || !title.trim()))
        errors.push(`${file}: "title" in its front matter is not text`);
      if (
        order !== undefined &&
        (typeof order !== 'number' || !Number.isFinite(order))
      )
        errors.push(`${file}: "order" in its front matter is not a number`);
      const unknown = Object.keys(rest).filter(
        k => !FRONT_MATTER_FIELDS.has(k),
      );
      if (unknown.length)
        warn(
          `${file}: ${unknown.map(k => `"${k}"`).join(', ')} in its front matter ${unknown.length > 1 ? 'are' : 'is'} not read - "title" and "order" are`,
        );
    }
    /* Blank lines in its place: the lines told stay the file's own */
    source = '\n'.repeat(countLines(fm[0])) + source.slice(fm[0].length);
  }

  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  let html = false as boolean;
  visit(tree, (node: Nodes) => {
    if (node.type === 'html') html = true;
    if (
      node.type !== 'link' &&
      node.type !== 'image' &&
      node.type !== 'definition'
    )
      return;
    const at = `${file}:${node.position?.start.line ?? 1}`;
    const target = resolveLink(node.url, file);
    if (target === undefined) return;
    if (typeof target === 'object') {
      errors.push(`${at}: ${target.error}`);
      return;
    }
    const doc = docs.get(target);
    if (!doc) {
      errors.push(
        `${at}: "${node.url}" links to ${target}, which ${isDir(target, docs) ? 'is a directory - link to a file in it' : 'is not in the package'}`,
      );
      return;
    }
    if (node.type === 'image' && doc.type.kind !== 'image') {
      errors.push(`${at}: "${node.url}" is shown as an image, but is none`);
      return;
    }
    /* A definition's use is not told: what it names counts as shown */
    if (doc.type.kind === 'image') shown.add(target);
  });
  if (html)
    warn(
      `${file} has HTML in it: it is not shown - write it in Markdown alone`,
    );
}

/**
 * Where a link of a document goes in the package (docs/...): undefined when
 * it leaves it, as it may, or goes nowhere but in the document
 */
function resolveLink(
  url: string,
  file: string,
): string | undefined | { error: string } {
  const scheme = SCHEME.exec(url);
  if (scheme)
    return SCHEMES_TAKEN.has(scheme[1].toLowerCase())
      ? undefined
      : { error: `"${url}": a link goes out by http(s) or mailto alone` };
  if (url.startsWith('//')) return undefined;
  const local = url.replace(/[?#].*$/, '');
  if (!local) return undefined;
  if (local.startsWith('/'))
    return {
      error: `"${url}" is from the package's root: link from where the document is (./, ../)`,
    };
  let decoded: string;
  try {
    decoded = decodeURIComponent(local);
  } catch {
    return { error: `"${url}" is not a link` };
  }
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(file), decoded),
  );
  if (!target.startsWith(DOCS_DIR + '/'))
    return {
      error: `"${url}" goes out of ${DOCS_DIR}/: what a document links to is among the documents`,
    };
  return target;
}

function isDir(target: string, docs: Map<string, DocPath>) {
  const prefix = target.replace(/\/$/, '') + '/';
  for (const file of docs.keys()) if (file.startsWith(prefix)) return true;
  return false;
}

function countLines(text: string) {
  return text.split('\n').length - 1;
}

function formatBytes(n: number) {
  return n >= 1024 * 1024
    ? `${Math.round((n / 1024 / 1024) * 10) / 10} MB`
    : `${Math.round(n / 1024)} KB`;
}

/** A file of a document, in any of its languages */
function firstOf(docs: Map<string, DocPath>, base: string): string {
  for (const [file, doc] of docs) if (doc.base === base) return file;
  return base;
}
