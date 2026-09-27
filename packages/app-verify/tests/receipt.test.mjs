import assert from 'node:assert/strict';
import test from 'node:test';
import {RECEIPT_VERSION, validateReceipt} from '@jimmie-potts/app-verify';

// The running receipt from docs/app-verification.md, with the fields #494 adds.
const running = () => ({
  receiptVersion: RECEIPT_VERSION,
  runId: 'hub-20260927T060259Z-3f9a1c',
  app: 'hub',
  repository: 'jimmie-potts/agent-device-hub',
  roots: {proof: '<canonical checkout>/.local/evidence/verify', runtime: '~/.local/state/app-verify'},
  state: 'running',
  startedAt: '2026-09-27T06:02:59Z',
  restarts: 'hub-20260927T052001Z-91be07',
  build: {sourceRevision: '4adfbf480a5bc3000cf99aec10226403d391a299', dirty: false, artifactDigest: 'sha256:' + 'a'.repeat(64), version: '0.4.0'},
  scenario: {name: 'lifecycle-basic', version: '4adfbf480a5bc3000cf99aec10226403d391a299', seededAt: '2026-09-27T06:03:01Z'},
  components: [{id: 'hub', kind: 'actual'}, {id: 'wall-controller', kind: 'simulated', note: 'fake loopback controller'}],
  checks: [{id: 'readiness', outcome: 'passed'}, {id: 'windows-loopback', outcome: 'skipped', reason: 'interop unavailable'}],
  captures: [{n: 1, step: 'task-appears', scenario: 'lifecycle-basic', set: 'verified', outcome: 'passed', screenshot: 'verified/capture-1/after.png', video: 'verified/capture-1/interaction.webm', log: 'verified/capture-1/assertions.json', startedAt: '2026-09-27T06:04:00Z', finishedAt: '2026-09-27T06:04:03Z'}],
  preview: {url: 'http://127.0.0.1:41705/', expiresAt: '2026-09-27T08:02:59Z', leaseMinutes: 120},
  owned: {unit: 'app-verify-hub-20260927T060259Z-3f9a1c.service', leaseTimer: 'app-verify-hub-20260927T060259Z-3f9a1c-lease.timer', port: 41705, runtimeDir: 'hub-20260927T060259Z-3f9a1c', proofDir: 'hub-20260927T060259Z-3f9a1c', mainPid: 4242, mainStartMonotonic: 218551931014},
  proof: {frozenAt: null},
  failure: null,
  cleanup: {result: null},
  secrets: 'none recorded',
});

test('the contract example with the #494 additions validates', () => {
  assert.deepEqual(validateReceipt(running()), {ok: true});
});

test('a starting receipt carries nulls for what it cannot know yet', () => {
  const value = running();
  Object.assign(value, {state: 'starting', captures: [], preview: null});
  delete value.restarts;
  value.build.artifactDigest = null;
  value.scenario.seededAt = null;
  Object.assign(value.owned, {port: null, mainPid: null, mainStartMonotonic: null});
  assert.deepEqual(validateReceipt(value), {ok: true});
});

test('a failed receipt names its cause and time, and what cleanup found', () => {
  const value = running();
  Object.assign(value, {state: 'failed', preview: null, failure: {cause: 'readiness-timeout', at: '2026-09-27T06:03:31Z', detail: 'no ready line within 30000 ms'}});
  value.cleanup = {result: 'clean', at: '2026-09-27T06:03:32Z', items: [{kind: 'unit', name: value.owned.unit, outcome: 'removed'}, {kind: 'lease-timer', name: value.owned.leaseTimer, outcome: 'removed'}, {kind: 'runtime-dir', name: value.owned.runtimeDir, outcome: 'removed'}]};
  assert.deepEqual(validateReceipt(value), {ok: true});
  assert.equal(validateReceipt({...value, failure: {cause: 'Readiness timeout', at: value.failure.at}}).ok, false, 'causes are kebab-case');
  assert.equal(validateReceipt({...value, failure: {cause: 'readiness-timeout'}}).ok, false, 'a failure records when it happened');
  assert.equal(validateReceipt({...value, failure: null}).ok, false, 'a failed run names its failure');
});

test('invalid receipts are refused with a reason for each problem', () => {
  const cases = [
    [value => (value.receiptVersion = 'app-verification/2'), /receiptVersion/],
    [value => (value.state = 'paused'), /state/],
    [value => (value.runId = 'hub-2026-3f9a1c'), /runId/],
    [value => (value.build.dirty = 'no'), /build.dirty/],
    [value => (value.captures[0].outcome = 'ok'), /captures\[0\].outcome/],
    [value => (value.captures[0].set = 'draft'), /captures\[0\].set/],
    [value => (value.preview.url = 'http://192.168.1.4:41705/'), /preview.url/],
    [value => (value.owned.unit = 'other.service'), /owned.unit/],
    [value => (value.cleanup.result = 'done'), /cleanup.result/],
    [value => (value.secrets = 'token abc'), /secrets/],
    [value => delete value.components, /components/],
    [value => (value.proof.frozenAt = 'yesterday'), /proof.frozenAt/],
  ];
  for (const [mutate, pattern] of cases) {
    const value = running();
    mutate(value);
    const result = validateReceipt(value);
    assert.equal(result.ok, false, String(pattern));
    assert.match(result.errors.join('\n'), pattern);
  }
});

test('fields a later 1.x adds are ignored, so a newer receipt still reads', () => {
  assert.deepEqual(validateReceipt({...running(), inputs: {hubPeer: 'http://127.0.0.1:41000/'}}), {ok: true});
});

test('a run id with pattern characters is refused, never compiled into a pattern', () => {
  const result = validateReceipt({runId: 'a(', owned: {}});
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /runId/);
  const value = running();
  value.runId = 'hub-(.*)';
  assert.equal(validateReceipt(value).ok, false);
});

test('capture records name their scenario, and fresh is only ever true', () => {
  const value = running();
  value.captures[0].scenario = 'lifecycle-basic';
  value.captures[0].fresh = true;
  assert.deepEqual(validateReceipt(value), {ok: true});
  value.captures[0].fresh = false;
  assert.match(validateReceipt(value).errors.join('\n'), /captures\[0\]\.fresh/);
  value.captures[0].fresh = true;
  value.captures[0].scenario = '';
  assert.match(validateReceipt(value).errors.join('\n'), /captures\[0\]\.scenario/);
});
