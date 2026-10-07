// The strict profile for new code (Hub #867): which files it covers, the module boundary rule, the safe-error rules
// (Hub #953) and the compiler base.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, globSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {describe, it, test} from 'node:test';
import {ESLint, RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import config, {staged as stagedGlobs, streamOwners, strict as strictGlobs, workspaceScopes} from '../eslint.config.mjs';
import bunny from '../scripts/eslint/bunny-rules.mjs';

const root = join(import.meta.dirname, '..');
const strictRules = ['@typescript-eslint/switch-exhaustiveness-check', '@typescript-eslint/strict-boolean-expressions',
  '@typescript-eslint/no-non-null-assertion'];
const safeErrorRules = ['bunny/no-console', 'bunny/no-raw-error-text', 'bunny/error-body-from-registry'];
const severity = (config, rule) => {
  const value = config.rules?.[rule];
  return Array.isArray(value) ? value[0] : value;
};
const on = (config, rule) => [2, 'error'].includes(severity(config, rule));

test('the strict rules cover new code and skip old and staged code', async () => {
  const eslint = new ESLint({cwd: root});
  for (const file of ['apps/runtime/src/a.ts', 'packages/sdk/src/a.ts', 'modules/example/src/a.ts']) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of strictRules) assert.ok(on(config, rule), `${file}: ${rule}`);
    assert.equal(config.linterOptions.noInlineConfig, true, `${file}: inline config`);
  }
  const moduleScript = await eslint.calculateConfigForFile(join(root, 'modules/example/src/a.mjs'));
  assert.ok(on(moduleScript, 'bunny/module-boundary'));
  assert.equal(moduleScript.linterOptions.noInlineConfig, true);
  for (const file of ['apps/hub/src/a.ts', 'modules/pixoo/src/a.ts']) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of [...strictRules, 'bunny/module-boundary', ...safeErrorRules]) assert.ok(!severity(config, rule), `${file}: ${rule} stays off`);
    assert.notEqual(config.linterOptions.noInlineConfig, true, `${file}: inline config stays on`);
  }
});

test('the safe-error rules cover production code under the profile, not its tests', async () => {
  const eslint = new ESLint({cwd: root});
  const production = ['apps/runtime/src/a.ts', 'apps/runtime/verify/a.ts', 'packages/sdk/src/a.ts', 'packages/sdk/src/testing/a.ts',
    'modules/example/src/a.ts', 'modules/example/src/a.mjs', 'modules/example/src/scripts/a.ts'];
  for (const file of production) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of safeErrorRules) assert.ok(on(config, rule), `${file}: ${rule}`);
    assert.deepEqual(config.rules['bunny/no-raw-error-text'][1], {workspaceScopes}, `${file}: own error classes come from the workspace`);
  }
  // The contracts package defines `errorBody`, so it builds the body by hand; its other rules still apply.
  const contracts = await eslint.calculateConfigForFile(join(root, 'packages/event-contracts/src/v2/a.ts'));
  assert.ok(!severity(contracts, 'bunny/error-body-from-registry'));
  for (const rule of ['bunny/no-console', 'bunny/no-raw-error-text']) assert.ok(on(contracts, rule), `contracts: ${rule}`);
  for (const file of ['apps/runtime/tests/a.ts', 'apps/runtime/verify/tests/a.ts', 'packages/sdk/tests/fixtures/a.ts', 'modules/example/tests/a.test.ts',
    'modules/example/src/a.test.ts']) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of safeErrorRules) assert.ok(!severity(config, rule), `${file}: ${rule} skips tests`);
    for (const rule of strictRules) assert.ok(on(config, rule), `${file}: ${rule} still applies`);
  }
  for (const file of ['apps/runtime/scripts/a.ts', ...streamOwners]) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    assert.ok(!severity(config, 'bunny/no-console'), `${file}: writes the standard streams`);
  }
});

// An exception is a config block named bunny/safe-errors/<reason>, after the profile blocks, and listed in
// docs/development.md's exception table. Scripts and the stream owners lift only `bunny/no-console`, and the contracts
// package only `bunny/error-body-from-registry`; every other exception names existing files, so a renamed file cannot
// leave a stale entry behind.
const exceptions = config.filter(block => block.name?.startsWith('bunny/safe-errors/'));
const scopes = {'bunny/safe-errors/scripts': {'bunny/no-console': 'off'}, 'bunny/safe-errors/contracts': {'bunny/error-body-from-registry': 'off'}};
const fileExceptions = exceptions.filter(block => !Object.hasOwn(scopes, block.name));
const isOff = value => [0, 'off'].includes(Array.isArray(value) ? value[0] : value);

test('each exception to the safe-error rules names files that exist and lifts only those rules', () => {
  for (const [name, rules] of Object.entries(scopes)) assert.deepEqual(exceptions.find(block => block.name === name)?.rules, rules, name);
  assert.deepEqual(exceptions.find(block => block.name === 'bunny/safe-errors/stream-owners')?.rules, {'bunny/no-console': 'off'});
  for (const block of fileExceptions) {
    for (const file of block.files) assert.ok(!file.includes('*') && existsSync(join(root, file)), `${block.name}: ${file} must name an existing file`);
    for (const [rule, value] of Object.entries(block.rules)) {
      assert.ok(safeErrorRules.includes(rule), `${block.name} lifts ${rule}`);
      assert.equal(value, 'off', `${block.name}: ${rule}`);
    }
  }
});

test('only a named exception in the docs table lifts or reconfigures a safe-error rule', () => {
  const docs = readFileSync(join(root, 'docs/development.md'), 'utf8');
  const section = docs.slice(docs.indexOf('### Safe-error rules'));
  const end = section.slice(1).search(/\n(?:#{1,3} |<a id=)/);
  const rows = section.slice(0, end === -1 ? undefined : end + 1).split('\n').filter(line => line.startsWith('|'));
  const documented = new Set(rows.flatMap(row => [...row.matchAll(/`(bunny\/safe-errors\/[\w-]+)`/g)].map(match => match[1])));
  for (const block of config.filter(block => block.name !== 'bunny/safe-errors')) {
    for (const rule of safeErrorRules.filter(rule => block.rules?.[rule] !== undefined)) {
      const where = block.name ?? `an unnamed block for ${JSON.stringify(block.files)}`;
      assert.match(block.name ?? '', /^bunny\/safe-errors\/[\w-]+$/, `${where} sets ${rule}; name it bunny/safe-errors/<reason>`);
      assert.ok(isOff(block.rules[rule]), `${where} reconfigures ${rule}; only bunny/safe-errors sets its options`);
      assert.ok(documented.has(block.name), `${where} lifts ${rule} but is not in docs/development.md's exception table`);
    }
  }
  assert.deepEqual([...documented].sort(), exceptions.map(block => block.name).sort(), 'the table lists exactly the exception blocks');
});

// A file exception whose file no longer breaks a rule it lifts would hide the next real finding, so it fails here.
// Syntax only: the safe-error rules need no type information.
test('each file exception still hides a finding of every rule it lifts', async () => {
  for (const block of fileExceptions) {
    const eslint = new ESLint({cwd: root, overrideConfigFile: true, overrideConfig: [
      {files: ['**/*.{ts,tsx}'], languageOptions: {parser: tseslint.parser}},
      ...config.filter(other => other.name === 'bunny/safe-errors' || (other.name?.startsWith('bunny/safe-errors/') && other !== block)),
    ]});
    for (const result of await eslint.lintFiles(block.files)) {
      for (const rule of Object.keys(block.rules)) {
        assert.ok(result.messages.some(message => message.ruleId === rule),
          `${block.name}: ${relative(root, result.filePath)} no longer breaks ${rule}; remove it from the exception`);
      }
    }
  }
});

test('an inline ESLint comment in covered code fails lint, even a blanket disable', async () => {
  const eslint = new ESLint({cwd: root});
  const cases = [
    '/* eslint-disable */\nexport {};\n',
    '/* eslint-disable no-console -- a reason does not make it count */\nconsole.log(1);\nexport {};\n',
    '/* eslint bunny/module-boundary: "off" */\nimport {store} from "@jimmie-potts/agent-state";\nexport {store};\n',
  ];
  for (const code of cases) {
    const [result] = await eslint.lintText(code, {filePath: join(root, 'modules/example/src/a.mjs')});
    assert.ok(result.messages.some(message => /noInlineConfig/.test(message.message)), code);
  }
  const [boundary] = await eslint.lintText(cases[2], {filePath: join(root, 'modules/example/src/a.mjs')});
  assert.ok(boundary.messages.some(message => message.ruleId === 'bunny/module-boundary'), 'the boundary still applies');
  // ESLint reports an ignored inline comment as a warning, so the ban holds only while lint allows none.
  assert.match(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['lint:js'], /--max-warnings=0\b/);
});

test('the strict rules keep their intended options', async () => {
  const config = await new ESLint({cwd: root}).calculateConfigForFile(join(root, 'modules/example/src/a.ts'));
  assert.deepEqual(config.rules['@typescript-eslint/switch-exhaustiveness-check'].slice(1)[0],
    {considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false});
  assert.deepEqual(config.rules['@typescript-eslint/strict-boolean-expressions'].slice(1)[0],
    {allowString: false, allowNumber: false, allowNullableObject: true});
  const boundary = (await new ESLint({cwd: root}).calculateConfigForFile(join(root, 'modules/example/src/a.ts'))).rules['bunny/module-boundary'][1];
  assert.equal(boundary.root, root);
  assert.deepEqual(boundary.allowedPackages, ['@jimmie-potts/sdk', '@jimmie-potts/event-contracts']);
  assert.deepEqual(boundary.workspaceScopes, ['@jimmie-potts/', '@pixoo/']);
  const base = JSON.parse(readFileSync(join(root, 'tsconfig.strict.json'), 'utf8')).compilerOptions;
  for (const option of ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch']) {
    assert.equal(base[option], true, option);
  }
});

// Guards for conventions the lint rules alone cannot enforce. They cover the directories of the `strict` and
// `staged` globs in eslint.config.mjs.
const directory = glob => glob.slice(0, glob.indexOf('*')).replace(/\/$/, '');
const covered = strictGlobs.map(directory);
const staged = stagedGlobs.map(directory);

test('each profile glob names a plain directory, so the guards cannot silently check nothing', () => {
  for (const [glob, dir] of [...strictGlobs, ...stagedGlobs].map(glob => [glob, directory(glob)])) {
    assert.ok(glob.includes('*') && /^[\w.-]+(\/[\w.-]+)*$/.test(dir), `${glob} must start with a plain directory`);
  }
});
function tsconfigs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'dist'].includes(entry.name) || staged.includes(relative(root, path)) ? [] : tsconfigs(path);
    return /^tsconfig.*\.json$/.test(entry.name) ? [path] : [];
  });
}
// The project that compiles a covered directory without its own tsconfig.json, below the repository root.
function nearestProject(dir) {
  for (let current = dir; current !== root && current.startsWith(root); current = dirname(current)) {
    if (existsSync(join(current, 'tsconfig.json'))) return [join(current, 'tsconfig.json')];
  }
  return [];
}
const strictOptions = ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch'];

test('every TypeScript project that compiles covered code has the strict compiler settings', () => {
  const projects = new Set(covered.flatMap(dir => [...nearestProject(join(root, dir)), ...tsconfigs(join(root, dir))]));
  for (const file of projects) {
    // tsc resolves comments, extends chains and overrides the same way a build does.
    const shown = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--showConfig', '-p', file], {encoding: 'utf8'});
    assert.equal(shown.status, 0, `${relative(root, file)}: ${shown.stdout}${shown.stderr}`);
    const options = JSON.parse(shown.stdout).compilerOptions;
    for (const option of strictOptions) assert.equal(options[option], true, `${relative(root, file)} must keep ${option} from tsconfig.strict.json`);
  }
});

test('covered paths have no lint baseline, and every workspace package is scoped', () => {
  const baseline = Object.keys(JSON.parse(readFileSync(join(root, 'eslint-suppressions.json'), 'utf8')));
  const inCovered = baseline.filter(file => covered.some(dir => file.startsWith(dir + '/')) && !staged.some(dir => file.startsWith(dir + '/')));
  assert.deepEqual(inCovered, []);
  // The module boundary treats other scopes as third-party, so every workspace package must use a listed scope.
  const workspaces = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces;
  const manifests = workspaces.flatMap(pattern => globSync(`${pattern}/package.json`, {cwd: root}));
  assert.ok(manifests.length >= workspaces.length);
  for (const manifest of manifests) {
    const name = JSON.parse(readFileSync(join(root, manifest), 'utf8')).name;
    assert.ok(workspaceScopes.some(scope => name.startsWith(scope)), `${dirname(manifest)} is named ${name}, outside ${workspaceScopes.join(', ')}`);
  }
});

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({languageOptions: {ecmaVersion: 'latest', sourceType: 'module'}});
const inModule = join(process.cwd(), 'modules/example/src/a.mjs');
const options = [{allowedPackages: ['@jimmie-potts/sdk', '@jimmie-potts/event-contracts'], workspaceScopes: ['@jimmie-potts/', '@pixoo/']}];

tester.run('module-boundary', bunny.rules['module-boundary'], {
  valid: [
    {code: "import {x} from './y.mjs';", filename: inModule, options},
    {code: "import {x} from '../test/y.mjs';", filename: inModule, options},
    {code: "import {sdk} from '@jimmie-potts/sdk';", filename: inModule, options},
    {code: "import {schema} from '@jimmie-potts/event-contracts/v2';", filename: inModule, options},
    {code: "import {readFile} from 'node:fs/promises';", filename: inModule, options},
    {code: "import {parse} from '@scope/third-party';", filename: inModule, options},
    {code: "import other from '../../../apps/hub/src/a.mjs';", filename: join(process.cwd(), 'apps/runtime/src/a.mjs'), options},
  ],
  invalid: [
    {code: "import {x} from '../../other/src/y.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "import {store} from '@jimmie-potts/agent-state';", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    // A staged snapshot's packages are workspace packages too, not third-party ones.
    {code: "import {Device} from '@pixoo/core';", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: "export * from '../../../apps/hub/src/a.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "await import('@jimmie-potts/hub');", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: "export {store} from '@jimmie-potts/agent-state';", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: 'await import(`@jimmie-potts/hub`);', filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: 'const name = "x"; await import(`./${name}.mjs`);', filename: inModule, options, errors: [{messageId: 'dynamic'}]},
    {code: "import {x} from '/etc/other.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "import {x} from 'file:///etc/other.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
  ],
});

// The `root` option, not the working directory, locates modules.
tester.run('module-boundary root', bunny.rules['module-boundary'], {
  valid: [
    {code: "import {x} from '../../other/src/y.mjs';", filename: '/virtual/apps/runtime/src/a.mjs', options: [{...options[0], root: '/virtual'}]},
  ],
  invalid: [
    {code: "import {x} from '../../other/src/y.mjs';", filename: '/virtual/modules/example/src/a.mjs', options: [{...options[0], root: '/virtual'}], errors: [{messageId: 'outside'}]},
    {code: "import {x} from '../../../other/src/y.mjs';", filename: '/virtual/modules/example/src/a.mjs', options: [{...options[0], root: '/virtual'}], errors: [{messageId: 'outside'}]},
  ],
});

const typescript = new RuleTester({languageOptions: {parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module'}});
const inModuleTs = join(process.cwd(), 'modules/example/src/a.ts');
typescript.run('module-boundary types', bunny.rules['module-boundary'], {
  valid: [
    {code: "type Sdk = import('@jimmie-potts/sdk').Sdk;", filename: inModuleTs, options},
    {code: "import type {Local} from './local.js';", filename: inModuleTs, options},
  ],
  invalid: [
    {code: "type Store = import('@jimmie-potts/agent-state').Store;", filename: inModuleTs, options, errors: [{messageId: 'workspace'}]},
    {code: "type Other = import('../../other/src/a.js').Other;", filename: inModuleTs, options, errors: [{messageId: 'outside'}]},
    {code: "import type {Other} from '../../other/src/a.js';", filename: inModuleTs, options, errors: [{messageId: 'outside'}]},
    {code: "export type {Store} from '@jimmie-potts/agent-state';", filename: inModuleTs, options, errors: [{messageId: 'workspace'}]},
  ],
});

// The safe-error rules (Hub #953, ADR 0012 "Safe errors" and "Observability").
const nodeGlobals = {languageOptions: {globals: {console: 'readonly', process: 'readonly', globalThis: 'readonly', JSON: 'readonly', String: 'readonly'}}};
const withGlobals = cases => cases.map(item => ({...nodeGlobals, ...(typeof item === 'string' ? {code: item} : item)}));

tester.run('no-console', bunny.rules['no-console'], {
  valid: withGlobals([
    "log.info('runtime.ready', {count: 1});",
    'const console = {log() {}}; console.log(1);',
    'function write(process) { return process.stdout; }',
    'process.exitCode = 1; process.on("SIGTERM", () => {});',
    "import {argv} from 'node:process'; export {argv};",
    "import process from 'node:process'; export const args = process.argv;",
  ]),
  invalid: [
    ...withGlobals([
      {code: "console.log('ready');", errors: [{messageId: 'console'}]},
      {code: 'try { run(); } catch (error) { console.error(error); }', errors: [{messageId: 'console'}]},
      {code: 'const {log} = console; log(1);', errors: [{messageId: 'console'}]},
      {code: "globalThis.console.warn('x');", errors: [{messageId: 'console'}]},
      {code: "process.stderr.write('x\\n');", errors: [{messageId: 'stream', data: {stream: 'stderr'}}]},
      {code: "process.stdout.write('x\\n');", errors: [{messageId: 'stream', data: {stream: 'stdout'}}]},
      {code: "process['stdout'].write('x\\n');", errors: [{messageId: 'stream', data: {stream: 'stdout'}}]},
      {code: "const out = process.stderr; out.write('x');", errors: [{messageId: 'stream', data: {stream: 'stderr'}}]},
      {code: "import {stderr} from 'node:process'; stderr.write('x');", errors: [{messageId: 'stream', data: {stream: 'stderr'}}]},
      {code: "import proc from 'node:process'; proc.stdout.write('x');", errors: [{messageId: 'stream', data: {stream: 'stdout'}}]},
      {code: "import * as proc from 'process'; proc.stderr.write('x');", errors: [{messageId: 'stream', data: {stream: 'stderr'}}]},
      {code: "import {Console} from 'node:console'; export {Console};", errors: [{messageId: 'console'}]},
    ]),
    // Without configured globals, an undeclared console is still the global one.
    {code: "console.info('x');", errors: [{messageId: 'console'}]},
  ],
});

const rawText = (property) => [{messageId: 'read', data: {property}}];
const asText = [{messageId: 'text'}];
tester.run('no-raw-error-text', bunny.rules['no-raw-error-text'], {
  valid: withGlobals([
    "try { run(); } catch (error) { throw new Failed('the read failed', {cause: error}); }",
    "try { run(); } catch (error) { log.warn('read.failed', errorFields(error)); }",
    'export function name() { try { run(); } catch (error) { return error.name; } }',
    "export function read() { try { run(); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }",
    'export function read() { try { run(); } catch (_) { return null; } }',
    'export function read() { try { run(); } catch { return null; } }',
    // A typed refusal carries its body on; its code and fixed text came from the registry.
    "import {SdkError} from '@jimmie-potts/sdk'; export function body() { try { run(); } catch (error) { if (error instanceof SdkError) return error.body; throw error; } }",
    // An error class this repository declares holds fixed text from the code that raised it.
    "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (!(error instanceof UsageError)) throw error; write(error.message); }",
    "import {UsageError} from './usage.js'; try { run(); } catch (error) { write(error instanceof UsageError ? `${error.message}\\n` : 'failed'); }",
    "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (error instanceof UsageError) write(`usage: ${error}`); }",
    "import * as errors from './errors.js'; try { run(); } catch (error) { if (error instanceof errors.ValueError) write(error.message); }",
    "class LocalError extends Error {} try { run(); } catch (error) { if (error instanceof LocalError) write(error.message); }",
    "import {A, B} from './errors.js'; try { run(); } catch (error) { if (!(error instanceof A) && !(error instanceof B)) throw error; write(error.message); }",
    "import {ValueError} from '@jimmie-potts/nanoleaf'; try { run(); } catch (error) { if (!(error instanceof ValueError)) throw error; write(error.message); }",
    {code: "import {ValueError} from '@pixoo/core'; try { run(); } catch (error) { if (!(error instanceof ValueError)) throw error; write(error.message); }",
      options: [{workspaceScopes: ['@jimmie-potts/', '@pixoo/']}]},
    // Values that are not exceptions.
    "const reply = {message: 'hello'}; write(reply.message); write(`${reply}`);",
    'function title(input) { return input.message + String(input); }',
    'function show(value) { if (value instanceof URL) return String(value); return `${value}`; }',
    'promise.then(result => write(result.message));',
    'promise.catch(() => write("failed"));',
    'promise.catch(error => fail(error));',
    "stream.on('data', chunk => write(chunk.message));",
    // The inner function's parameter shadows the catch binding.
    'try { run(); } catch (error) { const show = error => error.message; show(1); }',
    // A member chain narrowed to a class that is not an error, or a different chain than the one tested.
    'function show(r) { if (r.value instanceof URL) return String(r.value); return `${r.value}`; }',
    'function fail(r, s) { if (r.reason instanceof Error) write(s.reason.message); }',
    'function fail(r) { if (r.reason instanceof Error) write(r.other.message); }',
    "import {UsageError} from './usage.js'; function fail(r) { if (r.reason instanceof UsageError) write(r.reason.message); }",
  ]),
  invalid: withGlobals([
    {code: 'try { run(); } catch (error) { report(error.message); }', errors: rawText('message')},
    {code: 'try { run(); } catch (error) { report(error.stack); }', errors: rawText('stack')},
    {code: 'try { run(); } catch (error) { report(error.cause); }', errors: rawText('cause')},
    {code: 'try { run(); } catch (error) { report(error?.message); }', errors: rawText('message')},
    {code: "try { run(); } catch (error) { report(error['stack']); }", errors: rawText('stack')},
    {code: 'try { run(); } catch ({message}) { report(message); }', errors: rawText('message')},
    {code: 'try { run(); } catch (error) { const {name, stack} = error; report(name, stack); }', errors: rawText('stack')},
    {code: 'try { run(); } catch (error) { report(`failed: ${error}`); }', errors: asText},
    {code: "try { run(); } catch (error) { report('failed: ' + error); }", errors: asText},
    {code: 'try { run(); } catch (error) { report(String(error)); }', errors: asText},
    {code: 'try { run(); } catch (error) { report(JSON.stringify(error)); }', errors: asText},
    {code: 'try { run(); } catch (error) { report(error.toString()); }', errors: asText},
    {code: "try { run(); } catch (error) { let line = 'x'; line += error; report(line); }", errors: asText},
    {code: "import {inspect} from 'node:util'; try { run(); } catch (error) { report(inspect(error)); }", errors: asText},
    {code: "import util from 'node:util'; try { run(); } catch (error) { report(util.format('%s', error)); }", errors: asText},
    // The remote edge's old answer to an unexpected exception (Hub #948).
    {code: 'try { run(); } catch (error) { const refused = error instanceof Refusal ? error.body'
      + " : errorBody('internal', {detail: `the edge failed: ${error instanceof Error ? error.message : 'unknown'}`}); answer(refused); }",
    errors: rawText('message')},
    // A built-in or third-party error's message is not this repository's text.
    {code: 'try { parse(); } catch (error) { if (error instanceof SyntaxError) throw new ValueError(error.message); throw error; }', errors: rawText('message')},
    {code: "import {HTTPError} from 'got'; try { run(); } catch (error) { if (error instanceof HTTPError) report(error.message); }", errors: rawText('message')},
    // An own class's stack and cause are never fixed text, and its narrowing does not reach the other branch.
    {code: "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (error instanceof UsageError) report(error.stack); }", errors: rawText('stack')},
    {code: "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (error instanceof UsageError) report(error.cause); }", errors: rawText('cause')},
    {code: "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (error instanceof UsageError) {} else report(error.message); }", errors: rawText('message')},
    {code: "import {UsageError} from './usage.js'; try { run(); } catch (error) { if (error instanceof UsageError || error instanceof Error) report(error.message); }",
      errors: rawText('message')},
    // A rejection or 'error' event handler's parameter is a caught exception too.
    {code: 'promise.catch(error => answer(error.message));', errors: rawText('message')},
    {code: 'promise.then(ok, function (error) { answer(`${error}`); });', errors: asText},
    {code: "stream.on('error', error => log(error.stack));", errors: rawText('stack')},
    {code: "process.once('uncaughtException', ({message}) => log(message));", errors: rawText('message')},
    // Any value narrowed to an error class counts, wherever it came from.
    {code: "const failed = error => write(`start failed: ${error instanceof Error ? error.message : 'unknown'}`);", errors: rawText('message')},
    {code: 'function fail(reason) { if (!(reason instanceof Error)) return; write(reason.message); }', errors: rawText('message')},
    {code: 'function fail(reason) { if (reason instanceof TypeError && reason.stack) write(reason.stack); }', errors: [...rawText('stack'), ...rawText('stack')]},
    // So does a simple member chain: a settled result's reason, an event's error, a private field.
    {code: 'function fail(r) { if (r.reason instanceof Error) write(r.reason.message); }', errors: rawText('message')},
    {code: "export function fail(results) { for (const r of results) if (r.status === 'rejected' && r.reason instanceof Error) log(r.reason.stack); }",
      errors: rawText('stack')},
    {code: "emitter.on('failed', event => { if (event.error instanceof Error) report(`failed: ${event.error}`); });", errors: asText},
    {code: 'function fail(r) { return r?.reason instanceof Error ? r.reason.message : "failed"; }', errors: rawText('message')},
    {code: 'function fail(task) { if (!(task.state.error instanceof Error)) return; write(task.state.error.cause); }', errors: rawText('cause')},
    {code: 'class Job { #failure = null; report() { if (this.#failure instanceof Error) write(this.#failure.message); } }', errors: rawText('message')},
  ]),
});

typescript.run('no-raw-error-text types', bunny.rules['no-raw-error-text'], {
  valid: [
    "import type {SdkError} from '@jimmie-potts/sdk'; export function code(error: SdkError): string { return error.message; }",
    "import type * as errors from './errors.js'; export function text(error: errors.ValueError): string { return error.message; }",
    'type Failure = {message: string}; export function text(failure: Failure): string { return failure.message; }',
    'try { run(); } catch (error: unknown) { log((error as {code?: string}).code); }',
  ],
  invalid: [
    {code: 'try { run(); } catch (error) { report((error as Error).message); }', errors: rawText('message')},
    {code: 'try { run(); } catch (error) { report(error!.stack); }', errors: rawText('stack')},
    {code: 'try { run(); } catch (error: unknown) { report(`${error as Error}`); }', errors: asText},
    {code: "socket.on('close', (error: Error) => log(error.message));", errors: rawText('message')},
    {code: 'export function fail(r: PromiseRejectedResult): string { return r.reason instanceof Error ? (r.reason as Error).message : ""; }', errors: rawText('message')},
    {code: 'export function done(error: NodeJS.ErrnoException | null): void { if (error !== null) log(error.message); }', errors: rawText('message')},
    {code: "import {SdkError} from '@jimmie-potts/sdk'; export function code(error: SdkError): string { return error.stack ?? ''; }", errors: rawText('stack')},
  ],
});

const handBuilt = [{messageId: 'literal'}];
tester.run('error-body-from-registry', bunny.rules['error-body-from-registry'], {
  valid: [
    "return errorBody('internal', {detail: 'the edge failed'});",
    'const body = {error: {...refused.error, requestId, traceId}};',
    'throw new Refusal({error: result.error});',
    "const result = {status: 'rejected', requestId, error: named(refused, ids)};",
    "const outcome = {result: 'failed', evidence: 'none', error: errorBody('expired').error};",
    "const record = {error: 'failed'};",
    "const record = {error: {message: 'x'}};",
    "const options = {code: 'internal'};",
    "const fields = {[error]: {code: 'x'}};",
  ].map(code => `export function f() { ${code} }`),
  invalid: [
    "return {error: {code: 'internal', retryable: false}};",
    'const refusal = (code, detail) => ({error: {code, detail}});',
    "return {result: 'failed', evidence: 'none', error: {code: 'expired'}};",
    "return {error: {...body.error, code: 'internal'}};",
    "return {'error': {'code': 'internal', retryable: false}};",
    "return {['error']: {code: 'internal'}};",
  ].map(code => ({code: `export function f() { ${code} }`, errors: handBuilt})),
});

typescript.run('error-body-from-registry types', bunny.rules['error-body-from-registry'], {
  valid: [
    'type Body = {error: {code: string; retryable: boolean}};',
    "const body: ErrorBody = errorBody('internal');",
  ],
  invalid: [
    {code: "const body = {error: {code: 'internal', retryable: false}} as ErrorBody;", errors: handBuilt},
    {code: "const body = {error: {code: 'internal', retryable: false} satisfies ErrorDetail};", errors: handBuilt},
  ],
});

test('the strict compiler base rejects an unchecked index and an explicit undefined optional property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strict-profile-'));
  const compile = (code) => {
    writeFileSync(join(dir, 'case.ts'), code);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({extends: join(root, 'tsconfig.strict.json'),
      compilerOptions: {noEmit: true, rootDir: dir}, include: [join(dir, 'case.ts')]}));
    return spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')], {encoding: 'utf8'});
  };
  try {
    const ok = compile('const list: number[] = [1];\nconst first = list[0];\nexport const value = first === undefined ? 0 : first * 2;\ntype Options = {label?: string};\nexport const options: Options = {};\n');
    assert.equal(ok.status, 0, ok.stdout);
    const index = compile('const list: number[] = [1];\nexport const value: number = list[0] * 2;\n');
    assert.notEqual(index.status, 0);
    assert.match(index.stdout, /TS(18048|2532)/);
    const optional = compile('type Options = {label?: string};\nexport const options: Options = {label: undefined};\n');
    assert.notEqual(optional.status, 0);
    assert.match(optional.stdout, /exactOptionalPropertyTypes/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
