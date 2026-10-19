#!/usr/bin/env node
/**
 * Converts a transmit log written by TransmitLogger (@syncbridge/builtins
 * 1.0.x) into a fixture file, which FixtureReader (@syncbridge/testing)
 * reads.
 *
 *   node convert-transmit-log.mjs <old-file> [<new-file>]
 *
 * The new file is <old-file> with the extension `.fixtures` unless given.
 * Each block becomes a fixture, in the same order, with its direction
 * (`in` for R, `out` for T, `info` for I, W, E), time and peer as headers.
 * Name the fixtures a test uses (a `name:` header) once converted.
 *
 * Data is written as readable as it can be read back the same: text as it
 * is, text whose lines end with CR one line each (`eol: cr`), text with
 * control characters by their names (`escapes: true`), and anything else
 * as hex.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , from, to] = process.argv;
if (!from) {
  console.error('Usage: node convert-transmit-log.mjs <old-file> [<new-file>]');
  process.exit(1);
}
const target = to || from.replace(/(\.[^./\\]*)?$/, '.fixtures');

/* <<R|20260101|101530.1|42|b64|10.0.0.5:4001>>\n, then the data and \n\n */
const HEADER =
  /<<([RTIEW])\|(\d{8}\|\d{6}(?:\.\d+)?)\|(\d+)(?:\|(\w*)(?:\|([^>\n]*))?)?>> *\n/g;
const DIRECTION = { R: 'in', T: 'out', I: 'info', W: 'info', E: 'info' };
const LEVEL = { I: 'info', W: 'warn', E: 'error' };

const CONTROL_NAMES = [
  'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL',
  'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB',
  'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US',
]; // prettier-ignore
/* What FixtureReader takes for an escape: such text is not left as it is */
const ESCAPE_LIKE = /<(?:[A-Z][A-Z0-9]{1,3}|0x[0-9A-Fa-f]{2})>/;

/** Reads the blocks of a transmit log, as readTransmitLog did */
function readTransmitLog(buffer) {
  const text = buffer.toString('latin1'); /* one char per byte */
  const blocks = [];
  let m;
  HEADER.lastIndex = 0;
  while ((m = HEADER.exec(text))) {
    const [, kind, stamp, size, contentType, peer] = m;
    const start = HEADER.lastIndex;
    let data;
    if (contentType === 'b64') {
      const end = text.indexOf('\n\n', start);
      data = Buffer.from(
        text.slice(start, end < 0 ? undefined : end),
        'base64',
      );
      HEADER.lastIndex = end < 0 ? text.length : end;
    } else {
      let end = start + Number(size);
      /* A size not ending at the blank line closing the block (old logs
       * wrote 0) is not trusted: the data runs to the next header */
      if (!(text.startsWith('\n\n', end) || end === text.length)) {
        const next = new RegExp(HEADER.source, 'g');
        next.lastIndex = start;
        const n = next.exec(text);
        end = n ? n.index : text.length;
        while (end > start && text[end - 1] === '\n') end--;
      }
      data = Buffer.from(buffer.subarray(start, end));
      HEADER.lastIndex = end;
    }
    blocks.push({ kind, stamp, peer, data });
  }
  return blocks;
}

/* Control characters are what is looked for here */
/* eslint-disable no-control-regex */

/** The headers and content that read back as `data` */
function represent(data) {
  const text = data.toString('utf8');
  const isText = Buffer.from(text, 'utf8').equals(data);
  if (isText && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    /* Lines ending with CR alone: one per line, read back as CR */
    if (text.includes('\r') && !text.includes('\n'))
      return { headers: { eol: 'cr' }, content: text.replace(/\r/g, '\n') };
    return { headers: {}, content: text };
  }
  if (isText && !ESCAPE_LIKE.test(text)) {
    const content = text.replace(/[\x00-\x1f\x7f]/g, c =>
      c === '\n' || c === '\t'
        ? c
        : c === '\r'
          ? '<CR>'
          : `<${c === '\x7f' ? 'DEL' : CONTROL_NAMES[c.charCodeAt(0)]}>`,
    );
    return { headers: { escapes: 'true' }, content };
  }
  const lines = [];
  for (let i = 0; i < data.length; i += 16)
    lines.push(
      [...data.subarray(i, i + 16)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    );
  return { headers: { encoding: 'hex' }, content: lines.join('\n') };
}

const fixtures = readTransmitLog(fs.readFileSync(from)).map(block => {
  /* yyyyMMdd|HHmmss.S, the local time it was written at */
  const [, y, mo, d, h, mi, s, frac = ''] =
    /^(\d{4})(\d\d)(\d\d)\|(\d\d)(\d\d)(\d\d)(\.\d+)?$/.exec(block.stamp);
  const headers = {
    direction: DIRECTION[block.kind],
    time: `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}`,
    ...(block.peer ? { peer: block.peer } : {}),
  };
  if (LEVEL[block.kind]) {
    headers.level = LEVEL[block.kind];
    const { headers: more, content } = represent(block.data);
    return { headers: { ...headers, ...more }, content };
  }
  const { headers: more, content } = represent(block.data);
  return { headers: { ...headers, ...more }, content };
});

/* A boundary no fixture holds */
let boundary;
do boundary = 'sb-' + randomBytes(8).toString('hex');
while (fixtures.some(f => f.content.includes('--' + boundary)));

const out = [
  `syncbridge-fixtures; boundary=${boundary}`,
  '',
  `Converted from ${path.basename(from)}, a TransmitLogger log.`,
  '',
];
for (const { headers, content } of fixtures) {
  out.push('--' + boundary);
  for (const [k, v] of Object.entries(headers)) out.push(`${k}: ${v}`);
  out.push('', content);
}
out.push('--' + boundary + '--', '');
fs.writeFileSync(target, out.join('\n'));
console.log(`${from}: ${fixtures.length} fixtures -> ${target}`);
