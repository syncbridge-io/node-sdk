import { expect } from 'expect';
import { isDocContent, isDocsLanguage, parseDocPath } from '../../src/index.js';

describe('package docs', () => {
  it("should tell a module's document from the package's own", () => {
    expect(parseDocPath('docs/ModbusGateway/network.md')).toMatchObject({
      module: 'ModbusGateway',
      base: 'docs/ModbusGateway/network.md',
      type: { kind: 'document' },
    });
    expect(parseDocPath('docs/guides/setup.md').module).toBeUndefined();
    /* A file in docs/ itself, named as a class: no module's */
    expect(parseDocPath('docs/Overview.md').module).toBeUndefined();
    expect(parseDocPath('docs/API/x.md').module).toBeUndefined();
  });

  it('should read the language a document is in from its name', () => {
    expect(parseDocPath('docs/Gw/network.tr.md')).toMatchObject({
      language: 'tr',
      base: 'docs/Gw/network.md',
    });
    expect(parseDocPath('docs/Gw/guide.pt-BR.pdf')).toMatchObject({
      language: 'pt-BR',
      base: 'docs/Gw/guide.pdf',
    });
    /* Not a language: part of its name */
    expect(parseDocPath('docs/setup.v2.md').language).toBeUndefined();
    expect(parseDocPath('docs/setup.xx.md').language).toBeUndefined();
    /* An image has none */
    expect(parseDocPath('docs/images/map.tr.png').language).toBeUndefined();
  });

  it('should refuse what docs/ does not take', () => {
    expect(() => parseDocPath('docs/notes.txt')).toThrow(/takes .md/);
    expect(() => parseDocPath('docs/my notes.md')).toThrow(/"my notes.md"/);
    expect(() => parseDocPath('docs/ağ.md')).toThrow(/not a name/);
    expect(() => parseDocPath('src/x.md')).toThrow(/not in docs/);
  });

  it('should know a language from what is not one', () => {
    expect(isDocsLanguage('tr')).toBe(true);
    expect(isDocsLanguage('pt-BR')).toBe(true);
    expect(isDocsLanguage('xx')).toBe(false);
    expect(isDocsLanguage('TR')).toBe(false);
    expect(isDocsLanguage('pt-br')).toBe(false);
  });

  it('should check that a file is what its name says', () => {
    const pdf = parseDocPath('docs/a.pdf').type;
    expect(isDocContent(pdf, Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(isDocContent(pdf, Buffer.from('<html>'))).toBe(false);
    const svg = parseDocPath('docs/a.svg').type;
    expect(
      isDocContent(svg, Buffer.from('<?xml?><svg viewBox="0 0 1 1"/>')),
    ).toBe(true);
    const md = parseDocPath('docs/a.md').type;
    expect(isDocContent(md, Buffer.from('# Ağ'))).toBe(true);
    expect(isDocContent(md, Buffer.from([0xff, 0xfe, 0x00]))).toBe(false);
  });
});
