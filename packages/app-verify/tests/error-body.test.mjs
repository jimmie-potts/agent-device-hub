// The shared 2.0 error body on refusal lines (Hub #921, ADR 0012). A refusal keeps its 1.x `error` and `detail`
// and adds `errorBody`. Nothing here needs a user manager, so every test runs in CI too.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {RECEIPT_VERSION, validateReceipt} from '@jimmie-potts/app-verify';
import {holderRecord} from './lock-holder.mjs';
import {assertRefusal, expectedBody, REFUSAL_CODES, sandbox} from './helpers.mjs';

const RUN = '20260927T060259Z-3f9a1c';

/**
 * The registry's own `errorBody`, or undefined in the isolated package consumer, which installs only this archive:
 * the core has no runtime dependency, so it keeps a copy of the codes it uses, and this proves the copy.
 */
async function contracts() {
  try {
    return await import('@jimmie-potts/event-contracts/v2');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !String(error.message).includes("Cannot find package '@jimmie-potts/event-contracts'")) throw error;
    process.stderr.write('SKIP registry equality: @jimmie-potts/event-contracts is not installed; the workspace suite runs it.\n');
    return undefined;
  }
}

/** A valid receipt for a sandbox run, in `state`. */
function receiptFor(box, state) {
  const runId = `${box.app}-${RUN}`;
  return {
    receiptVersion: RECEIPT_VERSION, runId, app: box.app, repository: 'jimmie-potts/agent-device-hub',
    roots: {proof: '<canonical checkout>/.local/evidence/verify', runtime: box.stateRoot}, state, startedAt: '2026-09-27T06:02:59Z',
    build: {sourceRevision: 'unknown', dirty: true, artifactDigest: 'sha256:' + 'a'.repeat(64), version: '1.0.0-fixture'},
    scenario: {name: 'reference', version: 'unknown', seededAt: '2026-09-27T06:03:01Z'}, components: [], checks: [], captures: [],
    preview: {url: 'http://127.0.0.1:41705/', expiresAt: '2026-09-27T08:02:59Z', leaseMinutes: 120},
    owned: {unit: `app-verify-${runId}.service`, leaseTimer: `app-verify-${runId}-lease.timer`, port: 41705, runtimeDir: runId, proofDir: runId, mainPid: 4242, mainStartMonotonic: 218551931014},
    proof: {frozenAt: null}, failure: null, cleanup: {result: state === 'running' ? null : 'clean'}, secrets: 'none recorded',
  };
}

async function writeReceipt(box, value) {
  const dir = join(box.proofRoot, `${box.app}-${RUN}`);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'receipt.json'), JSON.stringify(value, null, 2) + '\n');
  return dir;
}

test('each refusal maps to the approved registry code, and the README lists the same table', async () => {
  const {REFUSAL_CODES: core, refusalBody} = await import(new URL('../dist/error-body.js', import.meta.url).href);
  assert.deepEqual({...core}, REFUSAL_CODES);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.slice(readme.indexOf('### Refusal error body'));
  const rows = [...section.slice(0, section.indexOf('\n## ')).matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| (yes|no) \|$/gm)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(Object.fromEntries(rows.map(([error, code]) => [error, code])), REFUSAL_CODES, 'the README table names every refusal and its code');
  assert.equal(rows.length, Object.keys(REFUSAL_CODES).length, 'each refusal is listed once');
  for (const [error, , retryable] of rows) {
    assert.equal(retryable === 'yes', refusalBody(error, 'x').error.retryable, `${error}: the README's Retryable column is what the core prints`);
    assert.equal(retryable === 'yes', expectedBody(error, 'x').error.retryable, `${error}: the README's Retryable column is the registry flag`);
  }
});

test('every refusal body equals the registry errorBody, with the registry retryable flag', async t => {
  const registry = await contracts();
  if (registry === undefined) return t.skip('@jimmie-potts/event-contracts is not installed in an isolated consumer');
  const {refusalBody} = await import(new URL('../dist/error-body.js', import.meta.url).href);
  for (const [refusal, code] of Object.entries(REFUSAL_CODES)) {
    const body = refusalBody(refusal, 'what happened');
    assert.deepEqual(body, registry.errorBody(code, {detail: `${refusal}: what happened`}), refusal);
    assert.equal(body.error.retryable, registry.errorCodes[code].retryable, refusal);
  }
  // A refusal the table does not name is internal, and a long detail is cut to the registry's limit.
  assert.deepEqual(refusalBody('seed-failed', 'x'), registry.errorBody('internal', {detail: 'seed-failed: x'}));
  const long = refusalBody('usage', 'x'.repeat(2000));
  assert.deepEqual(long, registry.errorBody('invalid-request', {detail: `usage: ${'x'.repeat(2000)}`.slice(0, registry.MAX_DETAIL)}));
  assert.deepEqual(expectedBody('usage', 'x'), registry.errorBody('invalid-request', {detail: 'usage: x'}), 'the tests expect the registry body too');
});

test('refusals before any run exists carry the body beside the 1.x fields', async () => {
  const box = await sandbox();
  try {
    const usage = await box.cli(['launch']);
    assert.equal(usage.code, 2);
    assertRefusal(usage.result, 'usage');
    assert.deepEqual(usage.result, {operation: 'launch', error: 'usage', detail: 'unknown operation launch; see help', errorBody: {error: {code: 'invalid-request', retryable: false, detail: 'usage: unknown operation launch; see help'}}});
    const runId = `${box.app}-${RUN}`;
    for (const args of [['extend', runId], ['scenario', runId, 'reference'], ['capture', runId, 'count-twice'], ['handoff', runId], ['restart', runId], ['stop', runId], ['doctor', runId]]) {
      const unknown = await box.cli(args);
      assert.equal(unknown.code, 1, args.join(' '));
      assertRefusal(unknown.result, 'unknown-run');
      assert.equal(unknown.result.operation, args[0]);
    }
    const bad = await box.cli(['help'], {entry: await box.wrapper(box.repo, 'verify-bad.mjs', {inputs: {apiKey: {description: 'no'}}})});
    assert.equal(bad.code, 1);
    assertRefusal(bad.result, 'internal');
  } finally {
    await box.close();
  }
});

test('an invalid receipt, a run that is not running and an unusable root are refused with the body', async () => {
  const box = await sandbox();
  try {
    const runId = `${box.app}-${RUN}`;
    await writeReceipt(box, {});
    const invalid = await box.cli(['extend', runId]);
    assert.equal(invalid.code, 1);
    assertRefusal(invalid.result, 'invalid-receipt');

    const stopped = receiptFor(box, 'stopped');
    assert.deepEqual(validateReceipt(stopped), {ok: true});
    await writeReceipt(box, stopped);
    for (const args of [['extend', runId], ['scenario', runId, 'reference'], ['capture', runId, 'count-twice'], ['handoff', runId]]) {
      const refused = await box.cli(args);
      assert.equal(refused.code, 1, args.join(' '));
      assertRefusal(refused.result, 'run-not-running');
      // `handoff` has its own wording: the run is not serving a preview.
      if (args[0] !== 'handoff') assert.equal(refused.result.detail, `${runId} is stopped`, `${args.join(' ')} says what state the run is in`);
    }
    // A receipt that says running while its unit is gone: the refusal names the unit, not "the receipt".
    await writeReceipt(box, receiptFor(box, 'running'));
    for (const args of [['extend', runId], ['capture', runId, 'count-twice']]) {
      const gone = await box.cli(args);
      assert.equal(gone.code, 1, args.join(' '));
      assertRefusal(gone.result, 'run-not-running');
      assert.equal(gone.result.detail, `app-verify-${runId}.service is not active`, `${args.join(' ')} names the unit that is not active`);
    }
    await writeReceipt(box, stopped);

    const runtime = await box.cli(['extend', runId], {extraEnv: {APP_VERIFY_STATE_ROOT: join(box.repo, 'state')}});
    assert.equal(runtime.code, 1);
    assertRefusal(runtime.result, 'runtime-root-unusable');
    const proof = await box.cli(['extend', runId], {extraEnv: {APP_VERIFY_PROOF_ROOT: join(box.repo, 'proof')}});
    assert.equal(proof.code, 1);
    assertRefusal(proof.result, 'proof-root-unusable');
  } finally {
    await box.close();
  }
});

test('an unknown scenario is refused by name, and the message points at help', async () => {
  const box = await sandbox();
  try {
    const runId = `${box.app}-${RUN}`;
    for (const args of [['start', '--scenario', 'nope'], ['scenario', runId, 'nope'], ['handoff', runId, '--reset', 'nope']]) {
      const refused = await box.cli(args);
      assert.equal(refused.code, 2, args.join(' '));
      assertRefusal(refused.result, 'usage');
      assert.equal(refused.result.detail, 'no scenario named nope; help lists the scenarios', args.join(' '));
    }
    const help = await box.cli(['help']);
    assert.ok(Object.hasOwn(help.result.scenarios, 'reference'), 'help lists the scenarios the message points at');
    assert.equal(existsSync(box.proofRoot), false, 'a usage refusal creates nothing');
  } finally {
    await box.close();
  }
});

test('a stop under a live receipt lock reports its cleanup and the body, and restart passes the same line on', {timeout: 60000}, async () => {
  const box = await sandbox();
  try {
    const runId = `${box.app}-${RUN}`;
    const dir = await writeReceipt(box, receiptFor(box, 'running'));
    await mkdir(join(dir, '.receipt.lock'));
    await writeFile(join(dir, '.receipt.lock', 'holder'), await holderRecord({dead: false}));
    const stop = await box.cli(['stop', runId]);
    assert.equal(stop.code, 1);
    assertRefusal(stop.result, 'receipt-locked', ['operation', 'runId', 'state', 'cleanup']);
    assert.match(stop.result.detail, new RegExp(`pid ${process.pid}`));
    const restart = await box.cli(['restart', runId]);
    assert.equal(restart.code, 1);
    assertRefusal(restart.result, 'receipt-locked', ['operation', 'runId', 'state', 'cleanup']);
    assert.equal(restart.result.operation, 'restart');
  } finally {
    await box.close();
  }
});

test('the bodies printed on refusal lines equal the registry errorBody', async t => {
  const registry = await contracts();
  if (registry === undefined) return t.skip('@jimmie-potts/event-contracts is not installed in an isolated consumer');
  const box = await sandbox();
  try {
    const lines = [(await box.cli(['launch'])).result, (await box.cli(['extend', `${box.app}-${RUN}`])).result];
    for (const line of lines) {
      assert.deepEqual(line.errorBody, registry.errorBody(REFUSAL_CODES[line.error], {detail: `${line.error}: ${line.detail}`}));
    }
  } finally {
    await box.close();
  }
});
