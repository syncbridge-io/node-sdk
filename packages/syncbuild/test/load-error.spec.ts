import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SbError } from '@syncbridge/common';
import { expect } from 'expect';
import { describeLoadError } from '../src/builder/utils/load-error.js';

function notFound(message: string) {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('describeLoadError', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-load-')),
    );
    /* A workspace package, linked into node_modules as npm does */
    const lib = path.join(root, 'packages', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(
      path.join(lib, 'package.json'),
      JSON.stringify({ name: '@test/lib' }),
    );
    fs.mkdirSync(path.join(root, 'node_modules', '@test'), { recursive: true });
    fs.symlinkSync(lib, path.join(root, 'node_modules', '@test', 'lib'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should tell to build a workspace package that has no build', () => {
    const file = path.join(root, 'node_modules', '@test', 'lib', 'index.js');
    const err = describeLoadError(
      notFound(`Cannot find module '${file}' imported from /tmp/x/index.js`),
      '@test/prc',
      root,
    );
    expect(err).toBeInstanceOf(SbError);
    expect(err.message).toBe(
      '@test/prc could not be loaded to read its metadata: "@test/lib" is a ' +
        'package of this workspace and has not been built (' +
        path.join(root, 'packages', 'lib', 'build') +
        ' not found). Build it first, then run spm again.',
    );
    expect(err.cause?.message).toMatch(/^Cannot find module/);
  });

  it('should tell a dependency the built code cannot reach from a broken install', () => {
    /* Installed for the package, imported from code built elsewhere */
    const elsewhere = path.join(os.tmpdir(), 'elsewhere', 'index.js');
    const err = describeLoadError(
      notFound(
        `Cannot find module '@test/lib': @test/lib cannot be resolved in file://${elsewhere}`,
      ),
      '@test/prc',
      path.join(root, 'packages', 'prc'),
    );
    expect(err.message).toMatch(
      /"@test\/lib" is installed for the package, but the built code in .*elsewhere cannot reach it/,
    );
  });

  it('should find the package a bare import names', () => {
    const err = describeLoadError(
      notFound(`Cannot find module '@test/lib': cannot be resolved`),
      '@test/prc',
      path.join(root, 'packages', 'prc'),
    );
    expect(err.message).toMatch(
      /"@test\/lib" is a package of this workspace and has not been built/,
    );
  });

  it('should tell to install a package that is not installed', () => {
    const err = describeLoadError(
      notFound(`Cannot find package 'date-fns' imported from /tmp/x/index.js`),
      '@test/prc',
      root,
    );
    expect(err.message).toMatch(
      /imports "date-fns", which is not installed\. Add it to "dependencies"/,
    );
  });

  it('should keep the first line of any other error', () => {
    const err = describeLoadError(
      new TypeError('x is not a function\n    at foo'),
      '@test/prc',
      root,
    );
    expect(err.message).toBe(
      '@test/prc could not be loaded to read its metadata: x is not a function',
    );
  });
});
