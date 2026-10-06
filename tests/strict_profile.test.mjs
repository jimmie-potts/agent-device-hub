// The strict profile for new code (Hub #867): which files it covers, the local rules and the compiler base.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {describe, it, test} from 'node:test';
import {ESLint, RuleTester} from 'eslint';
import bunny from '../scripts/eslint/bunny-rules.mjs';

const root = join(import.meta.dirname, '..');
const strictRules = ['@typescript-eslint/switch-exhaustiveness-check', '@typescript-eslint/strict-boolean-expressions',
  '@typescript-eslint/no-non-null-assertion', 'bunny/disable-reason'];
const severity = (config, rule) => {
  const value = config.rules?.[rule];
  return Array.isArray(value) ? value[0] : value;
};

test('the strict rules cover new code and skip old and staged code', async () => {
  const eslint = new ESLint({cwd: root});
  for (const file of ['apps/runtime/src/a.ts', 'packages/sdk/src/a.ts', 'modules/example/src/a.ts']) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of strictRules) assert.ok([2, 'error'].includes(severity(config, rule)), `${file}: ${rule}`);
  }
  assert.ok([2, 'error'].includes(severity(await eslint.calculateConfigForFile(join(root, 'modules/example/src/a.mjs')), 'bunny/module-boundary')));
  for (const file of ['apps/hub/src/a.ts', 'modules/pixoo/src/a.ts']) {
    const config = await eslint.calculateConfigForFile(join(root, file));
    for (const rule of [...strictRules, 'bunny/module-boundary']) assert.ok(!severity(config, rule), `${file}: ${rule} stays off`);
  }
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
  const base = JSON.parse(readFileSync(join(root, 'tsconfig.strict.json'), 'utf8')).compilerOptions;
  for (const option of ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch']) {
    assert.equal(base[option], true, option);
  }
});

// Guards for conventions the lint rules alone cannot enforce.
const covered = ['apps/runtime', 'packages/sdk', 'modules'];
const staged = ['modules/pixoo'];
function tsconfigs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'dist'].includes(entry.name) || staged.includes(relative(root, path)) ? [] : tsconfigs(path);
    return /^tsconfig.*\.json$/.test(entry.name) ? [path] : [];
  });
}
function extendsStrict(file, seen = new Set()) {
  if (resolve(file) === join(root, 'tsconfig.strict.json')) return true;
  if (seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  const parent = JSON.parse(readFileSync(file, 'utf8')).extends;
  return typeof parent === 'string' && parent.startsWith('.') && extendsStrict(resolve(dirname(file), parent), seen);
}

test('every TypeScript project under a covered path extends the strict compiler base', () => {
  for (const file of covered.flatMap(dir => tsconfigs(join(root, dir)))) {
    assert.ok(extendsStrict(file), `${relative(root, file)} must extend tsconfig.strict.json`);
  }
});

test('covered paths have no lint baseline, and every workspace package is scoped', () => {
  const baseline = Object.keys(JSON.parse(readFileSync(join(root, 'eslint-suppressions.json'), 'utf8')));
  const inCovered = baseline.filter(file => covered.some(dir => file.startsWith(dir + '/')) && !staged.some(dir => file.startsWith(dir + '/')));
  assert.deepEqual(inCovered, []);
  // The module boundary treats unscoped names as third-party, so workspace packages must use the scope.
  const workspaces = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces;
  for (const dir of workspaces) {
    const name = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).name;
    assert.ok(name.startsWith('@jimmie-potts/'), `${dir} is named ${name}`);
  }
});

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({languageOptions: {ecmaVersion: 'latest', sourceType: 'module'}});
const inModule = join(process.cwd(), 'modules/example/src/a.mjs');
const options = [{allowedPackages: ['@jimmie-potts/sdk', '@jimmie-potts/event-contracts']}];

tester.run('module-boundary', bunny.rules['module-boundary'], {
  valid: [
    {code: "import {x} from './y.mjs';", filename: inModule, options},
    {code: "import {x} from '../test/y.mjs';", filename: inModule, options},
    {code: "import {sdk} from '@jimmie-potts/sdk';", filename: inModule, options},
    {code: "import {schema} from '@jimmie-potts/event-contracts/v2';", filename: inModule, options},
    {code: "import {readFile} from 'node:fs/promises';", filename: inModule, options},
    {code: "import other from '../../../apps/hub/src/a.mjs';", filename: join(process.cwd(), 'apps/runtime/src/a.mjs'), options},
  ],
  invalid: [
    {code: "import {x} from '../../other/src/y.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "import {store} from '@jimmie-potts/agent-state';", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: "export * from '../../../apps/hub/src/a.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "await import('@jimmie-potts/hub');", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: "export {store} from '@jimmie-potts/agent-state';", filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: 'await import(`@jimmie-potts/hub`);', filename: inModule, options, errors: [{messageId: 'workspace'}]},
    {code: 'const name = "x"; await import(`./${name}.mjs`);', filename: inModule, options, errors: [{messageId: 'dynamic'}]},
    {code: "import {x} from '/etc/other.mjs';", filename: inModule, options, errors: [{messageId: 'outside'}]},
    {code: "import {x} from '../../other/src/y.mjs';", filename: inModule, options: [{...options[0], root: process.cwd()}], errors: [{messageId: 'outside'}]},
  ],
});

tester.run('disable-reason', bunny.rules['disable-reason'], {
  valid: [
    '// eslint-disable-next-line no-console -- the CLI prints its result\nconsole.log(1);',
    '/* eslint-disable no-console -- a command-line entry point */',
    '// a comment that mentions eslint-disable in passing',
  ],
  invalid: [
    {code: '// eslint-disable-next-line no-console\nconsole.log(1);', errors: [{messageId: 'reason'}]},
    {code: '/* eslint-disable no-console --  */', errors: [{messageId: 'reason'}]},
    {code: '/* eslint no-console: "off" */\nconsole.log(1);', errors: [{messageId: 'configuration'}]},
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
