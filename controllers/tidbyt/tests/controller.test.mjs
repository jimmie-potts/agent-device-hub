import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '@jimmie-potts/device-contracts';
import { TidbytController, renderFrame, FRAME_BYTES } from '../dist/index.js';

const CAPABILITIES = {
  backend: 'tidbyt-cloud', backgroundPush: { supported: true }, foregroundPush: { supported: false }, installationRead: { supported: true },
};

function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

/** Fake connection: scripted outcomes, concurrency tracking and optional gates per push. */
function fakeConnection({ push = () => ({ outcome: 'sent' }), read = () => ({ ok: true, present: true }) } = {}) {
  const state = { pushes: [], reads: 0, active: 0, maxActive: 0, signals: [] };
  return {
    state,
    capabilities: CAPABILITIES,
    async push(webp, signal) {
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      state.pushes.push(webp);
      state.signals.push(signal);
      try { return await push(state.pushes.length, signal); } finally { state.active--; }
    },
    async readInstallation() { state.reads++; return read(state.reads); },
  };
}

function setup(options = {}) {
  const clock = { now: 1000 };
  const connection = options.connection ?? fakeConnection();
  const controller = new TidbytController({
    controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', epoch: 'epoch-1',
    connection, now: () => clock.now, ...options.extra,
  });
  return { controller, connection, clock };
}

const frameData = (fill = 0) => ({ width: 64, height: 32, encoding: 'rgb24-base64', data: Buffer.alloc(FRAME_BYTES, fill).toString('base64') });

function display(controller, fill = 0, overrides = {}) {
  const { controller: s } = controller.snapshot();
  return {
    apiVersion: '1.0', controllerId: 'tidbyt-main', deviceId: 'tidbyt', requestId: s.nextRequestId,
    expectedConfigurationRevision: s.configurationRevision, expectedGeneration: s.generation,
    command: { kind: 'tidbyt.display', frame: frameData(fill) }, ...overrides,
  };
}

function checkSnapshot(controller) {
  const snapshot = controller.snapshot();
  assert(validate('snapshot', snapshot.controller), 'controller v1 snapshot is schema-valid');
  return snapshot;
}

async function settle(submission) {
  assert(validate('receipt', submission.receipt), 'admission receipt is schema-valid');
  const receipt = await submission.done;
  assert(validate('receipt', receipt), 'final receipt is schema-valid');
  return receipt;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('the initial snapshot is schema-valid, declares no v1 capability and fabricates no evidence', () => {
  const { controller } = setup();
  const snapshot = checkSnapshot(controller);
  assert.deepEqual(snapshot.profile, { profileId: 'tidbyt-display', profileVersion: '1.0.0' });
  const s = snapshot.controller;
  assert.deepEqual(s.identity, { deviceId: 'tidbyt', controllerId: 'tidbyt-main', sourceId: 'tidbyt-cloud', controllerEpoch: 'epoch-1' });
  for (const name of ['power', 'brightness', 'media', 'zones', 'scenes', 'preview']) assert.deepEqual(s.capabilities[name], { supported: false });
  assert.equal(s.serviceHealth, 'unknown');
  assert.deepEqual(s.nextRequestId, { epoch: 'epoch-1', sequence: 0 });
  assert.deepEqual(s.state.observation, { status: 'unknown' });
  assert.deepEqual(s.state.lastSuccessfulSend, { status: 'unknown' });
  assert.deepEqual(s.state.externalControl, { status: 'unknown' });
  assert.deepEqual(s.state.desired, { power: { status: 'unknown' }, brightness: { status: 'unknown' }, mode: { status: 'unknown' } });
  assert.equal(s.limits.maxPending, 8);
  assert.deepEqual(snapshot.display, {
    frame: { width: 64, height: 32, format: 'webp-lossless' },
    connection: CAPABILITIES,
    pending: [],
    holds: { authentication: false, rateLimitRemainingMs: 0 },
    installation: { status: 'unknown' },
    visible: { status: 'unknown' },
  });
  const text = JSON.stringify(snapshot);
  assert(!/api[_-]?key|bearer|synthetic-device/i.test(text));
});

test('a display request is queued, rendered and sent once, recording transmission but not observation', async () => {
  const { controller, connection, clock } = setup();
  const request = display(controller, 7);
  const submission = controller.submit(request);
  assert.equal(submission.decision, 'queued');
  assert.equal(submission.reserved, true);
  assert.equal(submission.receipt.outcome, 'queued');
  assert.equal(submission.receipt.configurationRevision, 1);
  clock.now = 1500;
  const receipt = await settle(submission);
  assert.deepEqual(receipt, {
    apiVersion: '1.0', controllerId: 'tidbyt-main', deviceId: 'tidbyt', requestId: { epoch: 'epoch-1', sequence: 0 },
    configurationRevision: 1, generation: { epoch: 'epoch-1', sequence: 0 }, outcome: 'sent',
    priorEffects: 'confirmed-transmission', completedOperations: ['push'], uncertainOperations: [],
  });
  const expected = renderFrame({ width: 64, height: 32, rgb: new Uint8Array(FRAME_BYTES).fill(7) });
  assert.deepEqual(connection.state.pushes, [expected.webp]);
  const s = checkSnapshot(controller);
  assert.equal(s.controller.serviceHealth, 'ready');
  assert.deepEqual(s.controller.state.lastSuccessfulSend, {
    status: 'known', requestId: { epoch: 'epoch-1', sequence: 0 },
    clock: { domain: 'controller-monotonic', epoch: 'epoch-1', sampledAtMs: 1500 }, operationIds: ['push'],
  });
  assert.deepEqual(s.controller.state.lastOutcome, { status: 'known', receipt });
  assert.deepEqual(s.controller.state.observation, { status: 'unknown' });
  assert.deepEqual(s.display.visible, { status: 'unknown' });
  assert.deepEqual(s.controller.nextRequestId, { epoch: 'epoch-1', sequence: 1 });
});

test('unregistered targets and malformed requests are rejected before reservation', async () => {
  const { controller, connection } = setup();
  const good = display(controller);
  const cases = [
    [{ ...good, controllerId: 'other' }, 'unknown-device'],
    [{ ...good, deviceId: 'other' }, 'unknown-device'],
    [{ ...good, apiVersion: '2.0' }, 'invalid-request'],
    [{ ...good, extra: 1 }, 'invalid-request'],
    [{ ...good, command: { kind: 'tidbyt.display', frame: { ...frameData(), width: 32 } } }, 'invalid-request'],
    [{ ...good, command: { kind: 'tidbyt.display', frame: { ...frameData(), data: 'AAAA' } } }, 'invalid-request'],
    [{ ...good, command: { kind: 'tidbyt.display', frame: frameData(), background: false } }, 'invalid-request'],
    [{ ...good, command: { kind: 'tidbyt.display', frame: frameData(), url: 'https://example.invalid' } }, 'invalid-request'],
    [{ ...good, requestId: { epoch: 'epoch-1', sequence: -1 } }, 'invalid-request'],
    [{ ...good, deviceId: '192.168.1.5/x' }, 'invalid-request'],
    [null, 'invalid-request'],
  ];
  for (const [request, decision] of cases) {
    const result = controller.submit(request);
    assert.deepEqual(result, { decision, reserved: false }, decision);
  }
  await flush();
  assert.equal(connection.state.pushes.length, 0);
  assert.deepEqual(checkSnapshot(controller).controller.nextRequestId, { epoch: 'epoch-1', sequence: 0 });
});

test('a full queue rejects with capacity without consuming the identity', async () => {
  const hold = gate();
  const connection = fakeConnection({ push: () => hold.promise });
  const { controller } = setup({ connection, extra: { maxPending: 2 } });
  const first = controller.submit(display(controller, 1));
  const second = controller.submit(display(controller, 2));
  assert.equal(first.decision, 'queued');
  assert.equal(second.decision, 'queued');
  const third = display(controller, 3);
  assert.deepEqual(controller.submit(third), { decision: 'capacity', reserved: false });
  assert.equal(checkSnapshot(controller).display.pending.length, 2);
  hold.open({ outcome: 'sent' });
  await first.done; await second.done;
  const retry = controller.submit({ ...third, expectedConfigurationRevision: checkSnapshot(controller).controller.configurationRevision });
  assert.equal(retry.decision, 'queued');
  assert.deepEqual(retry.receipt.requestId, third.requestId);
  await retry.done;
});

test('duplicates join or replay the original result and conflicting bodies are rejected', async () => {
  const hold = gate();
  const connection = fakeConnection({ push: () => hold.promise });
  const { controller } = setup({ connection });
  const request = display(controller, 9);
  const original = controller.submit(request);
  const reordered = { command: request.command, expectedGeneration: request.expectedGeneration, requestId: request.requestId,
    expectedConfigurationRevision: request.expectedConfigurationRevision, deviceId: request.deviceId,
    controllerId: request.controllerId, apiVersion: request.apiVersion };
  const joined = controller.submit(reordered);
  assert.equal(joined.decision, 'join');
  assert.equal(joined.reserved, false);
  const conflict = { ...request, command: { kind: 'tidbyt.display', frame: frameData(10) } };
  assert.deepEqual(controller.submit(conflict), { decision: 'request-conflict', reserved: false });
  hold.open({ outcome: 'sent' });
  const [a, b] = await Promise.all([original.done, joined.done]);
  assert.deepEqual(a, b);
  const replay = controller.submit(reordered);
  assert.equal(replay.decision, 'replay');
  assert.deepEqual(await replay.done, a);
  assert.deepEqual(replay.receipt, a);
  assert.deepEqual(controller.submit(conflict), { decision: 'request-conflict', reserved: false });
  assert.equal(connection.state.pushes.length, 1);
});

test('stale, future and foreign-epoch identities are rejected without execution', async () => {
  const { controller, connection } = setup();
  const first = display(controller);
  await controller.submit(first).done;
  const current = display(controller);
  assert.deepEqual(controller.submit({ ...current, requestId: { epoch: 'epoch-1', sequence: 5 } }), { decision: 'request-order', reserved: false });
  assert.deepEqual(controller.submit({ ...current, requestId: { epoch: 'epoch-0', sequence: 1 } }), { decision: 'request-expired', reserved: false });
  assert.equal(connection.state.pushes.length, 1);
});

test('evicted receipts expire instead of executing again', async () => {
  const { controller, connection } = setup();
  const first = display(controller);
  await controller.submit(first).done;
  for (let i = 0; i < 256; i++) await controller.submit(display(controller, i % 256)).done;
  assert.deepEqual(controller.submit(first), { decision: 'request-expired', reserved: false });
  assert.equal(connection.state.pushes.length, 257);
});

test('overlapping requests are written one at a time in admission order', async () => {
  const gates = [gate(), gate(), gate()];
  const connection = fakeConnection({ push: n => gates[n - 1].promise });
  const { controller } = setup({ connection });
  const submissions = [1, 2, 3].map(fill => controller.submit(display(controller, fill)));
  await flush();
  assert.equal(connection.state.pushes.length, 1);
  gates[0].open({ outcome: 'sent' });
  await submissions[0].done; await flush();
  assert.equal(connection.state.pushes.length, 2);
  gates[1].open({ outcome: 'sent' }); gates[2].open({ outcome: 'sent' });
  await Promise.all(submissions.map(s => s.done));
  assert.equal(connection.state.maxActive, 1);
  const fills = connection.state.pushes.map(webp => webp);
  const expected = [1, 2, 3].map(fill => renderFrame({ width: 64, height: 32, rgb: new Uint8Array(FRAME_BYTES).fill(fill) }).webp);
  assert.deepEqual(fills, expected);
});

test('cancellation retires queued writes while the in-flight write reports its own result', async () => {
  const hold = gate();
  const connection = fakeConnection({ push: () => hold.promise });
  const { controller } = setup({ connection });
  const inFlight = controller.submit(display(controller, 1));
  const queued = [controller.submit(display(controller, 2)), controller.submit(display(controller, 3))];
  await flush();
  const before = checkSnapshot(controller).controller.generation;
  controller.cancelPending();
  const after = checkSnapshot(controller).controller.generation;
  assert.deepEqual(after, { epoch: before.epoch, sequence: before.sequence + 1 });
  for (const submission of queued) {
    const receipt = await settle(submission);
    assert.equal(receipt.outcome, 'cancelled');
    assert.deepEqual(receipt.failure, { code: 'stale-generation' });
    assert.equal(receipt.priorEffects, 'none');
  }
  hold.open({ outcome: 'sent' });
  assert.equal((await settle(inFlight)).outcome, 'sent');
  assert.equal(connection.state.pushes.length, 1);
  const stale = display(controller, 4, { expectedGeneration: before });
  const rejected = controller.submit(stale);
  assert.equal(rejected.decision, 'stale-generation');
  assert.equal(rejected.reserved, true);
  assert.equal((await settle(rejected)).failure.code, 'stale-generation');
  const conflict = controller.submit(display(controller, 5, { expectedConfigurationRevision: 0 }));
  assert.equal(conflict.decision, 'revision-conflict');
  assert.equal(connection.state.pushes.length, 1);
});

test('an uncertain write is never replayed by the controller or a duplicate submission', async () => {
  const connection = fakeConnection({ push: () => ({ outcome: 'uncertain' }) });
  const { controller } = setup({ connection });
  const request = display(controller);
  const receipt = await settle(controller.submit(request));
  assert.equal(receipt.outcome, 'uncertain');
  assert.equal(receipt.priorEffects, 'possible');
  assert.deepEqual(receipt.failure, { code: 'uncertain-result' });
  assert.deepEqual(receipt.uncertainOperations, ['push']);
  assert.deepEqual(receipt.completedOperations, []);
  const again = controller.submit(request);
  assert.equal(again.decision, 'replay');
  assert.deepEqual(await again.done, receipt);
  await flush();
  assert.equal(connection.state.pushes.length, 1);
  const s = checkSnapshot(controller);
  assert.equal(s.controller.serviceHealth, 'degraded');
  assert.deepEqual(s.controller.state.lastSuccessfulSend, { status: 'unknown' });
});

test('controller v1 commands reserve their identity and are retained as unsupported', async () => {
  const { controller, connection } = setup();
  const request = { ...display(controller), command: { kind: 'power.set', on: true } };
  const submission = controller.submit(request);
  assert.equal(submission.decision, 'unsupported-capability');
  assert.equal(submission.reserved, true);
  const receipt = await settle(submission);
  assert.equal(receipt.outcome, 'failed');
  assert.deepEqual(receipt.failure, { code: 'unsupported-capability' });
  assert.equal(controller.submit(request).decision, 'replay');
  await flush();
  assert.equal(connection.state.pushes.length, 0);
  assert.deepEqual(checkSnapshot(controller).controller.nextRequestId.sequence, 1);
});

test('authentication failure holds later writes without network calls until reconfiguration', async () => {
  const hold = gate();
  const connection = fakeConnection({ push: () => hold.promise });
  const { controller } = setup({ connection });
  const first = controller.submit(display(controller, 1));
  const second = controller.submit(display(controller, 2));
  hold.open({ outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' });
  assert.deepEqual((await settle(first)).failure, { code: 'unauthenticated' });
  const blocked = await settle(second);
  assert.equal(blocked.outcome, 'failed');
  assert.deepEqual(blocked.failure, { code: 'unauthenticated' });
  assert.equal(blocked.priorEffects, 'none');
  assert.equal(connection.state.pushes.length, 1);
  let s = checkSnapshot(controller);
  assert.equal(s.display.holds.authentication, true);
  assert.equal(s.controller.serviceHealth, 'unavailable');
  const third = await settle(controller.submit(display(controller, 3)));
  assert.deepEqual(third.failure, { code: 'unauthenticated' });
  assert.equal(connection.state.pushes.length, 1);

  const replacement = fakeConnection();
  const revision = checkSnapshot(controller).controller.configurationRevision;
  controller.reconfigure(replacement);
  s = checkSnapshot(controller);
  assert.equal(s.controller.configurationRevision, revision + 1);
  assert.equal(s.display.holds.authentication, false);
  assert.equal(s.controller.serviceHealth, 'unknown');
  assert.equal((await settle(controller.submit(display(controller, 4)))).outcome, 'sent');
  assert.equal(replacement.state.pushes.length, 1);
});

test('a rate limit fails that write and delays queued writes until the hold expires', async () => {
  const connection = fakeConnection({ push: n => (n === 1
    ? { outcome: 'failed', failure: 'capacity', priorEffects: 'none', retryAfterMs: 60 }
    : { outcome: 'sent' }) });
  const { controller } = setup({ connection, extra: { now: () => performance.now() } });
  const start = performance.now();
  const first = controller.submit(display(controller, 1));
  const second = controller.submit(display(controller, 2));
  const limited = await settle(first);
  assert.equal(limited.outcome, 'failed');
  assert.deepEqual(limited.failure, { code: 'capacity' });
  const held = checkSnapshot(controller);
  assert(held.display.holds.rateLimitRemainingMs > 0 && held.display.holds.rateLimitRemainingMs <= 60);
  assert.equal(held.display.pending.length, 1);
  assert.equal((await settle(second)).outcome, 'sent');
  assert(performance.now() - start >= 55, 'queued write waited for the hold');
  assert.equal(connection.state.pushes.length, 2);
  assert.equal(checkSnapshot(controller).display.holds.rateLimitRemainingMs, 0);
});

test('close aborts the in-flight write as uncertain, cancels queued writes and refuses new ones', { timeout: 2000 }, async () => {
  const connection = fakeConnection({ push: (_n, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ outcome: 'uncertain' }))) });
  const { controller } = setup({ connection });
  const inFlight = controller.submit(display(controller, 1));
  const queued = controller.submit(display(controller, 2));
  await flush();
  const next = display(controller, 3);
  controller.close();
  assert.equal((await settle(inFlight)).outcome, 'uncertain');
  assert.equal((await settle(queued)).outcome, 'cancelled');
  assert.deepEqual(controller.submit(next), { decision: 'capacity', reserved: false });
  assert.equal(connection.state.pushes.length, 1);
  assert.equal(checkSnapshot(controller).controller.serviceHealth, 'unavailable');
});

test('refresh reads installation evidence without resubmitting, and stale evidence keeps aging', async () => {
  let readOk = true;
  const connection = fakeConnection({
    push: () => ({ outcome: 'failed', failure: 'transport-failure', priorEffects: 'none' }),
    read: () => (readOk ? { ok: true, present: true } : { ok: false, failure: 'transport-failure' }),
  });
  const { controller, clock } = setup({ connection });
  const failed = await settle(controller.submit(display(controller)));
  assert.deepEqual(failed.failure, { code: 'transport-failure' });
  assert.equal(checkSnapshot(controller).controller.serviceHealth, 'unavailable');
  const before = checkSnapshot(controller).controller;

  clock.now = 2000;
  await controller.refresh();
  let s = checkSnapshot(controller);
  assert.equal(s.controller.serviceHealth, 'ready');
  assert.deepEqual(s.display.installation, {
    status: 'known', present: true, clock: { domain: 'controller-monotonic', epoch: 'epoch-1', sampledAtMs: 2000 }, evidenceAgeMs: 0,
  });
  assert.deepEqual(s.controller.nextRequestId, before.nextRequestId);
  assert.deepEqual(s.controller.generation, before.generation);
  assert.equal(connection.state.pushes.length, 1);
  assert.deepEqual(s.controller.state.observation, { status: 'unknown' });
  assert.deepEqual(s.display.visible, { status: 'unknown' });

  clock.now = 5000;
  assert.equal(checkSnapshot(controller).display.installation.evidenceAgeMs, 3000);
  readOk = false;
  await controller.refresh();
  s = checkSnapshot(controller);
  assert.equal(s.controller.serviceHealth, 'unavailable');
  assert.equal(s.display.installation.evidenceAgeMs, 3000);
  assert.equal(s.display.installation.clock.sampledAtMs, 2000);
  assert.equal(connection.state.pushes.length, 1);
  assert.equal(connection.state.reads, 2);
});

test('invalid controller options are rejected', () => {
  const connection = fakeConnection();
  for (const extra of [{ controllerId: 'bad id' }, { deviceId: '' }, { maxPending: 0 }, { maxPending: 33 }, { epoch: 'x'.repeat(129) }, { label: 'x'.repeat(81) }]) {
    assert.throws(() => new TidbytController({ controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', connection, ...extra }));
  }
});

test('a stale in-flight result from the replaced connection does not re-apply holds or health', async () => {
  for (const stale of [
    { outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' },
    { outcome: 'failed', failure: 'capacity', priorEffects: 'none', retryAfterMs: 60000 },
  ]) {
    const hold = gate();
    const old = fakeConnection({ push: () => hold.promise });
    const { controller } = setup({ connection: old });
    const inFlight = controller.submit(display(controller, 1));
    await flush();
    const replacement = fakeConnection();
    controller.reconfigure(replacement);
    hold.open(stale);
    const receipt = await settle(inFlight);
    assert.deepEqual(receipt.failure, { code: stale.failure }, 'the stale write keeps its own receipt');
    const s = checkSnapshot(controller);
    assert.deepEqual(s.display.holds, { authentication: false, rateLimitRemainingMs: 0 }, stale.failure);
    assert.equal(s.controller.serviceHealth, 'unknown');
    assert.equal((await settle(controller.submit(display(controller, 2)))).outcome, 'sent', stale.failure);
    assert.equal(replacement.state.pushes.length, 1);
  }
});

test('a successful read does not report ready while the authentication hold blocks writes', async () => {
  const connection = fakeConnection({ push: () => ({ outcome: 'failed', failure: 'forbidden', priorEffects: 'none' }) });
  const { controller } = setup({ connection });
  await controller.submit(display(controller)).done;
  await controller.refresh();
  const s = checkSnapshot(controller);
  assert.equal(s.display.holds.authentication, true);
  assert.equal(s.controller.serviceHealth, 'unavailable');
  assert.equal(s.display.installation.status, 'known');
  const held = await settle(controller.submit(display(controller)));
  assert.deepEqual(held.failure, { code: 'forbidden' }, 'a forbidden hold keeps its own code');
  assert.equal(connection.state.pushes.length, 1);
});
