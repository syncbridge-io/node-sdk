import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_FILE, SbError } from '@syncbridge/common';

/**
 * The output directory is never the package itself or one of its
 * ancestors: `spm build` empties it when it is a build of the package.
 */
export function checkOutDir(outDir: string, packageDir: string) {
  const rel = path.relative(outDir, packageDir);
  if (!rel || !rel.startsWith('..'))
    throw new SbError(
      `Output directory "${outDir}" contains the package; ` +
        `choose a directory of its own (-o)`,
    );
}

/**
 * Whether a directory holds a build of the package: what `spm build`
 * writes - a package.json naming it, its manifest beside
 */
export function isBuildOf(dir: string, packageName: string): boolean {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    return (
      pkgJson?.name === packageName &&
      fs.existsSync(path.join(dir, MANIFEST_FILE))
    );
  } catch {
    return false;
  }
}

/**
 * Makes `spm build`'s output directory ready: the package is written into
 * it, so a previous build's files must go - but only a build's. An empty
 * directory is used as it is, a build of the package is emptied; anything
 * else is left as it is, and the build refused, unless `clean` says to
 * empty it.
 */
export function prepareBuildDir(
  outDir: string,
  packageName: string,
  clean = false,
) {
  if (!fs.existsSync(outDir)) return;
  const entries = fs.readdirSync(outDir);
  if (!entries.length) return;
  if (!clean && !isBuildOf(outDir, packageName))
    throw new SbError(
      `Output directory "${outDir}" is not empty, and not a build of ` +
        `${packageName}: nothing in it is removed. Empty it, choose another ` +
        `(-o), or run with --clean to empty it.`,
    );
  for (const entry of entries)
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
}

/**
 * Moves the entries of `srcDir` into `destDir`: `spm build` writes the
 * package into the output directory itself, so the directory can be
 * published as it is. The two may be on different devices (the temp
 * directory is the package's): what cannot be renamed is copied.
 */
export function moveContents(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, entry);
    const to = path.join(destDir, entry);
    try {
      fs.renameSync(from, to);
    } catch (e: any) {
      if (e?.code !== 'EXDEV') throw e;
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  }
}

/** Where spm makes its temp directories in a package, by default */
export const TEMP_DIR = '.spm';

/**
 * The directory a build is made in, before its output is written: a new
 * one of spm's own, removed after - inside `tempDir` when one is given
 * (which is itself never removed), else in the package's .spm, so the
 * built code, imported to read its metadata, resolves the package's
 * dependencies as the package does
 */
export function makeTempDir(packageDir: string, tempDir?: string): string {
  const parent = path.resolve(packageDir, tempDir ?? TEMP_DIR);
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, 'build-'));
}

/**
 * Removes a directory makeTempDir made - and the package's .spm with it,
 * left empty; a `tempDir` given is the user's, and stays
 */
export function removeTempDir(dir: string, packageDir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  const parent = path.dirname(dir);
  if (parent !== path.resolve(packageDir, TEMP_DIR)) return;
  try {
    fs.rmdirSync(parent);
  } catch {
    /* Not empty: another build's, still going */
  }
}
