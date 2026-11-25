// What a failed hosted test job keeps (Hub #2059): the failure-evidence action, its copy script and the JUnit reporter.
// Nothing here uploads; the upload itself is proven only by a hosted run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { KEPT_TYPES, LIMIT_BYTES, stage } from '../scripts/ci-selection/failure-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A child of this runner would otherwise report to it instead of running as its own test run.
const { NODE_TEST_CONTEXT: _context, ...childEnv } = process.env;

function directory(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gh2059-failure-evidence-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function write(file, bytes, modified) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  if (modified !== undefined) fs.utimesSync(file, modified, modified);
}
const manifest = target => fs.readFileSync(path.join(target, 'MANIFEST.txt'), 'utf8');

test('the action uploads the copy for 14 days with the pinned upload action, and runs both steps once called', () => {
  const action = YAML.parse(fs.readFileSync(path.join(root, '.github/actions/failure-evidence/action.yml'), 'utf8'));
  assert.equal(action.runs.using, 'composite');
  assert.deepEqual(Object.keys(action.inputs), ['name']);
  assert.deepEqual(action.runs.steps, [
    { if: 'always()', shell: 'bash', run: 'node scripts/ci-selection/failure-evidence.mjs "$TEST_EVIDENCE_DIR" "$RUNNER_TEMP/failure-evidence"' },
    { if: 'always()', uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', with: {
      name: 'failure-evidence-${{ inputs.name }}-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/failure-evidence', 'if-no-files-found': 'warn', 'retention-days': 14 } },
  ]);
  // The same upload action the release evidence uses.
  assert.ok(fs.readFileSync(path.join(root, '.github/workflows/release-qualification.yml'), 'utf8').includes(action.runs.steps[1].uses));
});

test('the copy keeps image, text and result files, skips other types, links and hidden files, and lists every file', t => {
  const source = path.join(directory(t), 'evidence'), target = path.join(directory(t), 'upload');
  write(path.join(source, 'bunny-browser-proof-a/failed.png'), 10);
  write(path.join(source, 'junit/node-test-1.xml'), 20);
  write(path.join(source, 'state.sqlite'), 30);
  write(path.join(source, '.env'), 5);
  write(path.join(source, '.hidden/shot.png'), 5);
  fs.symlinkSync('/etc/hostname', path.join(source, 'link.txt'));
  const outside = path.join(path.dirname(source), 'outside-original.txt');
  write(outside, 7);
  fs.linkSync(outside, path.join(source, 'hard.txt'));
  const rows = stage(source, target);
  assert.deepEqual(rows.map(row => [row.name, row.reason]), [
    ['.env', 'hidden, not uploaded'],
    ['.hidden', 'hidden, not uploaded'],
    [path.join('bunny-browser-proof-a', 'failed.png'), 'kept'],
    ['hard.txt', 'hard link'],
    [path.join('junit', 'node-test-1.xml'), 'kept'],
    ['link.txt', 'not a regular file'],
    ['state.sqlite', 'file type not kept'],
  ]);
  assert.equal(fs.readFileSync(path.join(target, 'bunny-browser-proof-a/failed.png')).length, 10);
  assert.equal(fs.existsSync(path.join(target, 'state.sqlite')), false);
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
  assert.equal(fs.existsSync(path.join(target, 'link.txt')), false);
  assert.equal(fs.existsSync(path.join(target, 'hard.txt')), false);
  assert.equal(fs.existsSync(path.join(target, '.hidden')), false);
  assert.match(manifest(target), /^Failure evidence \(#2059\): 2 of 7 files kept, 30 of at most \d+ bytes\.\n/);
  for (const type of ['.png', '.xml', '.json', '.txt', '.html']) assert.ok(KEPT_TYPES.has(type), type);
  assert.equal(LIMIT_BYTES, 50 * 1024 * 1024);
});

test('over the limit, JUnit files come first and then the newest files, and the rest are listed as omitted', t => {
  const source = path.join(directory(t), 'evidence'), target = path.join(directory(t), 'upload');
  write(path.join(source, 'old.png'), 40, 1000);
  write(path.join(source, 'new.png'), 40, 3000);
  write(path.join(source, 'junit/node-test-2.xml'), 40, 500);
  const rows = stage(source, target, { limit: 100 });
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.name, row.reason])), {
    [path.join('junit', 'node-test-2.xml')]: 'kept', 'new.png': 'kept', 'old.png': 'over the size limit' });
  assert.equal(fs.existsSync(path.join(target, 'old.png')), false);
  assert.match(manifest(target), /2 of 3 files kept, 80 of at most 100 bytes/);
  assert.match(manifest(target), /over the size limit\t40\told\.png/);
});

test('a job that failed before its tests wrote anything still uploads a manifest that says so', t => {
  const target = path.join(directory(t), 'upload');
  assert.deepEqual(stage(path.join(directory(t), 'never-written'), target), []);
  assert.match(manifest(target), /The tests wrote no evidence before the job failed\./);
});

test('the JUnit reporter names each test and its duration beside unchanged spec output, and writes nothing unset', t => {
  const folder = directory(t), evidence = path.join(folder, 'evidence');
  fs.writeFileSync(path.join(folder, 'probe.test.mjs'), "import {test} from 'node:test';import assert from 'node:assert';\n"
    + "test('passes', () => {});\ntest('fails on purpose', () => { assert.equal(1, 2); });\n");
  const reporter = path.join(root, 'scripts/ci-selection/junit-file.mjs');
  const options = `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=${reporter} --test-reporter-destination=stdout`;
  const run = env => spawnSync(process.execPath, ['--test', 'probe.test.mjs'], { cwd: folder, encoding: 'utf8', env: { ...childEnv, NODE_OPTIONS: options, ...env } });
  const plain = spawnSync(process.execPath, ['--test', 'probe.test.mjs'], { cwd: folder, encoding: 'utf8', env: { ...childEnv, NODE_OPTIONS: '', TEST_EVIDENCE_DIR: '' } });
  const result = run({ TEST_EVIDENCE_DIR: evidence });
  assert.equal(result.status, 1, 'the failing test still fails the run');
  const lines = text => text.split('\n').filter(line => !/duration_ms|\(\d/.test(line));
  assert.deepEqual(lines(result.stdout), lines(plain.stdout), 'the log keeps the spec output it had');
  const files = fs.readdirSync(path.join(evidence, 'junit'));
  assert.equal(files.length, 1);
  const xml = fs.readFileSync(path.join(evidence, 'junit', files[0]), 'utf8');
  assert.match(xml, /<testcase name="passes" time="[\d.]+"/);
  assert.match(xml, /<testcase name="fails on purpose" time="[\d.]+"[^>]*failure="1 == 2"/);
  assert.equal(run({ TEST_EVIDENCE_DIR: '' }).status, 1);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['evidence', 'probe.test.mjs'], 'without the folder it writes nothing');
  assert.equal(fs.readdirSync(path.join(evidence, 'junit')).length, 1);
});

test('the JUnit reporter fails open: a folder it cannot write leaves the result and output as they were', t => {
  const folder = directory(t), file = path.join(folder, 'a-file');
  fs.writeFileSync(file, 'not a folder');
  fs.writeFileSync(path.join(folder, 'pass.test.mjs'), "import {test} from 'node:test';\ntest('passes', () => {});\n");
  fs.writeFileSync(path.join(folder, 'fail.test.mjs'), "import {test} from 'node:test';import assert from 'node:assert';\n"
    + "test('fails on purpose', () => { assert.equal(1, 2); });\n");
  // /proc refuses new folders even to root, so this holds whoever runs the test. (A recursive create there never
  // returns, so the reporter creates one level at a time.)
  const unwritable = '/proc/gh2059-evidence';
  assert.throws(() => fs.mkdirSync(unwritable));
  const reporter = path.join(root, 'scripts/ci-selection/junit-file.mjs');
  const options = `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=${reporter} --test-reporter-destination=stdout`;
  const run = (name, env) => spawnSync(process.execPath, ['--test', name], { cwd: folder, encoding: 'utf8', timeout: 30000, env: { ...childEnv, ...env } });
  const lines = text => text.split('\n').filter(line => !/duration_ms|\(\d/.test(line));
  for (const [name, status] of [['pass.test.mjs', 0], ['fail.test.mjs', 1]]) {
    const plain = run(name, { NODE_OPTIONS: '', TEST_EVIDENCE_DIR: '' });
    assert.equal(plain.status, status, name);
    for (const evidence of [unwritable, file, '']) {
      const result = run(name, { NODE_OPTIONS: options, TEST_EVIDENCE_DIR: evidence });
      assert.equal(result.status, status, `${name} with ${JSON.stringify(evidence)}`);
      assert.deepEqual(lines(result.stdout), lines(plain.stdout), `${name} with ${JSON.stringify(evidence)}: same spec output`);
      assert.equal(result.stderr, plain.stderr, `${name} with ${JSON.stringify(evidence)}: same error output`);
    }
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a folder');
});
