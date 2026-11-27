import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {pathToFileURL} from 'node:url';
import {renderFailure} from '../scripts/ci-selection/failure-summary.mjs';

const blocked = 'private-name <img src=x> | [link](https://example.invalid)\n## injected heading';
const shell = resolve('scripts/ci-selection/failure-summary.sh');

test('the public renderer accepts fixed browser vocabulary and bounded numeric Node fields only', () => {
  const row = renderFailure('browser', blocked, {journey: 'Room models', step: 'Load the studio model',
    condition: 'feed connected', feed: 'reconnecting', copies: blocked, stack: blocked});
  assert.match(row, /room-models\.browser\.ts \| Load the studio model \| feed connected \| reconnecting \| not observed/);
  assert.ok(!row.includes('private-name'));
  assert.ok(!renderFailure('browser', blocked, {journey: blocked, step: blocked, condition: blocked, feed: blocked}).includes('private-name'));
  const cases = Array.from({length: 14}, () => ({suite: 'runtime', module: blocked, line: 1e20, column: blocked,
    caseId: -1, ordinal: 3, duration: blocked, name: blocked, diagnostic: blocked}));
  const rendered = renderFailure('node', blocked, {cases});
  assert.equal(rendered.split('\n').filter(line => line.startsWith('| runtime |')).length, 10);
  assert.match(rendered, /Additional failing cases omitted/);
  assert.ok(!rendered.includes('private-name'));
  assert.ok(!renderFailure('suite', blocked, {}).includes('private-name'));
});

test('a summary step preserves bash failure, inherited streams and zero summary on success', t => {
  const root = mkdtempSync(join(tmpdir(), 'summary-shell-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const summary = join(root, 'summary'), script = join(root, 'step');
  const run = command => {
    writeFileSync(summary, ''); writeFileSync(script, command);
    return spawnSync('bash', [shell, 'browser', 'smoke.ts', script], {env: {...process.env, RUNNER_TEMP: root,
      GITHUB_STEP_SUMMARY: summary}, input: 'original stdin\n', encoding: 'utf8'});
  };
  let child = run('cat\necho original-stderr >&2\nfalse | true\n');
  assert.equal(child.status, 0); assert.equal(child.stdout, 'original stdin\n'); assert.equal(child.stderr, 'original-stderr\n');
  assert.equal(readFileSync(summary, 'utf8'), '');
  child = run('echo before\n(exit 29)\necho should-not-run\n');
  assert.equal(child.status, 29); assert.equal(child.stdout, 'before\n');
  assert.match(readFileSync(summary, 'utf8'), /smoke\.ts \| not observed/);
});

test('the publisher refuses symlinked and oversized records without printing their contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'summary-boundary-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'other'), slot = join(root, 'browser'), summary = join(root, 'summary');
  writeFileSync(source, JSON.stringify({journey: 'Room models'})); symlinkSync(source, slot);
  function publish() {
    writeFileSync(summary, '');
    const child = spawnSync(process.execPath, ['scripts/ci-selection/failure-summary.mjs','browser','smoke.ts',root],
      {env: {...process.env, GITHUB_STEP_SUMMARY: summary}});
    assert.equal(child.status, 0); assert.match(readFileSync(summary,'utf8'), /smoke\.ts \| not observed/);
  }
  publish(); rmSync(slot); writeFileSync(slot, ' '.repeat(8500) + readFileSync(source, 'utf8')); publish();
});

test('the native reporter identifies only the failed case across a shared registration helper and keeps spec stdout', t => {
  const root = mkdtempSync(join(tmpdir(), 'summary-node-')), directory = join(root, 'apps/runtime/dist/tests');
  t.after(() => rmSync(root, {recursive: true, force: true})); mkdirSync(directory, {recursive: true});
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(directory, 'helper.js'), "import test from 'node:test';
import YAML from 'yaml'; export function register(title, fn) {test(title, fn);}");
  writeFileSync(join(directory, 'actions.test.js'), `import {register} from './helper.js';
    register('healthy', () => {});
    register(${JSON.stringify(blocked)}, () => { throw Error('PRIVATE_ERROR'); });`);
  const output = join(root,'node');
  const reporter = pathToFileURL(resolve('scripts/ci-selection/failure-node.mjs')).href;
  const env = {...process.env, BUNNY_CI_NODE_RECORD: output};
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--test','--test-reporter=spec','--test-reporter-destination=stdout',
    '--test-reporter='+reporter,'--test-reporter-destination=stdout','apps/runtime/dist/tests/actions.test.js'],
    {cwd: root, env, encoding:'utf8'});
  assert.equal(child.status, 1); assert.match(child.stdout, /PRIVATE_ERROR/);
  const raw = readFileSync(output,'utf8'), {cases} = JSON.parse(raw);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].suite, 'runtime'); assert.equal(cases[0].module, 'actions');
  assert.equal(cases[0].caseId, 2); assert.equal(cases[0].ordinal, 2);
  assert.equal(cases[0].line, undefined); assert.equal(typeof cases[0].duration, 'number');
  for (const value of [blocked, 'PRIVATE_ERROR', directory, 'healthy']) assert.ok(!raw.includes(value));
});

test('Core standalone admission can execute an older exact head without the summary shell', t => {
  const workflow = YAML.parse(readFileSync('.github/workflows/checks.yml', 'utf8'));
  const core = workflow.jobs.core;
  assert.match(core.steps[0].with.ref, /outputs.mode == 'standalone' && needs.select.outputs.head/);
  const shell = /^\$\{\{ needs\.select\.outputs\.mode == 'standalone' && '([^']+)' \|\| 'bash scripts\/ci-selection\/failure-summary\.sh core default \{0\}' \}\}$/.exec(core.defaults.run.shell);
  assert.ok(shell);
  const root = mkdtempSync(join(tmpdir(), 'older-standalone-head-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'step'), 'echo standalone\n(exit 19)\n');
  const [program, ...args] = shell[1].replace('{0}', 'step').split(' ');
  const child = spawnSync(program, args, {cwd: root, encoding: 'utf8'});
  assert.equal(child.status, 19); assert.equal(child.stdout, 'standalone\n');
});
