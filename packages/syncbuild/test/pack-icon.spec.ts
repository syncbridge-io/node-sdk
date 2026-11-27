import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import {
  classIcon,
  ICON_MAX_BYTES,
  svgIconProblems,
} from '../src/builder/pack-icon.js';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><use href="#p"/><path id="p" fill="url(#g)" d="M0 0h24v24H0z"/></svg>';

describe('classIcon', () => {
  let dir: string;
  const put = (name: string, content: string | Buffer) => {
    const file = path.join(dir, 'docs', 'GeApp', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-icon-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should tell of no icon where the class has none', () => {
    expect(classIcon(dir, 'GeApp')).toBeUndefined();
  });

  it('should make an SVG icon a data: URL', () => {
    put('icon.svg', SVG);
    expect(classIcon(dir, 'GeApp')).toEqual({
      file: 'docs/GeApp/icon.svg',
      iconUrl: `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`,
      problems: [],
    });
  });

  it('should make a PNG icon a data: URL, and refuse one that is not a PNG', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    put('icon.png', png);
    expect(classIcon(dir, 'GeApp')?.iconUrl).toBe(
      `data:image/png;base64,${png.toString('base64')}`,
    );
    put('icon.png', 'not a png');
    expect(classIcon(dir, 'GeApp')?.problems).toEqual([
      'docs/GeApp/icon.png is not a PNG image',
    ]);
  });

  it('should refuse two icons, an iconUrl given as well, and one too large', () => {
    put('icon.svg', SVG);
    expect(classIcon(dir, 'GeApp', 'https://example.com/a.svg')).toEqual({
      file: 'docs/GeApp/icon.svg',
      problems: [
        'docs/GeApp/icon.svg: GeApp gives an iconUrl in its code as well - drop one of them',
      ],
    });
    put('icon.svg', `<svg>${' '.repeat(ICON_MAX_BYTES)}</svg>`);
    expect(classIcon(dir, 'GeApp')?.problems).toEqual([
      'docs/GeApp/icon.svg is 33 KB: an icon is 32 KB at most',
    ]);
    put('icon.png', Buffer.alloc(8));
    expect(classIcon(dir, 'GeApp')?.problems).toEqual([
      'docs/GeApp/icon.svg and docs/GeApp/icon.png: GeApp takes one icon',
    ]);
  });
});

describe('svgIconProblems', () => {
  it('should take an icon drawn alone, its own references among it', () => {
    expect(svgIconProblems(SVG, 'icon.svg')).toEqual([]);
  });

  it('should refuse what is not an SVG, and what reaches out of it', () => {
    expect(svgIconProblems('<html></html>', 'icon.svg')).toEqual([
      'icon.svg is not an SVG image',
    ]);
    expect(
      svgIconProblems(
        `<!DOCTYPE svg [<!ENTITY x "y">]><svg onload="alert(1)"><script>alert(1)</script>
<foreignObject><iframe/></foreignObject><image xlink:href="https://x.test/a.png"/>
<style>@import 'x.css'; rect { fill: url(https://x.test/f) }</style><a href="javascript:void 0"/></svg>`,
        'icon.svg',
      ),
    ).toEqual([
      'icon.svg has a DOCTYPE or an entity: an icon may not',
      'icon.svg has a script: an icon may not',
      'icon.svg has a foreignObject: an icon may not',
      'icon.svg has an embedded document: an icon may not',
      'icon.svg has an event handler (on...): an icon may not',
      'icon.svg has a link to something not in it (href not "#..."): an icon may not',
      'icon.svg has a url() not to something in it: an icon may not',
      'icon.svg has a stylesheet import: an icon may not',
      'icon.svg has a javascript: link: an icon may not',
    ]);
  });
});
