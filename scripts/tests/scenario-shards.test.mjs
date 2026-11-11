import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import {test} from 'node:test';
import {DEFAULT_SHARDS, combinedStatus, jobs, parse, run, runIsolated, summary, totals} from '../scenario-shards.mjs';

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

/** A writable that keeps what is written, and calls `seen` with the text so far after each write. */
function collector(seen = () => undefined) {
  const out = new Writable({write(chunk, _encoding, done) { out.text += String(chunk); seen(out.text); done(); }});
  out.text = '';
  return out;
}

test('a process that cannot start ends with status 1 and a labelled message, and the others still report', async () => {
  const out = collector();
  const failing = () => {
    const child = new EventEmitter();
    Object.assign(child, {stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true});
    setImmediate(() => child.emit('error', new Error('spawn node ENOENT')));
    return child;
  };
  const start = (command, args, options) => {
    if (args[0] === 'emits') return failing();
    if (args[0] === 'throws') throw new Error('bad arguments');
    return spawn(command, args, options);
  };
  const results = await run([
    {label: 'fine', env: {}, args: ['-e', 'console.log("ℹ tests 1")']},
    {label: 'emits', env: {}, args: ['emits']},
    {label: 'throws', env: {}, args: ['throws']},
  ], {out, start});
  assert.deepEqual(results.map(result => [result.label, result.status]), [['fine', 0], ['emits', 1], ['throws', 1]]);
  assert.deepEqual(results[0].totals, {tests: 1});
  assert.match(out.text, /^\[emits\] could not start: spawn node ENOENT$/m);
  assert.match(out.text, /^\[throws\] could not start: bad arguments$/m);
  assert.equal(combinedStatus(results.map(result => result.status)), 1);
  assert.match(summary(results), /emits: exit 1 after/);
});

test('totals come from standard output alone, so standard error cannot split or add to them', async () => {
  const body = [
    'process.stdout.write("ℹ te")',
    'setTimeout(() => process.stderr.write("noise\\nℹ tests 99\\n"), 50)',
    'setTimeout(() => process.stdout.write("sts 5\\nℹ pass 5\\n"), 150)',
  ].join(';');
  const results = await run([{label: 'mixed', env: {}, args: ['-e', body]}], {out: collector()});
  assert.deepEqual(results[0].totals, {tests: 5, pass: 5});
});

test('SIGINT and SIGTERM reach every process', async () => {
  for (const [signal, status] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    const signals = new EventEmitter();
    const out = collector(text => { if ((text.match(/\] ready$/gm) ?? []).length === 2) signals.emit(signal, signal); });
    const forever = {env: {}, args: ['-e', 'console.log("ready");setInterval(() => undefined, 1000)']};
    const results = await run([{label: 'a', ...forever}, {label: 'b', ...forever}], {out, signals});
    assert.deepEqual(results.map(result => result.status), [status, status], signal);
    assert.equal(signals.listenerCount(signal), 0, 'the run stops listening once it ends');
  }
});

test('the private temporary directory is the processes\' TMPDIR and is removed after success, failure and interrupt', async () => {
  const tmp = await realpath('/tmp');
  const writes = 'require("node:fs").writeFileSync(require("node:path").join(process.env.TMPDIR, "left"), "x");console.log("dir " + process.env.TMPDIR)';
  for (const [name, tail, status] of [['success', '', 0], ['failure', ';process.exit(4)', 4], ['interrupt', ';setInterval(() => undefined, 1000)', 143]]) {
    const signals = new EventEmitter();
    const out = collector(text => { if (name === 'interrupt' && /^\[job\] dir /m.test(text)) signals.emit('SIGTERM', 'SIGTERM'); });
    const results = await runIsolated([{label: 'job', env: {}, args: ['-e', `${writes}${tail}`]}], {out, signals});
    assert.equal(results[0].status, status, name);
    const dir = /^\[job\] dir (.*)$/m.exec(out.text)?.[1];
    assert.ok(dir?.startsWith(join(tmp, 'bunny-shards.')), `${name}: ${String(dir)}`);
    assert.equal(existsSync(dir), false, `${name}: the directory is gone`);
  }
});
