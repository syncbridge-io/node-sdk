import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where this library's code is (src/ or build/): its frames are never
 * the caller, though the package's own tests are */
const OWN_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The file that called into this package: the test, whose location says
 * which package is under test and where its snapshots live. The working
 * directory cannot: a monorepo runs every package's tests from its root.
 */
export function callerFile(): string | undefined {
  const stack = new Error().stack?.split('\n').slice(1) || [];
  for (const line of stack) {
    /* "at fn (location)" or "at location", location ending in :line:col */
    const m = /^\s*at (?:.*\()?(.+?):\d+:\d+\)?$/.exec(line);
    if (!m || m[1].startsWith('node:')) continue;
    const file = m[1].startsWith('file:') ? fileURLToPath(m[1]) : m[1];
    if (!path.isAbsolute(file) || !fs.existsSync(file)) continue;
    if (file.startsWith(OWN_DIR + path.sep)) continue;
    if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    return file;
  }
}
