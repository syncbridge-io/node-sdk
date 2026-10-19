import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  MANIFEST_FILE,
  SbError,
  validateRegistryName,
} from '@syncbridge/common';
import { version } from './constants.js';

/**
 * Ranges the skeleton depends on. common is the range syncbuild itself
 * builds against; the rest are tools its test runs with.
 */
const TESTING_RANGE = '^1.0.0';
const DEV_TOOLS: Record<string, string> = {
  '@swc-node/register': '^1.12.1',
  '@swc/core': '^1.16.13',
  '@types/mocha': '^10.0.10',
  '@types/node': '^22.0.0',
  expect: '^30.5.2',
  mocha: '^12.0.3',
  typescript: '^6.0.3',
};

export interface InitOptions {
  /** The package's registry name, `@vendor/name` */
  name: string;
  /** Where to create it; default: a folder named after `name` */
  directory?: string;
  /** The example app's class name; default: from `name` */
  app?: string;
}

/**
 * Creates an extension package: a manifest, TypeScript and test setup, an
 * example app and its first test, written with @syncbridge/testing,
 * so a package never starts without one. Refuses to overwrite a file.
 * Returns the files written, relative to the package directory.
 */
export function initPackage(options: InitOptions): {
  directory: string;
  files: string[];
} {
  const problems = validateRegistryName(options.name);
  if (problems.length) throw new SbError(problems.join('. '));
  const [, shortName] = options.name.slice(1).split('/');
  const directory = path.resolve(options.directory || shortName);
  const className = options.app || pascalCase(shortName).replace(/App$/, '');
  if (!/^[A-Z][A-Za-z0-9]*$/.test(className))
    throw new SbError(
      `"${className}" is not a PascalCase class name; give one with --app`,
    );
  const fileBase = kebabCase(className);
  const appClass = `${className}App`;

  const files: Record<string, string> = {
    'package.json': json({
      name: options.name,
      version: '0.1.0',
      description: `${className} app for SyncBridge`,
      type: 'module',
      module: './index.js',
      types: './index.d.ts',
      scripts: {
        build: 'spm build --tsconfig tsconfig-build.json -o build',
        pack: 'spm pack --tsconfig tsconfig-build.json -o dist',
        test: 'mocha',
        verify: 'spm verify --tsconfig tsconfig-build.json',
      },
      peerDependencies: { '@syncbridge/common': commonRange() },
      devDependencies: sortKeys({
        ...DEV_TOOLS,
        '@syncbridge/common': commonRange(),
        '@syncbridge/syncbuild': `^${version}`,
        '@syncbridge/testing': TESTING_RANGE,
      }),
    }),
    [MANIFEST_FILE]: json({}),
    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        declaration: true,
        rootDir: '.',
        types: ['node', 'mocha'],
      },
      include: ['src', 'test'],
    }),
    /* The package is built from src alone, its entry point at the root */
    'tsconfig-build.json': json({
      extends: './tsconfig.json',
      compilerOptions: { rootDir: 'src', types: ['node'] },
      include: ['src'],
    }),
    '.mocharc.cjs': `/** Runs the TypeScript tests in test/ as they are, without a build */
process.env.TS_NODE_PROJECT = __dirname + '/tsconfig.json';

/** @type {import('mocha').MochaOptions} */
module.exports = {
  require: ['@swc-node/register/esm-register'],
  extension: ['ts'],
  spec: 'test/**/*.spec.ts',
  timeout: 30000,
};
`,
    '.gitignore': 'node_modules\nbuild\ndist\n.spm\n',
    'README.md': `# ${options.name}

${className} app for SyncBridge.

\`\`\`sh
npm install
npm test        # the app in a SyncBridge test environment (@syncbridge/testing)
npm run build   # into build/
npm run verify  # installs it as SyncBridge does and starts it in a worker
npm run pack    # the package to upload to SyncBridge, in dist/
\`\`\`

Each app and component tells what it does in
\`docs/<ClassName>/README.md\`: its README, shown on its page in the
Marketplace - what it links to beside it, in its directory.
`,
    [`docs/${appClass}/README.md`]: `# ${className}

What ${className} does, and how it is set up: shown on its page in the
Marketplace.

## Variables

- **Greeting** - what the app says when it starts (default: \`Hello\`).
`,
    'src/index.ts': `export * from './${fileBase}.app.js';\n`,
    [`src/${fileBase}.app.ts`]: `import { DefineVariable, App, AppBase } from '@syncbridge/common';

export class ${className}Variables {
  @DefineVariable({
    label: 'Greeting',
    description: 'What the app says when it starts',
    default: 'Hello',
  })
  declare greeting: string;
}

@App({
  displayName: '${className}',
  description: '${className} app',
})
export class ${appClass} extends AppBase {
  @App.UseVariables(${className}Variables)
  declare values: ${className}Variables;

  protected async _start(abortSignal?: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this.logger?.info(\`\${this.values.greeting} from \${this.name}\`);
  }
}
`,
    [`test/${fileBase}.app.spec.ts`]: `import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { ${appClass} } from '../src/index.js';

describe('${appClass}', () => {
  /* This package, registered with the extensions it depends on */
  const env = createTestEnv();

  afterEach(() => env.reset());
  after(() => env.dispose());

  it('should start and greet', async () => {
    const app = await env.start(${appClass}, {
      values: { greeting: 'Hi' },
    });
    expect(env.logs(app).messages).toContain('Hi from ${appClass}');
  });
});
`,
  };

  const existing = Object.keys(files).filter(f =>
    fs.existsSync(path.join(directory, f)),
  );
  if (existing.length)
    throw new SbError(
      `${directory} already has ${existing.join(', ')}; nothing was written`,
    );
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { directory, files: Object.keys(files) };
}

/** The range of @syncbridge/common syncbuild itself is built against */
function commonRange(): string {
  const require = createRequire(import.meta.url);
  /* Beside this module in build/, one level up from src/ */
  for (const file of ['./package.json', '../package.json']) {
    try {
      const pkgJson = require(file);
      if (pkgJson.name === '@syncbridge/syncbuild')
        return pkgJson.peerDependencies?.['@syncbridge/common'] || '*';
    } catch {
      /* not there: the other layout */
    }
  }
  return '*';
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function pascalCase(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function kebabCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
