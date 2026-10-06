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
const strict = ['apps/runtime/**/*.{ts,tsx}', 'packages/sdk/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}'];
const staged = ['modules/pixoo/**'];
// Workspace packages a module may import (owner decision, 2026-10-05).
const modulePackages = ['@jimmie-potts/sdk', '@jimmie-potts/event-contracts'];
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
    plugins: {bunny},
    rules: {
      // A catch-all default does not hide a newly added union variant.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false}],
      // Missing data is checked explicitly, never confused with zero, false or an empty string.
      '@typescript-eslint/strict-boolean-expressions': ['error', {allowString: false, allowNumber: false, allowNullableObject: true}],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'bunny/disable-reason': 'error',
    },
  },
  {
    name: 'bunny/module-boundary',
    files: ['modules/**/*.{ts,tsx,js,mjs}'],
    ignores: staged,
    plugins: {bunny},
    rules: {
      'bunny/module-boundary': ['error', {root: import.meta.dirname, allowedPackages: modulePackages}],
      'bunny/disable-reason': 'error',
    },
  },
  {
    name: 'bunny/react-hooks',
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    plugins: {'react-hooks': reactHooks},
    rules: {'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error'},
  },
);
