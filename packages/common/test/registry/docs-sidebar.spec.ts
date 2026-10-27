import { expect } from 'expect';
import { parseSidebar, sidebarDocs, sidebarOwner } from '../../src/index.js';

describe('docs sidebar', () => {
  const docs = new Set([
    'docs/Gw/README.md',
    'docs/Gw/network.md',
    'docs/Gw/firewall.md',
    'docs/Gw/user-guide.pdf',
    'docs/guides/install.md',
  ]);

  it('should know whose a sidebar is by where it is', () => {
    expect(sidebarOwner('docs/sidebar.json')).toBe('');
    expect(sidebarOwner('docs/Gw/sidebar.json')).toBe('Gw');
    expect(sidebarOwner('docs/guides/sidebar.json')).toBeUndefined();
    expect(sidebarOwner('docs/Gw/sub/sidebar.json')).toBeUndefined();
  });

  it("should read a module's sidebar: its documents by their paths", () => {
    const sidebar = parseSidebar(
      'docs/Gw/sidebar.json',
      {
        items: [
          'README.md',
          {
            doc: 'user-guide.pdf',
            title: { tr: 'Kullanım kılavuzu', en: 'User guide' },
          },
          {
            label: { tr: 'Ağ', en: 'Network' },
            items: ['network.md', { doc: './firewall.md', title: 'Firewall' }],
          },
        ],
      },
      docs,
    );
    expect(sidebar.items[1]).toEqual({
      doc: 'docs/Gw/user-guide.pdf',
      title: { tr: 'Kullanım kılavuzu', en: 'User guide' },
    });
    expect(sidebarDocs(sidebar)).toEqual([
      'docs/Gw/README.md',
      'docs/Gw/user-guide.pdf',
      'docs/Gw/network.md',
      'docs/Gw/firewall.md',
    ]);
  });

  it('should tell every problem of one at once', () => {
    let message = '';
    try {
      parseSidebar(
        'docs/sidebar.json',
        {
          items: [
            'guides/install.md',
            'guides/install.md',
            'Gw/network.md',
            'guides/missing.md',
            { doc: 'guides/install.md', title: { xx: 'No' } },
            { label: 'Empty', items: 'no' },
            { what: 1 },
          ],
          extra: true,
        },
        docs,
      );
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toMatch(/"extra" is not read/);
    expect(message).toMatch(/items\[1\]: "guides\/install.md" is listed twice/);
    expect(message).toMatch(/items\[2\]: "Gw\/network.md" is a module's/);
    expect(message).toMatch(
      /items\[3\]: "guides\/missing.md" is not a document/,
    );
    expect(message).toMatch(/items\[4\].title: text, or text by language/);
    expect(message).toMatch(/items\[5\].items: a list of items/);
    expect(message).toMatch(/items\[6\]: a document \("doc"\) or a category/);
  });

  it("should let a module's sidebar take documents shared beyond its directory", () => {
    const shared = new Set([
      ...docs,
      'docs/shared/README.md',
      'docs/shared/setup.md',
      'docs/Other/notes.md',
    ]);
    const sidebar = parseSidebar(
      'docs/Gw/sidebar.json',
      {
        items: [
          '../shared/README.md',
          { doc: '../shared/setup.md', title: { en: 'Setup', tr: 'Kurulum' } },
          '../Other/notes.md',
          'network.md',
        ],
      },
      shared,
    );
    expect(sidebarDocs(sidebar)).toEqual([
      'docs/shared/README.md',
      'docs/shared/setup.md',
      'docs/Other/notes.md',
      'docs/Gw/network.md',
    ]);
  });

  it('should keep a sidebar in docs/, a module to one README', () => {
    const shared = new Set([...docs, 'docs/shared/README.md']);
    let message = '';
    try {
      parseSidebar(
        'docs/Gw/sidebar.json',
        { items: ['README.md', '../shared/README.md', '../../src/index.md'] },
        shared,
      );
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toMatch(
      /items\[2\]: "..\/..\/src\/index.md" goes out of docs\//,
    );
    expect(message).toMatch(
      /docs\/Gw\/README.md, docs\/shared\/README.md - a module has one README.md/,
    );
  });
});
