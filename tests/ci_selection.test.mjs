// Affected PR checks (Hub #1080): the path-to-group mapping, the final gate's verdict, the CI entry point and the
// workflow that consumes them. The Workflow job runs this file, so a selector or workflow change is tested even when
// the Checks workflow it changes runs everything.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { runGate, runSelect } from '../scripts/ci-selection/cli.mjs';
import { localPaths, selectedCommands } from '../scripts/ci-selection/local.mjs';
import { GROUPS, JOBS, NOTICE_TITLE, STEP_CONDITION, gateVerdict, jobCondition, noticeMessage, readNotice, selectChecks, stepGroup, stepOwner } from '../scripts/ci-selection/selection.mjs';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/checks.yml'), 'utf8'));
const pr = paths => selectChecks({ event: 'pull_request', paths, complete: true });

// Hub #1676: the suite runs as two jobs, capture shard 1/2 in one and every other file then shard 2/2 in the other.
const verifyJobs = { 'runtime-verify-captures': 'npm run test:runtime:verify:captures:built', 'runtime-verify': 'npm run test:runtime:verify:rest:built' };

test('full runtime verification is independently required without dropping App checks', () => {
  for (const [id, suite] of Object.entries(verifyJobs)) {
    const runtime = checks.jobs[id];
    assert.ok(runtime, `${id}: each share of the serial runtime suite needs its own finite job budget`);
    assert.equal(runtime['timeout-minutes'], 45, id);
    assert.deepEqual(runtime.env, checks.jobs['app-verify'].env, id);
    assert.deepEqual(runtime.steps.filter(step => /test:runtime:verify/.test(step.run ?? '')).map(step => step.run), [suite], id);
    assert.equal(checks.jobs['app-verify'].steps.some(step => step.run === suite), false, id);
    assert.ok(checks.jobs.gate.needs.includes(id), id);
  }
  assert.equal(Object.values(checks.jobs).some(job => job.steps.some(step => step.run === 'npm run test:runtime:verify:built')), false,
    'CI runs the suite only through its two shares');
  const selected = pr(['apps/runtime/src/main.ts']);
  const narrow = pr(['apps/chompi-bridge/src/bridge.ts']);
  for (const id of Object.keys(verifyJobs)) {
    assert.equal(selected.jobs[id], true, id);
    assert.equal(narrow.jobs[id], false, id);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const verdict = gateVerdict(needs(selected, {[id]: {result, outputs: {}}}));
      assert.equal(verdict.ok, false, `${id}: ${result}`);
      assert.match(verdict.problems.join(), new RegExp(`${id}: ${result}`), `${id}: ${result}`);
    }
    const missing = needs(selected);
    delete missing[id];
    const verdict = gateVerdict(missing);
    assert.equal(verdict.ok, false, `${id}: missing`);
    assert.match(verdict.problems.join(), new RegExp(`${id}: missing`));
  }
  assert.equal(gateVerdict(needs(selected)).ok, true, 'both jobs succeeding passes the gate');
});

test('the two runtime verification jobs are selected together wherever either is (#1676)', () => {
  const samples = [['apps/runtime/src/main.ts'], ['modules/pixoo/src/module.ts'], ['apps/chompi-bridge/src/bridge.ts'], ['README.md'],
    ['apps/runtime/dashboard/src/music.css'], ['scripts/a.mjs'], ['an/unmapped/path.txt']];
  for (const paths of samples) {
    const selection = pr(paths);
    assert.equal(selection.jobs['runtime-verify-captures'], selection.jobs['runtime-verify'], paths.join());
  }
  for (const event of ['push', 'workflow_dispatch']) {
    const full = selectChecks({ event, paths: [], complete: true });
    assert.equal(full.jobs['runtime-verify-captures'], true, event);
    assert.equal(full.jobs['runtime-verify'], true, event);
  }
});

test('the runtime unit and scenario suites run in their own selected jobs, outside core (#1506)', () => {
  const suites = { 'runtime-unit': 'npm run test:runtime:built', 'runtime-scenarios': 'npm run test:runtime:scenarios:built' };
  const core = checks.jobs.core.steps.map(step => step.run);
  const runtime = pr(['apps/runtime/src/main.ts']);
  for (const [id, suite] of Object.entries(suites)) {
    const job = checks.jobs[id];
    assert.ok(job, `${id}: the suite has its own runner, so the core job keeps its headroom`);
    assert.equal(job['timeout-minutes'], 40, `${id} keeps the 40-minute limit the suite ran under in core`);
    assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), ['npm ci', 'npm run build', suite]);
    assert.equal(core.includes(suite), false, `${suite} runs once, in ${id}`);
    assert.ok(checks.jobs.gate.needs.includes(id), `the gate covers ${id}`);
    assert.equal(runtime.jobs[id], true, `a runtime change runs ${id}`);
    // Focused presentation admission kept both suites while they ran in core; it omits only the broad jobs.
    assert.equal(pr(['apps/runtime/dashboard/src/music.css']).jobs[id], true, `focused admission keeps ${id}`);
    assert.equal(pr(['modules/wispr/src/frontend/wispr.css']).jobs[id], true, `focused module admission keeps ${id}`);
    assert.equal(pr(['apps/chompi-bridge/src/bridge.ts']).jobs[id], false, `a CHOMPI change skips ${id}`);
    assert.equal(selectChecks({ event: 'release_qualification', paths: [], complete: true }).jobs[id], true, `qualification runs ${id}`);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(gateVerdict(needs(runtime, { [id]: { result, outputs: {} } })).ok, false, `${id}: ${result}`);
    }
    const missing = needs(runtime);
    delete missing[id];
    assert.match(gateVerdict(missing).problems.join(), new RegExp(`${id}: missing`));
  }
});

// ---- Path selection ----

test('a narrow module change selects its suites and known consumers, and omits unrelated work', () => {
  const result = pr(['modules/pixoo/src/module.ts']);
  assert.equal(result.mode, 'selected');
  // The runtime composes every module.
  assert.deepEqual(result.groups, ['runtime', 'modules']);
  assert.deepEqual(result.omitted, ['chompi', 'shared']);
  assert.deepEqual(result.jobs, { 'runtime-unit': true, 'runtime-scenarios': true, firmware: false, 'app-verify': true, 'runtime-verify-captures': true, 'runtime-verify': true });
  assert.deepEqual(result.reasons.find(item => item.path === 'modules/pixoo/src/module.ts').groups, ['modules', 'runtime']);
  assert.deepEqual(pr(['apps/bb8-windows/src/link.ts']).groups, []);
});

test('a change to the Volcano collector alone runs its adapter tests in the modules group', () => {
  for (const path of ['apps/runtime/src/collector/volcano.ts', 'apps/runtime/bin/volcano-collector.mjs']) {
    assert.deepEqual(pr([path]).groups, ['runtime', 'modules'], path);
  }
  assert.deepEqual(pr(['apps/volcano-collector/src/noble-transport.ts']).groups.toSorted(), ['modules', 'runtime']);
  assert.deepEqual(pr(['apps/runtime/src/collector/codex-desktop.ts']).groups, ['runtime'], 'another collector stays with the runtime');
});

test('a runtime dashboard change selects the runtime only', () => {
  const result = pr(['apps/runtime/dashboard/src/music.css', 'apps/runtime/dashboard/src/card-chrome.css']);
  assert.deepEqual(result.groups, ['runtime']);
  assert.equal(result.mode, 'focused');
  assert.deepEqual(result.jobs, { 'runtime-unit': true, 'runtime-scenarios': true, firmware: false, 'app-verify': false, 'runtime-verify-captures': false, 'runtime-verify': false });
  // The old dashboard is shared with the old Hub and the runtime's dashboard copy, so it keeps the full gate.
  assert.equal(pr(['apps/dashboard/src/main.tsx']).mode, 'full');
});

// #1714: hosted CI runs no CHOMPI bridge step until #1715, so a CHOMPI change runs the Firmware job only.
test('CHOMPI changes select the chompi group and the firmware job, not App verification', () => {
  for (const file of ['apps/chompi-bridge/src/bridge.ts', 'packages/chompi-protocol/fixtures/frames.json', 'firmware/chompi-controller/src/main.cpp']) {
    const result = pr([file]);
    assert.deepEqual(result.groups, ['chompi'], file);
    assert.deepEqual(result.jobs, { 'runtime-unit': false, 'runtime-scenarios': false, firmware: true, 'app-verify': false, 'runtime-verify-captures': false, 'runtime-verify': false }, file);
  }
});

test('shared, toolchain, CI, selector and unknown paths select full coverage with their reason', () => {
  for (const [file, reason] of [
    ['packages/sdk/src/database.ts', /shared package/],
    ['packages/event-contracts/src/v2/index.ts', /shared package/],
    ['package-lock.json', /not mapped/],
    ['tsconfig.json', /not mapped/],
    ['pyrightconfig.json', /not mapped/],
    ['eslint.config.mjs', /not mapped/],
    ['ruff.toml', /not mapped/],
    ['requirements-tooling.txt', /not mapped/],
    ['.github/workflows/checks.yml', /CI configuration/],
    ['scripts/ci-selection/selection.mjs', /repository script/],
    ['scripts/delivery-preflight/ci.mjs', /repository script/],
    ['apps/hub/src/server.ts', /old system/],
    ['controllers/lifx/src/index.ts', /old system/],
    ['docs/skins/places.json', /both dashboards/],
    ['tests/workflow_checks.cjs', /shared test/],
    ['vendor/x/y.js', /not mapped/],
    ['somewhere/new.txt', /not mapped/],
  ]) {
    const result = pr(['modules/pixoo/src/module.ts', file]);
    assert.equal(result.mode, 'full', file);
    assert.deepEqual(result.groups, GROUPS, file);
    assert.deepEqual(result.omitted, [], file);
    assert.deepEqual(result.jobs, { 'runtime-unit': true, 'runtime-scenarios': true, firmware: true, 'app-verify': true, 'runtime-verify-captures': true, 'runtime-verify': true }, file);
    assert.ok(result.full.some(item => item.path === file && reason.test(item.reason)), `${file}: ${JSON.stringify(result.full)}`);
  }
});

test('Markdown, documentation tooling and OpenSpec change no Checks suite, and the Roborock consumers are runtime tests', () => {
  for (const file of ['README.md', 'apps/runtime/README.md', 'docs/diagrams/check.py', 'docs/system-design/build.py', 'openspec/config.yaml']) {
    const result = pr([file]);
    assert.equal(result.mode, 'selected', file);
    assert.deepEqual(result.groups, [], file);
    assert.deepEqual(result.jobs, { 'runtime-unit': false, 'runtime-scenarios': false, firmware: false, 'app-verify': false, 'runtime-verify-captures': false, 'runtime-verify': false }, file);
  }
  assert.deepEqual(pr(['tests/roborock_consumer.test.mjs']).groups, ['runtime']);
  // A Markdown file never widens a mixed change.
  assert.deepEqual(pr(['apps/chompi-bridge/README.md', 'apps/chompi-bridge/src/bridge.ts']).groups, ['chompi']);
});

test('renames and deletions count both paths: a move out of a narrow group widens the selection', () => {
  // A rename's old and new paths both arrive as changed paths (callers add previous_filename).
  assert.deepEqual(pr(['modules/pixoo/src/old.ts', 'apps/chompi-bridge/src/new.ts']).groups, ['runtime', 'modules', 'chompi']);
  const moved = pr(['modules/pixoo/src/helpers.ts', 'packages/sdk/src/helpers.ts']);
  assert.equal(moved.mode, 'full');
  // A deletion is just its old path.
  assert.deepEqual(pr(['apps/chompi-bridge/src/removed.ts']).groups, ['chompi']);
});

test('pushes, manual runs, other events, incomplete or empty comparisons select full coverage', () => {
  for (const event of ['push', 'workflow_dispatch', 'merge_group', 'schedule']) {
    const result = selectChecks({ event, paths: ['apps/chompi-bridge/src/bridge.ts'], complete: true });
    assert.equal(result.mode, 'full', event);
    assert.match(result.full[0].reason, new RegExp(event));
  }
  const incomplete = selectChecks({ event: 'pull_request', paths: ['apps/chompi-bridge/src/bridge.ts'], complete: false, detail: 'HTTP 502' });
  assert.equal(incomplete.mode, 'full');
  assert.match(incomplete.full[0].reason, /incomplete.*HTTP 502/);
  assert.equal(selectChecks({ event: 'pull_request', paths: [], complete: true }).mode, 'full');
});

test('the mapping refuses malformed input instead of guessing', () => {
  assert.throws(() => selectChecks({ event: 'pull_request', paths: ['/abs/path'], complete: true }), /relative/);
  assert.throws(() => selectChecks({ event: 'pull_request', paths: ['a/../b'], complete: true }), /relative/);
  assert.throws(() => selectChecks({ event: 'pull_request', paths: 'apps/runtime/x.ts', complete: true }), /paths/);
  assert.throws(() => selectChecks({ paths: [], complete: true }), /event/);
});

// ---- The final gate ----

const outputs = selection => ({
  mode: selection.mode,
  groups: JSON.stringify(selection.groups),
  ...Object.fromEntries(Object.entries(selection.jobs).map(([id, run]) => [id, String(run)])),
});
const needs = (selection, results = {}) => ({
  select: { result: 'success', outputs: outputs(selection) },
  core: { result: 'success', outputs: {} },
  ...Object.fromEntries(Object.keys(JOBS).map(id => [id, { result: selection.jobs[id] ? 'success' : 'skipped', outputs: {} }])),
  ...results,
});

test('the gate passes when every selected job succeeded and only unselected jobs were skipped', () => {
  const narrow = pr(['apps/runtime/src/main.ts']);
  const verdict = gateVerdict(needs(narrow));
  assert.equal(verdict.ok, true, verdict.problems.join('; '));
  assert.deepEqual(verdict.lines.filter(line => /not selected/.test(line)).length, 1);
  assert.equal(gateVerdict(needs(pr(['packages/sdk/src/x.ts']))).ok, true);
  // An unselected job that ran anyway was executed, so it is reported as executed, not as skipped.
  const extra = gateVerdict(needs(narrow, { firmware: { result: 'success', outputs: {} } }));
  assert.equal(extra.ok, true);
  assert.ok(extra.lines.some(line => /firmware: success \(ran although not selected\)/.test(line)));
});

test('the gate fails on a selection failure, a failed, cancelled or missing job, and an unexpected skip', () => {
  const narrow = pr(['modules/pixoo/src/module.ts']);
  const failing = [
    [{ select: { result: 'failure', outputs: {} } }, /selection did not succeed: failure/],
    [{ select: { result: 'cancelled', outputs: {} } }, /selection did not succeed: cancelled/],
    [{ select: { result: 'success', outputs: {} } }, /selection output/],
    [{ select: { result: 'success', outputs: { ...outputs(narrow), groups: '["runtime","bogus"]' } } }, /unknown group bogus/],
    [{ select: { result: 'success', outputs: { ...outputs(narrow), groups: 'not json' } } }, /selection output/],
    [{ select: { result: 'success', outputs: { ...outputs(narrow), mode: 'partial' } } }, /mode/],
    [{ select: { result: 'success', outputs: { ...outputs(narrow), firmware: 'true' } } }, /firmware.*does not match/],
    [{ select: { result: 'success', outputs: { ...outputs(narrow), mode: 'full' } } }, /full selection must select every group/],
    [{ core: { result: 'failure', outputs: {} } }, /core: failure/],
    [{ core: { result: 'cancelled', outputs: {} } }, /core: cancelled/],
    [{ core: { result: 'skipped', outputs: {} } }, /core: skipped/],
    [{ 'app-verify': { result: 'skipped', outputs: {} } }, /app-verify: skipped although selected/],
    [{ 'app-verify': { result: 'cancelled', outputs: {} } }, /app-verify: cancelled/],
    [{ firmware: { result: 'failure', outputs: {} } }, /firmware: failure/],
    [{ firmware: { result: 'cancelled', outputs: {} } }, /firmware: cancelled/],
  ];
  for (const [change, pattern] of failing) {
    const verdict = gateVerdict(needs(narrow, change));
    assert.equal(verdict.ok, false, JSON.stringify(change));
    assert.ok(verdict.problems.some(problem => pattern.test(problem)), `${JSON.stringify(change)}: ${verdict.problems.join('; ')}`);
  }
  const missing = needs(narrow);
  delete missing.firmware;
  assert.match(gateVerdict(missing).problems.join(), /firmware: missing/);
  assert.equal(gateVerdict(undefined).ok, false);
  // An inherited property name is not a job.
  assert.match(gateVerdict({ ...needs(narrow), constructor: { result: 'skipped', outputs: {} } }).problems.join(), /constructor: skipped although selected/);
});

// ---- The CI entry points ----

function actions(t, event, payload) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-selection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const eventPath = path.join(directory, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(payload));
  return {
    directory,
    env: {
      GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: 'jimmie-potts/agent-device-hub',
      GITHUB_API_URL: 'https://api.github.com', GITHUB_TOKEN: 'token-value',
      GITHUB_OUTPUT: path.join(directory, 'output'), GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
    },
  };
}
const readOutputs = file => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
const PULL = { pull_request: { number: 7, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };

test('select reads the exact PR comparison, counts renamed paths and writes outputs and a summary', async t => {
  const { env } = actions(t, 'pull_request', PULL);
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ files: [
      { filename: 'apps/chompi-bridge/src/new.ts', previous_filename: 'modules/pixoo/src/old.ts', status: 'renamed' },
      { filename: 'docs/example.md', status: 'modified' },
      { filename: 'modules/pixoo/src/removed.ts', status: 'removed' },
    ] }) };
  };
  const result = await runSelect({ env, fetch });
  assert.deepEqual(result.groups, ['runtime', 'modules', 'chompi']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.github.com/repos/jimmie-potts/agent-device-hub/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.authorization, 'Bearer token-value');
  assert.deepEqual(readOutputs(env.GITHUB_OUTPUT), { mode: 'selected', groups: '["runtime","modules","chompi"]', owners:'[]',head:'b'.repeat(40),'runtime-unit': 'true', 'runtime-scenarios': 'true', firmware: 'true', 'app-verify': 'true', 'runtime-verify-captures': 'true', 'runtime-verify': 'true' });
  const summary = fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /Selected: runtime, modules, chompi/);
  assert.match(summary, /Omitted \(no changed path selects them\): shared/);
  assert.match(summary, /modules\/pixoo\/src\/removed\.ts/);
  assert.match(summary, /modules\/pixoo\/src\/old\.ts/);
  assert.doesNotMatch(summary, /token-value/);
});

test('select falls back to full coverage when the comparison is unreadable, truncated or not a PR', async t => {
  for (const [label, fetch, reason] of [
    ['HTTP error', async () => ({ ok: false, status: 502, json: async () => ({}) }), /HTTP 502/],
    ['network error', async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }, /could not be read/],
    ['no file list', async () => ({ ok: true, status: 200, json: async () => ({}) }), /no file list/],
    ['300 files', async () => ({ ok: true, status: 200, json: async () => ({ files: Array.from({ length: 300 }, (_, n) => ({ filename: `modules/pixoo/src/f${n}.ts` })) }) }), /300/],
  ]) {
    const { env } = actions(t, 'pull_request', PULL);
    const result = await runSelect({ env, fetch });
    assert.equal(result.mode, 'full', label);
    assert.match(result.full[0].reason, reason, label);
    assert.equal(readOutputs(env.GITHUB_OUTPUT).mode, 'full', label);
  }
  const { env } = actions(t, 'push', { after: 'c'.repeat(40) });
  const result = await runSelect({ env, fetch: async () => assert.fail('a push reads no comparison') });
  assert.equal(result.mode, 'full');
  assert.deepEqual(JSON.parse(readOutputs(env.GITHUB_OUTPUT).groups), GROUPS);
  const missing = actions(t, 'pull_request', { pull_request: { number: 7 } });
  assert.equal((await runSelect({ env: missing.env, fetch: async () => assert.fail('no SHAs, no read') })).mode, 'full');
});

test('the gate entry point reads the needs context, writes a summary and returns the verdict', async t => {
  const { env } = actions(t, 'pull_request', PULL);
  const good = await runGate({ env: { ...env, NEEDS: JSON.stringify(needs(pr(['apps/runtime/src/x.ts']))) } });
  assert.equal(good.ok, true);
  assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /firmware: skipped \(not selected\)/);
  assert.equal((await runGate({ env: { ...env, NEEDS: 'not json' } })).ok, false);
  assert.equal((await runGate({ env: { ...env, NEEDS: undefined } })).ok, false);
});

test('the select command publishes its selection in a notice that the preflight reads back', t => {
  const { env } = actions(t, 'push', { after: 'c'.repeat(40) });
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/ci-selection/cli.mjs'), 'select'], { env: { ...env, PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split('\n').find(text => text.startsWith('::notice '));
  assert.equal(line, `::notice title=${NOTICE_TITLE}::${noticeMessage({ mode: 'full', groups: GROUPS })}`);
  assert.deepEqual(readNotice(line.slice(line.indexOf('::', 2) + 2)), { mode: 'full', groups: [...GROUPS] });
  const narrow = pr(['apps/chompi-bridge/src/bridge.ts']);
  assert.deepEqual(readNotice(noticeMessage(narrow)), { mode: 'selected', groups: ['chompi'] });
  for (const message of ['', 'not json', '{"mode":"partial","groups":[]}', '{"mode":"selected","groups":["bogus"]}', '{"mode":"selected"}']) {
    assert.equal(readNotice(message), null, message);
  }
});

// ---- Local selection ----

test('local selection lists the same commands CI runs for the selection', () => {
  const narrow = selectedCommands(checks, pr(['apps/runtime/src/main.ts']));
  const core = narrow.find(job => job.id === 'core');
  assert.ok(core.commands.includes('npm run build'));
  assert.ok(core.commands.includes('npm run lint:js'));
  assert.ok(core.commands.includes('npm run test:runtime-dashboard:built'));
  assert.equal(core.commands.includes('npm run test:chompi-bridge:built'), false);
  assert.deepEqual(narrow.filter(job => !job.selected).map(job => job.id).sort(), ['firmware']);
  const full = selectedCommands(checks, pr(['package.json']));
  assert.ok(full.every(job => job.selected));
  const all = full.flatMap(job => job.commands);
  for (const step of Object.values(checks.jobs).flatMap(job => job.steps).filter(step => step.run && !/ci-selection/.test(step.run))) {
    if(stepOwner(step.if))continue;
    assert.ok(all.includes(step.run), `${step.run} is listed for a full selection`);
  }
});

test('local paths include both sides of renames, uncommitted and untracked files', () => {
  const calls = [];
  const git = args => {
    calls.push(args.join(' '));
    if (args[0] === 'diff' && args.includes('--cached')) return 'apps/runtime/src/staged.ts\0';
    if (args[0] === 'diff' && args.includes('HEAD')) return 'apps/runtime/src/edited.ts\0';
    if (args[0] === 'diff') return 'apps/runtime/src/old.ts\0apps/chompi-bridge/src/new.ts\0';
    if (args[0] === 'ls-files') return 'modules/pixoo/src/untracked.ts\0';
    return '';
  };
  assert.deepEqual(localPaths({ base: 'origin/main', git }).sort(), [
    'apps/chompi-bridge/src/new.ts', 'apps/runtime/src/edited.ts', 'apps/runtime/src/old.ts', 'apps/runtime/src/staged.ts', 'modules/pixoo/src/untracked.ts',
  ]);
  assert.ok(calls.every(call => !call.startsWith('diff') || (call.includes('--no-renames') && call.includes('-z'))), calls.join('\n'));
  assert.ok(calls.some(call => call.startsWith('diff') && call.includes('origin/main...HEAD')), calls.join('\n'));
  assert.ok(calls.every(call => call.includes('-z')), calls.join('\n'));
});

test('local Git paths preserve whitespace identities before choosing focused commands', () => {
  for (const unknown of [
    'apps/runtime/dashboard/src/music.css ',
    '\tapps/runtime/dashboard/src/music.css',
    'apps/runtime/dashboard/src/music.css\nnotes.css',
  ]) {
    const git = args => args[0] === 'diff' && args.includes('base...HEAD')
      ? unknown + (args.includes('-z') ? '\0' : '\n') : '';
    const paths = localPaths({ base: 'base', git });
    assert.deepEqual(paths, [unknown], 'Git filenames must retain their exact identity');
    const selection = pr(paths);
    assert.notEqual(selection.mode, 'focused', unknown);
    assert.equal(selection.jobs['app-verify'], true, unknown);
    assert.equal(selection.jobs['runtime-verify-captures'], true, unknown);
    assert.equal(selection.jobs['runtime-verify'], true, unknown);
  }
  assert.equal(pr(['apps/runtime/dashboard/src/music.css']).mode, 'focused');
});

test('local Git paths reject incomplete NUL-delimited output', () => {
  assert.throws(() => localPaths({ git: () => 'apps/runtime/dashboard/src/music.css' }), /incomplete NUL-delimited/);
});

// ---- The workflow uses the mapping consistently ----

// The group of every conditional Checks step, pinned so that moving a suite to another group fails here (Hub #1080).
// A step belongs to the group whose changed paths can break it; `shared` runs only with full coverage.
const STEP_GROUPS = {
  core: {
    'node --test scripts/release/tests/*.test.mjs': 'shared',
    'actions/setup-python': 'shared',
    'python -m pip install -r requirements-contracts.txt -r packages/observability/requirements-host.txt': 'shared',
    'npm run test:observability:built': 'shared', 'npm run test:observability:pilot': 'shared', 'npm run test:observability:python': 'shared',
    'npm run test:observability:query': 'shared', 'npm run test:observability:package:built': 'shared', 'npm run test:contracts:built': 'shared',
    'npm run test:events:built': 'shared', 'npm run test:music-producer:built': 'shared', 'npm run test:music-producer:native': 'shared', 'npm run test:events:python': 'shared', 'npm run test:sdk:built': 'shared',
    'node --test scripts/tests/runtime-container.test.mjs scripts/tests/bunny.test.mjs scripts/tests/bunny-backup.test.mjs scripts/tests/bunny-operations.test.mjs scripts/tests/bunny-deployment.test.mjs scripts/tests/mac-host.test.mjs deploy/container/tests/context.test.mjs deploy/container/tests/entrypoint.test.mjs deploy/container/tests/runtime.test.mjs deploy/container/tests/provision-local.test.mjs deploy/container/tests/production-acceptance.test.mjs apps/runtime/tests/mac-codex-hook.test.mjs': 'runtime',
    'npm run test:lifecycle:built': 'shared', 'npm run test:lifecycle:python': 'shared', 'npm run test:lifecycle:package:built': 'shared',
    'npm run test:agent-state:built': 'shared', 'npm run test:agent-state:python': 'shared', 'npm run test:agent-state:package:built': 'shared',
    'npm run test:wispr:built': 'shared', 'npm run test:wispr:package:built': 'shared',
    // #1714: the CHOMPI bridge's core steps are off in hosted CI until #1715 restores them.
    'npm run test:mcp:built': 'shared', 'npm run test:mcp:protocol:built': 'shared', 'npm run test:mcp:package:built': 'shared',
    'npm run test:pixoo:built': 'modules', 'npm run test:nanoleaf:built': 'modules', 'npm run test:playback:built': 'modules',
    'npm run test:lifx-module:built': 'modules', 'npm run test:tidbyt-module:built': 'modules', 'npm run test:codex-desktop:built': 'modules',
    'npm run test:wispr-module:built': 'modules', 'npm run test:companions:built': 'modules', 'npm run test:roborock-transport:built': 'modules',
    // The Roborock consumer tests import the built runtime registry.
    'npm run test:roborock-transport:consumer:built': 'runtime', 'npm run test:roborock:built': 'modules',
    'npm run test:roborock:consumer:built': 'runtime', 'npm run test:volcano:consumer:built': 'runtime', 'npm run test:volcano:built': 'modules', 'npm run test:wemo:built': 'modules', 'npm run test:art:built': 'modules', 'npm run test:weather:built': 'modules', 'npm run test:reachy:built': 'modules', 'npm run test:microduck:built': 'modules',
    'npm run test:dashboard': 'shared', 'npm run test:runtime-dashboard:built': 'runtime',
  },
  'app-verify': {
    'npm run test:app-verify:built': 'shared', 'npm run test:app-verify:package:built': 'shared', 'npm run test:verify-host': 'shared',
    // #1714: the CHOMPI bridge's App verification steps are off in hosted CI until #1715 restores them.
    'npm run test:dashboard:smoke': 'shared',
    // The runtime dashboard's browser checks, including its module pages, live under apps/runtime.
    'npm run test:runtime-dashboard:smoke': 'runtime', 'node apps/runtime/dashboard/tests/timeline-card.browser.ts': 'runtime', 'node apps/runtime/dashboard/tests/playback-artwork.browser.ts': 'runtime', 'node apps/runtime/dashboard/tests/room-models.browser.ts': 'runtime', 'node apps/runtime/dashboard/tests/music-card.browser.ts': 'runtime', 'node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts': 'runtime', 'node apps/runtime/dashboard/tests/tv.browser.ts': 'runtime',
    'npm run test:roborock:browser': 'runtime', 'npm run test:volcano:browser': 'runtime', 'npm run test:companions:browser': 'runtime', 'npm run test:wemo:browser': 'runtime', 'npm run test:reachy:browser': 'runtime', 'npm run test:microduck:browser': 'runtime', 'npm run test:art:browser': 'runtime', 'npm run test:art-theme:browser': 'runtime', 'npm run test:observability:browser': 'shared',
  },
};

test('every conditional Checks step keeps its pinned group', () => {
  for (const [id, expected] of Object.entries(STEP_GROUPS)) {
    const actual = Object.fromEntries(checks.jobs[id].steps.filter(step => step.if !== undefined && !stepOwner(step.if))
      .map(step => [step.run ?? step.uses.split('@')[0], stepGroup(step.if)]));
    assert.deepEqual(actual, expected, `${id}: a suite moved group, or a conditional step was added or removed`);
  }
});

test('a narrow change runs the suites its paths can break', () => {
  const runs = files => selectedCommands(checks, pr(files)).flatMap(job => job.commands);
  const expectations = [
    [['apps/runtime/src/main.ts'], ['npm run test:runtime:built', 'npm run test:runtime:scenarios:built', 'npm run test:runtime-dashboard:built',
      'npm run test:runtime:verify:captures:built', 'npm run test:runtime:verify:rest:built', 'npm run test:runtime-dashboard:smoke', 'npm run test:roborock:browser', 'npm run test:volcano:browser',
      'npm run test:roborock:consumer:built', 'npm run test:roborock-transport:consumer:built'],
    ['npm run test:pixoo:built', 'npm run test:chompi-bridge:built', 'npm run test:sdk:built', 'npm run test:firmware']],
    [['modules/pixoo/src/module.ts'], ['npm run test:pixoo:built', 'npm run test:nanoleaf:built', 'npm run test:runtime:built',
      'npm run test:runtime:verify:captures:built', 'npm run test:runtime:verify:rest:built'], ['npm run test:chompi-bridge:built', 'npm run test:events:built']],
    [['modules/roborock/transport/src/transport/codec.ts'], ['npm run test:roborock-transport:built', 'npm run test:roborock-transport:consumer:built',
      'npm run test:roborock:browser', 'npm run test:volcano:browser'], ['npm run test:firmware']],
    // #1714: a CHOMPI change runs the Firmware job but none of the bridge's own steps until #1715 restores them.
    [['apps/chompi-bridge/src/bridge.ts'], ['npm run test:firmware', 'npm run test:firmware:arm'],
    ['npm run test:chompi-bridge:built', 'npm run test:chompi-bridge:scenarios', 'npm run test:chompi-bridge:verify:built', 'npm run test:chompi-bridge:browser',
      'npm run test:runtime:built', 'npm run test:runtime:verify:captures:built', 'npm run test:runtime:verify:rest:built', 'npm run test:app-verify:built']],
  ];
  for (const [files, included, excluded] of expectations) {
    const commands = runs(files);
    for (const command of ['npm run build', 'npm run typecheck', 'npm run lint:js', ...included]) assert.ok(commands.includes(command), `${files}: runs ${command}`);
    for (const command of excluded) assert.equal(commands.includes(command), false, `${files}: omits ${command}`);
  }
});

test('Checks selects jobs and steps only through the selection outputs, and the gate covers every job', () => {
  assert.deepEqual(Object.keys(checks.jobs), ['select', 'core', 'runtime-unit', 'runtime-scenarios', 'firmware', 'app-verify', 'runtime-verify-captures', 'runtime-verify', 'gate']);
  const select = checks.jobs.select;
  assert.equal(select.name, 'Select affected checks');
  assert.equal(select.needs, undefined);
  assert.deepEqual(select.outputs, Object.fromEntries(['mode', 'groups', 'owners', 'head', ...Object.keys(JOBS)].map(name => [name, `\${{ steps.select.outputs.${name} }}`])));
  assert.deepEqual(select.steps.at(-1), { id: 'select', env: { GITHUB_TOKEN: '${{ github.token }}', BUNNY_RELEASE_QUALIFICATION: '${{ inputs.qualification }}' }, run: 'node scripts/ci-selection/cli.mjs select' });
  const gate = checks.jobs.gate;
  assert.equal(gate.name, 'Selected checks gate');
  assert.equal(gate.if, "always() && (github.event_name != 'pull_request' || !github.event.pull_request.draft)");
  assert.deepEqual(gate.needs, Object.keys(checks.jobs).filter(id => id !== 'gate'));
  assert.deepEqual(gate.steps.at(-1), { env: { NEEDS: '${{ toJSON(needs) }}' }, run: 'node scripts/ci-selection/cli.mjs gate' });
  for (const id of ['select', 'gate']) {
    assert.deepEqual(checks.jobs[id].steps[0].with, { 'sparse-checkout': 'scripts/ci-selection' }, `${id} checks out only the selector`);
    assert.equal(checks.jobs[id]['timeout-minutes'], 5);
  }
  assert.deepEqual(checks.jobs.core.needs, 'select');
  assert.equal(checks.jobs.core.if, undefined, 'build, typecheck and lint run for every change');

  const used = new Set();
  for (const [id, groups] of Object.entries(JOBS)) {
    const job = checks.jobs[id];
    assert.equal(job.needs, 'select');
    assert.equal(job.if, jobCondition(id));
    // A job skipped before its matrix expands reports the unexpanded name, so conditional jobs name their runner.
    assert.equal(job.strategy, undefined, `${id} has no matrix`);
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.match(job.name, / on ubuntu-latest$/);
    const stepGroups = new Set(job.steps.map(step => stepGroup(step.if)).filter(Boolean));
    groups.forEach(group => used.add(group));
    if (stepGroups.size) assert.deepEqual([...stepGroups].sort(), [...groups].sort(), `${id} runs when any of its steps' groups is selected`);
  }
  for (const [id, job] of Object.entries(checks.jobs)) {
    for (const step of job.steps) {
      if (step.if === undefined) continue;
      if (id === 'core' || id === 'app-verify') {
        if(stepOwner(step.if)){assert.equal(id,'core');assert.equal(stepOwner(step.if),'microduck-browser');continue;}
        assert.match(step.if, STEP_CONDITION, `${id}: ${step.if}`);
        used.add(stepGroup(step.if));
      } else {
        assert.fail(`${id}: only core and App verification steps are conditional`);
      }
    }
  }
  assert.deepEqual([...used].sort(), [...GROUPS].sort(), 'every group selects some work');
  // Every test suite and the Python setup are selected; setup, build, typecheck and lint always run.
  for (const step of checks.jobs.core.steps) {
    const always = step.uses?.startsWith('actions/checkout') || step.uses?.startsWith('actions/setup-node')
      || ['npm ci', 'npm run build', 'npm run typecheck', 'npm run lint:js', 'npm run test:workspace-audit', 'npm run test:tracker-audit', 'node scripts/ci-selection/run-standalone.mjs'].includes(step.run);
    assert.equal(step.if === undefined, Boolean(always), JSON.stringify(step));
  }
});
