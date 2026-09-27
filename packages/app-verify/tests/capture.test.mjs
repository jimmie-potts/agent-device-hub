// Capture, frozen proof and handoff against a real run and the consumer's Chromium.
// The negative controls matter most: a known-incorrect result must fail.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateReceipt} from '@jimmie-potts/app-verify';
import {sandbox, supervisorSkipReason, until} from './helpers.mjs';

const skip = supervisorSkipReason();
const magic = async (path, bytes) => (await readFile(path)).subarray(0, bytes.length).equals(Buffer.from(bytes));
const PNG = [0x89, 0x50, 0x4e, 0x47], WEBM = [0x1a, 0x45, 0xdf, 0xa3];

test('a stateful step passes with screenshot, video and assertion log; known-wrong results fail', {skip}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--lease', '10']);
    assert.equal(started.code, 0, started.stderr);
    const {runId} = started.result;

    // Reference behavior passes.
    const passed = await box.cli(['capture', runId, 'count-twice']);
    assert.equal(passed.code, 0, passed.stderr);
    assert.equal(passed.result.outcome, 'passed');
    assert.equal(passed.result.set, 'verified');
    assert.ok(await magic(passed.result.screenshot, PNG), 'an openable PNG');
    assert.ok(await magic(passed.result.video, WEBM), 'a finalized WebM');
    assert.ok((await stat(passed.result.video)).size > 1000);
    const log = JSON.parse(await readFile(passed.result.log, 'utf8'));
    assert.deepEqual(log.assertions.map(a => [a.name, a.outcome]), [['the counter advanced by 2', 'passed']]);
    assert.equal(log.scenario, 'reference');
    assert.equal(log.candidate.sourceRevision, box.git('rev-parse', 'HEAD'));
    assert.equal(existsSync(join(passed.result.captureDir, '.in-progress')), false);

    // An injected wrong expectation fails, keeps its screenshot and exits non-zero.
    const wrong = await box.cli(['capture', runId, 'wrong-expectation']);
    assert.equal(wrong.code, 1);
    assert.equal(wrong.result.outcome, 'failed');
    assert.match(wrong.result.reason, /^assertion failed: the counter advanced by 3: expected Count: 5, saw Count: 4/);
    assert.ok(await magic(wrong.result.screenshot, PNG), 'the failure keeps its screenshot');

    // Screenshots and video alone never pass.
    const silent = await box.cli(['capture', runId, 'no-assertions']);
    assert.equal(silent.code, 1);
    assert.equal(silent.result.reason, 'no assertions recorded: a screenshot alone never passes');
    assert.ok(silent.result.video, 'the video exists and still does not make a pass');

    // The known-incorrect application fails the same step that the reference passes.
    assert.equal((await box.cli(['scenario', runId, 'broken'])).code, 0);
    const broken = await box.cli(['capture', runId, 'count-twice']);
    assert.equal(broken.code, 1);
    assert.equal(broken.result.outcome, 'failed');
    assert.match(broken.result.reason, /the counter advanced by 2: expected Count: 2, saw Count: 4/);

    // Read-only browsing sends no command; one click sends exactly one.
    assert.equal((await box.cli(['scenario', runId, 'reference'])).code, 0);
    const readOnly = await box.cli(['capture', runId, 'read-only']);
    assert.equal(readOnly.code, 0, readOnly.stderr);
    const once = await box.cli(['capture', runId, 'command-once']);
    assert.equal(once.code, 0, once.stderr);

    const receipt = await box.receipt(runId);
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    assert.deepEqual(receipt.captures.map(c => [c.n, c.step, c.outcome]), [[1, 'count-twice', 'passed'], [2, 'wrong-expectation', 'failed'], [3, 'no-assertions', 'failed'], [4, 'count-twice', 'failed'], [5, 'read-only', 'passed'], [6, 'command-once', 'passed']]);
    assert.ok(receipt.captures.every(c => c.log === `capture-${c.n}/assertions.json`));

    const unknown = await box.cli(['capture', runId, 'nope']);
    assert.equal(unknown.code, 2);
    await box.cli(['stop', runId]);
    const stopped = await box.cli(['capture', runId, 'count-twice']);
    assert.equal(stopped.code, 1);
    assert.equal(stopped.result.error, 'run-not-running');
  } finally {
    await box.close();
  }
});

test('an interrupted capture is failed, never passed', {skip}, async () => {
  const box = await sandbox();
  try {
    const {runId} = (await box.cli(['start', '--lease', '10'])).result;
    const interrupt = async signal => {
      let child;
      const pending = box.cli(['capture', runId, 'slow'], {onSpawn: c => (child = c)});
      // Wait until the step has asserted and is recording, then interrupt before the video is finalized.
      await until(async () => {
        const events = existsSync(join(box.proofRoot, runId, 'events.jsonl')) ? await box.events(runId) : [];
        const started = events.filter(e => e.event === 'capture-started').length;
        const finished = events.filter(e => e.event === 'capture-finished').length;
        return started > finished;
      }, 'capture started');
      await new Promise(resolve => setTimeout(resolve, 3000));
      child.kill(signal);
      return pending;
    };
    const terminated = await interrupt('SIGTERM');
    assert.notEqual(terminated.code, 0);
    assert.equal(terminated.result.outcome, 'failed');
    assert.match(terminated.result.reason, /^interrupted by SIGTERM/);
    assert.equal(terminated.result.video, null, 'no validated video is claimed');

    const killed = await interrupt('SIGKILL');
    assert.equal(killed.signal, 'SIGKILL');
    const receipt = await box.receipt(runId);
    assert.deepEqual(receipt.captures.map(c => [c.outcome, c.reason.split(':')[0]]), [['failed', 'interrupted by SIGTERM before the capture completed'], ['failed', 'interrupted']], 'the write-ahead record keeps a killed capture failed');
    assert.equal(receipt.captures[1].video, null);
    assert.equal(receipt.captures[1].finishedAt, null);
    // The run itself continues.
    assert.equal((await box.cli(['doctor', runId])).result.runs[0].state, 'running');
    await box.cli(['stop', runId]);
  } finally {
    await box.close();
  }
});

test('missing Playwright, Chromium or ffmpeg is unavailable, and an unfinalized video is failed', {skip}, async () => {
  const box = await sandbox({playwright: ['app-verify-no-such-playwright']});
  const empty = await mkdtemp(join(tmpdir(), 'app-verify-browsers-'));
  try {
    const {runId} = (await box.cli(['start', '--lease', '10'])).result;
    const noModule = await box.cli(['capture', runId, 'count-twice']);
    assert.equal(noModule.code, 3);
    assert.equal(noModule.result.outcome, 'unavailable');
    assert.match(noModule.result.reason, /Playwright is not installed/);

    // The real Playwright with an empty browser cache: Chromium is missing.
    const real = await box.wrapper(box.repo, 'verify-real.mjs');
    await writeFile(real, (await readFile(real, 'utf8')).replace(',"playwright":["app-verify-no-such-playwright"]', ''));
    const noChromium = await box.cli(['capture', runId, 'count-twice'], {entry: real, extraEnv: {PLAYWRIGHT_BROWSERS_PATH: empty}});
    assert.equal(noChromium.code, 3, noChromium.stdout + noChromium.stderr);
    assert.match(noChromium.result.reason, /Chromium build .* is not installed/);

    // Chromium present, ffmpeg absent: video recording is unavailable.
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright');
    const browsers = join(empty, 'no-ffmpeg');
    await mkdir(browsers);
    for (const name of await readdir(cache)) if (!name.startsWith('ffmpeg') && !name.startsWith('.')) await symlink(join(cache, name), join(browsers, name));
    const noFfmpeg = await box.cli(['capture', runId, 'count-twice'], {entry: real, extraEnv: {PLAYWRIGHT_BROWSERS_PATH: browsers}});
    assert.equal(noFfmpeg.code, 3, noFfmpeg.stdout + noFfmpeg.stderr);
    assert.match(noFfmpeg.result.reason, /ffmpeg/);

    // An ffmpeg that writes nothing: every assertion passes, but the video is never finalized.
    const stubbed = join(empty, 'stub-ffmpeg');
    await mkdir(stubbed);
    for (const name of await readdir(cache)) {
      if (name.startsWith('.')) continue;
      if (!name.startsWith('ffmpeg')) await symlink(join(cache, name), join(stubbed, name));
      else {
        await mkdir(join(stubbed, name));
        for (const file of await readdir(join(cache, name))) {
          await writeFile(join(stubbed, name, file), '#!/bin/sh\ncat > /dev/null\nexit 0\n');
          await chmod(join(stubbed, name, file), 0o755);
        }
      }
    }
    const unfinished = await box.cli(['capture', runId, 'count-twice'], {entry: real, extraEnv: {PLAYWRIGHT_BROWSERS_PATH: stubbed}});
    assert.equal(unfinished.code, 1, unfinished.stdout + unfinished.stderr);
    assert.equal(unfinished.result.outcome, 'failed');
    assert.equal(unfinished.result.reason, 'the video was not finalized');
    assert.equal(unfinished.result.video, null);
    const unfinishedLog = JSON.parse(await readFile(unfinished.result.log, 'utf8'));
    assert.deepEqual(unfinishedLog.assertions.map(a => a.outcome), ['passed'], 'the assertions passed and the capture still failed');

    const receipt = await box.receipt(runId);
    assert.deepEqual(receipt.captures.map(c => c.outcome), ['unavailable', 'unavailable', 'unavailable', 'failed']);
    // Everything else still works without browser tooling.
    assert.equal((await box.cli(['extend', runId, '--lease', '10'])).code, 0);
    assert.equal((await box.cli(['handoff', runId])).code, 0);
    assert.equal((await box.cli(['stop', runId])).code, 0);
  } finally {
    await box.close();
    await chmod(empty, 0o700);
    spawnSync('rm', ['-rf', empty]);
  }
});

test('handoff freezes the verified set; reset, extend and later captures never change it', {skip}, async () => {
  const box = await sandbox();
  try {
    const {runId, url} = (await box.cli(['start', '--lease', '10'])).result;
    assert.equal((await box.cli(['capture', runId, 'count-twice'])).code, 0);
    assert.equal((await box.cli(['capture', runId, 'wrong-expectation'])).code, 1);
    const handoff = await box.cli(['handoff', runId, '--reset', 'second']);
    assert.equal(handoff.code, 0, handoff.stderr);
    const proof = join(box.proofRoot, runId), verified = join(proof, 'verified');
    assert.equal(handoff.result.verified, verified);
    assert.deepEqual(handoff.result.card, [
      `Preview   ${url}   run ${runId}`,
      `Candidate ${box.git('rev-parse', 'HEAD').slice(0, 8)} (clean)   scenario second`,
      handoff.result.card[2],
      `Extend    node verify.mjs extend ${runId}`,
      `Stop      node verify.mjs stop ${runId}`,
    ]);
    assert.match(handoff.result.card[2], /^Expires   \d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ \(in \d+ min\)$/);
    assert.match(handoff.stderr, /Preview {3}http:\/\/127\.0\.0\.1:/, 'the card is printed for the human');
    assert.match(await (await fetch(url)).text(), /Count: 10/, 'the human starts from the reset scenario');

    // The frozen set: moved captures, the receipt of that moment and checksums, read-only.
    assert.deepEqual((await readdir(verified)).sort(), ['SHA256SUMS', 'capture-1', 'capture-2', 'receipt.json']);
    assert.equal(existsSync(join(proof, 'capture-1')), false);
    const manifest = await readFile(join(verified, 'SHA256SUMS'), 'utf8');
    assert.match(manifest, /^[0-9a-f]{64} {2}capture-1\/after\.png$/m);
    assert.match(manifest, /^[0-9a-f]{64} {2}capture-1\/interaction\.webm$/m);
    assert.match(manifest, /^[0-9a-f]{64} {2}receipt\.json$/m);
    const check = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], {cwd: verified, encoding: 'utf8'});
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.equal((await stat(verified)).mode & 0o222, 0, 'verified/ is read-only');
    assert.equal((await stat(join(verified, 'capture-1/after.png'))).mode & 0o222, 0);
    const copy = JSON.parse(await readFile(join(verified, 'receipt.json'), 'utf8'));
    assert.deepEqual(validateReceipt(copy), {ok: true});
    assert.equal(copy.captures[0].screenshot, 'verified/capture-1/after.png');
    assert.equal(copy.proof.frozenAt, handoff.result.frozenAt);

    // Later operations change the live receipt, never the frozen set.
    assert.equal((await box.cli(['extend', runId, '--lease', '20'])).code, 0);
    const later = await box.cli(['capture', runId, 'read-only']);
    assert.equal(later.code, 0, later.stderr);
    assert.equal(later.result.set, 'after-handoff');
    assert.ok(later.result.screenshot.startsWith(join(proof, 'after-handoff/capture-3/')));
    const live = await box.receipt(runId);
    assert.deepEqual(live.captures.map(c => [c.n, c.set, c.log]), [[1, 'verified', 'verified/capture-1/assertions.json'], [2, 'verified', 'verified/capture-2/assertions.json'], [3, 'after-handoff', 'after-handoff/capture-3/assertions.json']]);
    assert.equal(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], {cwd: verified}).status, 0, 'the sums still match after reset, extend and a later capture');
    assert.equal((await box.cli(['doctor', runId])).result.runs[0].proof.sums, 'ok');

    // A second handoff only prints the card; it refuses to reset over frozen proof.
    const again = await box.cli(['handoff', runId]);
    assert.equal(again.code, 0);
    assert.equal(again.result.frozenAt, handoff.result.frozenAt);
    const resetAgain = await box.cli(['handoff', runId, '--reset', 'reference']);
    assert.equal(resetAgain.code, 1);
    assert.equal(resetAgain.result.error, 'already-frozen');
    assert.equal(await readFile(join(verified, 'SHA256SUMS'), 'utf8'), manifest);

    // Tampering shows in doctor.
    await chmod(join(verified, 'capture-1'), 0o755);
    await chmod(join(verified, 'capture-1/assertions.json'), 0o644);
    await writeFile(join(verified, 'capture-1/assertions.json'), '{}');
    assert.equal((await box.cli(['doctor', runId])).result.runs[0].proof.sums, 'tampered');

    // Stop keeps the proof.
    assert.equal((await box.cli(['stop', runId])).code, 0);
    assert.ok(existsSync(join(verified, 'SHA256SUMS')));
  } finally {
    await box.close();
  }
});

test('a reset that fails stops the run instead of serving half-seeded state, and keeps the frozen set', {skip}, async () => {
  const box = await sandbox();
  try {
    const {runId, port} = (await box.cli(['start', '--lease', '10'])).result;
    assert.equal((await box.cli(['capture', runId, 'count-twice'])).code, 0);
    const failed = await box.cli(['handoff', runId, '--reset', 'seed-fails']);
    assert.equal(failed.code, 1);
    assert.equal(failed.result.state, 'stopped');
    assert.equal(failed.result.cause, 'reset-failed');
    assert.match(failed.result.detail, /^seed-failed: fixture seed refused/);
    assert.equal(failed.result.cleanup.result, 'clean');
    const receipt = await box.receipt(runId);
    assert.equal(receipt.state, 'stopped');
    assert.equal(receipt.failure.cause, 'reset-failed');
    assert.ok(receipt.proof.frozenAt);
    assert.equal(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], {cwd: join(box.proofRoot, runId, 'verified')}).status, 0);
    assert.equal(existsSync(join(box.stateRoot, runId)), false);
    assert.ok((await box.events(runId)).some(e => e.event === 'reset-failed'));
    const refusedPort = await fetch(`http://127.0.0.1:${port}/`).then(() => false, () => true);
    assert.ok(refusedPort);
  } finally {
    await box.close();
  }
});
