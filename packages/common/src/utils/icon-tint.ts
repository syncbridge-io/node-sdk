/*
 * Whether a class's icon is drawn in the colour of the page showing it.
 * An SVG icon is when it is painted in `currentColor` alone: every fill,
 * stroke and stop colour it gives is `currentColor`, or `none`, and at
 * least one is `currentColor`. A UI then draws it as a mask in its own
 * colour. Any other icon - a PNG, a logo in its own colours - is drawn as
 * it is. Nothing of Node is used here: a browser takes it from
 * `@syncbridge/common/web`.
 */

/** The SVG properties that give a colour */
const COLOR_PROPERTIES = [
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
];

/** The values that paint nothing, or take the colour of the parent */
const NEUTRAL_COLORS = new Set(['none', 'transparent', 'inherit']);

/** An SVG data: URL, with its parameters: `;charset=utf-8`, `;utf8`, `;base64` */
const SVG_DATA_URL = /^data:image\/svg\+xml((?:;[^;,]*)*),/i;

/**
 * Whether an icon - a class's `iconUrl` - is painted in `currentColor`
 * alone, to be drawn in the colour of the page showing it
 */
export function isTintedIcon(iconUrl: string | undefined): boolean {
  const source = iconUrl && svgOfDataUrl(iconUrl);
  return source ? isTintedSvg(source) : false;
}

/**
 * Whether an SVG is painted in `currentColor` alone: every colour it
 * gives, in an attribute or a style, is `currentColor` or `none`, and at
 * least one is `currentColor`
 */
export function isTintedSvg(source: string): boolean {
  const colors = svgColors(source);
  return (
    colors.includes('currentcolor') &&
    colors.every(c => c === 'currentcolor' || NEUTRAL_COLORS.has(c))
  );
}

/** The colours an SVG gives, lower-cased */
function svgColors(source: string): string[] {
  const names = COLOR_PROPERTIES.join('|');
  const colors: string[] = [];
  const attribute = new RegExp(`\\s(?:${names})\\s*=\\s*(["'])(.*?)\\1`, 'gi');
  for (const m of source.matchAll(attribute)) colors.push(m[2]);
  // In style="..." attributes and <style> elements
  const declaration = new RegExp(
    `(?:^|[\\s;{"'])(?:${names})\\s*:\\s*([^;}"']+)`,
    'gi',
  );
  for (const m of source.matchAll(declaration)) colors.push(m[1]);
  return colors.map(c =>
    c
      .replace(/!important/i, '')
      .trim()
      .toLowerCase(),
  );
}

/** The SVG an `image/svg+xml` data: URL holds */
function svgOfDataUrl(url: string): string | undefined {
  const m = SVG_DATA_URL.exec(url);
  if (!m) return;
  const data = url.substring(m[0].length);
  const base64 = m[1].toLowerCase().split(';').at(-1)?.trim() === 'base64';
  if (base64) {
    try {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return;
    }
  }
  // Written by hand, an SVG is often not URL-encoded: a "%" in it is kept
  try {
    return decodeURIComponent(data);
  } catch {
    return data;
  }
}
