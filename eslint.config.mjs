import panatesEslint from '@panates/eslint-config-ts';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**/*',
      'packages/*/node_modules/**/*',
      'packages/*/build/**/*',
      'packages/*/dist/**/*',
      'packages/*/tmp-*',
      'packages/*/coverage/**/*',
      // Claude Code's local state, including agent worktrees
      '.claude/**',
    ],
  },
  ...panatesEslint.configs.node,
  {
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
];
