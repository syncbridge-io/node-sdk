import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { packPackage } from '../src/pack-package.js';
import { publishedRange } from '../src/workspace.js';

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  );
}

describe('packPackage', function () {
  this.timeout(60000);
  let root: string;
  let pkgDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-pack-'));
    pkgDir = path.join(root, 'prc');
    write(path.join(pkgDir, 'package.json'), {
      name: '@test/pack-prc',
      version: '1.2.3',
      description: 'A test package',
      type: 'module',
      module: './index.js',
      scripts: { test: 'mocha' },
      dependencies: { 'date-fns': '^4.4.0' },
      devDependencies: { typescript: '*' },
      peerDependencies: { '@syncbridge/common': '>=0.13.0' },
      syncbridge: {},
    });
    write(path.join(pkgDir, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: 'src',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        skipLibCheck: true,
      },
      include: ['src'],
    });
    /* Types only, so the test needs no build of @syncbridge/common; at run
     * time the test environment resolves it to its sources */
    write(
      path.join(pkgDir, 'src', 'common.d.ts'),
      `declare module '@syncbridge/common' {
  export const Component: any;
  export class ComponentBase { constructor(...args: any[]); }
}`,
    );
    write(
      path.join(pkgDir, 'src', 'pack.component.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({ className: 'PackComponent' })
export class PackComponent extends ComponentBase {}
`,
    );
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export * from './pack.component.js';\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should write the compiled package, its package.json and manifest, and no lockfile', async () => {
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    /* Into the output directory itself, publishable as it is */
    const out = path.join(pkgDir, 'dist');
    expect(fs.readdirSync(out).sort()).toEqual([
      'index.d.ts',
      'index.js',
      'pack.component.d.ts',
      'pack.component.js',
      'package.json',
      'syncbridge-manifest.json',
    ]);
    const outPkgJson = JSON.parse(
      fs.readFileSync(path.join(out, 'package.json'), 'utf8'),
    );
    /* The manifest is in its own file, never in package.json */
    expect(outPkgJson).toEqual({
      name: '@test/pack-prc',
      version: '1.2.3',
      description: 'A test package',
      private: true,
      type: 'module',
      module: './index.js',
      main: './index.js',
      types: './index.d.ts',
      dependencies: { 'date-fns': '^4.4.0' },
      peerDependencies: { '@syncbridge/common': '>=0.13.0' },
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'syncbridge-manifest.json'), 'utf8'),
    );
    expect(Object.keys(manifest)).toEqual(['components']);
    /* Each with its definition and the module it is declared in */
    expect(manifest.components).toEqual([
      expect.objectContaining({
        exportName: 'PackComponent',
        entryPoint: './pack.component.js',
        className: 'PackComponent',
      }),
    ]);
  });

  it("should publish pnpm's workspace: ranges resolved, as pnpm publish does - the workspace package's version under ^ or ~, itself for *, the range after it", async () => {
    /* An npm package of the same workspace, linked */
    write(path.join(root, 'util', 'package.json'), {
      name: '@test/util',
      version: '3.4.5',
    });
    const link = path.join(root, 'node_modules', '@test', 'util');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(root, 'util'), link, 'junction');
    const pkgFile = path.join(pkgDir, 'package.json');
    write(pkgFile, {
      ...JSON.parse(fs.readFileSync(pkgFile, 'utf8')),
      dependencies: { 'date-fns': '^4.4.0', '@test/util': 'workspace:^' },
      peerDependencies: {
        '@syncbridge/common': 'workspace:>=0.13.0',
        '@test/util': 'workspace:*',
      },
    });
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const out = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'dist', 'package.json'), 'utf8'),
    );
    expect(out.dependencies).toEqual({
      'date-fns': '^4.4.0',
      '@test/util': '^3.4.5',
    });
    expect(out.peerDependencies).toEqual({
      '@syncbridge/common': '>=0.13.0',
      '@test/util': '3.4.5',
    });
    expect(publishedRange('@test/util', 'workspace:~', pkgDir)).toBe('~3.4.5');
    expect(publishedRange('@test/util', '^1.0.0', pkgDir)).toBe('^1.0.0');
    expect(() =>
      publishedRange('@test/util', 'workspace:@test/other@^1', pkgDir),
    ).toThrow(/names another package or a path/);
  });

  it('should keep where the package lives: its web page and its repository', async () => {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    write(pkgJsonPath, {
      ...JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')),
      homepage: 'https://example.com/prc',
      repository: {
        type: 'git',
        url: 'git+https://github.com/test/prc.git',
        directory: 'packages/prc',
      },
    });
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const outPkgJson = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'dist', 'package.json'), 'utf8'),
    );
    expect(outPkgJson).toMatchObject({
      homepage: 'https://example.com/prc',
      repository: {
        type: 'git',
        url: 'git+https://github.com/test/prc.git',
        directory: 'packages/prc',
      },
    });
  });

  it('should write the zip beside what is in the directory, removing nothing', async () => {
    const out = path.join(pkgDir, 'dist');
    write(path.join(out, 'older-1.0.0.zip'), 'an older zip');
    write(path.join(out, 'notes.txt'), 'keep me');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: true });
    expect(fs.readdirSync(out).sort()).toEqual([
      'notes.txt',
      'older-1.0.0.zip',
      'test-pack-prc-1.2.3.zip',
    ]);
    expect(fs.readFileSync(path.join(out, 'older-1.0.0.zip'), 'utf8')).toBe(
      'an older zip',
    );
    /* Nothing of the build left behind: its .spm removed */
    expect(fs.existsSync(path.join(pkgDir, '.spm'))).toBe(false);
  });

  it('should replace its own previous build, and refuse a directory that is not one', async () => {
    const out = path.join(pkgDir, 'dist');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    write(path.join(out, 'stale.js'), '');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    expect(fs.existsSync(path.join(out, 'stale.js'))).toBe(false);

    const other = path.join(root, 'other-project');
    write(path.join(other, 'README.md'), 'not a build');
    await expect(
      packPackage({ packageDir: pkgDir, outDir: other, pack: false }),
    ).rejects.toThrow(/is not empty, and not a build of @test\/pack-prc/);
    expect(fs.readdirSync(other)).toEqual(['README.md']);
  });

  it('should keep a temp directory it is given, removing only its own inside', async () => {
    const scratch = path.join(pkgDir, 'scratch');
    write(path.join(scratch, 'mine.txt'), 'keep me');
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      tempDir: 'scratch',
      pack: true,
    });
    expect(fs.readdirSync(scratch)).toEqual(['mine.txt']);
  });

  it('should pack into a directory outside the package', async () => {
    const out = path.join(root, 'packages-out');
    await packPackage({ packageDir: pkgDir, outDir: out, pack: true });
    expect(fs.readdirSync(out)).toEqual(['test-pack-prc-1.2.3.zip']);
  });

  it('should put docs/ whole in the package, each extension told its README', async () => {
    write(
      path.join(pkgDir, 'docs', 'PackComponent', 'README.md'),
      '# Pack\n\nIt packs: see [the network](network.md) and ' +
        '[setup](../guides/setup.md#start).\n\n![Map](../images/map.svg)',
    );
    write(path.join(pkgDir, 'docs', 'PackComponent', 'network.md'), '# Net');
    write(
      path.join(pkgDir, 'docs', 'PackComponent', 'network.tr.md'),
      '---\ntitle: Ağ\norder: 2\n---\n# Ağ',
    );
    write(path.join(pkgDir, 'docs', 'guides', 'setup.md'), '# Setup');
    write(path.join(pkgDir, 'docs', 'images', 'map.svg'), '<svg></svg>');
    write(path.join(pkgDir, 'docs', '.DS_Store'), 'hidden');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const out = path.join(pkgDir, 'dist');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'syncbridge-manifest.json'), 'utf8'),
    );
    /* At the same path: what it links to found from where it is */
    expect(manifest.components[0].readme).toBe('docs/PackComponent/README.md');
    expect(manifest.docsLanguage).toBe('en');
    expect(
      fs.readFileSync(
        path.join(out, 'docs', 'PackComponent', 'network.tr.md'),
        'utf8',
      ),
    ).toContain('# Ağ');
    expect(fs.readdirSync(path.join(out, 'docs')).sort()).toEqual([
      'PackComponent',
      'guides',
      'images',
    ]);
  });

  it("should take the documents' language from the manifest", async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    );
    write(path.join(pkgDir, 'package.json'), {
      ...pkg,
      syncbridge: { docsLanguage: 'tr' },
    });
    write(path.join(pkgDir, 'docs', 'PackComponent', 'README.md'), '# Paket');
    write(path.join(pkgDir, 'docs', 'PackComponent', 'README.en.md'), '# Pack');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.docsLanguage).toBe('tr');

    /* In its own language: named by none */
    write(path.join(pkgDir, 'docs', 'PackComponent', 'README.tr.md'), '# P');
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/README.tr.md is in "tr"/);
  });

  it('should refuse documents with problems, all told at once', async () => {
    const told: string[] = [];
    const dir = path.join(pkgDir, 'docs', 'PackComponent');
    write(
      path.join(dir, 'README.md'),
      [
        '---',
        'title: 3',
        'tags: [x]',
        '---',
        '# Pack',
        '',
        '[gone](missing.md)',
        '[out](../../src/pack.component.ts)',
        '[root](/docs/guides/a.md)',
        '[js](javascript:alert(1))',
        '[dir](../guides)',
        '![not an image](network.md)',
        '[web](https://example.com) [mail](mailto:a@b.c) [here](#pack)',
        '',
        '```',
        '[in code](nowhere.md)',
        '```',
        '<div>raw</div>',
      ].join('\n'),
    );
    write(path.join(dir, 'network.md'), '# Net');
    write(path.join(dir, 'setup.de.md'), '# Einrichtung');
    write(path.join(dir, 'notes.txt'), 'no');
    write(path.join(dir, 'fake.pdf'), 'not a pdf');
    write(path.join(pkgDir, 'docs', 'guides', 'a.md'), '# A');
    write(path.join(pkgDir, 'docs', 'images', 'unused.svg'), '<svg></svg>');
    const error = await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: (m: string) => told.push(m),
    }).catch(e => e);
    const message: string = error.message;
    expect(message).toMatch(
      /README.md:7: "missing.md" links to .* not in the package/,
    );
    expect(message).toMatch(/README.md:8: .* goes out of docs\//);
    expect(message).toMatch(/README.md:9: .* from the package's root/);
    expect(message).toMatch(/README.md:10: .* http\(s\) or mailto alone/);
    expect(message).toMatch(/README.md:11: .* is a directory/);
    expect(message).toMatch(/README.md:12: .* shown as an image, but is none/);
    expect(message).toMatch(/"title" in its front matter is not text/);
    expect(message).toMatch(/notes.txt: docs\/ takes/);
    expect(message).toMatch(/fake.pdf is not what its name says/);
    expect(message).not.toMatch(/nowhere.md|example.com|#pack/);
    expect(told.join('\n')).toMatch(/"tags" in its front matter is not read/);
    expect(told.join('\n')).toMatch(/README.md has HTML in it/);
    expect(told.join('\n')).toMatch(/unused.svg is shown by no document/);
    expect(fs.existsSync(path.join(pkgDir, 'dist', 'docs'))).toBe(false);
  });

  it('should take a sidebar telling how the documents are listed, and one in another language alone', async () => {
    const told: string[] = [];
    const dir = path.join(pkgDir, 'docs', 'PackComponent');
    write(path.join(dir, 'README.md'), '# Pack');
    write(path.join(dir, 'network.md'), '# Network');
    write(path.join(dir, 'unlisted.md'), '# Not listed');
    write(path.join(dir, 'guide.de.pdf'), '%PDF-1.7\n');
    write(path.join(dir, 'sidebar.json'), {
      items: [
        'README.md',
        { doc: 'guide.pdf', title: { de: 'Handbuch', en: 'Guide' } },
        { label: 'Network', items: ['network.md'] },
      ],
    });
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: (m: string) => told.push(m),
    });
    expect(
      fs.existsSync(
        path.join(pkgDir, 'dist', 'docs', 'PackComponent', 'sidebar.json'),
      ),
    ).toBe(true);
    expect(told.join('\n')).toMatch(
      /sidebar.json does not list docs\/PackComponent\/unlisted.md/,
    );

    write(path.join(dir, 'sidebar.json'), {
      items: ['README.md', 'missing.md', 'network.de.md'],
    });
    write(path.join(pkgDir, 'docs', 'guides', 'sidebar.json'), { items: [] });
    const error = await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
    }).catch(e => e);
    expect(error.message).toMatch(/items\[1\]: "missing.md" is not a document/);
    expect(error.message).toMatch(
      /items\[2\]: "network.de.md" is not a document/,
    );
    expect(error.message).toMatch(
      /docs\/guides\/sidebar.json: a sidebar is docs\/sidebar.json or/,
    );
  });

  it('should take documents shared by modules: listed by their sidebars, a README among them their page', async () => {
    const told: string[] = [];
    const shared = path.join(pkgDir, 'docs', 'shared');
    write(path.join(shared, 'README.md'), '# A family of devices');
    write(path.join(shared, 'README.tr.md'), '# Bir cihaz ailesi');
    write(path.join(shared, 'setup.md'), '# Setup');
    write(path.join(shared, 'setup.tr.md'), '# Kurulum');
    write(path.join(pkgDir, 'docs', 'guides', 'about.md'), '# About');
    write(path.join(pkgDir, 'docs', 'sidebar.json'), {
      items: ['guides/about.md'],
    });
    write(path.join(pkgDir, 'docs', 'PackComponent', 'sidebar.json'), {
      items: [
        '../shared/README.md',
        { doc: '../shared/setup.md', title: { en: 'Setup', tr: 'Kurulum' } },
      ],
    });
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: (m: string) => told.push(m),
    });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    /* No README of its own: the shared one its page */
    expect(manifest.components[0].readme).toBe('docs/shared/README.md');
    expect(
      fs.existsSync(path.join(pkgDir, 'dist', 'docs', 'shared', 'setup.tr.md')),
    ).toBe(true);
    /* Taken by a module: not the package's own, its sidebar not told of it */
    expect(told.join('\n')).not.toMatch(/does not list .*shared/);
    expect(told.join('\n')).not.toMatch(/PackComponent has no README/);

    /* Its own README the page, the shared one listed as a document */
    write(path.join(pkgDir, 'docs', 'PackComponent', 'README.md'), '# Pack');
    write(path.join(pkgDir, 'docs', 'PackComponent', 'sidebar.json'), {
      items: ['../shared/setup.md'],
    });
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const again = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(again.components[0].readme).toBe('docs/PackComponent/README.md');
  });

  it('should keep how a module is found in the Marketplace: its summary by language, its screenshots among its documents', async () => {
    write(
      path.join(pkgDir, 'src', 'pack.component.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({
  className: 'PackComponent',
  summary: { en: 'Reads weights.', tr: 'Tartım okur.' },
  screenshots: ['shots/main.svg'],
})
export class PackComponent extends ComponentBase {}
`,
    );
    write(path.join(pkgDir, 'docs', 'PackComponent', 'README.md'), '# Pack');
    write(
      path.join(pkgDir, 'docs', 'PackComponent', 'shots', 'main.svg'),
      '<svg></svg>',
    );
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.components[0]).toMatchObject({
      summary: { en: 'Reads weights.', tr: 'Tartım okur.' },
      screenshots: ['docs/PackComponent/shots/main.svg'],
    });
  });

  it("should refuse a module's Marketplace fields with problems, all told at once", async () => {
    write(
      path.join(pkgDir, 'src', 'pack.component.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({
  className: 'PackComponent',
  summary: '${'x'.repeat(161)}',
  screenshots: ['shots/none.png'],
})
export class PackComponent extends ComponentBase {}
`,
    );
    const message = await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
    }).then(
      () => '',
      (e: Error) => e.message,
    );
    expect(message).toMatch(/summary in en is 161 characters/);
    expect(message).toMatch(/shots\/none.png is not among/);
  });

  it('should tell of an extension with no README, and pack it still', async () => {
    const told: string[] = [];
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: (m: string) => told.push(m),
    });
    expect(told.some(m => m.includes('PackComponent has no README'))).toBe(
      true,
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.components[0]).not.toHaveProperty('readme');
  });

  it("should keep settings' labels and descriptions by language, and refuse a key not a language", async () => {
    const component = (label: string) =>
      write(
        path.join(pkgDir, 'src', 'pack.component.ts'),
        `import { Component, ComponentBase, DefineVariable } from '@syncbridge/common';

class TlsVars {
  @DefineVariable({ description: { en: 'Certificate', tr: 'Sertifika' } })
  declare cert: string;
}

class PackVars {
  @DefineVariable({ label: ${label}, description: 'The port' })
  declare port: number;

  @DefineVariable({ label: 'TLS', variables: TlsVars })
  declare tls: TlsVars;
}

@Component({ className: 'PackComponent' })
export class PackComponent extends ComponentBase {
  @Component.UseVariables(PackVars)
  declare values: PackVars;
}
`,
      );
    write(
      path.join(pkgDir, 'src', 'common.d.ts'),
      `declare module '@syncbridge/common' {
  export const Component: any;
  export const DefineVariable: any;
  export class ComponentBase { constructor(...args: any[]); }
}`,
    );
    component(`{ en: 'Port', tr: 'Bağlantı noktası' }`);
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    const { variables } = manifest.components[0];
    expect(variables.port.label).toEqual({
      en: 'Port',
      tr: 'Bağlantı noktası',
    });
    expect(variables.port.description).toBe('The port');
    expect(variables.tls.variables.cert.description).toEqual({
      en: 'Certificate',
      tr: 'Sertifika',
    });

    component(`{ english: 'Port' }`);
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/PackComponent's port label is told in "english"/);
  });

  it("should take locales/ into the manifest - its classes' texts by language, those of its settings down groups - and pack them for the packages built on it", async () => {
    write(
      path.join(pkgDir, 'src', 'pack.component.ts'),
      `import { Component, ComponentBase, DefineVariable } from '@syncbridge/common';

class TlsVars {
  @DefineVariable({ label: 'Certificate' })
  declare cert: string;
}

class PackVars {
  @DefineVariable({ label: 'Port', description: 'The port' })
  declare port: number;

  @DefineVariable({ label: 'TLS', variables: TlsVars })
  declare tls: TlsVars;
}

@Component({
  className: 'PackComponent',
  displayName: 'Pack client',
  description: 'Packs things.',
  summary: 'Packs things.',
})
export class PackComponent extends ComponentBase {
  @Component.UseVariables(PackVars)
  declare values: PackVars;
}
`,
    );
    write(
      path.join(pkgDir, 'src', 'common.d.ts'),
      `declare module '@syncbridge/common' {
  export const Component: any;
  export const DefineVariable: any;
  export class ComponentBase { constructor(...args: any[]); }
}`,
    );
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      PackComponent: {
        displayName: 'Paketleme istemcisi',
        description: 'Bir şeyleri paketler.',
        summary: 'Bir şeyleri paketler.',
        variables: {
          port: { label: 'Bağlantı noktası', description: 'Port' },
          tls: { label: 'TLS' },
          'tls.cert': { label: 'Sertifika' },
        },
      },
    });
    /* Some of it alone: the rest in English meanwhile, told */
    write(path.join(pkgDir, 'locales', 'pt-BR.json'), {
      PackComponent: { displayName: 'Cliente de empacotamento' },
    });
    const logged: string[] = [];
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: m => logged.push(m),
    });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    const [component] = manifest.components;
    expect(component.displayName).toEqual({
      en: 'Pack client',
      tr: 'Paketleme istemcisi',
      'pt-BR': 'Cliente de empacotamento',
    });
    expect(component.description).toEqual({
      en: 'Packs things.',
      tr: 'Bir şeyleri paketler.',
    });
    expect(component.summary).toEqual({
      en: 'Packs things.',
      tr: 'Bir şeyleri paketler.',
    });
    expect(component.variables.port.label).toEqual({
      en: 'Port',
      tr: 'Bağlantı noktası',
    });
    expect(component.variables.tls.variables.cert.label).toEqual({
      en: 'Certificate',
      tr: 'Sertifika',
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(pkgDir, 'dist', 'locales', 'pt-BR.json'),
          'utf8',
        ),
      ),
    ).toEqual({ PackComponent: { displayName: 'Cliente de empacotamento' } });
    expect(logged.join('\n')).toMatch(
      /locales\/pt-BR\.json lacks 6 texts, shown in en meanwhile: PackComponent description, PackComponent summary, PackComponent's port label/,
    );
    expect(logged.join('\n')).not.toMatch(/locales\/tr\.json lacks/);
  });

  it("should take the texts a class extends - its base's, a class of settings' for a group - its own over them, and pack them taken in", async () => {
    write(
      path.join(pkgDir, 'src', 'pack.component.ts'),
      `import { Component, ComponentBase, DefineVariable } from '@syncbridge/common';

export class ChannelVars {
  @DefineVariable({ label: 'Code' })
  declare code: string;

  @DefineVariable({ label: 'Unit' })
  declare unit: string;
}

class BaseVars {
  @DefineVariable({ label: 'Port' })
  declare port: number;
}

@Component({ className: 'PackBase', abstract: true, description: 'Base.' })
export class PackBase extends ComponentBase {
  @Component.UseVariables(BaseVars)
  declare values: BaseVars;
}

class PackVars extends BaseVars {
  @DefineVariable({ label: 'Channels', variables: ChannelVars })
  declare channels: ChannelVars;
}

@Component({ className: 'PackComponent', displayName: 'Pack client' })
export class PackComponent extends PackBase {
  @Component.UseVariables(PackVars)
  declare values: PackVars;
}
`,
    );
    write(
      path.join(pkgDir, 'src', 'common.d.ts'),
      `declare module '@syncbridge/common' {
  export const Component: any;
  export const DefineVariable: any;
  export class ComponentBase { constructor(...args: any[]); }
}`,
    );
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      PackBase: {
        displayName: 'Temel',
        description: 'Temel.',
        variables: { port: { label: 'Bağlantı noktası' } },
      },
      ChannelVars: {
        variables: { code: { label: 'Kod' }, unit: { label: 'Birim' } },
      },
      PackComponent: {
        '@extends': 'PackBase',
        displayName: 'Paketleme istemcisi',
        variables: {
          channels: { '@extends': 'ChannelVars', label: 'Kanallar' },
          'channels.unit': { label: 'Ölçü birimi' },
        },
      },
    });
    const logged: string[] = [];
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: m => logged.push(m),
    });
    const out = path.join(pkgDir, 'dist');
    const [component] = JSON.parse(
      fs.readFileSync(path.join(out, 'syncbridge-manifest.json'), 'utf8'),
    ).components;
    /* Its name its own; its description, as in its code, its base's */
    expect(component.displayName).toEqual({
      en: 'Pack client',
      tr: 'Paketleme istemcisi',
    });
    expect(component.description).toEqual({ en: 'Base.', tr: 'Temel.' });
    expect(component.variables.port.label).toEqual({
      en: 'Port',
      tr: 'Bağlantı noktası',
    });
    expect(component.variables.channels.label).toEqual({
      en: 'Channels',
      tr: 'Kanallar',
    });
    expect(component.variables.channels.variables.code.label).toEqual({
      en: 'Code',
      tr: 'Kod',
    });
    expect(component.variables.channels.variables.unit.label).toEqual({
      en: 'Unit',
      tr: 'Ölçü birimi',
    });
    expect(logged.join('\n')).not.toMatch(/locales\/tr\.json lacks/);
    /* Packed taken in: what a package built on it reads */
    const packed = JSON.parse(
      fs.readFileSync(path.join(out, 'locales', 'tr.json'), 'utf8'),
    );
    expect(packed.PackComponent).toEqual({
      description: 'Temel.',
      displayName: 'Paketleme istemcisi',
      variables: {
        port: { label: 'Bağlantı noktası' },
        'channels.code': { label: 'Kod' },
        'channels.unit': { label: 'Ölçü birimi' },
        channels: { label: 'Kanallar' },
      },
    });
    expect(packed.ChannelVars).toEqual({
      variables: { code: { label: 'Kod' }, unit: { label: 'Birim' } },
    });
  });

  it('should refuse locales/ naming what the package has not, all told at once', async () => {
    write(path.join(pkgDir, 'locales', 'tr.json'), {
      PackComponent: {
        displayName: 'Paket',
        title: 'Başlık',
        description: '',
        variables: { port: { label: 'Port' } },
      },
      Gone: { displayName: 'Yok' },
    });
    write(path.join(pkgDir, 'locales', 'turkish.json'), {});
    write(path.join(pkgDir, 'locales', 'en.json'), {});
    const message = await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
    }).then(
      () => '',
      (e: Error) => e.message,
    );
    expect(message).toMatch(
      /locales\/en\.json is in "en", the package's own language/,
    );
    expect(message).toMatch(/locales\/turkish\.json is not a language's/);
    expect(message).toMatch(
      /locales\/tr\.json: "Gone" is not a class of the package/,
    );
    expect(message).toMatch(/PackComponent's "title" is not a text of it/);
    expect(message).toMatch(
      /PackComponent's description is empty, or not text/,
    );
    expect(message).toMatch(/PackComponent has no setting "port"/);
  });

  it('should leave an abstract class out: a base of others, never run nor offered', async () => {
    write(
      path.join(pkgDir, 'src', 'pack-base.component.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({ className: 'PackBase', abstract: true })
export class PackBase extends ComponentBase {}
`,
    );
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export * from './pack-base.component.js';\nexport * from './pack.component.js';\n`,
    );
    const told: string[] = [];
    await packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
      logger: (m: string) => told.push(m),
    });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.components.map((c: any) => c.className)).toEqual([
      'PackComponent',
    ]);
    /* Nothing asked of it for the Marketplace */
    expect(told.filter(m => m.includes('PackBase'))).toEqual([]);
  });

  it('should refuse a README named after no class of the package: a misspelt one', async () => {
    write(path.join(pkgDir, 'docs', 'PackComponnet', 'README.md'), '# Typo');
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/docs\/PackComponnet\/: no app, component or plugin/);
  });

  it("should send an abstract class's documents among the package's own: no page shows them", async () => {
    write(
      path.join(pkgDir, 'src', 'pack-base.component.ts'),
      `import { Component, ComponentBase } from '@syncbridge/common';

@Component({ className: 'PackBase', abstract: true })
export class PackBase extends ComponentBase {}
`,
    );
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export * from './pack-base.component.js';\nexport * from './pack.component.js';\n`,
    );
    write(path.join(pkgDir, 'docs', 'PackBase', 'README.md'), '# PackBase');
    const packing = packPackage({
      packageDir: pkgDir,
      outDir: 'dist',
      pack: false,
    });
    await expect(packing).rejects.toThrow(
      /docs\/PackBase\/: PackBase is abstract - a base of others, offered nowhere, so documents named after it are shown nowhere: put them among the package's own documents \(docs\/guides\/, say\)/,
    );
    await expect(packing).rejects.not.toThrow(/no app, component or plugin/);
    /* Among the package's own, it packs */
    fs.rmSync(path.join(pkgDir, 'docs', 'PackBase'), { recursive: true });
    write(path.join(pkgDir, 'docs', 'guides', 'pack-base.md'), '# PackBase');
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
  });

  it('should list the plugins with their definitions', async () => {
    write(
      path.join(pkgDir, 'src', 'plugin-api.d.ts'),
      `declare module '@syncbridge/plugin-api' {
  export const Plugin: any;
  export class PluginBase { constructor(...args: any[]); }
}`,
    );
    write(
      path.join(pkgDir, 'src', 'common.d.ts'),
      `declare module '@syncbridge/common' {
  export const Component: any;
  export const DefineVariable: any;
  export class ComponentBase { constructor(...args: any[]); }
}`,
    );
    write(
      path.join(pkgDir, 'src', 'audit.plugin.ts'),
      `import { DefineVariable } from '@syncbridge/common';
import { Plugin, PluginBase } from '@syncbridge/plugin-api';

class AuditSettings {
  @DefineVariable({ label: 'URL', required: true })
  declare url: string;
}

@Plugin({
  name: 'audit-log',
  title: 'Audit',
  settings: AuditSettings,
  permissions: ['log-records', 'network'],
  hosts: ['audit.example.com'],
})
export class AuditPlugin extends PluginBase {
  async activate() {}
}
`,
    );
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export * from './pack.component.js';\nexport * from './audit.plugin.js';\n`,
    );
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.plugins).toEqual([
      {
        exportName: 'AuditPlugin',
        entryPoint: './audit.plugin.js',
        classType: 'plugin',
        name: 'audit-log',
        className: 'AuditPlugin',
        title: 'Audit',
        settings: {
          url: expect.objectContaining({ label: 'URL', required: true }),
        },
        permissions: ['log-records', 'network'],
        hosts: ['audit.example.com'],
      },
    ]);
    expect(manifest.components).toHaveLength(1);
  });

  it('should carry the name and dependencies its author wrote into the manifest', async () => {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    );
    delete pkgJson.syncbridge;
    write(path.join(pkgDir, 'package.json'), pkgJson);
    write(path.join(pkgDir, 'syncbridge-manifest.json'), {
      name: '@test/registered-as',
    });
    await packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pkgDir, 'dist', 'syncbridge-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.name).toBe('@test/registered-as');
    expect(manifest.components[0].entryPoint).toBe('./pack.component.js');
  });

  it('should refuse a manifest both in package.json and in its own file', async () => {
    write(path.join(pkgDir, 'syncbridge-manifest.json'), {});
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/both in syncbridge-manifest\.json/);
  });

  it('should refuse a package spm check finds problems in', async () => {
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export { x } from 'sb:@test/undeclared';`,
    );
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/"@test\/undeclared" is not in manifest dependencies/);
  });

  it('should report TypeScript errors', async () => {
    write(
      path.join(pkgDir, 'src', 'index.ts'),
      `export const x: number = 'text';`,
    );
    await expect(
      packPackage({ packageDir: pkgDir, outDir: 'dist', pack: false }),
    ).rejects.toThrow(/TypeScript compilation failed[\s\S]*TS2322/);
  });
});
