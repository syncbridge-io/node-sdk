import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import callerCallsite from 'caller-callsite';

/** The first line of a fixture file: `syncbridge-fixtures; boundary=…` */
const DECLARATION =
  /^syncbridge-fixtures\s*;\s*boundary=(?:"([^"]+)"|(\S+))\s*$/;

/** The control characters, by the names documents write them with */
const CONTROL_NAMES = [
  'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL',
  'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB',
  'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US',
]; // prettier-ignore

const DEFAULT_ESCAPES: Record<string, number | string> = Object.fromEntries([
  ...CONTROL_NAMES.map((name, code) => [`<${name}>`, code]),
  ['<DEL>', 0x7f],
]);

/** `<CR>`, `<VT>`, `<0x1C>` */
const DEFAULT_ESCAPE_PATTERN = /<(?:[A-Z][A-Z0-9]{1,3}|0x[0-9A-Fa-f]{2})>/g;
const HEX_ESCAPE = /^<0x([0-9A-Fa-f]{2})>$/;

const EOL = { cr: '\r', lf: '\n', crlf: '\r\n' } as const;

/**
 * Reads test fixtures: the data a test sends or expects - a message as a
 * device sent it at a site, an example from a manual, a frame written by
 * hand - kept in a file of its own beside the tests.
 *
 * A fixture file holds any number of fixtures, set apart by a boundary the
 * file declares on its first line, as multipart MIME does. The boundary
 * appears in no fixture, so a fixture holds anything: `<<`, `--`, control
 * characters, binary data.
 *
 * ```text
 * syncbridge-fixtures; boundary=sb-7f3a9c
 *
 * Text up to the first boundary describes the file; it is not read.
 *
 * --sb-7f3a9c
 * name: oru-r01
 * eol: cr
 *
 * MSH|^~\&|VSP|GE Healthcare|||20250827142700||ORU^R01|0040972856FF|P|2.6
 * PID|||33426^^^PID^MR
 * --sb-7f3a9c
 * encoding: hex
 *
 * 00 01 00 2a e1 00 00 02
 * --sb-7f3a9c--
 * ```
 *
 * Each fixture starts at a `--<boundary>` line: its headers (`name: value`
 * lines), an empty line, and its content up to the next boundary line, the
 * line break before which is not the content's. A fixture without headers
 * starts with the empty line. The file ends with `--<boundary>--`.
 *
 * The headers - each overriding the reader's options for its fixture:
 * - `name`: what a test gets it by; without one, by its position
 * - `encoding`: `text` (default), `hex` (whitespace between the digits
 *   ignored) or `base64`
 * - `charset`: of text content changed by `eol` or `escapes`; default
 *   `utf8`. Content nothing changes is the bytes as written, binary or not
 * - `eol`: `cr`, `lf` or `crlf`: the line breaks of text content are made
 *   that; HL7, for one, ends its segments with CR, which an editor shows as
 *   one line
 * - `escapes`: `<CR>`, `<VT>`, `<0x1C>` and the like in text content are
 *   the characters they name, as manuals write them (`escapes: false` turns
 *   them off where the options turn them on)
 * - any other (`direction`, `time`, `note`): kept, for the reader of the
 *   file and for `filter`
 *
 * A relative file name is resolved from the directory of the file that
 * creates the reader: `new FixtureReader('_data/monitor.fixtures')` in a
 * test finds the file beside it.
 */
export class FixtureReader implements Iterable<Fixture> {
  /** The file the fixtures were read from */
  readonly file?: string;
  protected readonly _fixtures: Fixture[];

  constructor(file: string, options?: FixtureReader.Options);
  constructor(file: string, options: FixtureReader.Options = {}) {
    let filename = file;
    if (!path.isAbsolute(filename)) {
      const caller = options.baseDir ?? callerDirectory();
      filename = path.resolve(caller ?? process.cwd(), filename);
    }
    if (!fs.existsSync(filename))
      throw new Error(`Fixture file "${file}" not found (${filename})`);
    this.file = filename;
    this._fixtures = parseFixtures(fs.readFileSync(filename), options, file);
  }

  /** Reads fixtures from the content of a fixture file */
  static parse(
    content: string | Buffer,
    options: FixtureReader.Options = {},
  ): FixtureReader {
    const reader = Object.create(FixtureReader.prototype) as FixtureReader;
    (reader as any)._fixtures = parseFixtures(
      Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
      options,
      'fixtures',
    );
    return reader;
  }

  /**
   * One piece of data as a fixture's content is written, without a file:
   * `FixtureReader.decode('<VT>MSH|…<CR><FS><CR>', { escapes: true })`
   */
  static decode(content: string, options: FixtureReader.Options = {}): Buffer {
    return decodeContent(Buffer.from(content, 'utf8'), {}, options, 'data');
  }

  get length(): number {
    return this._fixtures.length;
  }

  /** The names of the named fixtures, in order */
  get names(): string[] {
    return this._fixtures.filter(f => f.name).map(f => f.name!);
  }

  /** A fixture's data by its position; a negative index counts from the end */
  at(index: number): Buffer {
    return this.fixture(index).data;
  }

  /** A fixture's data by its name */
  get(name: string): Buffer {
    return this.fixture(name).data;
  }

  has(name: string): boolean {
    return this._fixtures.some(f => f.name === name);
  }

  /** A fixture's data as text */
  text(key: string | number, charset?: BufferEncoding): string {
    return this.fixture(key).text(charset);
  }

  /** A fixture's headers */
  headers(key: string | number): Record<string, string> {
    return this.fixture(key).headers;
  }

  /** A fixture, by its name or position */
  fixture(key: string | number): Fixture {
    if (typeof key === 'number') {
      const fixture = this._fixtures.at(key);
      if (!fixture)
        throw new RangeError(
          `${this._where()} has no fixture at ${key}: it holds ${this.length}`,
        );
      return fixture;
    }
    const fixture = this._fixtures.find(f => f.name === key);
    if (!fixture)
      throw new Error(
        `${this._where()} has no fixture named "${key}"` +
          (this.names.length
            ? ` (named: ${this.names.join(', ')})`
            : ': none is named; get them by position with at()'),
      );
    return fixture;
  }

  /** The fixtures `predicate` keeps, as a reader of their own */
  filter(predicate: (fixture: Fixture) => boolean): FixtureReader {
    const reader = Object.create(FixtureReader.prototype) as FixtureReader;
    (reader as any).file = this.file;
    (reader as any)._fixtures = this._fixtures.filter(predicate);
    return reader;
  }

  toArray(): Fixture[] {
    return [...this._fixtures];
  }

  [Symbol.iterator](): Iterator<Fixture> {
    return this._fixtures[Symbol.iterator]();
  }

  protected _where(): string {
    return this.file ? `"${path.basename(this.file)}"` : 'The fixtures';
  }
}

export namespace FixtureReader {
  /** Defaults of every fixture; a fixture's own headers come first */
  export interface Options {
    /**
     * Escapes in text content: `true` for the control characters by name
     * (`<NUL>` … `<US>`, `<DEL>`) and `<0x1C>` by code; a table to add
     * escapes of your own, or redefine those, each the bytes it stands for
     * (`{ '<SB>': 0x0b, '<EB>': '\x1c\r' }`); `false` (default) for none
     */
    escapes?: boolean | Record<string, number | string>;
    /**
     * What an escape looks like; default `<NAME>` and `<0xHH>`. Matches not
     * in the table, other than `<0xHH>`, are an error: a misspelled escape
     * is not left in the data.
     */
    escapePattern?: RegExp;
    encoding?: 'text' | 'hex' | 'base64';
    /** Of text content; default `utf8` */
    charset?: BufferEncoding;
    /** The line breaks text content is given; default: as written */
    eol?: 'cr' | 'lf' | 'crlf';
    /** Where a relative file name is resolved from; default: the directory of the file creating the reader */
    baseDir?: string;
  }
}

/** A fixture of a fixture file */
export interface Fixture {
  /** Its position in the file */
  index: number;
  name?: string;
  /** Its headers, their names in lower case */
  headers: Record<string, string>;
  data: Buffer;
  /** Its data as text; default `utf8` */
  text(charset?: BufferEncoding): string;
}

function parseFixtures(
  buffer: Buffer,
  options: FixtureReader.Options,
  source: string,
): Fixture[] {
  /* One char per byte, so offsets in the text are offsets in the buffer */
  const text = buffer.toString('latin1');
  const firstBreak = text.indexOf('\n');
  const firstLine = (firstBreak < 0 ? text : text.slice(0, firstBreak)).replace(
    /\r$/,
    '',
  );
  const m = DECLARATION.exec(firstLine);
  if (!m)
    throw new SyntaxError(
      `${source}:1: a fixture file starts with "syncbridge-fixtures; boundary=<boundary>"`,
    );
  const boundary = m[1] ?? m[2];
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;

  /* The boundary lines: `--boundary`, or `--boundary--` closing the file */
  const delimiter = new RegExp(
    `(^|\\r?\\n)--${escapeRegExp(boundary)}(--)?[ \\t]*(?=\\r?\\n|$)`,
    'g',
  );
  delimiter.lastIndex = firstBreak < 0 ? text.length : firstBreak;
  const marks: { start: number; end: number; close: boolean }[] = [];
  let d: RegExpExecArray | null;
  while ((d = delimiter.exec(text))) {
    marks.push({ start: d.index, end: delimiter.lastIndex, close: !!d[2] });
    if (d[2]) break;
  }
  if (!marks.length || !marks.at(-1)!.close)
    throw new SyntaxError(
      `${source}: the fixtures are not closed with "--${boundary}--"`,
    );

  const fixtures: Fixture[] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    /* After the boundary line's own line break, up to the line break that
     * comes with the next boundary line */
    let start = marks[i].end;
    if (text.startsWith('\r\n', start)) start += 2;
    else if (text[start] === '\n') start++;
    const end = marks[i + 1].start;
    const part = text.slice(start, end);
    const line = lineOf(start);
    const blank = /(^|\r?\n)\r?\n/.exec(part);
    if (!blank)
      throw new SyntaxError(
        `${source}:${line}: a fixture's headers end with an empty line; one without headers starts with an empty line`,
      );
    const headers: Record<string, string> = {};
    const headerText = part.slice(0, blank.index);
    headerText.split(/\r?\n/).forEach((h, j) => {
      if (!h) return;
      const colon = h.indexOf(':');
      if (colon <= 0)
        throw new SyntaxError(
          `${source}:${line + j}: "${h}" is not a header ("name: value")`,
        );
      const name = h.slice(0, colon).trim().toLowerCase();
      /* Headers are written as text: back from one char per byte */
      headers[name] = Buffer.from(h.slice(colon + 1).trim(), 'latin1').toString(
        'utf8',
      );
    });
    const contentStart = start + blank.index + blank[0].length;
    const index = fixtures.length;
    const name = headers.name || undefined;
    if (name && fixtures.some(f => f.name === name))
      throw new SyntaxError(
        `${source}:${line}: a fixture named "${name}" is already in the file`,
      );
    const data = decodeContent(
      buffer.subarray(contentStart, end),
      headers,
      options,
      `${source}:${lineOf(contentStart)}`,
    );
    fixtures.push(makeFixture(index, name, headers, data));
  }
  return fixtures;
}

function makeFixture(
  index: number,
  name: string | undefined,
  headers: Record<string, string>,
  data: Buffer,
): Fixture {
  return {
    index,
    ...(name ? { name } : {}),
    headers,
    data,
    text: (charset: BufferEncoding = 'utf8') => data.toString(charset),
  };
}

function decodeContent(
  content: Buffer,
  headers: Record<string, string>,
  options: FixtureReader.Options,
  where: string,
): Buffer {
  const encoding = headers.encoding || options.encoding || 'text';
  if (encoding === 'hex') {
    const digits = content.toString('latin1').replace(/\s+/g, '');
    if (!/^(?:[0-9A-Fa-f]{2})*$/.test(digits))
      throw new SyntaxError(
        `${where}: hex content is pairs of hex digits, whitespace between them`,
      );
    return Buffer.from(digits, 'hex');
  }
  if (encoding === 'base64') {
    const digits = content.toString('latin1').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(digits))
      throw new SyntaxError(`${where}: the content is not base64`);
    return Buffer.from(digits, 'base64');
  }
  if (encoding !== 'text')
    throw new SyntaxError(
      `${where}: unknown encoding "${encoding}" (text, hex or base64)`,
    );

  const charset = (headers.charset ||
    options.charset ||
    'utf8') as BufferEncoding;
  if (!Buffer.isEncoding(charset))
    throw new SyntaxError(`${where}: unknown charset "${charset}"`);
  const eol = (headers.eol || options.eol) as keyof typeof EOL | undefined;
  if (eol && !(eol in EOL))
    throw new SyntaxError(`${where}: unknown eol "${eol}" (cr, lf or crlf)`);
  const escapes = escapeTable(headers.escapes, options.escapes, where);
  /* Nothing to change: the bytes as written, whatever they are */
  if (!eol && !escapes) return Buffer.from(content);
  let text = content.toString(charset);
  if (eol) text = text.replace(/\r\n|\r|\n/g, EOL[eol]);
  if (!escapes) return Buffer.from(text, charset);

  /* The text between escapes in the charset, each escape its own bytes */
  const pattern = new RegExp(
    (options.escapePattern || DEFAULT_ESCAPE_PATTERN).source,
    'g',
  );
  const parts: Buffer[] = [];
  let last = 0;
  let e: RegExpExecArray | null;
  while ((e = pattern.exec(text))) {
    if (!e[0]) {
      pattern.lastIndex++;
      continue;
    }
    parts.push(Buffer.from(text.slice(last, e.index), charset));
    parts.push(escapeBytes(e[0], escapes, where));
    last = pattern.lastIndex;
  }
  parts.push(Buffer.from(text.slice(last), charset));
  return Buffer.concat(parts);
}

function escapeTable(
  header: string | undefined,
  option: FixtureReader.Options['escapes'],
  where: string,
): Record<string, number | string> | undefined {
  let on: boolean;
  if (header === undefined) on = !!option;
  else if (header === '' || /^(true|yes|on)$/i.test(header)) on = true;
  else if (/^(false|no|off)$/i.test(header)) on = false;
  else
    throw new SyntaxError(
      `${where}: escapes is "true" or "false", not "${header}"`,
    );
  if (!on) return;
  return typeof option === 'object'
    ? { ...DEFAULT_ESCAPES, ...option }
    : DEFAULT_ESCAPES;
}

function escapeBytes(
  escape: string,
  table: Record<string, number | string>,
  where: string,
): Buffer {
  const value = table[escape];
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 255)
      throw new RangeError(`${escape} stands for ${value}, not a byte`);
    return Buffer.from([value]);
  }
  if (typeof value === 'string') return Buffer.from(value, 'latin1');
  const hex = HEX_ESCAPE.exec(escape);
  if (hex) return Buffer.from([parseInt(hex[1], 16)]);
  throw new SyntaxError(
    `${where}: unknown escape ${escape}; add it to the escapes option, or turn escapes off for this fixture`,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The directory of the file that called the FixtureReader constructor */
function callerDirectory(): string | undefined {
  /* callerCallsite gives the caller of this function's caller: the
   * constructor's caller */
  const file = callerCallsite({ depth: 1 })?.getFileName();
  if (!file) return;
  return path.dirname(file.startsWith('file:') ? fileURLToPath(file) : file);
}
