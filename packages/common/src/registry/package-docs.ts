import { SbError } from '../classes/sb-error.js';

/**
 * A package's documents: docs/ in its source, put in what spm packs, taken
 * out of it by the registry on publish - the field reads them from the
 * registry, never from what it installs.
 *
 *   docs/<ClassName>/README.md      an app's, component's or plugin's page
 *   docs/<ClassName>/**             its documents
 *   docs/**                         the package's own (guides/, images/)
 *
 * A document is Markdown or PDF; an image is what they show. A document's
 * languages share its name, each other than the package's own before its
 * extension: network.md, network.tr.md, network.pt-BR.md - the one naming
 * none in the language the manifest's `docsLanguage` names (English, if
 * none). A document may be in another language alone (user-guide.en.pdf).
 * How they are listed, a sidebar.json may tell (see docs-sidebar).
 */
export const DOCS_DIR = 'docs';
/** An app's, component's or plugin's page, in docs/<ClassName>/ */
export const README_FILE = 'README.md';
/** The language of documents that name none, when the manifest names none */
export const DEFAULT_DOCS_LANGUAGE = 'en';
/** All of a package's documents together, at most */
export const DOCS_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const KB = 1024;
const MB = 1024 * KB;

/** What a file in docs/ is: read as a page, or shown in one */
export type DocKind = 'document' | 'image';

export interface DocType {
  kind: DocKind;
  contentType: string;
  /** Its largest: larger, it is refused */
  maxBytes: number;
}

/** The files docs/ may hold, by extension: no other is packed */
export const DOC_TYPES: Readonly<Record<string, DocType>> = {
  '.md': {
    kind: 'document',
    contentType: 'text/markdown; charset=utf-8',
    maxBytes: 256 * KB,
  },
  '.pdf': {
    kind: 'document',
    contentType: 'application/pdf',
    maxBytes: 20 * MB,
  },
  '.png': { kind: 'image', contentType: 'image/png', maxBytes: 5 * MB },
  '.jpg': { kind: 'image', contentType: 'image/jpeg', maxBytes: 5 * MB },
  '.jpeg': { kind: 'image', contentType: 'image/jpeg', maxBytes: 5 * MB },
  '.gif': { kind: 'image', contentType: 'image/gif', maxBytes: 5 * MB },
  '.webp': { kind: 'image', contentType: 'image/webp', maxBytes: 5 * MB },
  '.svg': { kind: 'image', contentType: 'image/svg+xml', maxBytes: 5 * MB },
};

/**
 * A directory in docs/ named as a class would be (UdpSocket): an app's,
 * component's or plugin's. Others (guides, images, API) the package's own.
 */
export const CLASS_DIR_PATTERN = /^[A-Z][a-z0-9][A-Za-z0-9]*$/;

/** A file's or directory's name in docs/: one a link needs no escaping for */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A language a document is in: ISO 639-1, its region if any (pt-BR) */
const LANGUAGE_PATTERN = /^([a-z]{2})(?:-([A-Z]{2}))?$/;

/** A document's language in its name: network.tr.md, setup.pt-BR.pdf */
const LANGUAGE_IN_NAME = /^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)(\.(?:md|pdf))$/;

/** ISO 639-1: the languages a document may be in */
const LANGUAGES = new Set(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ' +
    'ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr ' +
    'fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is ' +
    'it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln ' +
    'lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ' +
    'ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk ' +
    'sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ' +
    'ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
  ).split(' '),
);

/** Whether a document may be in this language: `tr`, `pt-BR` */
export function isDocsLanguage(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const m = LANGUAGE_PATTERN.exec(code);
  return !!m && LANGUAGES.has(m[1]);
}

/** A file in docs/, as its path tells */
export interface DocPath {
  /** Its path in the package: docs/ModbusGateway/network.tr.md */
  path: string;
  type: DocType;
  /** The class whose documents it is among; none: the package's own */
  module?: string;
  /** Its language, when its name tells one: a document's alone */
  language?: string;
  /**
   * The document it is in another language of: docs/ModbusGateway/network.md
   * for network.tr.md - itself, when it names no language
   */
  base: string;
}

/**
 * Reads what a file in docs/ is from its path in the package (docs/...).
 * Throws when docs/ may not hold it: a type it does not take, a name a link
 * would need escaping for, or no path in docs/.
 */
export function parseDocPath(file: string): DocPath {
  const segments = file.split('/');
  if (segments[0] !== DOCS_DIR || segments.length < 2)
    throw new SbError(`${file}: not in ${DOCS_DIR}/`);
  const names = segments.slice(1);
  const bad = names.find(n => !NAME_PATTERN.test(n));
  if (bad !== undefined)
    throw new SbError(
      `${file}: "${bad}" is not a name docs/ takes - letters, digits, ".", "_" and "-" alone, not starting with "." "_" or "-"`,
    );
  const name = names[names.length - 1];
  const dot = name.lastIndexOf('.');
  const type = dot > 0 ? DOC_TYPES[name.slice(dot).toLowerCase()] : undefined;
  if (!type)
    throw new SbError(
      `${file}: docs/ takes ${Object.keys(DOC_TYPES).join(', ')} files alone`,
    );
  const module =
    names.length > 1 && CLASS_DIR_PATTERN.test(names[0]) ? names[0] : undefined;
  const m = type.kind === 'document' ? LANGUAGE_IN_NAME.exec(name) : null;
  if (m && LANGUAGES.has(m[2].slice(0, 2)))
    return {
      path: file,
      type,
      module,
      language: m[2],
      base: [...segments.slice(0, -1), m[1] + m[3]].join('/'),
    };
  return { path: file, type, module, base: file };
}

/** The first bytes each type begins with: what a file claims, checked */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'application/pdf': b => ascii(b, 0, 5) === '%PDF-',
  'image/png': b => ascii(b, 1, 4) === 'PNG' && b[0] === 0x89,
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': b => ascii(b, 0, 4) === 'GIF8',
  'image/webp': b => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/svg+xml': b => /<svg[\s>]/.test(ascii(b, 0, Math.min(b.length, 4096))),
};

function ascii(b: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...b.subarray(start, end));
}

/**
 * Whether a file's bytes are what its extension says: a PDF begins as one,
 * an image as its type, Markdown is UTF-8 text
 */
export function isDocContent(type: DocType, content: Uint8Array): boolean {
  if (type.contentType.startsWith('text/markdown')) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
      return true;
    } catch {
      return false;
    }
  }
  return SIGNATURES[type.contentType]?.(content) ?? false;
}

/**
 * What a publish tells of a package's documents when it leaves out the
 * files its registry has: at the archive's root, each file of docs/ by its
 * path, SHA-256 and size. A Markdown document is always sent - what it
 * tells is read from it; a PDF or an image may be left out, if the
 * package's earlier versions had it.
 */
export const DOCS_MANIFEST_FILE = 'syncbridge-docs.json';

export interface DocsManifest {
  files: DocsManifestFile[];
}

export interface DocsManifestFile {
  /** Its path in the package: docs/Gw/user-guide.en.pdf */
  path: string;
  /** Hex SHA-256 of the file */
  sha256: string;
  size: number;
}

/** Whether a publish may leave a file out, its registry having it */
export function isDocLeftOut(type: DocType): boolean {
  return !type.contentType.startsWith('text/markdown');
}

/** A file of a package, by its path in the archive and its SHA-256 */
export interface PackageFileDigest {
  path: string;
  sha256: string;
}

/**
 * What a package holds, as one SHA-256: every file of its archive by its
 * path and hash, sorted - the same however the archive was zipped, or
 * whichever of its documents' files were left out (told by their hash).
 * A publish is approved for it.
 */
export async function packageDigest(
  files: readonly PackageFileDigest[],
): Promise<string> {
  const lines = files
    .filter(f => f.path !== DOCS_MANIFEST_FILE && !f.path.endsWith('/'))
    .map(f => `${f.path}\t${f.sha256}\n`)
    .sort()
    .join('');
  const hash = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(lines),
  );
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
