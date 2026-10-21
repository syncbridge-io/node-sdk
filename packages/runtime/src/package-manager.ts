import { spawn } from 'node:child_process';
import type { ILogger } from '@syncbridge/common';
import { SbError } from '@syncbridge/common';

/** The environment variable that points at a pnpm other than the one on PATH */
export const SB_PNPM_PATH = 'SB_PNPM_PATH';

/**
 * The arguments every extension's npm dependencies are installed with.
 *
 * - `--prod`: the package's dependencies, without its devDependencies. A
 *   package carries no lockfile: its ranges are resolved when it is
 *   installed, and the `pnpm-lock.yaml` pnpm writes in its directory records
 *   what it runs on from then on.
 * - `--store-dir`, `--package-import-method hardlink`: files are hardlinked
 *   from one store shared by every extension, not copied per extension.
 * - `auto-install-peers=true`: the peers of the package's npm dependencies
 *   are installed with them - a @syncbridge library declares what it uses
 *   as peers, and nobody else would install them. Those the host shares
 *   (`@syncbridge/common`, the registry packages' peers) still resolve to
 *   the host's copy in the worker. The package's own peers are not given
 *   to pnpm (installDependencies): they are the host's alone.
 * - `strict-dep-builds=false`: dependencies' build scripts are not run - a
 *   pnpm default kept on purpose - but skipping them is not a failure.
 *   pnpm 12 exits with 1 for skipped scripts otherwise, although the install
 *   is complete (measured with oracledb, which then loads in thin mode).
 * - `--no-frozen-lockfile`: the lockfile follows the package.json written
 *   for the plan. pnpm keeps it as it is when the environment says CI
 *   (`CI=true`), and refuses an install whose plan changed.
 */
export function pnpmInstallArgs(storeDir: string): string[] {
  return [
    'install',
    '--prod',
    '--store-dir',
    storeDir,
    '--package-import-method',
    'hardlink',
    '--config.auto-install-peers=true',
    '--config.strict-dep-builds=false',
    '--no-frozen-lockfile',
  ];
}

/**
 * Runs the package manager. An object, so tests can replace `install`.
 */
export const packageManager = {
  /**
   * Installs the npm dependencies of the package in `cwd`.
   */
  async install(options: {
    cwd: string;
    storeDir: string;
    /**
     * The command that runs pnpm, with its leading arguments - for a pnpm
     * run through Node.js. Default: `SB_PNPM_PATH`, else `pnpm` on PATH.
     */
    pnpm?: string[];
    /** More arguments, after pnpmInstallArgs */
    args?: string[];
    /** The level pnpm's output is logged at; default `trace` */
    outputLevel?: 'trace' | 'debug' | 'info';
    logger?: ILogger;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const [bin, ...prefix] = options.pnpm || [
      process.env[SB_PNPM_PATH] || 'pnpm',
    ];
    const args = [
      ...prefix,
      ...pnpmInstallArgs(options.storeDir),
      ...(options.args || []),
    ];
    const level = options.outputLevel || 'trace';
    const output: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd: options.cwd,
        signal: options.abortSignal,
        stdio: ['ignore', 'pipe', 'pipe'],
        /* Windows resolves pnpm.cmd only through a shell */
        shell: process.platform === 'win32' && !options.pnpm,
      });
      const collect = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (!line.trim()) continue;
          output.push(line);
          options.logger?.[level](line);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (err: any) =>
        reject(
          new SbError(
            err.code === 'ENOENT'
              ? `pnpm was not found ("${bin}"). Install pnpm or set ${SB_PNPM_PATH}`
              : `pnpm could not be started: ${err.message}`,
            { cause: err },
          ),
        ),
      );
      child.once('close', code => {
        if (code === 0) return resolve();
        reject(
          new SbError(
            `Installing dependencies failed (pnpm exited with ${code}).\n` +
              output.slice(-20).join('\n'),
            { code: 'DEPENDENCY_INSTALL_FAILED' },
          ),
        );
      });
    });
  },
};
