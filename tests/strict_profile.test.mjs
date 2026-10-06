// The strict profile for new code (Hub #867): which files it covers, the local rules and the compiler base.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
