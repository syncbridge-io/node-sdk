import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 *
 */
export function locatePackageJson(
  directory: string,
  depth: number = 10,
): string | undefined {
  if (directory.startsWith('file:')) directory = fileURLToPath(directory);
  for (let i = 0; i < depth; i++) {
    const f = path.resolve(directory, 'package.json');
    if (fs.existsSync(f)) {
      return directory;
    }
    directory = path.dirname(directory);
  }
}

export function resolvePackageJson(directory: string): any | undefined {
  const pkg = locatePackageJson(directory);
  if (!pkg) return;
  const content = fs.readFileSync(path.resolve(pkg, 'package.json'), 'utf-8');
  return JSON.parse(content);
}
