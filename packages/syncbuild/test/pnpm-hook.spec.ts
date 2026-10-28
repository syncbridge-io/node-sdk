import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SDK_PACKAGES } from '@syncbridge/common';
import { SDK_PACKAGES as HOOK_SDK } from '@syncbridge/pnpm-config';
import { expect } from 'expect';
import {
  configuredVersion,
  PNPM_CONFIG_PACKAGE,
  pnpmConfigVersion,
  PNPMFILE,
  PNPMFILE_SOURCE,
  pnpmHookState,
  usesPnpm,
} from '../src/pnpm-hook.js';

describe("spm's pnpm hook", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncbuild-pnpm-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = (version: string) =>
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      `packages: [packages/*]\nconfigDependencies:\n  '${PNPM_CONFIG_PACKAGE}': ${version}+sha512-x\n`,
    );

  it('should tell a workspace by its lockfile, its workspace file or its packageManager', () => {
    expect(usesPnpm(root)).toBe(false);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
    );
    expect(usesPnpm(root)).toBe(true);
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), '');
    expect(usesPnpm(root)).toBe(true);
  });

  it('should read the config dependency the workspace takes, its integrity left', () => {
    expect(configuredVersion(root)).toBeUndefined();
    config('1.2.3');
    expect(configuredVersion(root)).toBe('1.2.3');
  });

  it('should be the hook once the file takes it and the config dependency is there, of this version or newer', () => {
    expect(pnpmHookState(root)).toBe('missing');
    fs.writeFileSync(path.join(root, PNPMFILE), PNPMFILE_SOURCE);
    expect(pnpmHookState(root)).toBe('missing');
    config(pnpmConfigVersion());
    expect(pnpmHookState(root)).toBe('current');
    config('0.0.1');
    expect(pnpmHookState(root)).toBe('outdated');
    fs.writeFileSync(path.join(root, PNPMFILE), '// mine\n');
    expect(pnpmHookState(root)).toBe('own');
  });

  it("should take the hook's SDK as common's", () => {
    expect([...HOOK_SDK].sort()).toEqual([...SDK_PACKAGES].sort());
  });
});
