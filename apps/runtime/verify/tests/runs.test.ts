// Hub #920: the runtime adapter through its documented wrapper against real transient user units. Every run uses
// private state and proof roots and run-generated grants; tests stop only the runs they started. Without a user manager
// these tests skip with the reason (#873); steps.test.ts still judges every capture step.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {access, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {validateReceipt} from '@jimmie-potts/app-verify';
import {HEALTH_PATH} from '../../src/index.js';
import {base, listening, ROOT} from './support.js';

const wrapper = join(ROOT, 'scripts/verify-runtime.mjs');

function skipReason(): string | undefined {
  const state = (spawnSync('systemctl', ['--user', 'is-system-running'], {encoding: 'utf8'}).stdout ?? '').trim();
  if (['running', 'degraded', 'starting', 'initializing'].includes(state)) return undefined;
  const reason = `no systemd --user manager (is-system-running: ${state === '' ? 'no answer' : state})`;
  if (process.env.APP_VERIFY_REQUIRE_SYSTEMD === '1') throw new Error(`APP_VERIFY_REQUIRE_SYSTEMD=1 but ${reason}`);
  process.stderr.write(`SKIP runtime verification run tests: ${reason}. apps/runtime/verify/tests/steps.test.ts still judges every step.\n`);
  return reason;
}
const skip = skipReason();

type Result = Record<string, unknown> & {runId?: string; state?: string; url?: string; endpoints?: Record<string, string>};
type Verify = (...args: string[]) => Promise<{code: number | null; result: Result; output: string}>;

/** The wrapper with private roots under a base directory. Every run it started is stopped after the test. */
async function roots(context: TestContext): Promise<{verify: Verify; root: string}> {
  const root = await base(context);
  const env = {...process.env, APP_VERIFY_STATE_ROOT: join(root, 's'), APP_VERIFY_PROOF_ROOT: join(root, 'p'), APP_VERIFY_WINDOWS_CHECK: 'off'};
  const mine = new Set<string>();
  const verify: Verify = (...args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrapper, ...args], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 1, 'one JSON result line on stdout');
      const result = JSON.parse(lines[0] ?? '{}') as Result;
      if (typeof result.runId === 'string') mine.add(result.runId);
      resolve({code, result, output: stdout + stderr});
    });
  });
  context.after(() => {
    for (const runId of mine) for (const unit of [`app-verify-${runId}.service`, `app-verify-${runId}-lease.timer`]) spawnSync('systemctl', ['--user', 'stop', unit]);
  });
  return {verify, root};
}

const units = (runId: string): string => spawnSync('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', `app-verify-${runId}*`], {encoding: 'utf8'}).stdout.trim();

void test('a run serves the runtime with the fixture modules and, reseeded, with none; captures pass; stop removes everything it owned', {skip, timeout: 300_000}, async context => {
  const {verify, root} = await roots(context);
  const started = await verify('start', '--scenario', 'fixtures', '--lease', '10');
  assert.equal(started.result.state, 'running', JSON.stringify(started.result));
  const runId = String(started.result.runId);
  const preview = new URL(String(started.result.url));
  assert.equal(preview.pathname, HEALTH_PATH, 'the preview links the runtime\'s health page');
  assert.equal((await fetch(preview)).status, 200, 'and the page answers');
  const runtimeDir = join(root, 's', runId);
  const grants = {grants: Object.values(JSON.parse(await readFile(join(runtimeDir, 'data/config/part-tokens.json'), 'utf8')) as Record<string, string>).map(token => ({token}))};
  const receipt = JSON.parse(await readFile(join(root, 'p', runId, 'receipt.json'), 'utf8')) as {checks?: {id: string; outcome: string}[]};
  assert.ok(validateReceipt(receipt).ok, 'the receipt is valid');
  assert.deepEqual(receipt.checks?.filter(check => check.id !== 'windows-loopback').map(check => [check.id, check.outcome]), [
    ['readiness', 'passed'], ['build-current', 'passed'], ['simulated-transports', 'passed'], ['no-outbound-connections', 'passed'], ['private-state', 'passed'],
  ]);
  const doctor = await verify('doctor', runId);
  const row = (doctor.result.runs as {state: string; checks: {outcome: string}[]; listener: {outcome: string}}[])[0];
  assert.equal(row?.state, 'running');
  assert.ok(row.checks.every(check => check.outcome === 'passed'), JSON.stringify(row.checks));
  assert.equal(row.listener.outcome, 'matches', 'the runtime and the harness listen where the receipt says');

  const captured = await verify('capture', runId, 'scenario-command-tracked-outcome');
  assert.equal(captured.result.outcome, 'passed', JSON.stringify(captured.result));
  const reseeded = await verify('scenario', runId, 'zero-modules');
  assert.equal(reseeded.code, 0, JSON.stringify(reseeded.result));
  const zero = await verify('capture', runId, 'scenario-zero-modules');
  assert.equal(zero.result.outcome, 'passed', JSON.stringify(zero.result));

  // One request through the run's own diagnostics, in each case, as the proof keeps it; the run's spans are in a private
  // file of its runtime directory, which stop removes with it.
  const followed = await verify('capture', runId, 'follow-one-request');
  assert.equal(followed.result.outcome, 'passed', JSON.stringify(followed.result));
  const attachments = (followed.result.attachments as string[]).map(file => file.slice(file.lastIndexOf('/') + 1)).sort();
  assert.deepEqual(attachments, ['follow-capped.json', 'follow-crash.json', 'follow-missing.json', 'follow-refusal.json', 'follow-replayed.json',
    'follow-success.json', 'follow-trace.json', 'follow-uncertain.json']);
  const spansFile = join(runtimeDir, 'data/state/spans.ndjson');
  assert.equal((await stat(spansFile)).mode & 0o777, 0o600, 'the spans are in a private file');

  const ports = [new URL(String(started.result.url)).port, new URL(String(started.result.endpoints?.harness)).port].map(Number);
  const stopped = await verify('stop', runId);
  assert.equal(stopped.result.state, 'stopped');
  assert.equal(units(runId), '', 'no unit or timer is left');
  await assert.rejects(access(runtimeDir), 'the runtime directory is gone');
  await assert.rejects(access(spansFile), 'and the span file with it');
  for (const port of ports) assert.equal(await listening(port), false, `port ${port} is closed`);
  const outputs = [started, doctor, captured, reseeded, zero, followed, stopped].map(call => call.output).join('\n') + JSON.stringify(receipt);
  for (const {token} of grants.grants) assert.equal(outputs.includes(token), false, 'no grant reaches a result, card or receipt');
});

void test('a boundary negative control fails its start with check-failed and leaves nothing behind', {skip, timeout: 120_000}, async context => {
  const {verify, root} = await roots(context);
  const started = await verify('start', '--scenario', 'control-installed-port', '--lease', '5');
  assert.equal(started.result.state, 'failed');
  assert.equal(started.result.cause, 'check-failed');
  assert.match(String(started.result.detail), /^no-outbound-connections: the runtime tried to reach tcp 127\.0\.0\.1:8788/);
  const runId = String(started.result.runId);
  assert.equal(units(runId), '', 'no unit or timer is left');
  await assert.rejects(access(join(root, 's', runId)), 'the runtime directory is gone');
});

void test('the wrapper refuses to reseed a run into a boundary negative control before the core acts', {timeout: 60_000}, async context => {
  const {verify} = await roots(context);
  const refused = await verify('scenario', 'runtime-20260101T000000Z-abcdef', 'control-default-state');
  assert.equal(refused.code, 2);
  assert.equal(refused.result.error, 'start-only-scenario');
});
