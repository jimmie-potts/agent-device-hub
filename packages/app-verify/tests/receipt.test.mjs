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
  const value = running();
  value.owned.laterField = {any: 'shape'};
  assert.deepEqual(validateReceipt({...value, laterField: [1, 2]}), {ok: true});
});

test('1.1 run inputs and extra endpoints validate when present and stay optional', () => {
  const value = running();
  value.inputs = {hubFeed: 'http://127.0.0.1:41000/api/monitor/v1/sessions', label: 'wall run'};
  value.owned.endpoints = {controller: 'http://127.0.0.1:41999/'};
  assert.deepEqual(validateReceipt(value), {ok: true});
  assert.deepEqual(validateReceipt({...running(), inputs: {}}), {ok: true}, 'a plug-in that declares inputs records an empty map when none were given');
  const cases = [
    [v => (v.inputs = ['a']), /inputs: expected an object/],
    [v => (v.inputs = {'1st': 'x'}), /inputs\.1st/],
    [v => (v.inputs = {apiToken: 'x'}), /inputs\.apiToken: .*secret/],
    [v => (v.inputs = {label: ''}), /inputs\.label/],
    [v => (v.inputs = {label: 'x'.repeat(513)}), /inputs\.label/],
    [v => (v.inputs = {label: 'caf\u00e9'}), /inputs\.label/],
    [v => (v.inputs = {label: 'a\nb'}), /inputs\.label/],
    [v => (v.inputs = {label: 7}), /inputs\.label/],
    [v => (v.owned.endpoints = []), /owned\.endpoints: expected an object/],
    [v => (v.owned.endpoints = {controller: 'http://192.168.1.4:41999/'}), /owned\.endpoints\.controller/],
    [v => (v.owned.endpoints = {controller: 'http://127.0.0.1:0/'}), /owned\.endpoints\.controller/],
    [v => (v.owned.endpoints = {'bad name': 'http://127.0.0.1:41999/'}), /owned\.endpoints\.bad name/],
    [v => (v.owned.endpoints = {controller: 'http://u:p@127.0.0.1:41999/'}), /owned\.endpoints\.controller/],
    [v => (v.owned.endpoints = {controller: 'http://127.0.0.1:41999/?token=x'}), /owned\.endpoints\.controller/],
    [v => (v.owned.endpoints = {controller: 'http://127.0.0.1:41999/#x'}), /owned\.endpoints\.controller/],
    [v => (v.owned.endpoints = {controller: 'http://127.0.0.1:41999/api/'}), /owned\.endpoints\.controller/],
  ];
  for (const [mutate, pattern] of cases) {
    const bad = running();
    mutate(bad);
    const result = validateReceipt(bad);
    assert.equal(result.ok, false, String(pattern));
    assert.match(result.errors.join('\n'), pattern);
  }
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

test('recorded details keep root paths and URLs, replace other absolute paths and are capped', async () => {
  const {redact} = await import('../dist/util.js');
  const roots = {runtime: '/home/u/.local/state/app-verify', proof: '/home/u/repo/.local/evidence/verify'};
  assert.equal(
    redact("Command failed: /usr/bin/python3 /home/u/repo/scripts/seed.py --data=/home/u/.local/state/app-verify/r/data open '/etc/private' [/var/x] (/tmp/y) http://127.0.0.1:41705/api/x /home/u/repo/.local/evidence/verify/r/receipt.json", roots),
    "Command failed: <path> <path> --data=/home/u/.local/state/app-verify/r/data open '<path>' [<path>] (<path>) http://127.0.0.1:41705/api/x /home/u/repo/.local/evidence/verify/r/receipt.json",
  );
  assert.equal(redact('/home/u/.local/state/app-verify-other/x', roots), '<path>', 'a sibling that only shares a prefix is outside the root');
  assert.equal(redact('ratio 3/4 and a / b', roots), 'ratio 3/4 and a / b');
  const cases = [
    // A path after a colon, in backticks or after <, {, ; or |, and a file: URL outside the roots.
    ['cwd:/home/someone/secret', 'cwd:<path>'],
    ['open `/tmp/a` failed', 'open `<path>` failed'],
    ['</srv/a> {/srv/b} x;/srv/c |/srv/d', '<<path>> {<path>} x;<path> |<path>'],
    ['file:///home/someone/.ssh/key', 'file://<path>'],
    ['file:///home/u/.local/state/app-verify/r/data/x', 'file:///home/u/.local/state/app-verify/r/data/x'],
    // A trailing colon is not part of the path.
    ['reads /srv/private/fixture.json: ENOENT', 'reads <path>: ENOENT'],
    ['PATH=/a/bin:/b/bin', 'PATH=<path>'],
    // `..` cannot climb out of a root.
    ['/home/u/.local/state/app-verify/../../someone/secret', '<path>'],
    ['/home/u/.local/state/app-verify/r/../r/data', '/home/u/.local/state/app-verify/r/../r/data'],
    // URLs keep their paths and queries, including a / inside the query.
    ['GET http://127.0.0.1:41705/api/x?y=/z answered 503', 'GET http://127.0.0.1:41705/api/x?y=/z answered 503'],
    ['see https://example.invalid/docs/a (or /usr/share/doc)', 'see https://example.invalid/docs/a (or <path>)'],
    // A bare route is indistinguishable from a file path, so it is replaced: plug-ins name full URLs.
    ['GET /api/monitor/v1/sessions answered 503', 'GET <path> answered 503'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input, roots), expected, input);
  const long = redact('x'.repeat(5000), roots);
  assert.equal(long.length, 1000);
  assert.ok(long.endsWith('...'));
  assert.equal(redact('short', roots), 'short');
});
