// Run inputs (1.1): declared by the plug-in, given with `--input name=value`,
// recorded in the receipt and events, and reused by every relaunch. The usage
// refusals and runCaptureStep need no user manager and run in CI.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runCaptureStep, validateReceipt, VERSION} from '@jimmie-potts/app-verify';
import {createPlugin} from './fixture-app/plugin.mjs';
import {assertRefusal, sandbox, supervisorSkipReason, units} from './helpers.mjs';

const skip = supervisorSkipReason();
const server = fileURLToPath(new URL('fixture-app/server.mjs', import.meta.url));
const INPUTS = {
  label: {description: 'A label the fixture keeps', required: true},
  feed: {description: 'Loopback URL of a peer feed'},
};

test('help reports the declared inputs and the core version', async () => {
  const box = await sandbox({options: {inputs: INPUTS}});
  try {
    const help = await box.cli(['help']);
    assert.equal(help.code, 0);
    assert.equal(help.result.coreVersion, VERSION);
    assert.equal(VERSION, '1.3.0');
    assert.deepEqual(help.result.inputs, {label: {description: 'A label the fixture keeps', required: true}, feed: {description: 'Loopback URL of a peer feed', required: false}});
    assert.ok(help.result.operations.includes('start [--scenario <name>] [--lease <minutes>] [--input <name>=<value>]...'));
    assert.ok(help.result.operations.includes('scenario <run-id> <name> [--input <name>=<value>]...'));
    const plain = await box.cli(['help'], {entry: await box.wrapper(box.repo, 'verify-plain.mjs', {})});
    assert.deepEqual(plain.result.inputs, {}, 'a plug-in without inputs declares none');
    assert.ok(plain.result.operations.includes('start [--scenario <name>] [--lease <minutes>]'), 'a plug-in without inputs keeps the 1.0 operation strings');
    assert.ok(plain.result.operations.includes('scenario <run-id> <name>'));
    assert.equal(plain.result.operations.some(o => o.includes('--input')), false);
    assert.equal(plain.result.coreVersion, VERSION);
  } finally {
    await box.close();
  }
});

// No skip: every refusal happens before the supervisor is consulted, so it holds on a CI runner without systemd too.
test('bad inputs are usage errors that create nothing', async () => {
  const box = await sandbox({options: {inputs: INPUTS}});
  try {
    const refusals = [
      [['start', '--input', 'label=a', '--input', 'nope=1'], /nope is not an input of this plug-in/],
      [['start', '--input', 'label=a', '--input', 'apiToken=abc'], /apiToken looks like a secret/],
      [['start', '--input', 'label=a', '--input', 'SESSION_KEY=abc'], /SESSION_KEY looks like a secret/],
      [['start'], /input label is required/],
      [['start', '--input', 'feed=http://127.0.0.1:1/'], /input label is required/],
      [['start', '--input', 'label='], /label takes 1 to 512 printable ASCII characters/],
      [['start', '--input', 'label=' + 'x'.repeat(513)], /label takes 1 to 512 printable ASCII characters/],
      [['start', '--input', 'label=café'], /label takes 1 to 512 printable ASCII characters/],
      [['start', '--input', 'label=a\tb'], /label takes 1 to 512 printable ASCII characters/],
      [['start', '--input', 'label=a‮b'], /label takes 1 to 512 printable ASCII characters/],
      [['start', '--input', 'label'], /--input takes <name>=<value>/],
      [['start', '--input', 'label=a', '--input', 'label=b'], /label is given twice/],
      [['start', '--input', 'label=a', '--input', '__proto__=x'], /__proto__ is not an input of this plug-in/],
      [['start', '--input', 'label=a', '--input', 'constructor=x'], /constructor is not an input of this plug-in/],
      [['scenario', `${box.app}-20260927T060259Z-3f9a1c`, 'reference', '--input', 'nope=1'], /nope is not an input of this plug-in/],
      [['scenario', `${box.app}-20260927T060259Z-3f9a1c`, 'reference', '--input', 'label=café'], /label takes 1 to 512/],
      [['extend', `${box.app}-20260927T060259Z-3f9a1c`, '--input', 'label=a'], /extend does not take --input/],
    ];
    for (const [args, pattern] of refusals) {
      const refused = await box.cli(args);
      assert.equal(refused.code, 2, `${args.join(' ')}: ${refused.stdout}`);
      assertRefusal(refused.result, 'usage');
      assert.match(refused.result.detail, pattern, args.join(' '));
    }
    // A 1.0-style plug-in declares no inputs, so any input is refused.
    const plain = await box.cli(['start', '--input', 'label=a'], {entry: await box.wrapper(box.repo, 'verify-plain.mjs', {})});
    assert.equal(plain.code, 2);
    assertRefusal(plain.result, 'usage');
    assert.match(plain.result.detail, /label is not an input of this plug-in/);
    assert.equal(existsSync(box.proofRoot), false, 'no proof directory was created');
    assert.equal(existsSync(box.stateRoot), false, 'no runtime directory was created');
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});

test('a scenario that requires an input refuses to start without it, before the supervisor is consulted', async () => {
  const box = await sandbox({options: {inputs: INPUTS}});
  try {
    const refused = await box.cli(['start', '--scenario', 'paired', '--input', 'label=a']);
    assert.equal(refused.code, 2, refused.stdout);
    assertRefusal(refused.result, 'usage');
    assert.equal(refused.result.detail, 'scenario paired requires input feed; give it with --input feed=<value>');
    const help = await box.cli(['help']);
    assert.deepEqual(help.result.scenarioInputs, {paired: ['feed']});
    assert.deepEqual((await box.cli(['help'], {entry: await box.wrapper(box.repo, 'verify-plain.mjs', {})})).result.scenarioInputs, {});
    assert.equal(existsSync(box.proofRoot), false, 'no proof directory was created');
  } finally {
    await box.close();
  }
});

test('a plug-in that declares a secret-like or malformed input is refused before any operation', async () => {
  const box = await sandbox();
  try {
    for (const [inputs, pattern] of [[{apiKey: {description: 'no'}}, /apiKey looks like a secret/], [{'two words': {description: 'no'}}, /input name two words/], [{label: {}}, /input label needs a description/], [{label: {description: 'a label'}}, /scenario paired requires feed, which is not a declared input/]]) {
      const refused = await box.cli(['help'], {entry: await box.wrapper(box.repo, 'verify-bad.mjs', {inputs})});
      assert.equal(refused.code, 1);
      assertRefusal(refused.result, 'internal');
      assert.match(refused.result.detail, pattern);
    }
  } finally {
    await box.close();
  }
});

test('runCaptureStep gives a step the run inputs, and refuses undeclared, secret-like or missing ones', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-inputs-')));
  const plugin = createPlugin({root: base, app: 'avt-inputs', inputs: INPUTS});
  const inputs = {label: 'direct run', feed: 'http://127.0.0.1:9/feed'};
  const data = join(base, 'data');
  await mkdir(data);
  await writeFile(join(data, 'scenario.json'), JSON.stringify({name: 'reference', behavior: 'reference', start: 0, inputs}));
  const child = spawn(process.execPath, [server, '--data', data, '--port', '0', '--inputs', JSON.stringify(inputs)], {stdio: ['ignore', 'pipe', 'inherit']});
  try {
    const url = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', chunk => {
        text += chunk;
        const line = text.split('\n').find(l => l.startsWith('{'));
        if (line) resolve(JSON.parse(line).url);
      });
      child.on('exit', code => reject(new Error(`fixture exited ${code}`)));
    });
    const passed = await runCaptureStep(plugin, 'inputs-shown', {url, outputDir: join(base, 'out-1'), inputs});
    assert.equal(passed.outcome, 'passed', passed.reason);
    const other = await runCaptureStep(plugin, 'inputs-shown', {url, outputDir: join(base, 'out-2'), inputs: {label: 'another run'}});
    assert.equal(other.outcome, 'failed', 'the step compares what it was given with what the app runs with');
    await assert.rejects(runCaptureStep(plugin, 'inputs-shown', {url, outputDir: join(base, 'out-3'), inputs: {...inputs, nope: 'x'}}), /nope is not an input/);
    await assert.rejects(runCaptureStep(plugin, 'inputs-shown', {url, outputDir: join(base, 'out-4'), inputs: {...inputs, secretFeed: 'x'}}), /secretFeed looks like a secret/);
    await assert.rejects(runCaptureStep(plugin, 'inputs-shown', {url, outputDir: join(base, 'out-5')}), /input label is required/);
    await assert.rejects(runCaptureStep(plugin, 'controller-answers', {url, outputDir: join(base, 'out-6'), inputs, endpoints: {controller: 'http://localhost:9/'}}), /endpoint controller/);
  } finally {
    await new Promise(resolve => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
    await rm(base, {recursive: true, force: true});
  }
});

/** The inputs the running application reports, from its seed and its launch argv. */
async function seen(url) {
  return (await fetch(new URL('/inputs', url))).json();
}

test('inputs reach seed, launch, checks and captures, and persist across reseed, fresh steps, handoff --reset and restart', {skip}, async () => {
  const box = await sandbox({options: {inputs: INPUTS}});
  try {
    const given = {label: 'first', feed: 'http://127.0.0.1:41000/api/monitor/v1/sessions'};
    const started = await box.cli(['start', '--lease', '10', '--input', `label=${given.label}`, '--input', `feed=${given.feed}`]);
    assert.equal(started.code, 0, started.stderr);
    const {runId, url} = started.result;
    assert.deepEqual(started.result.inputs, given);
    const receipt = await box.receipt(runId);
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    assert.deepEqual(receipt.inputs, given);
    assert.deepEqual(await seen(url), {seeded: given, launched: given}, 'seed and launch received the inputs');
    assert.deepEqual(receipt.checks.find(c => c.id === 'inputs-seen'), {id: 'inputs-seen', outcome: 'passed'}, 'the boundary check received them');
    const events = await box.events(runId);
    assert.deepEqual(events.find(e => e.event === 'seeded').inputs, given);
    assert.deepEqual(events.find(e => e.event === 'unit-started').inputs, given);
    const captured = await box.cli(['capture', runId, 'inputs-shown']);
    assert.equal(captured.code, 0, captured.stderr);

    // A reseed without --input keeps the recorded inputs.
    const kept = await box.cli(['scenario', runId, 'second']);
    assert.equal(kept.code, 0, kept.stderr);
    assert.deepEqual(kept.result.inputs, given);
    assert.deepEqual(await seen(url), {seeded: given, launched: given});
    // A reseed with --input replaces the named value and keeps the others.
    const changed = {...given, label: 'second'};
    const replaced = await box.cli(['scenario', runId, 'reference', '--input', 'label=second']);
    assert.equal(replaced.code, 0, replaced.stderr);
    assert.deepEqual(replaced.result.inputs, changed);
    assert.deepEqual((await box.receipt(runId)).inputs, changed);
    assert.deepEqual(await seen(url), {seeded: changed, launched: changed});
    assert.deepEqual((await box.events(runId)).filter(e => e.event === 'reseeded').map(e => e.inputs), [given, changed]);
    // A fresh step reseeds with the recorded inputs, and doctor's read-only checks get them too.
    const fresh = await box.cli(['capture', runId, 'fresh-inputs']);
    assert.equal(fresh.code, 0, fresh.stderr);
    const [row] = (await box.cli(['doctor', runId])).result.runs;
    assert.equal(row.state, 'running');
    assert.deepEqual(row.inputs, changed);
    assert.deepEqual(row.checks, [{id: 'seeded-scenario', outcome: 'passed'}, {id: 'inputs-seen', outcome: 'passed'}]);
    // handoff --reset reseeds with them.
    const handoff = await box.cli(['handoff', runId, '--reset', 'second']);
    assert.equal(handoff.code, 0, handoff.stderr);
    assert.deepEqual(await seen(url), {seeded: changed, launched: changed});
    assert.deepEqual(JSON.parse(await readFile(join(box.proofRoot, runId, 'verified/receipt.json'), 'utf8')).inputs, changed, 'the frozen receipt copy names the inputs');

    // A plug-in that no longer declares a recorded input refuses to restart the run, and the run keeps serving.
    const plain = await box.wrapper(box.repo, 'verify-plain.mjs', {});
    const refused = await box.cli(['restart', runId], {entry: plain});
    assert.equal(refused.code, 2);
    assertRefusal(refused.result, 'usage');
    assert.match(refused.result.detail, /label is not an input of this plug-in/);
    // A plug-in that now requires an input the run never recorded names the operations that take --input.
    const stricter = await box.wrapper(box.repo, 'verify-stricter.mjs', {inputs: {...INPUTS, extra: {description: 'Added later', required: true}}});
    const hinted = await box.cli(['restart', runId], {entry: stricter});
    assert.equal(hinted.code, 2);
    assertRefusal(hinted.result, 'usage');
    assert.equal(hinted.result.detail, 'input extra is required and this run has not recorded it; reseed it with scenario <run-id> second --input extra=<value>, or stop it and start a new run with --input extra=<value>');
    assert.equal((await box.receipt(runId)).state, 'running');
    // restart reuses them.
    const restarted = await box.cli(['restart', runId]);
    assert.equal(restarted.code, 0, restarted.stderr);
    assert.deepEqual(restarted.result.inputs, changed);
    assert.deepEqual((await box.receipt(restarted.result.runId)).inputs, changed);
    assert.deepEqual(await seen(restarted.result.url), {seeded: changed, launched: changed});
    assert.equal((await box.cli(['stop', restarted.result.runId])).code, 0);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});

test('a plug-in that declares inputs records an empty map when none is given', {skip}, async () => {
  const box = await sandbox({options: {inputs: {feed: INPUTS.feed}}});
  try {
    const started = await box.cli(['start', '--lease', '5']);
    assert.equal(started.code, 0, started.stderr);
    assert.deepEqual((await box.receipt(started.result.runId)).inputs, {});
    assert.deepEqual(await seen(started.result.url), {seeded: {}, launched: {}});
    assert.equal((await box.cli(['stop', started.result.runId])).code, 0);
  } finally {
    await box.close();
  }
});

test('a scenario-specific input missing on scenario, a fresh step or handoff --reset is a usage error that stops nothing', {skip}, async () => {
  const box = await sandbox({options: {inputs: INPUTS}});
  try {
    const started = await box.cli(['start', '--lease', '10', '--input', 'label=first']);
    assert.equal(started.code, 0, started.stderr);
    const {runId, url} = started.result;
    const before = await box.receipt(runId);
    // Only `scenario` takes --input; the operations that relaunch with the recorded inputs say how to supply one.
    const relaunch = 'scenario paired requires input feed, which this run has not recorded; reseed it with scenario <run-id> paired --input feed=<value>, or stop it and start a new run with --input feed=<value>';
    const refusals = [
      [['scenario', runId, 'paired'], 'scenario paired requires input feed; give it with --input feed=<value>'],
      [['capture', runId, 'fresh-paired'], relaunch],
      [['handoff', runId, '--reset', 'paired'], relaunch],
    ];
    for (const [args, detail] of refusals) {
      const refused = await box.cli(args);
      assert.equal(refused.code, 2, `${args.join(' ')}: ${refused.stdout}`);
      assertRefusal(refused.result, 'usage');
      assert.equal(refused.result.detail, detail);
    }
    assert.deepEqual(await box.receipt(runId), before, 'the receipt is unchanged: nothing was stopped, captured or frozen');
    assert.equal(existsSync(join(box.proofRoot, runId, 'verified')), false);
    assert.deepEqual(await seen(url), {seeded: {label: 'first'}, launched: {label: 'first'}}, 'the run still serves');

    // Given the input, the same reseed works, and the fresh step and restart reuse it.
    const feed = 'http://127.0.0.1:41000/feed';
    const paired = await box.cli(['scenario', runId, 'paired', '--input', `feed=${feed}`]);
    assert.equal(paired.code, 0, paired.stderr);
    assert.deepEqual(paired.result.inputs, {label: 'first', feed});
    assert.equal((await box.cli(['capture', runId, 'fresh-paired'])).code, 0);
    const restarted = await box.cli(['restart', runId]);
    assert.equal(restarted.code, 0, restarted.stderr);
    assert.equal(restarted.result.scenario, 'paired');
    assert.deepEqual(restarted.result.inputs, {label: 'first', feed});
    assert.equal((await box.cli(['stop', restarted.result.runId])).code, 0);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});
