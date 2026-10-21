#!/usr/bin/env node

import * as console from 'node:console';
import process from 'node:process';
import { SbError } from '@syncbridge/common';
import colors from 'ansi-colors';
import { Command, program } from 'commander';
import { openBrowser, signIn, signOut, whoAmI } from './commands/account.js';
import { addDependency } from './commands/add-dependency.js';
import { checkPackage } from './commands/check-package.js';
import {
  ApprovalRequiredError,
  publishPackage,
} from './commands/publish-package.js';
import { verifyPackage } from './commands/verify-package.js';
import { viewPackage } from './commands/view-package.js';
import { version } from './constants.js';
import { initPackage } from './init-package.js';
import { packPackage } from './pack-package.js';

function addBuildOptions(cmd: Command) {
  return cmd
    .option('-p, --package-dir <directory>', 'Directory of package')
    .option('-o, --out <directory>', 'Output directory', 'dist')
    .option(
      '--temp-dir <directory>',
      'Directory to make the temp build directory in (only that is removed)',
    )
    .option('--tsconfig <fileName>', 'tsconfig file name', 'tsconfig.json');
}

/**
 * Prints what went wrong and how to fix it. The stack only helps when spm
 * itself is at fault, so it is printed with --verbose alone.
 */
function fail(e: any) {
  console.error(colors.red(e instanceof Error ? e.message : String(e)));
  if (program.opts().verbose) console.error(e?.cause ?? e);
  else if (!(e instanceof SbError))
    console.error(colors.gray('Run with --verbose for the details.'));
  /* One that waits on no one: told apart, to stop rather than retry */
  process.exitCode = e instanceof ApprovalRequiredError ? 3 : 1;
}

async function build(options: any, pack: boolean) {
  if (options.color === false) colors.enabled = false;
  console.log(colors.yellow('**** SyncBuild v' + version + ' ****'));
  return packPackage({
    pack,
    packageDir: options.packageDir,
    outDir: options.out,
    tsconfig: options.tsconfig,
    tempDir: options.tempDir,
    clean: options.clean,
    logger: console.log,
  });
}

program.version(version).description('SyncBridge® extension package builder');

const buildCommand = program
  .command('build')
  .description('Builds the package into a directory')
  .option(
    '--clean',
    'Empties the output directory even when it is not a build of the package',
  )
  .action(options => build(options, false).catch(fail));
addBuildOptions(buildCommand);

const packCommand = program
  .command('pack')
  .description('Builds the package into a zip to upload to SyncBridge')
  .action(options => build(options, true).catch(fail));
addBuildOptions(packCommand);

program
  .command('add <spec>')
  .description(
    'Adds a registry dependency: manifest dependencies, its @sbext types and the tsconfig paths entry. Example: spm add @vendor/name@^1.2.0',
  )
  .option('-p, --package-dir <directory>', 'Directory of package', '.')
  .option('--tsconfig <fileName>', 'tsconfig file name', 'tsconfig.json')
  .action((spec, options) => {
    try {
      const r = addDependency(options.packageDir, spec, options.tsconfig);
      console.log(
        `Added ${colors.magenta(r.name + '@' + r.range)}` +
          (r.changed.length ? ` (${r.changed.join(', ')})` : ' (no changes)') +
          '. Run your package manager install to fetch its types.',
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command('check')
  .description(
    'Checks the registry dependencies of the package are declared consistently',
  )
  .option('-p, --package-dir <directory>', 'Directory of package', '.')
  .option('--tsconfig <fileName>', 'tsconfig file name', 'tsconfig.json')
  .action(options => {
    try {
      const r = checkPackage(options.packageDir, options.tsconfig);
      for (const w of r.warnings) console.log(colors.yellow('⚠ ' + w));
      for (const e of r.errors) console.error(colors.red('✖ ' + e));
      if (r.errors.length) process.exitCode = 1;
      else console.log(colors.green('✔ No problems found'));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('init')
  .description('Creates an extension package with an example app and its test')
  .argument('<name>', 'Registry name of the package, @vendor/name')
  .argument(
    '[directory]',
    'Where to create it; default: the name after the slash',
  )
  .option('--app <className>', 'Class name of the example app, without "App"')
  .action((name: string, directory: string | undefined, options) => {
    try {
      const r = initPackage({ name, directory, app: options.app });
      console.log(`Created ${colors.magenta(name)} in ${r.directory}:`);
      for (const f of r.files) console.log('  ' + f);
      console.log(
        `Next: cd ${directory || name.split('/')[1]} && npm install && npm test`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command('verify')
  .description(
    'Packs the package, installs it as SyncBridge does, and in a worker loads its classes and creates its apps, without starting them; a package of components alone has its classes loaded',
  )
  .option('-p, --package-dir <directory>', 'Directory of package', '.')
  .option('--tsconfig <fileName>', 'tsconfig file name')
  .option(
    '--profile <files...>',
    'Profiles to create (YAML or JSON), or directories of them; default: each app with its default values',
  )
  .option(
    '--with <archives...>',
    'Archives of registry packages to install first, when the project does not have them',
  )
  .option('--timeout <ms>', 'How long creating an app may take', '30000')
  .option('--keep', 'Leave the sandbox in place, for inspection', false)
  .action(async options => {
    if (options.color === false) colors.enabled = false;
    console.log(colors.yellow('**** SyncBuild v' + version + ' ****'));
    try {
      const r = await verifyPackage({
        packageDir: options.packageDir,
        tsconfig: options.tsconfig,
        profile: options.profile,
        with: options.with,
        timeout: Number(options.timeout),
        keep: options.keep,
        logger: console.log,
      });
      for (const p of r.apps) {
        if (p.created)
          console.log(
            colors.green(`✔ ${p.app} ${p.loadOnly ? 'loaded' : 'created'}`) +
              (p.components.length
                ? colors.gray(
                    ` (${p.loadOnly ? 'classes' : 'components'}: ${p.components.join(', ')})`,
                  )
                : ''),
          );
        else console.error(colors.red(`✖ ${p.app}: ${p.message}`));
        if (p.notCreated?.length)
          console.log(
            colors.yellow(
              `  Not created: ${p.notCreated.join(', ')} - a required component is to be chosen; give a profile with --profile`,
            ),
          );
      }
      if (r.sandbox) console.log(`Sandbox kept at ${r.sandbox}`);
      if (!r.ok) process.exitCode = 1;
    } catch (e) {
      fail(e);
    }
  });

program
  .command('publish')
  .description(
    'Publishes the package to the registry: packed first, unless an archive is given; files of its documents the registry has are not sent again',
  )
  .argument(
    '[archive]',
    'A packed archive (spm pack); default: the package, packed',
  )
  .option('-p, --package-dir <directory>', 'Directory of package', '.')
  .option('--tsconfig <fileName>', 'tsconfig file name', 'tsconfig.json')
  .option(
    '--temp-dir <directory>',
    'Directory to make the temp build directory in (only that is removed)',
  )
  .option(
    '--registry <url>',
    'The registry; default: SB_REGISTRY_URL, or registry.syncbridge.io',
  )
  .option(
    '--access <access>',
    'public or private: who may see it - a new package is private unless told',
  )
  .option('--dry-run', 'Tells what would be sent, sending nothing', false)
  .option(
    '--no-browser',
    'Does not open the browser to approve it: the address is shown',
  )
  .option(
    '--no-ci',
    'In GitHub Actions, publishes as the signed-in user, not as the job',
  )
  .option(
    '--no-wait',
    'When the registry asks it approved in Console: fails at once (exit code 3) rather than waits',
  )
  .option(
    '--skip-existing',
    'A version the registry has already is skipped, not an error: a release run again safely',
    false,
  )
  .action(async (archive: string | undefined, options) => {
    console.log(colors.yellow('**** SyncBuild v' + version + ' ****'));
    try {
      if (options.access && !['public', 'private'].includes(options.access))
        throw new SbError('--access is public or private');
      const r = await publishPackage({
        archive,
        packageDir: options.packageDir,
        tsconfig: options.tsconfig,
        tempDir: options.tempDir,
        registry: options.registry,
        access: options.access,
        dryRun: options.dryRun,
        ci: options.ci === false ? false : undefined,
        skipExisting: options.skipExisting,
        wait: options.wait,
        logger: console.log,
        onApproval: ({ url }) => {
          console.log(
            `Approve the publish in Console, with your second factor: ${colors.cyan(url)}`,
          );
          if (options.browser !== false && openBrowser(url))
            console.log(
              colors.gray(
                'Opened in your browser - waiting for your approval...',
              ),
            );
          else console.log(colors.gray('Waiting for your approval...'));
        },
      });
      if (r.skipped) {
        console.log(
          colors.gray(
            `- ${r.name}@${r.version} is already published to ${r.registry}: skipped`,
          ),
        );
        return;
      }
      const kb = (n: number) =>
        n >= 1024 * 1024
          ? `${(n / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(n / 1024))} KB`;
      const saved = r.reused.reduce((n, d) => n + d.size, 0);
      if (r.ci)
        console.log(
          colors.gray(
            'As the GitHub Actions job: its OIDC token, trusted by the organization',
          ),
        );
      console.log(
        `${r.dryRun ? 'Would send' : 'Sent'} ${kb(r.sentBytes)}` +
          (r.reused.length
            ? colors.gray(
                ` - ${r.reused.length} document file${r.reused.length > 1 ? 's' : ''} (${kb(saved)}) the registry has, not sent`,
              )
            : ''),
      );
      if (r.dryRun)
        console.log(
          colors.green(
            `✔ ${r.name}@${r.version} may be published to ${r.registry}`,
          ) + (r.created ? colors.gray(' - a new package') : ''),
        );
      else
        console.log(
          colors.green(`✔ Published ${r.name}@${r.version} to ${r.registry}`) +
            (r.created
              ? colors.gray(` - a new package, ${options.access ?? 'private'}`)
              : ''),
        );
    } catch (e) {
      fail(e);
    }
  });

program
  .command('view <name>')
  .description(
    'Tells the published versions of a package (@org/name[@version]), as its publisher would see them',
  )
  .option(
    '--registry <url>',
    'The registry; default: SB_REGISTRY_URL, or registry.syncbridge.io',
  )
  .option('--json', 'Prints {"name", "versions"} alone, newest first', false)
  .option(
    '--no-ci',
    'In GitHub Actions, asks as the signed-in user, not as the job',
  )
  .action(async (name: string, options) => {
    try {
      const r = await viewPackage({
        name,
        registry: options.registry,
        ci: options.ci === false ? false : undefined,
      });
      if (options.json)
        process.stdout.write(
          JSON.stringify({ name: r.name, versions: r.versions }) + '\n',
        );
      else if (!r.versions.length)
        console.log(colors.gray(`${name} is not published to ${r.registry}`));
      else for (const v of r.versions) console.log(v);
    } catch (e) {
      fail(e);
    }
  });

program
  .command('login')
  .description(
    'Signs in to the registry: a code to enter in a browser, on any device',
  )
  .option(
    '--registry <url>',
    'The registry; default: SB_REGISTRY_URL, or registry.syncbridge.io',
  )
  .option('--no-browser', 'Does not open the browser: the address is shown')
  .action(async options => {
    try {
      const r = await signIn({
        registry: options.registry,
        onCode: code => {
          const url = code.verificationUriComplete ?? code.verificationUri;
          console.log(
            `Enter the code ${colors.bold(colors.magenta(code.userCode))} at ${colors.cyan(code.verificationUri)}`,
          );
          if (options.browser !== false && openBrowser(url))
            console.log(
              colors.gray(
                'Opened in your browser - waiting for you to sign in...',
              ),
            );
          else
            console.log(
              colors.gray(`Or open ${url} - waiting for you to sign in...`),
            );
        },
      });
      console.log(
        colors.green(`✔ Signed in to ${r.registry}`) +
          (r.username ? ` as ${colors.magenta(r.username)}` : ''),
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command('logout')
  .description('Signs out of the registry: the sign-in revoked and forgotten')
  .option(
    '--registry <url>',
    'The registry; default: SB_REGISTRY_URL, or registry.syncbridge.io',
  )
  .action(async options => {
    try {
      const r = await signOut({ registry: options.registry });
      console.log(
        r.signedOut
          ? colors.green(`✔ Signed out of ${r.registry}`)
          : `Not signed in to ${r.registry}`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command('whoami')
  .description('Tells who you are signed in as, and your organizations')
  .option(
    '--registry <url>',
    'The registry; default: SB_REGISTRY_URL, or registry.syncbridge.io',
  )
  .action(async options => {
    try {
      const r = await whoAmI({ registry: options.registry });
      console.log(
        `${colors.magenta(r.username)}${r.fullName ? ` (${r.fullName})` : ''} at ${r.registry}`,
      );
      for (const o of r.organizations)
        console.log(
          `  @${o.name}` +
            (o.displayName ? ` ${colors.gray(o.displayName)}` : '') +
            (o.role ? colors.gray(` - ${o.role}`) : ''),
        );
      if (!r.organizations.length)
        console.log(colors.gray('  A member of no organization yet'));
    } catch (e) {
      fail(e);
    }
  });

program.option('--no-color', 'Disables colors in logs messages', false);
/* Asked anywhere, before the command or after it: no colors at all */
program.hook('preAction', (_, command) => {
  if (program.opts().color === false || command.opts().color === false)
    colors.enabled = false;
});
program.option('--verbose', 'Prints the stack of errors', false);

program.parse(process.argv);
