import { expect } from 'expect';
import { isTintedIcon, isTintedSvg } from '../../src/web.js';

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
const base64Url = (source: string) =>
  `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;

describe('isTintedSvg', () => {
  it('takes an SVG painted in currentColor alone', () => {
    expect(
      isTintedSvg(
        svg(
          '<path fill="none" stroke="currentColor" d="M0 0h64"/>' +
            '<circle fill="currentColor" r="4"/>',
        ),
      ),
    ).toBe(true);
  });

  it('reads colours in styles too', () => {
    expect(
      isTintedSvg(svg('<path style="stroke: currentColor; fill:none"/>')),
    ).toBe(true);
    expect(
      isTintedSvg(
        svg(
          '<style>path{fill:currentColor}</style><path style="stroke:#f00"/>',
        ),
      ),
    ).toBe(false);
  });

  it('refuses an SVG with a colour of its own', () => {
    expect(
      isTintedSvg(svg('<path stroke="currentColor"/><path fill="#1a73e8"/>')),
    ).toBe(false);
    expect(
      isTintedSvg(
        svg('<path fill="url(#g)"/><stop stop-color="currentColor"/>'),
      ),
    ).toBe(false);
  });

  it('refuses an SVG with no currentColor', () => {
    expect(isTintedSvg(svg('<path d="M0 0h64"/>'))).toBe(false);
    expect(isTintedSvg(svg('<path fill="none"/>'))).toBe(false);
  });
});

describe('isTintedIcon', () => {
  const tinted = svg('<path stroke="currentColor"/>');

  it('reads a base64 and a plain SVG data: URL', () => {
    expect(isTintedIcon(base64Url(tinted))).toBe(true);
    expect(
      isTintedIcon(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`,
      ),
    ).toBe(true);
  });

  it('reads an SVG data: URL with any parameters, encoded or not', () => {
    expect(isTintedIcon(`data:image/svg+xml;utf8,${tinted}`)).toBe(true);
    expect(
      isTintedIcon(`data:image/svg+xml;utf8,${encodeURIComponent(tinted)}`),
    ).toBe(true);
    expect(isTintedIcon(`data:image/svg+xml,${tinted}`)).toBe(true);
    expect(
      isTintedIcon(
        `data:image/svg+xml;charset=utf-8;base64,${Buffer.from(tinted).toString('base64')}`,
      ),
    ).toBe(true);
    expect(
      isTintedIcon(
        `data:image/svg+xml;utf8,${svg('<rect width="100%" stroke="currentColor"/>')}`,
      ),
    ).toBe(true);
  });

  it('refuses what is not an SVG data: URL', () => {
    expect(isTintedIcon(undefined)).toBe(false);
    expect(isTintedIcon('https://example.com/icon.svg')).toBe(false);
    expect(isTintedIcon('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(isTintedIcon('data:image/svg+xml;base64,@@')).toBe(false);
  });
});
