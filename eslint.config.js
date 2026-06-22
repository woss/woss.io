import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

// ESLint serializes config for caching, but svelteConfig.compilerOptions.runes
// is a function (per-file runes check). Replace with static value for linting.
const lintSvelteConfig = {
  ...svelteConfig,
  compilerOptions: {
    ...svelteConfig.compilerOptions,
    runes: true,
  },
};

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    plugins: { 'better-tailwindcss': betterTailwindcss },
    rules: { 'better-tailwindcss/enforce-canonical-classes': 'warn' },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-expressions': ['error', { allowTaggedTemplates: true }],
      // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
      // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig: lintSvelteConfig,
      },
    },
  },
  {
    // Override or add rule settings here, such as:
    // 'svelte/button-has-type': 'error'
    rules: {},
  },
);
