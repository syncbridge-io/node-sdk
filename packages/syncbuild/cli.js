#!/usr/bin/env node
/*
 * spm in this checkout: its source, run as the tests run it (swc-node,
 * the monorepo's tsconfig-test.json paths) - the workspace packages here
 * are laid out to be published from build/, so neither build/cli.js nor
 * the packages it imports resolve in place. The published package's
 * spm is build/cli.js; this file is not in it.
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TS_NODE_PROJECT ??= fileURLToPath(
  new URL('../../../tsconfig-test.json', import.meta.url),
);
/* swc-node's esm-register resolves itself from the working directory:
 * spm runs in the package it builds, so it is resolved from here */
register('@swc-node/register/esm', import.meta.url);
await import('./src/cli.ts');
