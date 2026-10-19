import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { callerFile } from './caller.js';

export interface SnapshotOptions {
  /** Properties, at any depth, whose values change from run to run */
  ignore?: string[];
  /** The test file the snapshot belongs to; default: the caller */
  file?: string;
}

const IGNORED = '<ignored>';

/**
 * Compares `value` with the snapshot `name` kept beside the test in
 * `__snapshots__/<test file>.json`, as JSON. A missing snapshot is written,
 * except under CI; UPDATE_SNAPSHOTS=1 rewrites them.
 */
export function expectSnapshot(
  value: unknown,
  name: string,
  options: SnapshotOptions = {},
): void {
  const testFile = options.file || callerFile();
  if (!testFile) throw new Error('Can not tell which test file this is');
  const file = path.join(
    path.dirname(testFile),
    '__snapshots__',
    path.basename(testFile).replace(/\.[cm]?[jt]sx?$/, '') + '.json',
  );
  const actual = normalize(value, new Set(options.ignore || []));
  const snapshots: Record<string, unknown> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  if (!(name in snapshots) || update) {
    if (!update && process.env.CI)
      throw new Error(
        `Snapshot "${name}" does not exist; write it locally and commit ${path.basename(file)}`,
      );
    snapshots[name] = actual;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshots, null, 2) + '\n');
    return;
  }
  assert.deepStrictEqual(
    actual,
    snapshots[name],
    `Snapshot "${name}" differs (UPDATE_SNAPSHOTS=1 rewrites it)`,
  );
}

/** A JSON round trip, with ignored properties replaced */
function normalize(value: unknown, ignore: Set<string>): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      key && ignore.has(key) && v !== undefined ? IGNORED : v,
    ) ?? 'null',
  );
}
