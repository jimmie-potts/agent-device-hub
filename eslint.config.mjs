// Static bug detection for maintained JavaScript and TypeScript (Hub #765).
// docs/development.md "Static analysis" records the coverage, exclusions and how a package adds stricter rules.
import js from '@eslint/js';
import {defineConfig, includeIgnoreFile} from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import {fileURLToPath} from 'node:url';
import tseslint from 'typescript-eslint';
import bunny from './scripts/eslint/bunny-rules.mjs';

const unused = {
  argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_',
  ignoreRestSiblings: true,
};
// New code under the strict profile (Hub #867). Staged imported code joins when its module story converts it.
// tests/strict_profile.test.mjs reads both lists, so its convention guards follow any path added here.
export const strict = ['apps/runtime/**/*.{ts,tsx}', 'packages/sdk/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}', 'packages/event-contracts/src/v2/**/*.ts'];
export const staged = ['modules/pixoo/**'];
// Tests, their fixtures and helpers read an error to report a failure and spell out the bodies they expect, so the
// safe-error rules (Hub #953) skip them. The strict rules still apply.
const tests = ['**/tests/**', '**/*.test.{ts,tsx,js,mjs}'];
// Named entry points that own the process's standard streams, so `bunny/no-console` skips them: the runtime's journal
// sink and its process entry (the ready line and usage), and the verification run's supervisor and network guard.
export const streamOwners = ['apps/runtime/src/log.ts', 'apps/runtime/src/process.ts', 'apps/runtime/verify/guard.ts', 'apps/runtime/verify/supervisor.ts'];
// Code under the profile has no inline ESLint comments: each one is ignored and reported, and lint allows no
// warnings. An exception is a config entry after the profile blocks, scoped to its files, with a comment saying why.
const noInlineConfig = {noInlineConfig: true};
// Workspace packages a module may import (owner decision, 2026-10-05).
const modulePackages = ['@jimmie-potts/sdk', '@jimmie-potts/event-contracts'];
// Every workspace package's scope. The boundary rule treats other scopes as third-party, so a module importing
// any other package in these scopes is refused; @pixoo/ is the staged Pixoo snapshot's scope (Hub #25, until #843).
export const workspaceScopes = ['@jimmie-potts/', '@pixoo/'];
// Code that runs in a page.
const browser = [
  'apps/dashboard/src/**',
  'apps/chompi-bridge/verify/page/**',
  'docs/system-design/assets/**',
  'docs/work-guide/browser/renderer.mjs',
  'docs/work-guide/browser/runtime/**',
  'docs/work-guide/work/guide_overview.js',
];
// Node scripts that drive Playwright and pass callbacks that run in the page.
const pageDrivers = [
  'apps/dashboard/tests/**',
  'apps/hub/verify/**',
  'docs/skins/check_*.cjs',
  'docs/skins/screenshot.cjs',
  'docs/system-design/check.cjs',
  'docs/system-design/reference/check_reference.cjs',
  'docs/work-guide/browser/tests/**',
  'docs/work-guide/work/check_guide.cjs',
  '**/*.browser.mjs',
  'scripts/check-hub-compatibility.mjs',
  'scripts/performance/standalone-worker.mjs',
];

export default defineConfig(
  // Everything Git ignores: build output, dependencies, local data and agent worktrees.
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url)), 'bunny/git-ignored'),
  {
    name: 'bunny/excluded',
    ignores: [
      // Firmware build trees, ignored by the firmware folder's own .gitignore.
      'firmware/chompi-controller/build/**', 'firmware/chompi-controller/.upstream/**',
      // Committed generated output: the Work guide's published releases.
      'docs/work-guide/outputs/**',
      // Vendored third-party reference assets: the Scalar bundle and SchemaSpy's generated pages and theme.
      'docs/system-design/reference/assets/**', 'docs/system-design/reference/database/**',
      // Saved source copies from other repositories, kept as architecture evidence.
      'docs/work-guide/work/architecture/sources/**',
    ],
  },
  {
    name: 'bunny/javascript',
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    linterOptions: {reportUnusedDisableDirectives: 'error'},
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module'},
    rules: {
      // Best-effort cleanup uses empty catch blocks; a leading underscore marks a deliberately unused name.
      'no-empty': ['error', {allowEmptyCatch: true}],
      'no-unused-vars': ['error', unused],
    },
  },
  {
    name: 'bunny/node',
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ignores: browser,
    languageOptions: {globals: {...globals.nodeBuiltin}},
  },
  {
    name: 'bunny/commonjs',
    files: ['**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: {...globals.node}},
  },
  {
    name: 'bunny/browser',
    files: browser,
    languageOptions: {globals: {...globals.browser}},
  },
  {
    name: 'bunny/page-drivers',
    files: pageDrivers,
    languageOptions: {globals: {...globals.browser}},
  },
  {
    name: 'bunny/typescript',
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Each file is checked with the nearest tsconfig.json. These files belong to no project: esbuild bundles
        // the art harness, package consumer checks compile the examples, and host.d.ts is a published declaration.
        projectService: {allowDefaultProject: [
          'apps/dashboard/tests/art-harness.tsx',
          'packages/agent-state/examples/embed.ts',
          'packages/mcp/examples/consumers.ts',
          'packages/observability/runtime/host.d.ts',
        ]},
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Existing idioms, not defects: side-effect ternaries, and rejecting with a caught error whose type is unknown.
      '@typescript-eslint/no-unused-expressions': ['error', {allowTernary: true}],
      '@typescript-eslint/prefer-promise-reject-errors': ['error', {allowThrowingUnknown: true}],
      '@typescript-eslint/no-unused-vars': ['error', unused],
      // Entry points declare a handle before signal handlers that read it, then assign it once.
      'prefer-const': ['error', {ignoreReadBeforeAssign: true}],
    },
  },
  {
    name: 'bunny/strict',
    files: strict,
    ignores: staged,
    linterOptions: noInlineConfig,
    rules: {
      // A catch-all default does not hide a newly added union variant.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false}],
      // Missing data is checked explicitly, never confused with zero, false or an empty string.
      '@typescript-eslint/strict-boolean-expressions': ['error', {allowString: false, allowNumber: false, allowNullableObject: true}],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    name: 'bunny/module-boundary',
    files: ['modules/**/*.{ts,tsx,js,mjs}'],
    ignores: staged,
    linterOptions: noInlineConfig,
    plugins: {bunny},
    rules: {'bunny/module-boundary': ['error', {root: import.meta.dirname, allowedPackages: modulePackages, workspaceScopes}]},
  },
  {
    // ADR 0012's "Safe errors" and "Observability" rules, for production code under the profile.
    name: 'bunny/safe-errors',
    files: [...strict, 'modules/**/*.{js,mjs}'],
    ignores: [...staged, ...tests],
    linterOptions: noInlineConfig,
    plugins: {bunny},
    rules: {
      'bunny/no-console': 'error',
      // An error class from a workspace package is this repository's own, with fixed text.
      'bunny/no-raw-error-text': ['error', {workspaceScopes}],
      'bunny/error-body-from-registry': 'error',
    },
  },
  // Where the safe-error rules do not apply. Each block is named bunny/safe-errors/<reason>, lifts only the rules it
  // names and is listed in docs/development.md "Safe-error rules"; tests/strict_profile.test.mjs checks all three, and
  // that each file exception still hides a finding.
  {
    // Scripts write their results to the terminal.
    name: 'bunny/safe-errors/scripts',
    files: ['apps/runtime/scripts/**'],
    rules: {'bunny/no-console': 'off'},
  },
  {
    name: 'bunny/safe-errors/stream-owners',
    files: streamOwners,
    rules: {'bunny/no-console': 'off'},
  },
  {
    // The contracts package defines `errorBody`, the one place that builds an error body.
    name: 'bunny/safe-errors/contracts',
    files: ['packages/event-contracts/**'],
    rules: {'bunny/error-body-from-registry': 'off'},
  },
  // Code that breaks a safe-error rule until its owner converts it.
  {
    // A malformed command line's usage error quotes parseArgs's message. #954 converts it at its pickup.
    name: 'bunny/safe-errors/runtime-usage',
    files: ['apps/runtime/src/process.ts'],
    rules: {'bunny/no-raw-error-text': 'off'},
  },
  {
    // The verification run's harness quotes a failure's message in its own refusal body, its lamp failures and its
    // start-failure lines. #954 converts it at its pickup.
    name: 'bunny/safe-errors/verification-harness',
    files: ['apps/runtime/verify/supervisor.ts'],
    rules: {'bunny/no-raw-error-text': 'off', 'bunny/error-body-from-registry': 'off'},
  },
  {
    // The staged Nanoleaf port's outcome drafts carry a bare {code} error block, without the registry's retryable flag,
    // because the module does not depend on the contracts package yet. #844 converts it when it publishes them through
    // the SDK's outbox.
    name: 'bunny/safe-errors/nanoleaf-outcomes',
    files: ['modules/nanoleaf/src/journal.ts'],
    rules: {'bunny/error-body-from-registry': 'off'},
  },
  {
    name: 'bunny/react-hooks',
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    plugins: {'react-hooks': reactHooks},
    rules: {'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error'},
  },
);
