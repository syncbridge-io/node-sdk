import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import {
  checkOutDir,
  makeTempDir,
  moveContents,
  prepareBuildDir,
  removeTempDir,
} from '../src/builder/utils/out-dir.js';

describe('output directory', () => {
  it('should refuse the package directory and its ancestors', () => {
    const pkg = path.resolve('/work/packages/prc');
    expect(() => checkOutDir(pkg, pkg)).toThrow(/contains the package/);
    expect(() => checkOutDir(path.dirname(pkg), pkg)).toThrow(
      /contains the package/,
    );
    expect(() => checkOutDir(path.join(pkg, 'build'), pkg)).not.toThrow();
    expect(() => checkOutDir('/elsewhere', pkg)).not.toThrow();
  });

  it('should move the build into the output directory itself', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-out-'));
    try {
      const out = path.join(root, 'build');
      const tmp = path.join(out, 'tmp-x');
      fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'index.js'), '');
      moveContents(tmp, out);
      expect(fs.readdirSync(out).sort()).toEqual(['index.js', 'lib', 'tmp-x']);
      expect(fs.readdirSync(tmp)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  describe("spm build's directory", () => {
    let root: string;
    const write = (file: string, content = '') => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-out-'));
    });
    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('should take a missing or empty directory as it is', () => {
      expect(() =>
        prepareBuildDir(path.join(root, 'none'), '@test/prc'),
      ).not.toThrow();
      fs.mkdirSync(path.join(root, 'empty'));
      prepareBuildDir(path.join(root, 'empty'), '@test/prc');
      expect(fs.existsSync(path.join(root, 'empty'))).toBe(true);
    });

    it("should empty a build of the package, and only the package's", () => {
      const out = path.join(root, 'build');
      write(
        path.join(out, 'package.json'),
        JSON.stringify({ name: '@test/prc' }),
      );
      write(path.join(out, 'syncbridge-manifest.json'), '{}');
      write(path.join(out, 'stale.js'));
      prepareBuildDir(out, '@test/prc');
      expect(fs.readdirSync(out)).toEqual([]);

      /* Another package's build is not this one's */
      write(
        path.join(out, 'package.json'),
        JSON.stringify({ name: '@test/other' }),
      );
      write(path.join(out, 'syncbridge-manifest.json'), '{}');
      expect(() => prepareBuildDir(out, '@test/prc')).toThrow(
        /is not empty, and not a build of @test\/prc: nothing in it is removed/,
      );
      expect(fs.readdirSync(out).sort()).toEqual([
        'package.json',
        'syncbridge-manifest.json',
      ]);
    });

    it('should leave anything else as it is, unless told to clean it', () => {
      const out = path.join(root, 'mine');
      write(path.join(out, 'notes.txt'), 'keep me');
      expect(() => prepareBuildDir(out, '@test/prc')).toThrow(/--clean/);
      expect(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8')).toBe(
        'keep me',
      );
      prepareBuildDir(out, '@test/prc', true);
      expect(fs.readdirSync(out)).toEqual([]);
    });
  });

  describe('the temp directory', () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-tmp-'));
    });
    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("should be spm's own: in the package's .spm, or in the one given", () => {
      const pkg = path.join(root, 'prc');
      const made = makeTempDir(pkg);
      expect(path.dirname(made)).toBe(path.join(pkg, '.spm'));
      /* Removed, and the package's .spm with it */
      removeTempDir(made, pkg);
      expect(fs.existsSync(path.join(pkg, '.spm'))).toBe(false);
      const given = path.join(root, 'scratch');
      const inGiven = makeTempDir(pkg, given);
      expect(path.dirname(inGiven)).toBe(given);
      expect(inGiven).not.toBe(given);
      /* The one given is the user's: it stays */
      removeTempDir(inGiven, pkg);
      expect(fs.existsSync(given)).toBe(true);
    });
  });
});
