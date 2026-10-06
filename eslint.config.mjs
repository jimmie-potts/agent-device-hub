// Static bug detection for maintained JavaScript and TypeScript (Hub #765).
// docs/development.md "Static analysis" records the coverage, exclusions and how a package adds stricter rules.
import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
  {
    name: 'bunny/excluded',
    ignores: [
      // Generated output and local data (also ignored by Git).
      '**/dist/**', 'apps/hub/public/**', 'artifacts/**', '.local/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
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
  },
  {
    name: 'bunny/node',
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ignores: browser,
    languageOptions: {globals: {...globals.node}},
  },
  {
    name: 'bunny/commonjs',
    files: ['**/*.cjs'],
    languageOptions: {sourceType: 'commonjs'},
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
      // Existing idioms, not defects: side-effect ternaries, and passing on a caught error whose type is unknown.
      '@typescript-eslint/no-unused-expressions': ['error', {allowTernary: true}],
      '@typescript-eslint/only-throw-error': ['error', {allowThrowingUnknown: true}],
      '@typescript-eslint/prefer-promise-reject-errors': ['error', {allowThrowingUnknown: true}],
      // Entry points declare a handle before signal handlers that read it, then assign it once.
      'prefer-const': ['error', {ignoreReadBeforeAssign: true}],
    },
  },
  {
    name: 'bunny/react-hooks',
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    plugins: {'react-hooks': reactHooks},
    rules: {'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error'},
  },
);
