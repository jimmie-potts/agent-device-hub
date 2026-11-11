import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {test} from 'node:test';
import {DEFAULT_SHARDS, combinedStatus, jobs, parse, run, summary, totals} from '../scenario-shards.mjs';

const FILES = ['catalog.test.js', 'roborock.test.js', 'runner.test.js'];

test('a run takes four shards unless --shards names another count, and passes options after -- to every process', () => {
  assert.equal(DEFAULT_SHARDS, 4);
  assert.deepEqual(parse([]), {shards: 4, extra: []});
  assert.deepEqual(parse(['--shards', '8', '--', '--test-name-pattern=a b']), {shards: 8, extra: ['--test-name-pattern=a b']});
  assert.deepEqual(parse(['--', '--test-reporter=tap']), {shards: 4, extra: ['--test-reporter=tap']});
  for (const args of [['--shards'], ['--shards', '0'], ['--shards', 'four'], ['--shards', '100'], ['--shards', '-1'], ['--shards', '2', '--shards', '3'],
    ['--other', '1'], ['4']]) {
    assert.throws(() => parse(args), undefined, args.join(' '));
  }
});

test('each shard runs the catalog once with its own selection, and the other files run once in one more process', () => {
  const planned = jobs(3, FILES, ['--test-reporter=tap']);
  assert.deepEqual(planned.map(job => job.label), ['shard 1/3', 'shard 2/3', 'shard 3/3', 'other files']);
  assert.deepEqual(planned.map(job => job.env), [{BUNNY_SCENARIO_SHARD: '1/3'}, {BUNNY_SCENARIO_SHARD: '2/3'}, {BUNNY_SCENARIO_SHARD: '3/3'}, {}]);
  const suite = 'apps/runtime/dist/tests/scenarios';
  for (const job of planned.slice(0, 3)) assert.deepEqual(job.args, ['--test', '--test-concurrency=1', '--test-reporter=tap', `${suite}/catalog.test.js`]);
  assert.deepEqual(planned[3].args, ['--test', '--test-concurrency=1', '--test-reporter=tap', `${suite}/roborock.test.js`, `${suite}/runner.test.js`]);
  assert.deepEqual(jobs(1, ['catalog.test.js']).map(job => job.label), ['shard 1/1']);
  assert.throws(() => jobs(4, ['roborock.test.js']), /npm run build/);
});

test('the run fails when any process fails, with the first failing status', () => {
  assert.equal(combinedStatus([0, 0, 0]), 0);
  assert.equal(combinedStatus([0, 1, 0]), 1);
  assert.equal(combinedStatus([0, 130, 1]), 130);
  assert.equal(combinedStatus([]), 0);
});

test('totals are read from the spec and tap reporters, and the summary adds up the catalog shards only', () => {
  assert.deepEqual(totals('ℹ tests 46\nℹ suites 0\nℹ pass 45\nℹ fail 1\nℹ skipped 0\n'), {tests: 46, pass: 45, fail: 1, skipped: 0});
  assert.deepEqual(totals('# tests 3\n# pass 3\n# fail 0\nok 1 - x tests 9\n'), {tests: 3, pass: 3, fail: 0});
  const text = summary([
    {label: 'shard 1/2', status: 0, seconds: 1, totals: {tests: 4, pass: 4, fail: 0}},
    {label: 'shard 2/2', status: 1, seconds: 2, totals: {tests: 3, pass: 2, fail: 1}},
    {label: 'other files', status: 0, seconds: 3, totals: {tests: 9, pass: 9}},
  ]);
  assert.match(text, /shard 2\/2: exit 1 after 2\.0 s, tests 3, pass 2, fail 1, skipped 0/);
  assert.match(text, /catalog shards together: tests 7, pass 6, fail 1, skipped 0$/);
});

test('each output line names its process, and each keeps its own exit status', async () => {
  let output = '';
  const out = new Writable({write(chunk, _encoding, done) { output += String(chunk); done(); }});
  const script = (lines, code) => ({args: ['-e', `${lines.map(line => `console.log(${JSON.stringify(line)})`).join(';')};process.exit(${String(code)})`]});
  const results = await run([
    {label: 'a', env: {}, ...script(['one', 'ℹ tests 2'], 0)},
    {label: 'b', env: {MARK: 'b'}, args: ['-e', 'console.error(process.env.MARK);setTimeout(() => process.exit(3), 300)']},
    {label: 'c', env: {}, args: ['-e', 'setTimeout(() => process.kill(process.pid, "SIGTERM"), 300)']},
  ], {out});
  assert.deepEqual(results.map(result => [result.label, result.status]), [['a', 0], ['b', 3], ['c', 143]]);
  assert.deepEqual(results[0].totals, {tests: 2});
  assert.equal(combinedStatus(results.map(result => result.status)), 3);
  assert.deepEqual(output.split('\n').filter(Boolean).sort(), ['[a] one', '[a] ℹ tests 2', '[b] b']);
});
