import { expect } from 'expect';
import { checkModuleCatalog } from '../../src/index.js';

const context = (docs: string[] = []) => ({
  docsLanguage: 'en',
  hasDoc: (file: string) => docs.includes(file),
});

describe('A module in the Marketplace (checkModuleCatalog)', () => {
  it('keeps a summary by language: one alone in the docs language', () => {
    expect(
      checkModuleCatalog(
        { className: 'ScaleReader', summary: ' Reads   weights. ' },
        context(),
      ),
    ).toEqual({ catalog: { summary: { en: 'Reads weights.' } }, problems: [] });
    expect(
      checkModuleCatalog(
        {
          className: 'ScaleReader',
          summary: { en: 'Reads weights.', tr: 'Tartım okur.' },
        },
        context(),
      ).catalog.summary,
    ).toEqual({ en: 'Reads weights.', tr: 'Tartım okur.' });
  });

  it('tells a summary too long, empty, or in no language', () => {
    const { problems } = checkModuleCatalog(
      {
        className: 'ScaleReader',
        summary: { en: 'x'.repeat(161), tr: ' ', xx1: 'a' },
      },
      context(),
    );
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/161 characters/);
    expect(problems.join('\n')).toMatch(/in tr is empty/);
    expect(problems.join('\n')).toMatch(/"xx1", not a language/);
  });

  it('takes screenshots among its own documents, images alone', () => {
    const docs = ['docs/A/shots/main.png', 'docs/A/README.md'];
    expect(
      checkModuleCatalog(
        { className: 'A', screenshots: ['shots/main.png'] },
        context(docs),
      ),
    ).toEqual({
      catalog: { screenshots: ['docs/A/shots/main.png'] },
      problems: [],
    });
    const { problems } = checkModuleCatalog(
      {
        className: 'A',
        screenshots: [
          'README.md',
          'shots/missing.png',
          '../B/x.png',
          'docs/B/x.png',
        ],
      },
      context(docs),
    );
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/not an image/);
    expect(problems[1]).toMatch(/not among the package's documents/);
    expect(problems[2]).toMatch(/its own documents/);
  });
});
