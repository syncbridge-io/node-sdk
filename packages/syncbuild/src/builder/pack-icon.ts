import fs from 'node:fs';
import path from 'node:path';
import { DOCS_DIR } from '@syncbridge/common';

/*
 * An app's or a component's icon, by convention in its documents'
 * directory: docs/<ClassName>/icon.svg, or icon.png. It is taken into its
 * manifest as its `iconUrl`, a data: URL, so it is shown wherever the
 * class is - the Marketplace, an engine with no internet - with nothing
 * fetched from elsewhere.
 */

/** The names an icon may have, in a class's documents' directory */
export const ICON_FILES = ['icon.svg', 'icon.png'] as const;

/** The largest icon taken */
export const ICON_MAX_BYTES = 32 * 1024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** What an SVG icon may not have: each with what to tell of it */
const SVG_REFUSED: [RegExp, string][] = [
  [/<!DOCTYPE|<!ENTITY/i, 'a DOCTYPE or an entity'],
  [/<\s*script[\s>/]/i, 'a script'],
  [/<\s*foreignObject[\s>/]/i, 'a foreignObject'],
  [/<\s*(?:iframe|object|embed)[\s>/]/i, 'an embedded document'],
  [/\son[a-z]+\s*=/i, 'an event handler (on...)'],
  [
    /\s(?:xlink:)?href\s*=\s*["']\s*(?!#)/i,
    'a link to something not in it (href not "#...")',
  ],
  [/url\(\s*["']?\s*(?!#)/i, 'a url() not to something in it'],
  [/@import/i, 'a stylesheet import'],
  [/javascript:/i, 'a javascript: link'],
];

export interface ClassIcon {
  /** Its path in the package: docs/<ClassName>/icon.svg */
  file: string;
  /** Its data: URL, when it is taken */
  iconUrl?: string;
  /** What is wrong with it */
  problems: string[];
}

/**
 * A class's icon, if its documents' directory has one: read, checked and
 * made a data: URL. A class with both an icon.svg and an icon.png, or an
 * `iconUrl` its code gives as well, is refused.
 */
export function classIcon(
  packageDir: string,
  className: string,
  iconUrl?: string,
): ClassIcon | undefined {
  const found = ICON_FILES.map(
    name => `${DOCS_DIR}/${className}/${name}`,
  ).filter(file => fs.existsSync(path.join(packageDir, file)));
  if (!found.length) return;
  const [file] = found;
  if (found.length > 1)
    return {
      file,
      problems: [`${found.join(' and ')}: ${className} takes one icon`],
    };
  if (iconUrl)
    return {
      file,
      problems: [
        `${file}: ${className} gives an iconUrl in its code as well - drop one of them`,
      ],
    };
  const content = fs.readFileSync(path.join(packageDir, file));
  if (content.length > ICON_MAX_BYTES)
    return {
      file,
      problems: [
        `${file} is ${Math.ceil(content.length / 1024)} KB: an icon is ${ICON_MAX_BYTES / 1024} KB at most`,
      ],
    };
  const problems = file.endsWith('.svg')
    ? svgIconProblems(content.toString('utf8'), file)
    : content.subarray(0, 8).equals(PNG_SIGNATURE)
      ? []
      : [`${file} is not a PNG image`];
  if (problems.length) return { file, problems };
  const type = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return {
    file,
    iconUrl: `data:${type};base64,${content.toString('base64')}`,
    problems: [],
  };
}

/**
 * What is wrong with an SVG icon: not an SVG; a script, a handler, or a
 * link to what is not in it - an icon is drawn as it is, alone
 */
export function svgIconProblems(source: string, file: string): string[] {
  if (!/<svg[\s>]/i.test(source)) return [`${file} is not an SVG image`];
  return SVG_REFUSED.filter(([pattern]) => pattern.test(source)).map(
    ([, what]) => `${file} has ${what}: an icon may not`,
  );
}
