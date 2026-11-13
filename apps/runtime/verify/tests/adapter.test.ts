// Hub #920: the run adapter's disconnect keeps the catalog's Harness contract. The runtime's edge ends the part's stream,
// and the same remote part reconnects; its timers wait for the next wait, as the in-memory harness's wait for virtual
// time to move, so the part stays away however long the steps in between take.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {test} from 'node:test';
import {act, answered, expect, runScenario, scenario, type Harness} from '../../tests/scenarios/catalog.js';
import {LAMP_SCHEMA, switchLamp} from '../../tests/fixtures/lamp.js';
import {observation, sessionStarted} from '../../tests/fixtures/agents.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, SdkError, prepareMessage, publishOnce, type Draft} from '@jimmie-potts/sdk';
import {REAL_WORK_WITHIN_MS, RESYNC_WITHIN_MS, RunFailure, connectRun, failureOf, readGrants} from '../adapter.js';
import {scenarioProof} from '../plugin.js';
import {HEALTH_PATH} from '../../src/index.js';
import {Reader, actionCall, follow, sourceOf} from '../../tests/scenarios/parts.js';
import {manualClock} from '../../tests/scenarios/virtual-time.js';
import {base, startRun} from './support.js';

void test('a dropped part stays away until the next wait, then the same part reconnects and resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const reader = h.sdk('reader');
  assert.equal(h.reader.syncs('session'), 1);

  await h.disconnect('reader');
  await sleep(500);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session')], [0, 1], 'it is still away after real time passed');
  for (let waited = 0; h.reader.syncs('session') < 2 && waited < 50; waited += 1) await h.wait(100);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], [1, 2, 2], 'it reconnected and synced each copy again');
  assert.equal(h.sdk('reader'), reader, 'the same remote part');
  assert.deepEqual(h.problems(), []);
});

// Hub #1711: on virtual time a wait passes in a few milliseconds, so a dropped reader whose stream is back may still be
// resyncing a copy, which is real I/O, when the wait ends. The reader's resync of its lamp copy is held by a gate the
// test opens only after many turns of the event loop: a wait that ended at the stream's return reads the copy unsynced.
void test('a wait after a dropped reader is back ends only once each of its copies has synced again', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  let open: () => void = () => {};
  const gate = new Promise<void>(resolve => { open = resolve; });
  const real = globalThis.fetch;
  let armed = false;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const source = (init?.headers as Record<string, string> | undefined)?.['bunny-source'];
    if (armed && init?.method === 'POST' && source === sourceOf('reader') && url.endsWith('/sync') && typeof init.body === 'string' && init.body.includes('lamp')) await gate;
    return real(input, init);
  };
  context.after(() => { globalThis.fetch = real; });
  await h.disconnect('reader');
  armed = true;
  // Opens the gate a thousand turns after the session copy has synced again; no timer, no sleep.
  void (async () => {
    for (let turn = 0; h.reader.syncs('session') < 2 && turn < 1_000_000; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
    for (let turn = 0; turn < 1000; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
    open();
  })();
  for (let waited = 0; h.reader.syncs('session') < 2 && waited < 50; waited += 1) await h.wait(100);
  open();
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], [1, 2, 2], 'the wait ended with each copy synced again');
  assert.deepEqual(h.problems(), []);
});

/** A request's URL and the source header a remote part sends, as the test process's `fetch` sees them. */
function requestOf(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): {url: string; source: string | undefined; method: string; body: RequestInit['body']} {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return {url, source: (init?.headers as Record<string, string> | undefined)?.['bunny-source'], method: init?.method ?? 'GET', body: init?.body};
}

/** A promise the test opens itself, never on a timer. */
function gate(): {opened: Promise<void>; open: () => void} {
  let open: () => void = () => {};
  const opened = new Promise<void>(resolve => { open = resolve; });
  return {opened, open};
}

/** `count` turns of the event loop: no timer and no sleep. */
async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
}

/**
 * Wraps the test process's `fetch` until the test ends: `around` sees each request first and may hold it, and `after`
 * sees each answer. The remote parts and the adapter call the global `fetch`, so this reaches both.
 */
function intercept(context: {after: (fn: () => void) => void}, around: (request: ReturnType<typeof requestOf>) => Promise<void> | void,
  after: (request: ReturnType<typeof requestOf>, response: Response) => Response | Promise<Response> = (_request, response) => response): void {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = requestOf(input, init);
    await around(request);
    return after(request, await real(input, init));
  };
  context.after(() => { globalThis.fetch = real; });
}

/**
 * Turns of the event loop until the run's time has passed `bound` and then stood still for a thousand turns, which an
 * expectation in overtime gives it, or `stop()` says so.
 */
async function untilStill(h: Harness, bound: number, stop: () => boolean): Promise<void> {
  for (let last = h.now(), still = 0; !stop() && still < 1000;) {
    await turns(1);
    still = h.now() >= bound && h.now() === last ? still + 1 : 0;
    last = h.now();
  }
}

// Hub #1711: live delivery to the reader's stream is real I/O. Once a wait's last refresh has seen what the run
// published, a wait on virtual time could end in a few turns while that delivery is still on its way. The reader's
// stream is held by a gate the test opens a thousand turns after the wait's last refresh answered.
void test('on virtual time a wait ends only once what the run published has reached the reader', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const held = gate();
  let armed = false, refreshed = 0;
  intercept(context, () => {}, (request, response) => {
    if (request.url.includes('/api/harness/v1/state')) refreshed += 1;
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (armed) await held.opened;
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  armed = true;
  assert.equal(await h.dispatch('operator', 'gated', switchLamp('lamp-1', 'on'), 'req-gated'), 'accepted');
  const published = h.published().filter(({message}) => message.kind === 'occurrence' || message.kind === 'outcome').map(({message}) => message.id);
  assert.ok(published.length > 0, 'the switch published an occurrence or an outcome');
  const before = refreshed;
  let ended = false;
  const waited = h.wait(10).finally(() => { ended = true; });
  // Opens the gate a thousand turns after the wait's refresh answered; no timer, no sleep.
  void (async () => {
    while (refreshed === before && !ended) await turns(1);
    await turns(1000);
    held.open();
  })();
  await waited;
  held.open();
  const heard = new Set(h.reader.heard().map(({id}) => id));
  assert.deepEqual(published.filter(id => !heard.has(id)), [], 'the wait ended with everything published heard');
  assert.equal(copiedPower(h), 'on', 'and the reader\'s copy of the lamp shows it on');
  assert.deepEqual(h.problems(), []);
});


void test('reader delivery matches occurrence source and ID', () => {
  const reader = new Reader([]);
  const event = prepareMessage(sourceOf('hook'), observation(sessionStarted, 0).draft);
  reader.messages.push(event);
  assert.deepEqual(reader.undelivered([event]), []);
  assert.equal(reader.undelivered([{...event, source: 'bunny/core'}]).length, 1);
});

void test('reader delivery uses applied tombstones and snapshots', async () => {
  const bus = new InProcessBus();
  const owner = bus.connect('bunny/modules/lamp');
  const participant = bus.connect(sourceOf('reader'));
  await owner.serveSync(['lamp'], () => ({revision: 5, states: []}));
  const reader = new Reader([['lamp']]);
  await follow(participant, reader, [['lamp']], {check: () => {}, problem: assert.fail});
  const removal: Draft<Record<string, unknown>> = {
    kind: 'removal', type: 'org.bunny.lamp.removed', subject: 'lamp-1', dataschema: 'https://bunny.invalid/events/removal/2.0',
    data: {entity: {family: 'lamp', id: 'lamp-1'}, revision: 8, reason: 'deleted'},
  };
  const state: Draft<Record<string, unknown>> = {
    kind: 'state', type: 'org.bunny.lamp.updated', subject: 'lamp-1', dataschema: LAMP_SCHEMA,
    data: {id: 'lamp-1', revision: 7, power: 'on'},
  };
  const missing = prepareMessage(owner.source, removal);
  assert.deepEqual(reader.undelivered([prepareMessage(owner.source, {...removal, data: {...removal.data, revision: 5}})]), []);
  const absent = reader.undelivered([missing]);
  await owner.publishMessage('bunny.state.lamp.lamp-1', missing);
  const stale = await owner.publish('bunny.state.lamp.lamp-1', state);
  await turns(1);
  assert.equal(reader.undelivered([missing, stale]).length, 0, 'the applied removal supersedes stale state');
  assert.equal(absent.length, 1, 'plain absence does not cover a pending removal');
  await participant.close();
  await owner.close();
});

void test('the first refresh after reader reconnect waits for live frames and excludes the gap', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const source = sourceOf('hook'), token = (await readGrants(run.dataDir)).get(source);
  assert.ok(token !== undefined && token !== '');
  const held = gate(), published = gate();
  let h: Awaited<ReturnType<typeof connectRun>> | undefined, liveId: string | undefined;
  const publish = async (live = false): Promise<string> => {
    const now = h?.now() ?? 0;
    const {key, draft} = observation(sessionStarted, now);
    const message = prepareMessage(source, draft, {now: () => now});
    if (live) liveId = message.id;
    assert.equal((await publishOnce({url: run.url, source, token, timeoutMs: 1000}, key, message)).status, 'published');
    return message.id;
  };
  intercept(context, async request => {
    if (request.url.includes('/api/harness/v1/state') && liveId === undefined && (h?.reader.gaps() ?? 0) > 0) {
      await publish(true);
      published.open();
    }
  }, (request, response) => {
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (liveId !== undefined && new TextDecoder().decode(chunk).includes(liveId)) await held.opened;
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h?.close());
  await h.disconnect('reader');
  const lost = await publish();
  let finished = false;
  const waiting = (async () => {
    for (let attempt = 0; attempt < 50 && liveId === undefined; attempt += 1) await h?.wait(100);
  })().finally(() => { finished = true; });
  try {
    await Promise.race([published.opened, waiting]);
    const id = liveId;
    assert.ok(id !== undefined && id !== '');
    const reader = h.reader;
    while (!finished && !h.published().some(({message}) => message.id === id)) await turns(1);
    await turns(1000);
    const finishedBeforeFrame = finished;
    held.open();
    await waiting;
    assert.equal(finishedBeforeFrame, false, 'the first refresh did not skip the held live frame');
    assert.ok(reader.heard().some(message => message.id === id));
    assert.ok(h.published().some(({message}) => message.id === lost));
    assert.ok(!reader.heard().some(message => message.id === lost));
  } finally {
    held.open();
    await waiting.catch(() => {});
  }
});

void test('overtime rechecks an action that settles during its first advance', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const held = gate(), dispatched = gate();
  let action: Promise<string> | undefined, advances = 0, checks = 0;
  intercept(context, async request => {
    if (request.url.endsWith('/clock/advance') && request.body === '{"ms":0}' && ++advances === 2) {
      held.open();
      await action;
    }
  }, async (request, response) => {
    if (!request.url.includes('/api/v2/commands/')) return response;
    const text = await response.text();
    dispatched.open();
    await held.opened;
    return new Response(text, {status: response.status, headers: response.headers});
  });
  try {
    const result = await runScenario({id: 'quick-overtime', title: 'quick overtime', seed, steps: [
      act('the command awaits the answer', async h => {
        action = h.dispatch('operator', 'none', switchLamp('lamp-1', 'on'), 'req-none');
        await dispatched.opened;
      }),
      expect('the command answer was unavailable', h => {
        checks += 1;
        return answered(h, 'none', 'unavailable');
      }, 0),
    ]}, h);
    assert.equal(h.answer('none'), 'unavailable');
    assert.equal(result.outcome, 'passed', JSON.stringify(result.steps));
    assert.equal(checks, 2);
  } finally {
    held.open();
  }
});

void test('overtime remembers an independent answer that settles inside the bound check', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const held = gate(), dispatched = gate();
  let action: Promise<string> | undefined, checks = 0;
  intercept(context, () => {}, async (request, response) => {
    if (!request.url.includes('/api/v2/commands/')) return response;
    dispatched.open();
    await held.opened;
    return response;
  });
  try {
    const result = await runScenario({id: 'check-with-pending-answer', title: 'check with pending answer', seed, steps: [
      act('the command awaits the answer', async h => {
        action = h.dispatch('operator', 'none', switchLamp('lamp-1', 'on'), 'req-none');
        await dispatched.opened;
      }),
      expect('the command answer was unavailable', async h => {
        checks += 1;
        const outcome = answered(h, 'none', 'unavailable');
        held.open();
        await action;
        return outcome;
      }, 0),
    ]}, h);
    assert.equal(result.outcome, 'passed', JSON.stringify(result.steps));
    assert.equal(checks, 2);
  } finally {
    held.open();
  }
});

void test('overtime waits for live delivery after an independent action answers', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const reply = gate(), dispatched = gate(), frame = gate();
  let armed = false, advances = 0, checks = 0;
  let action: Promise<string> | undefined;
  intercept(context, async request => {
    if (armed && request.url.endsWith('/clock/advance') && ++advances === 2) {
      reply.open();
      await action;
    }
  }, async (request, response) => {
    if (request.url.endsWith('/stream') && request.source === sourceOf('reader') && response.body !== null) {
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        async transform(chunk, controller) {
          if (armed) await frame.opened;
          controller.enqueue(chunk);
        },
      }));
      return new Response(body, {status: response.status, headers: response.headers});
    }
    if (!armed || !request.url.includes('/api/v2/commands/')) return response;
    dispatched.open();
    await reply.opened;
    return response;
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  armed = true;
  const result = runScenario({id: 'action-delivery', title: 'action delivery', seed, steps: [
    act('the command waits for its reply', async h => {
      action = h.dispatch('operator', 'held', switchLamp('lamp-1', 'on'), 'req-held');
      await dispatched.opened;
    }),
    expect('the reader saw the resulting state', h => {
      checks += 1;
      return copiedPower(h) === 'on' || 'the reader still sees the lamp off';
    }, 0),
  ]}, h);
  try {
    await Promise.race([reply.opened, result]);
    assert.equal(await action, 'accepted');
    await turns(1000);
    assert.equal(checks, 1, 'the reply alone did not permit another check');
    frame.open();
    assert.equal((await result).outcome, 'passed');
    assert.equal(checks, 2);
  } finally {
    reply.open();
    frame.open();
    await result;
  }
});

void test('a prior predicate action is not an independent obligation for a third check', {timeout: 30_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const previous = gate(), predicate = gate(), previousStarted = gate(), predicateStarted = gate();
  intercept(context, () => {}, async (request, response) => {
    if (typeof request.body !== 'string') return response;
    if (request.body.includes('req-independent-first')) {
      previousStarted.open();
      await previous.opened;
    } else if (request.body.includes('req-from-predicate')) {
      predicateStarted.open();
      await predicate.opened;
    }
    return response;
  });
  let checks = 0;
  let preexisting: Promise<string> | undefined;
  let own: Promise<string> | undefined;
  try {
    const result = await runScenario({id: 'predicate-provenance', title: 'predicate provenance', seed, steps: [
      act('the independent action starts', async h => {
        preexisting = h.dispatch('operator', 'independent', switchLamp('lamp-1', 'on'), 'req-independent-first');
        await previousStarted.opened;
      }),
      expect('the check stays failed', async h => {
        checks += 1;
        if (checks === 1) {
          own = h.dispatch('operator', 'predicate', switchLamp('lamp-1', 'on'), 'req-from-predicate');
          await predicateStarted.opened;
          previous.open();
          assert.equal(await preexisting, 'unavailable');
        } else if (checks === 2) {
          predicate.open();
          assert.equal(await own, 'unavailable');
        }
        return 'the original failed check';
      }, 0),
    ]}, h);
    assert.equal(result.steps[1]?.detail, 'the original failed check');
    assert.equal(checks, 2, 'only the independent answer can authorize one recheck');
  } finally {
    previous.open();
    predicate.open();
  }
});

void test('a predicate-owned frame cannot block a different completed read', {timeout: 30_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const clock = manualClock(0), waiting = gate();
  const realWorkClock = {now: clock.now, scheduler: {after: (delay: number, callback: () => void) => {
    if (delay === 25) waiting.open();
    return clock.scheduler.after(delay, callback);
  }}};
  const read = gate(), readStarted = gate(), frame = gate(), frameStarted = gate();
  let armed = false;
  intercept(context, () => {}, async (request, response) => {
    if (armed && request.url.endsWith(HEALTH_PATH)) {
      readStarted.open();
      await read.opened;
    }
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const decoder = new TextDecoder();
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (armed && decoder.decode(chunk).includes('org.bunny.lifecycle.observed')) {
          frameStarted.open();
          await frame.opened;
        }
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, realWorkClock});
  context.after(() => h.close());
  let checks = 0, independent: ReturnType<typeof h.gateway> | undefined;
  let second: ReturnType<typeof runScenario> | undefined;
  try {
    armed = true;
    second = runScenario({id: 'predicate-delivery', title: 'predicate delivery', seed, steps: [
      act('the independent health read awaits an answer', async h => {
        independent = h.gateway({as: 'anonymous', method: 'GET', path: HEALTH_PATH});
        await readStarted.opened;
      }),
      expect('the second check observes the independent answer', async h => {
        checks += 1;
        if (checks === 2) return true;
        const {key, draft} = observation(sessionStarted, h.now());
        await h.sdk('hook').publish(key, draft);
        await frameStarted.opened;
        read.open();
        assert.equal((await independent)?.status, 200);
        return 'the first check observed the health read pending';
      }, 0),
    ]}, h);
    await Promise.race([second, waiting.opened]);
    clock.advance(REAL_WORK_WITHIN_MS);
    const result = await second;
    assert.equal(result.outcome, 'passed', JSON.stringify(result));
    assert.equal(checks, 2);
    assert.equal(h.reader.heard().filter(message => message.type === 'org.bunny.lifecycle.observed').length, 0,
      'the independent check passed while the unrelated frame was still held');
  } finally {
    read.open();
    frame.open();
    await second;
  }
});

void test('a later duplicate preserves the captured trace of the original action', {timeout: 30_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const heldFrame = gate();
  let armed = false;
  intercept(context, () => {}, (request, response) => {
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (armed) await heldFrame.opened;
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const clock = manualClock(0), awaitingDelivery = gate();
  const scheduler = {after: (delay: number, callback: () => void) => {
    if (delay === 25) awaitingDelivery.open();
    return clock.scheduler.after(delay, callback);
  }};
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, realWorkClock: {now: clock.now, scheduler}});
  context.after(() => h.close());
  let original: Promise<string> | undefined, checks = 0;
  const reachedBound = gate();
  armed = true;
  const result = runScenario({id: 'duplicate-admission', title: 'duplicate admission', seed, steps: [
    act('an original named action waits for the reply', async h => {
      h.simulate({device: 'lamp', action: 'hold'});
      original = h.dispatch('operator', 'original', switchLamp('lamp-1', 'on'), 'req-shared');
      for (let i = 0; h.devices().lamp.calls.length === 0 && i < 100; i++) {
        await h.gateway({as: 'anonymous', method: 'GET', path: HEALTH_PATH});
      }
      assert.equal(h.devices().lamp.calls.length, 1, 'the original reached the simulated device');
      assert.equal(h.answer('original'), 'pending');
    }),
    expect('the reader saw the original action\'s state', async h => {
      checks += 1;
      if (checks === 1) {
        const records = h.logs().filter(({record}) => record.event_name.endsWith('command.queued')
          && record.attributes['bunny.request.id'] === 'req-shared');
        assert.equal(new Set(records.map(({record}) => record.trace_id).filter(trace => trace !== undefined)).size, 1,
          'the original trace was known before the duplicate started');
        assert.equal(await h.dispatch('operator', 'duplicate', switchLamp('lamp-1', 'on'), 'req-shared'), 'uncertain-result');
        h.simulate({device: 'lamp', action: 'release'});
        assert.equal(await original, 'accepted');
        reachedBound.open();
      }
      return copiedPower(h) === 'on' || 'the reader still sees the lamp off';
    }, 0),
  ]}, h);
  try {
    await Promise.race([reachedBound.opened, result]);
    await Promise.race([awaitingDelivery.opened, result]);
    const checksBeforeFrame = checks;
    heldFrame.open();
    const verdict = await result;
    assert.equal(checksBeforeFrame, 1, JSON.stringify(verdict));
    assert.equal(verdict.outcome, 'passed', JSON.stringify(verdict));
  } finally {
    heldFrame.open();
    await result;
  }
});

void test('a zero-width check retries once when the child was already busy', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  let advances = 0, checks = 0;
  intercept(context, () => {}, async (request, response) => {
    if (!request.url.endsWith('/clock/advance')) return response;
    assert.equal(request.body, '{"ms":0}');
    const state = await response.json() as object;
    advances += 1;
    return Response.json({...state, busy: advances === 1});
  });
  const result = await runScenario({id: 'child-busy', title: 'child busy', seed, steps: [
    expect('the child had one busy interval', () => {
      checks += 1;
      assert.equal(advances, checks);
      return 'the original failed check';
    }, 0),
  ]}, h);
  assert.equal(result.steps[0]?.detail, 'the original failed check');
  assert.deepEqual([checks, advances], [2, 2]);
});

void test('the first bound check shares the settle deadline', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const clock = manualClock(0);
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, realWorkClock: clock});
  context.after(() => h.close());
  const held = gate(), checking = gate(), finished = gate();
  let evaluations = 0, settled = false;
  intercept(context, request => {
    if (request.url.endsWith('/clock/advance')) clock.advance(REAL_WORK_WITHIN_MS - 1);
  });
  const result = runScenario({id: 'check-deadline', title: 'check deadline', seed, steps: [
    expect('the held predicate', async () => {
      evaluations += 1;
      checking.open();
      await held.opened;
      finished.open();
      throw new Error('late predicate rejection');
    }, 0),
  ]}, h).finally(() => { settled = true; });
  try {
    await Promise.race([checking.opened, result]);
    assert.equal(evaluations, 1);
    assert.equal(settled, false);
    clock.advance(1);
    await turns(2);
    assert.equal(settled, true, 'the same deadline expired while the predicate was held');
    assert.match((await result).steps[0]?.detail ?? '', /15000 ms.*expectation check/);
  } finally {
    held.open();
    if (evaluations > 0) await finished.opened;
    await result;
  }
});

void test('overtime counts a held advance against its real deadline', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const clock = manualClock(0);
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, realWorkClock: clock});
  context.after(() => h.close());
  const held = gate(), advancing = gate();
  intercept(context, async request => {
    if (!request.url.endsWith('/clock/advance')) return;
    advancing.open();
    await held.opened;
  });
  const started = h.now();
  const overtime = h.overtime?.();
  assert.ok(overtime);
  let detail: boolean | string | undefined;
  const checked = overtime.run(() => Promise.resolve('the check failed')).then(result => { detail = result; });
  try {
    await advancing.opened;
    clock.advance(REAL_WORK_WITHIN_MS);
    await turns(2);
    assert.equal(typeof detail, 'string', 'overtime expired while its advance was still held');
    assert.match(String(detail), /15000 ms.*advance/i);
    assert.equal(h.now(), started);
  } finally {
    held.open();
    await checked;
  }
});

void test('a long ordinary wait holds virtual time during reconnect resync', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const held = gate(), syncing = gate();
  let heldAt: number | undefined, advanced = false, opening = false;
  intercept(context, async request => {
    if (request.source === sourceOf('reader') && request.url.endsWith('/stream')) opening = true;
    if (request.source === sourceOf('reader') && request.url.endsWith('/sync')) {
      heldAt ??= h.now();
      syncing.open();
      await held.opened;
    }
    if (heldAt !== undefined && request.url.endsWith('/clock/advance')) advanced = true;
  }, async (request, response) => {
    if (opening && request.url.includes('/api/harness/v1/state')) await syncing.opened;
    return response;
  });
  await h.disconnect('reader');
  const started = h.now();
  const waiting = h.wait(8000);
  try {
    await Promise.race([syncing.opened, waiting]);
    assert.notEqual(heldAt, undefined, 'the reader began its resync');
    await turns(1000);
    assert.equal(h.now(), heldAt, 'virtual time was frozen while the resync was held');
    assert.equal(advanced, false, 'the wait did not advance the run during resync');
  } finally {
    held.open();
    await waiting;
  }
  assert.equal(h.now(), started + 8000);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], [1, 2, 2]);
  assert.deepEqual(h.problems(), []);
});

void test('a delivery timeout names every missing publication', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const held = gate(), ticking = gate();
  const clock = manualClock(0);
  const scheduler = {after: (delay: number, callback: () => void) => {
    ticking.open();
    return clock.scheduler.after(delay, callback);
  }};
  let armed = false;
  intercept(context, () => {}, (request, response) => {
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (armed) await held.opened;
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, realWorkClock: {now: clock.now, scheduler}});
  context.after(() => h.close());
  const before = h.published().length;
  armed = true;
  try {
    for (let i = 0; i < 7; i += 1) {
      const {key, draft} = observation(sessionStarted, h.now());
      await h.sdk('hook').publish(key, draft);
    }
    // Flush the journal without advancing the run, then control only the delivery wait's real timer.
    await h.gateway({as: 'anonymous', method: 'GET', path: HEALTH_PATH});
    const ids = h.published().slice(before).filter(({message}) => message.kind === 'occurrence' && message.source === sourceOf('hook')).map(({message}) => message.id);
    assert.equal(ids.length, 7);
    const wait = h.wait(0);
    const failed = assert.rejects(wait, (error: unknown) => {
      assert.ok(error instanceof RunFailure);
      for (const id of ids) assert.ok(error.message.includes(id), `missing diagnostic for ${id}`);
      return true;
    });
    try {
      await Promise.race([ticking.opened, wait]);
      clock.advance(REAL_WORK_WITHIN_MS);
      await failed;
    } finally {
      held.open();
      await failed.catch(() => {});
    }
  } finally {
    held.open();
  }
});

void test('a counted overflow does not waive a later live occurrence', {timeout: 45_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const source = sourceOf('hook');
  const token = (await readGrants(run.dataDir)).get(source);
  assert.ok(token !== undefined && token !== '');
  const held = gate();
  let overflowId: string | undefined, liveId: string | undefined;
  intercept(context, () => {}, (request, response) => {
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const text = new TextDecoder();
    const bytes = new TextEncoder();
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const frame = text.decode(chunk);
        if (liveId !== undefined && frame.includes(liveId)) await held.opened;
        if (overflowId !== undefined && frame.includes(overflowId)) {
          const subscription = /"subscription":"([^"]+)"/.exec(frame)?.[1];
          assert.ok(subscription !== undefined && subscription !== '');
          controller.enqueue(bytes.encode('event: overflow\ndata: ' + JSON.stringify({schema: 'sdk-remote/1.0', subscription, dropped: 1}) + '\n\n'));
        }
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const publish = async (assign: (id: string) => void) => {
    const {key, draft} = observation(sessionStarted, h.now());
    const message = prepareMessage(source, draft, {now: () => h.now()});
    assign(message.id);
    assert.equal((await publishOnce({url: run.url, source, token, timeoutMs: 1000}, key, message)).status, 'published');
  };
  try {
    const reader = h.reader;
    assert.ok(reader instanceof Reader);
    const notice = new Promise<void>(resolve => {
      const changed = reader.onChange;
      reader.onChange = () => {
        changed();
        if (reader.gaps() > 0) resolve();
      };
    });
    await publish(id => { overflowId = id; });
    await notice;
    assert.equal(reader.gaps(), 1, 'the counted overflow reached the reader first');
    await publish(id => { liveId = id; });
    await h.gateway({as: 'anonymous', method: 'GET', path: HEALTH_PATH});
    assert.ok(h.published().some(({message}) => message.id === liveId));
    let finished = false;
    const waiting = h.wait(0).finally(() => { finished = true; });
    await turns(1000);
    const finishedBeforeFrame = finished;
    held.open();
    await waiting;
    assert.equal(finishedBeforeFrame, false, 'a known live publication after the overflow is still required');
  } finally {
    held.open();
  }
});

void test('a completed gateway read cannot trigger overtime through its refusal log', {timeout: 60_000}, async context => {
  const seed = scenario('zero-modules')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'zero-modules');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  let checks = 0, requests = 0;
  intercept(context, request => { if (request.url.endsWith('/unknown-route')) requests += 1; });

  const result = await runScenario({id: 'no-overtime', title: 'no overtime', seed, steps: [
    expect('the completed read still fails the check', async h => {
      checks += 1;
      const response = await h.gateway({as: 'anonymous', method: 'GET', path: '/unknown-route'});
      assert.equal(response.status, 404);
      return 'the original failed check';
    }, 0),
  ]}, h);
  assert.ok(h.logs().some(({record}) => record.event_name === 'runtime.edge.refused'));
  assert.equal(result.steps[0]?.detail, 'the original failed check');
  assert.deepEqual([checks, requests], [1, 1]);
});

void test('a completed check command cannot trigger another command from its own logs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  let checks = 0, requests = 0, advances = 0;
  const command = actionCall('operator', switchLamp('lamp-1', 'on'), 'req-check-command');
  intercept(context, request => {
    if (request.method === 'POST' && request.url.endsWith(command.path)) requests += 1;
  }, async (request, response) => {
    if (!request.url.endsWith('/clock/advance')) return response;
    const state = await response.json() as object;
    advances += 1;
    // If a probe followed the command, the fixture would report work the check started.
    return Response.json({...state, busy: requests > 0});
  });

  const result = await runScenario({id: 'effectful-check', title: 'effectful check', seed, steps: [
    expect('the completed command still fails the check', async h => {
      checks += 1;
      assert.equal((await h.gateway(command)).status, 200);
      return 'the original failed check';
    }, 0),
  ]}, h);
  assert.ok(h.logs().some(({record}) => record.event_name === 'runtime.command.replied'));
  assert.equal(result.steps[0]?.detail, 'the original failed check');
  assert.deepEqual([checks, requests, advances], [1, 1, 1]);
});

void test('resync refreshes delivery eligibility when the preceding state response is stale', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const source = sourceOf('hook'), token = (await readGrants(run.dataDir)).get(source);
  assert.ok(token !== undefined && token !== '');
  const subscribe = gate(), staleState = gate(), live = gate(), releaseFrame = gate();
  let armed = false, captured = false, reconnecting = false, liveId: string | undefined;
  intercept(context, async request => {
    if (!armed || request.source !== sourceOf('reader')) return;
    if (request.url.endsWith('/stream')) {
      reconnecting = true;
      await subscribe.opened;
    }
  }, async (request, response) => {
    if (reconnecting && !captured && request.url.includes('/api/harness/v1/state')) {
      captured = true;
      subscribe.open();
      await staleState.opened;
    }
    if (!request.url.endsWith('/stream') || request.source !== sourceOf('reader') || response.body === null) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (liveId !== undefined && new TextDecoder().decode(chunk).includes(liveId)) {
          live.open();
          await releaseFrame.opened;
        }
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const reader = h.reader;
  assert.ok(reader instanceof Reader);
  const synced = gate();
  const change = reader.onChange;
  reader.onChange = () => {
    change();
    if (reader.syncs('session') > 1 && reader.syncs('lamp') > 1) synced.open();
  };
  await h.disconnect('reader');
  armed = true;
  let finished = false;
  const waiting = (async () => {
    for (let attempt = 0; !captured && attempt < 10; attempt += 1) await h.wait(50);
  })().finally(() => { finished = true; });
  const stop = gate();
  context.signal.addEventListener('abort', stop.open, {once: true});
  try {
    await Promise.race([synced.opened, waiting, stop.opened]);
    assert.equal(context.signal.aborted, false);
    assert.equal(captured, true, 'a state response preceded re-registration');
    const {key, draft} = observation(sessionStarted, h.now());
    const message = prepareMessage(source, draft, {now: () => h.now()});
    liveId = message.id;
    assert.equal((await publishOnce({url: run.url, source, token, timeoutMs: 1000}, key, message)).status, 'published');
    await Promise.race([live.opened, stop.opened]);
    assert.equal(context.signal.aborted, false);
    staleState.open();
    while (!finished && !h.published().some(({message}) => message.id === liveId)) await turns(1);
    await turns(1000);
    const finishedBeforeFrame = finished;
    releaseFrame.open();
    await waiting;
    assert.equal(finishedBeforeFrame, false, 'resync did not let a stale state response waive live delivery');
    assert.ok(reader.heard().some(message => message.id === liveId));
  } finally {
    subscribe.open();
    staleState.open();
    releaseFrame.open();
    await waiting.catch(() => {});
  }
});

const copiedPower = (h: Harness): unknown => h.reader.states<{id: string; power: unknown}>('lamp').find(state => state.data.id === 'lamp-1')?.data.power;

// Hub #1711: an expectation's bound is counted in the run's time, which a wait on virtual time moves while a part's
// reconnect, real I/O, is still on its way. The reader's reopened stream is held by a gate the test opens once the run's
// time has passed the bound and stood still: the expectation then waits in overtime instead of failing.
void test('on virtual time an expectation past its bound waits while a dropped reader is still reconnecting', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const held = gate();
  let armed = false;
  intercept(context, async request => {
    if (armed && request.url.endsWith('/stream') && request.source === sourceOf('reader')) await held.opened;
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  await h.disconnect('reader');
  armed = true;
  const started = h.now();
  let done = false;
  const result = runScenario({id: 'overtime-reconnect', title: 'overtime', seed, steps: [
    expect('the reader is back and synced each copy again', h => (h.reader.syncs('session') === 2 && h.reader.syncs('lamp') === 2) || 'not yet', 200),
  ]}, h).finally(() => { done = true; });
  await untilStill(h, started + 200, () => done);
  held.open();
  const {outcome, steps} = await result;
  assert.equal(outcome, 'passed', JSON.stringify(steps));
  assert.ok(h.now() - started < 1000, 'the run\'s time stood still past the bound');
  assert.deepEqual(h.problems(), []);
});

// Hub #1711: the same for a call in flight: an action's answer is real I/O, which the run's time does not bound. The
// answer is held by a gate the test opens once the run's time has passed the expectation's bound and stood still.
void test('on virtual time an expectation past its bound waits while an action\'s answer is still on its way', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const held = gate();
  let armed = false;
  intercept(context, () => {}, (request, response) => {
    if (!armed || request.method !== 'POST' || !request.url.includes('/api/v2/commands/')) return response;
    const late = response.text().then(async text => { await held.opened; return text; });
    return new Response(new ReadableStream<Uint8Array>({async start(controller) {
      controller.enqueue(new TextEncoder().encode(await late));
      controller.close();
    }}), {status: response.status, headers: response.headers});
  });
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  armed = true;
  const started = h.now();
  let done = false;
  const result = runScenario({id: 'overtime-answer', title: 'overtime', seed, steps: [
    act('the operator switches lamp-1 on', h => { void h.dispatch('operator', 'held', switchLamp('lamp-1', 'on'), 'req-held-answer'); }),
    expect('its answer is accepted', h => answered(h, 'held', 'accepted'), 200),
  ]}, h).finally(() => { done = true; });
  await untilStill(h, started + 200, () => done);
  held.open();
  const {outcome, steps} = await result;
  assert.equal(outcome, 'passed', JSON.stringify(steps));
  assert.ok(h.now() - started < 1000, 'the run\'s time stood still past the bound');
  assert.deepEqual(h.problems(), []);
});

/**
 * Makes the reader's calls to the edge (`subscribe` or `sync`) take `slow` first, while the returned `armed` flag is set,
 * and puts back the real `fetch` when the test ends. The remote client calls the global `fetch`, so this holds back
 * exactly the reader's re-registration and resync after a restart, and nothing of the adapter's own.
 */
function readerCalls(context: {after: (fn: () => void) => void}, call: 'subscribe' | 'sync', slow: () => Promise<void>): {armed: boolean} {
  const real = globalThis.fetch, state = {armed: false};
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const source = (init?.headers as Record<string, string> | undefined)?.['bunny-source'];
    if (state.armed && init?.method === 'POST' && source === sourceOf('reader') && url.endsWith(`/${call}`)) await slow();
    return real(input, init);
  };
  context.after(() => { globalThis.fetch = real; });
  return state;
}

// Hub #1697: a restart resolves only once the reader is back in sync with the new runtime, so the next step, such as a
// second restart, never stops the runtime while the reader is still coming back.
void test('a restart resolves only once the reader has resynced with the new runtime', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  // Its subject is real elapsed time, so its run stays on the real clock (Hub #1711).
  const run = await startRun(context, await base(context), 'reconnect-and-sync', {testOnlyRealClock: true});
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const before = [h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')];
  const slowed = readerCalls(context, 'subscribe', () => sleep(500));
  slowed.armed = true;
  const started = Date.now();
  await h.restart();
  slowed.armed = false;
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], before.map(count => count + 1),
    'the reader heard of the gap and synced each copy again before the restart resolved');
  assert.ok(Date.now() - started >= 500, 'the restart waited for the reader\'s slowed re-registration');
  assert.equal(h.generation(), 2);
  assert.deepEqual(h.problems(), []);
});

// Hub #1711: on virtual time the run advances while the reader comes back, so its bound passes in a few seconds of real
// time, while the reader's re-registration is real I/O. The wait also needs the bound in real time before it fails. The
// re-registration is held by a gate the test opens once the run's time has passed the bound and stopped moving.
void test('on virtual time a restart waits for a reader held past the bound of the run\'s time, and resolves once it is back', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  const before = [h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')];
  let open: () => void = () => {};
  const gate = new Promise<void>(resolve => { open = resolve; });
  const held = readerCalls(context, 'subscribe', () => gate);
  held.armed = true;
  const started = h.now();
  let settled = false;
  const restarted = h.restart().finally(() => { settled = true; });
  restarted.catch(() => {});
  // Until the restart has failed, or the run's time has passed the bound and stopped moving: polls, no sleep.
  for (let last = h.now(); !settled;) {
    for (let turn = 0; turn < 200; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
    if (h.now() >= started + RESYNC_WITHIN_MS && h.now() === last) break;
    last = h.now();
  }
  held.armed = false;
  open();
  await restarted;
  assert.ok(h.now() >= started + RESYNC_WITHIN_MS, 'the run\'s time passed the bound while the reader was held');
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], before.map(count => count + 1),
    'the reader heard of the gap and synced each copy again before the restart resolved');
  assert.equal(h.generation(), 2);
  assert.deepEqual(h.problems(), []);
});

// Hub #1711: once a restarted reader's stream is back, its resync is real I/O whose deadline (5 s) runs on the parts'
// clock. The run's time stands still while the resync is on its way, so the deadline cannot pass under it. The resync is
// held by a gate the test opens once the run's time has stood still for two thousand turns, or has run on by more than
// that deadline.
void test('on virtual time a restart holds the run\'s time while the returned reader resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  assert.equal(h.clock, 'virtual');
  const before = [h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')];
  const held = gate();
  let heldAt: number | undefined, advances = 0, armed = true;
  intercept(context, async request => {
    if (heldAt !== undefined && request.url.endsWith('/clock/advance')) advances += 1;
    if (armed && request.method === 'POST' && request.source === sourceOf('reader') && request.url.endsWith('/sync')) {
      heldAt ??= h.now();
      await held.opened;
    }
  });
  let settled = false;
  const restarted = h.restart().finally(() => { settled = true; });
  restarted.catch(() => {});
  void (async () => {
    while (heldAt === undefined && !settled) await turns(1);
    for (let quiet = 0, seen = advances; !settled && quiet < 2000 && h.now() < (heldAt ?? 0) + 6000; seen = advances) {
      await turns(1);
      quiet = advances === seen ? quiet + 1 : 0;
    }
    held.open();
  })();
  await restarted;
  armed = false;
  held.open();
  assert.equal(advances, 0, 'the run\'s time did not move while the resync was held');
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], before.map(count => count + 1));
  assert.deepEqual(h.problems(), []);
});

// The bound is above the reader's longest reconnect backoff (5 s), so its stream is back before the bound however long the
// restart took, and only the refused copies are named: the message stays exact on a slow host too.
const NEVER_RESYNCS_WITHIN_MS = 8000;

void test('a restart fails within its bound, naming what did not come back, when the reader never resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  // Its subject is real elapsed time, so its run stays on the real clock (Hub #1711).
  const run = await startRun(context, await base(context), 'reconnect-and-sync', {testOnlyRealClock: true});
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, resyncWithinMs: NEVER_RESYNCS_WITHIN_MS});
  context.after(() => h.close());
  // Each resync is refused at the connection, as when the runtime is gone, so each copy stops for good.
  const refused = readerCalls(context, 'sync', () => Promise.reject(new TypeError('fetch failed')));
  refused.armed = true;
  const started = Date.now();
  await assert.rejects(h.restart(), (error: unknown) => {
    assert.ok(error instanceof RunFailure);
    assert.equal(error.message, `the reader did not resync within ${NEVER_RESYNCS_WITHIN_MS} ms of the restart: its copy of session,inbox-item did not sync again; its copy of lamp did not sync again`);
    return true;
  });
  const elapsed = Date.now() - started;
  // The upper limit only catches a wait that never ends: it leaves room for the restart itself, however slow the host.
  assert.ok(elapsed >= NEVER_RESYNCS_WITHIN_MS && elapsed < NEVER_RESYNCS_WITHIN_MS + 20_000, `the restart gave up at its bound, after ${elapsed} ms`);
  assert.equal(h.reader.gaps(), 1, 'the stream came back');
  assert.deepEqual(h.problems().filter(problem => problem.includes('stopped')), [
    'the reader\'s copy of session,inbox-item stopped: unavailable', 'the reader\'s copy of lamp stopped: unavailable',
  ], 'the stopped copies are still reported as problems');
});

// What the reader still lacks after a restart: its stream (its subscription's gap notice) and each copy's sync again,
// each needed on its own, and the stream also for a reader that keeps no copy (Hub #1697).
void test('a reader is behind until its stream is back and every copy has synced again', () => {
  const reader = new Reader([['session', 'inbox-item'], ['lamp']]);
  reader.counts[0] = 1;
  reader.counts[1] = 1;
  const mark = reader.mark();
  assert.deepEqual(reader.behind(mark), ['its stream did not come back', 'its copy of session,inbox-item did not sync again', 'its copy of lamp did not sync again']);
  reader.counts[0] = 2;
  reader.counts[1] = 2;
  assert.deepEqual(reader.behind(mark), ['its stream did not come back'], 'copies that synced again without a gap notice are not enough');
  reader.gapNotices = 1;
  reader.counts[1] = 1;
  assert.deepEqual(reader.behind(mark), ['its copy of lamp did not sync again'], 'a gap notice without every copy is not enough');
  reader.counts[1] = 2;
  assert.deepEqual(reader.behind(mark), []);
  const bare = new Reader([]), bareMark = bare.mark();
  assert.deepEqual(bare.behind(bareMark), ['its stream did not come back'], 'a reader with no copy still waits for its stream');
  bare.gapNotices = 1;
  assert.deepEqual(bare.behind(bareMark), []);
});

// What the adapter reports goes into a capture's proof, so it names a failure by its own fixed text, a refusal's registry
// code or the exception's type, never by an exception's message (ADR 0012, "Safe errors"; Hub #954).
void test('the adapter names a failure by its own text, a refusal\'s registry code or the exception\'s type, never an exception\'s message', () => {
  const secret = 'tok_SYNTHETIC954';
  assert.equal(failureOf(new RunFailure('state answered 503')), 'state answered 503');
  assert.equal(failureOf(new SdkError(errorBody('unavailable', {detail: `no owner for ${secret}`}))), 'SdkError unavailable');
  assert.equal(failureOf(new TypeError(`fetch failed for ${secret}`)), 'TypeError');
  assert.equal(failureOf(secret), 'string');
});

// What a scenario's capture step keeps: the result it attaches and the reason its expectation gives (Hub #954).
void test('a scenario\'s proof and its failed expectation never quote an exception a step or a part threw', async () => {
  const secret = 'tok_SYNTHETIC954';
  const h = {tier: 'run', transport: 'remote', wait: () => Promise.resolve()} as unknown as Harness;
  const result = await runScenario({id: 'control-proof', title: 'negative control', seed: {modules: [], follows: []}, steps: [
    act('read a body that is not JSON', () => { JSON.parse(secret); }),
  ]}, h);
  const proof = scenarioProof(result, 'real', [`bunny/parts/reader on stream: ${failureOf(new TypeError(`fetch failed for ${secret}`))}`]);
  assert.equal(proof.failure, 'read a body that is not JSON: threw SyntaxError');
  assert.match(proof.attachment, /"detail": "threw SyntaxError"/);
  assert.match(proof.attachment, /bunny\/parts\/reader on stream: TypeError/);
  assert.equal(`${proof.attachment}${proof.failure ?? ''}`.includes(secret), false, 'neither the attachment nor the expectation quotes the exception');
});
