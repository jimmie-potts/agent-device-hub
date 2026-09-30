import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {chmod, link, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {withPausedFeeds, releaseFeed, liveFeedIdentity} from '../feed-pause.mjs';
import {ProofStore} from '../../../../packages/app-verify/dist/receipt.js';
import {resolveRoots} from '../../../../packages/app-verify/dist/roots.js';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'hub-pause-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const runtimeRoot = join(base, 'state'), proofRoot = join(base, 'proof');
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const units = new Map(), services = [];
  for (const [id, pid, start] of [['nanoleaf', 4101, 8101], ['pixoo', 4102, 8102]]) {
    const runId = `${id}-20260929T120000Z-abcdef`;
    const runtime = join(runtimeRoot, runId), proofDir = join(proofRoot, runId);
    const unit = `app-verify-${runId}.service`, leaseTimer = `app-verify-${runId}-lease.timer`;
    await mkdir(runtime, {recursive: true, mode: 0o700});
    await mkdir(proofDir, {recursive: true, mode: 0o700});
    const receipt = {runId, state: 'running', roots: {runtime: runtimeRoot}, owned: {runtimeDir: runId, unit, leaseTimer, mainPid: pid, mainStartMonotonic: start}, preview: {expiresAt: new Date(expiry * 1000).toISOString()}};
    await writeFile(join(proofDir, 'receipt.json'), JSON.stringify(receipt), {mode: 0o600});
    units.set(unit, {pid, start, active: 'active', frozen: 'running'});
    services.push({id, runId, proofDir, pid, unit, runtime, receipt});
  }
  let timerActive = true;
  const control = async args => {
    assert.equal(args[0], 'show');
    if (args[1].endsWith('.timer')) return `LoadState=loaded\nActiveState=${timerActive ? 'active' : 'inactive'}\nNextElapseUSecRealtime=@${expiry}\n`;
    const unit = units.get(args[1]); assert.ok(unit, `unexpected unit ${args[1]}`);
    return `LoadState=loaded\nActiveState=${unit.active}\nFreezerState=${unit.frozen}\nMainPID=${unit.pid}\nExecMainStartTimestampMonotonic=${unit.start}\n`;
  };
  return {runtimeRoot, services, units, control, expire: () => { timerActive = false; }};
}
async function request(service) {
  const path = join(service.runtime, 'feed-pause.request');
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.deepEqual(Object.keys(value).sort(), ['nonce', 'runId', 'version']);
      assert.equal(value.runId, service.runId); assert.match(value.nonce, /^[0-9a-f]{32}$/);
      return value;
    } catch (error) { if (error.code !== 'ENOENT') throw error; await delay(5); }
  }
  throw new Error(`${service.id} received no pause request`);
}
const ack = async (service, value, override = {}) => {
  const path = join(service.runtime, 'feed-pause.ack');
  await writeFile(path + '.tmp', JSON.stringify({...value, pid: service.pid, ...override}), {mode: 0o600});
  await rename(path + '.tmp', path);
};
const options = f => ({runtimeRoot: f.runtimeRoot, control: f.control, timeoutMs: 250});

async function coreFixture(t, defaults) {
  const f = await fixture(t);
  const roots = await resolveRoots({root: fileURLToPath(new URL('../../../../', import.meta.url))}, {
    HOME: f.runtimeRoot,
    APP_VERIFY_PROOF_ROOT: f.services[0].proofDir,
    ...(!defaults ? {APP_VERIFY_STATE_ROOT: f.runtimeRoot} : {}),
  });
  const s = f.services[0];
  f.runtimeRoot = roots.runtime;
  s.runtime = join(roots.runtime, s.runId);
  await mkdir(s.runtime, {recursive: true, mode: 0o700});
  await chmod(s.proofDir, 0o775);
  Object.assign(s.receipt, {
    receiptVersion: 'app-verification/1', app: s.id, repository: 'example/consumer', roots: roots.labels,
    startedAt: '2026-09-29T12:00:00Z',
    build: {sourceRevision: 'a'.repeat(40), dirty: false, artifactDigest: null, version: '1.0.0'},
    scenario: {name: 'hub-paired', version: '1', seededAt: '2026-09-29T12:00:00Z'},
    components: [], checks: [], captures: [], proof: {frozenAt: null}, failure: null,
    cleanup: {result: null}, secrets: 'none recorded',
  });
  Object.assign(s.receipt.owned, {proofDir: s.runId, port: 41234});
  Object.assign(s.receipt.preview, {url: 'http://127.0.0.1:41234/', leaseMinutes: 10});
  s.receipt.preview.expiresAt = s.receipt.preview.expiresAt.replace('.000Z', 'Z');
  await new ProofStore(s.proofDir).write(s.receipt);
  // Exercise the core's shareable mode even when the test runner has a private umask.
  await chmod(join(s.proofDir, 'receipt.json'), 0o644);
  return {f, s, options: {...options(f), runtimeLabel: roots.labels.runtime}};
}

for (const defaults of [true, false]) {
  test(`core-written receipt authorizes reset with ${defaults ? 'default' : 'explicit'} runtime roots and shareable proof`, async t => {
    const {s, options: opts} = await coreFixture(t, defaults);
    const live = await liveFeedIdentity(s, opts);
    assert.deepEqual(live, {runtime: s.runtime, pid: s.pid, started: 8101});
    assert.equal((await stat(join(s.proofDir, 'receipt.json'))).mode & 0o777, 0o644);
  });
}

for (const [name, change] of [
  ['group-writable receipt', async s => chmod(join(s.proofDir, 'receipt.json'), 0o664)],
  ['world-writable proof directory', async s => chmod(s.proofDir, 0o777)],
  ['nonprivate runtime', async s => chmod(s.runtime, 0o755)],
  ['linked receipt', async s => link(join(s.proofDir, 'receipt.json'), join(s.proofDir, 'copy'))],
  ['symlink receipt', async s => {
    const path = join(s.proofDir, 'receipt.json');
    await rename(path, path + '.saved'); await symlink(path + '.saved', path);
  }],
  ['symlink proof directory', async s => {
    await rename(s.proofDir, s.proofDir + '.saved'); await symlink(s.proofDir + '.saved', s.proofDir);
  }],
  ['oversized receipt', async s => writeFile(join(s.proofDir, 'receipt.json'), ' '.repeat(4 * 1024 * 1024 + 1))],
  ['wrong runtime label', async s => {
    s.receipt.roots.runtime = '/another/runtime';
    await new ProofStore(s.proofDir).write(s.receipt);
  }],
  ['wrong unit', async s => {
    s.receipt.owned.unit = 'app-verify-other.service';
    await writeFile(join(s.proofDir, 'receipt.json'), JSON.stringify(s.receipt));
  }],
]) {
  test(`${name} cannot authorize reset from shareable core proof`, async t => {
    const {s, options: opts} = await coreFixture(t, true);
    await change(s);
    await assert.rejects(liveFeedIdentity(s, opts), /current run identity or lease/);
  });
}

test('a default runtime label cannot authorize an explicit-root composition', async t => {
  const {s, options: opts} = await coreFixture(t, false);
  s.receipt.roots.runtime = '~/.local/state/app-verify';
  await new ProofStore(s.proofDir).write(s.receipt);
  await assert.rejects(liveFeedIdentity(s, opts), /current run identity or lease/);
});

test('foreign ownership cannot authorize shareable proof', async t => {
  const {s, options: opts} = await coreFixture(t, true);
  const foreign = process.getuid() + 1;
  t.mock.method(process, 'getuid', () => foreign);
  await assert.rejects(liveFeedIdentity(s, opts), /current run identity or lease/);
});

test('owner reset waits for both drained live consumers and leaves controls for seed', async t => {
  const f = await fixture(t); let ownerCalls = 0;
  const pending = withPausedFeeds(f.services, {...options(f), timeoutMs: 3000}, async tickets => { ownerCalls++; return tickets; });
  pending.catch(() => {});
  const requests = await Promise.all(f.services.map(request));
  await ack(f.services[0], requests[0]); await delay(50);
  assert.equal(ownerCalls, 0, 'one acknowledgment cannot reset the owner');
  await ack(f.services[1], requests[1]);
  const tickets = await pending; assert.equal(ownerCalls, 1); assert.equal(tickets.length, 2);
  assert.notEqual(requests[0].nonce, requests[1].nonce);
  for (const [i, service] of f.services.entries()) {
    assert.deepEqual(JSON.parse(await readFile(join(service.runtime, 'feed-pause.request'), 'utf8')), requests[i]);
    await releaseFeed(tickets[i], options(f));
    assert.deepEqual(JSON.parse(await readFile(join(service.runtime, 'feed-pause.release'), 'utf8')), requests[i]);
  }
});

for (const [name, change] of [
  ['wrong process', async (f, requests) => ack(f.services[0], requests[0], {pid: 9999})],
  ['wrong nonce', async (f, requests) => ack(f.services[0], requests[0], {nonce: 'f'.repeat(32)})],
  ['wrong run', async (f, requests) => ack(f.services[0], requests[0], {runId: f.services[1].runId})],
  ['extra key', async (f, requests) => ack(f.services[0], requests[0], {extra: true})],
  ['nonprivate ack', async f => chmod(join(f.services[0].runtime, 'feed-pause.ack'), 0o644)],
  ['linked ack', async f => link(join(f.services[0].runtime, 'feed-pause.ack'), join(f.services[0].runtime, 'second-link'))],
  ['symlink ack', async f => { const path = join(f.services[0].runtime, 'feed-pause.ack'); await rm(path); await symlink(join(f.services[1].runtime, 'feed-pause.ack'), path); }],
  ['oversized ack', async f => writeFile(join(f.services[0].runtime, 'feed-pause.ack'), ' '.repeat(4097))],
  ['replaced process', async f => { f.units.get(f.services[0].unit).start++; }],
  ['expired lease', async f => f.expire()],
  ['frozen process', async f => { f.units.get(f.services[0].unit).frozen = 'frozen'; }],
]) {
  test(`${name} cannot authorize owner reset`, async t => {
    const f = await fixture(t); let ownerCalls = 0;
    const pending = withPausedFeeds(f.services, options(f), async () => { ownerCalls++; }); pending.catch(() => {});
    const requests = await Promise.all(f.services.map(request));
    // Keep the second consumer unacknowledged until the invalid input is in place.
    await ack(f.services[0], requests[0]); await change(f, requests); await ack(f.services[1], requests[1]);
    await assert.rejects(pending); assert.equal(ownerCalls, 0);
    assert.deepEqual(JSON.parse(await readFile(join(f.services[0].runtime, 'feed-pause.request'), 'utf8')), requests[0]);
  });
}

test('an existing pause or release is never overwritten', async t => {
  const f = await fixture(t), path = join(f.services[1].runtime, 'feed-pause.release');
  await writeFile(path, 'existing control', {mode: 0o600});
  await assert.rejects(withPausedFeeds(f.services, options(f), async () => assert.fail('owner called')));
  assert.equal(await readFile(path, 'utf8'), 'existing control');
});

test('owner failure leaves requests and grants no release', async t => {
  const f = await fixture(t);
  const pending = withPausedFeeds(f.services, options(f), async () => { throw new Error('owner failed'); }); pending.catch(() => {});
  const requests = await Promise.all(f.services.map(request));
  for (const [i, service] of f.services.entries()) await ack(service, requests[i]);
  await assert.rejects(pending, /owner failed/);
  for (const service of f.services) {
    await stat(join(service.runtime, 'feed-pause.request'));
    await assert.rejects(stat(join(service.runtime, 'feed-pause.release')), {code: 'ENOENT'});
  }
});


test('a missing acknowledgment times out without authorizing the owner or either release', async t => {
  const f = await fixture(t); let calls = 0;
  const pending = withPausedFeeds(f.services, options(f), async () => { calls++; }); pending.catch(() => {});
  const requests = await Promise.all(f.services.map(request));
  await ack(f.services[0], requests[0]);
  await assert.rejects(pending, /before timeout/); assert.equal(calls, 0);
  for (const service of f.services) await assert.rejects(stat(join(service.runtime, 'feed-pause.release')), {code: 'ENOENT'});
});

test('a replaced pause request after drain cannot authorize release', async t => {
  const f = await fixture(t);
  const pending = withPausedFeeds(f.services, options(f), async tickets => tickets); pending.catch(() => {});
  const requests = await Promise.all(f.services.map(request));
  for (const [i, service] of f.services.entries()) await ack(service, requests[i]);
  const tickets = await pending;
  await writeFile(join(f.services[0].runtime, 'feed-pause.request'), JSON.stringify({...requests[0], nonce: '0'.repeat(32)}));
  await assert.rejects(releaseFeed(tickets[0], options(f)), /did not match/);
  await assert.rejects(stat(join(f.services[0].runtime, 'feed-pause.release')), {code: 'ENOENT'});
});
