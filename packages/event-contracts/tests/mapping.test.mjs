// The 1.x to 2.0 mapping (Hub #842): MAPPING.md names every 1.x field, and the 1.x corpora and a real agent-state
// owner convert into valid 2.0 messages. The converters below follow MAPPING.md; the runtime's owners (#831) publish
// 2.0 directly, so none of this ships.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createAgentState, MemoryStorage} from '@jimmie-potts/agent-state';
import {validate as validateController} from '@jimmie-potts/device-contracts';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import {consumerCopy} from './consumer.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const validator = new MessageValidator();
registerCoreFamilies(validator);
const valid = message => {
  const result = validator.validate(message);
  assert.equal(result.ok, true, JSON.stringify([result.error, message.data]));
};
let sent = 0;
const AT = Date.parse('2026-10-06T12:00:00.000Z');
const message = (family, kind, type, subject, data, atMs = AT) => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `msg-${++sent}`, source: 'bunny/core', type, subject, time: new Date(atMs).toISOString(),
  kind, datacontenttype: 'application/json', dataschema: `https://bunny.invalid/events/${family}/2.0`,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
});

// Every field path of a 1.x schema definition; a definition reached again by $ref is named, not expanded again.
function fieldPaths(document, start) {
  const paths = [], seen = new Set();
  const resolve = node => node.$ref?.startsWith('#/') ? resolve(node.$ref.slice(2).split('/').reduce((at, key) => at[key], document)) : node;
  const walk = (node, prefix) => {
    if (node.$ref?.startsWith('#/')) {
      if (seen.has(node.$ref)) return;
      seen.add(node.$ref);
    }
    const target = resolve(node);
    for (const branch of [...(target.oneOf ?? []), ...(target.allOf ?? [])]) walk(branch, prefix);
    if (target.items) walk(target.items, `${prefix}[]`);
    for (const [name, child] of Object.entries(target.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (!paths.includes(path)) paths.push(path);
      walk(child, path);
    }
  };
  walk(start, '');
  return paths;
}

test('MAPPING.md names every field of the session record, lifecycle observation, controller receipt and moment command', () => {
  const sections = readFileSync(new URL('../MAPPING.md', import.meta.url), 'utf8').split(/^## /m);
  const named = heading => new Set(sections.find(section => section.startsWith(heading)).split('\n')
    .filter(line => line.startsWith('| `')).flatMap(line => [...line.split(' | ')[0].matchAll(/`([^`]+)`/g)].map(match => match[1])));
  const snapshot = read('../../agent-state/schemas/snapshot-v1.3.schema.json');
  const durable = read('../../agent-state/schemas/durable-v2.1.schema.json');
  const lifecycle = read('../../lifecycle-contracts/schemas/lifecycle-v1.2.schema.json');
  const controller = read('../../contracts/schemas/controller-v1.schema.json');
  const expected = [
    ['Agent-state session record', [...fieldPaths(snapshot, snapshot.$defs.snapshotSession), ...fieldPaths(durable, durable.$defs.storedSession)]],
    ['Agent-state snapshot', Object.keys(snapshot.properties)],
    ['Lifecycle observation', fieldPaths(lifecycle, lifecycle)],
    ['Controller receipt', [...fieldPaths(controller, controller.$defs.receipt), ...fieldPaths(controller, controller.$defs.receiptV1_1)]],
    ['Moment request', fieldPaths(controller, controller.$defs.momentCommand)],
  ];
  for (const [heading, paths] of expected) {
    const listed = named(heading);
    assert.deepEqual([...new Set(paths)].filter(path => !listed.has(path)), [], `${heading} misses fields`);
  }
});

const ordering = (order, identity) => order.status === 'known' ? {status: 'known', authority: identity.sourceId, epoch: order.epoch, sequence: order.sequence} : order;
function observation(envelope) {
  const {apiVersion: _version, eventId, event, ordering: order, ...rest} = envelope;
  return message('lifecycle', 'occurrence', 'org.bunny.lifecycle.observed', sessionEntityId(envelope.identity), {
    ...rest, ...(eventId === undefined ? {} : {nativeEventId: eventId}), event: {...event, kind: event.kind.replace('.', '-')},
    ordering: ordering(order, envelope.identity),
  });
}
function record(session, revision) {
  const {observationAgeMs: _age, label, labelOrigin, generation, unavailable, ordering: order, ...rest} = session;
  return {
    ...rest, id: sessionEntityId(session.identity), revision, generation: generation ?? 0, ordering: ordering(order, session.identity),
    unavailable: unavailable.map(({dimension, reason}) => ({dimension, reason})),
    ...(label === undefined ? {} : {label: {value: label, origin: labelOrigin ?? 'user'}}),
  };
}
const state = (data, atMs) => message('session', 'state', 'org.bunny.session.updated', data.id, data, atMs);

// 1.x refusals that concern one observation or one record, and where 2.0 refuses each of them.
const REFUSED_OBSERVATIONS = {
  'self-parent': 'payload /parent/identity same session',
  'cross-provider-parent': 'payload /parent/identity another source',
  'provider-client-mismatch': 'payload /identity/client const',
  'cli-read-unsupported-read': 'payload /identity/client const',
  'cli-read-unsupported-unread': 'payload /identity/client const',
  'label-trailing-newline': 'payload /label/value pattern',
  'label-only-newline': 'payload /label/value pattern',
  'overlong-title': 'payload /title/value maxLength',
  'overlong-project': 'payload /project maxLength',
  'empty-title': 'payload /title/value minLength',
  'control-title': 'payload /title/value pattern',
  'credential-title': 'payload /title/value pattern',
  'credential-label': 'payload /label/value pattern',
  'credential-after-0x2028-title': 'payload /title/value pattern',
  'credential-after-0x2029-project': 'payload /project pattern',
  'child-rejects-host-session': 'payload /hostSessionId false schema',
  'host-session-space': 'payload /hostSessionId pattern',
  'host-session-path': 'payload /hostSessionId pattern',
  'host-session-non-ascii': 'payload /hostSessionId pattern',
};
const REFUSED_RECORDS = {
  'self-parent': 'payload /parent/identity same session',
  'foreign-parent-source': 'payload /parent/identity another source',
  'invalid-provider-client': 'payload /identity/client const',
  'invented-cli-read': 'payload /read const',
  'invented-claude-read': 'payload /read const',
  'duplicate-notice': 'payload /notices duplicate id',
  'notice-hash-newline': 'payload /notices/0/id pattern',
  'labels-exclude-controls': 'payload /label/value pattern',
  'restart-claimed-current': 'payload /freshness const',
  'false-freshness': 'payload /freshness uncertain before five minutes',
  'freshness-after-five-minutes': 'payload /freshness current after five minutes',
  'generation-after-revision': 'payload /generation after the revision',
  'non-ascii-neutral-id': 'payload /identity/sessionId pattern',
  'credential': 'payload /title/value pattern',
  'overlong-project': 'payload /project maxLength',
  'credential-after-0x2028-title': 'payload /title/value pattern',
  'host-session-child': 'payload /hostSessionId false schema',
  'host-session-malformed': 'payload /hostSessionId pattern',
};

test('every valid lifecycle 1.x observation converts to a valid 2.0 observation, and per-observation refusals stay refused', () => {
  const cases = ['lifecycle-v1', 'lifecycle-v1.1', 'lifecycle-v1.2'].flatMap(name => read(`../../lifecycle-contracts/fixtures/${name}.json`).cases);
  for (const {id, input} of cases.filter(item => item.valid)) {
    const converted = observation(input);
    assert.equal(validator.validate(converted).ok, true, `${id}: ${JSON.stringify(validator.validate(converted).error)}`);
  }
  for (const [id, detail] of Object.entries(REFUSED_OBSERVATIONS)) {
    const item = cases.find(candidate => candidate.id === id);
    assert.equal(item.valid, false, `${id} is a 1.x refusal`);
    assert.equal(validator.validate(observation(item.input)).error?.detail, detail, `${id} is refused in 2.0`);
  }
});

test('every valid snapshot session converts to a valid 2.0 session record, and per-record refusals stay refused', () => {
  const cases = ['snapshots-v1', 'snapshots-v1.2', 'snapshots-v1.3'].flatMap(name => read(`../../agent-state/fixtures/${name}.json`).cases);
  let records = 0;
  for (const {id, input} of cases.filter(item => item.valid)) {
    for (const session of input.sessions) {
      const converted = state(record(session, input.revision), input.asOfMs);
      assert.equal(validator.validate(converted).ok, true, `${id}: ${JSON.stringify(validator.validate(converted).error)}`);
      records++;
    }
  }
  assert.ok(records >= 20, `${records} records`);
  for (const [id, detail] of Object.entries(REFUSED_RECORDS)) {
    const item = cases.find(candidate => candidate.id === id);
    assert.equal(item.valid, false, `${id} is a 1.x refusal`);
    const refusals = item.input.sessions.map(session => validator.validate(state(record(session, item.input.revision), item.input.asOfMs)))
      .filter(result => !result.ok).map(result => result.error.detail);
    assert.equal(refusals[0], detail, `${id} is refused in 2.0`);
  }
});

// The receipt rule in MAPPING.md "Controller receipt". The error's detail is the 1.x failure code; without one, it is
// the 1.x outcome when the 2.0 result renames it. It is omitted when it equals the 2.0 code.
const ADMISSION = ['unauthenticated', 'forbidden', 'unsupported-capability', 'invalid-request', 'unknown-device', 'revision-conflict',
  'stale-generation', 'request-conflict', 'request-expired', 'request-order', 'capacity'];
const CODES = {'unknown-device': 'not-found', 'stale-generation': 'revision-conflict', 'request-conflict': 'duplicate-conflict',
  'request-expired': 'expired', 'moment-missed': 'expired', 'request-order': 'revision-conflict', 'external-control': 'invalid-state',
  'moment-blocked': 'invalid-state', 'moment-duplicate': 'invalid-state'};
const RESULTS = {sent: 'succeeded', failed: 'failed', 'partially-applied': 'uncertain', uncertain: 'uncertain', cancelled: 'failed'};
const RETRYABLE = new Set(['capacity', 'unavailable']);
const error = (code, detail) => ({code, retryable: RETRYABLE.has(code), ...(detail === undefined || detail === code ? {} : {detail})});
function receiptMessage(receipt) {
  const requestId = `${receipt.requestId.epoch}.${receipt.requestId.sequence}`, failure = receipt.failure?.code;
  const reply = data => message('reply', 'reply', 'org.bunny.device.command.replied', receipt.deviceId, {requestId, ...data});
  const outcome = (result, evidence, code) => message('outcome', 'outcome', 'org.bunny.device.command.completed', receipt.deviceId, {
    requestId, result, evidence,
    ...(code === undefined ? {} : {error: error(code, failure ?? (receipt.outcome === result ? undefined : receipt.outcome))}),
  });
  if (receipt.outcome === 'queued') return reply({status: 'accepted'});
  // Possible prior effects: no evidence that anything reached the device, and no evidence that nothing did.
  if (receipt.priorEffects === 'possible') return outcome('uncertain', 'none', 'uncertain-result');
  const evidence = receipt.priorEffects === 'confirmed-transmission' ? 'transmitted' : 'none';
  const mapped = failure === 'transport-failure' ? (evidence === 'none' ? 'unavailable' : 'uncertain-result') : CODES[failure] ?? failure;
  // Sent, then its answer was lost: uncertain, as the profile's lost-answer scenario reports it.
  if (receipt.outcome === 'failed' && evidence === 'transmitted' && ['uncertain-result', 'transport-failure'].includes(failure ?? '')) {
    return outcome('uncertain', 'transmitted', 'uncertain-result');
  }
  switch (receipt.outcome) {
    case 'sent': return outcome('succeeded', 'transmitted');
    case 'failed': return ADMISSION.includes(failure) ? reply({error: error(mapped, failure)}) : outcome('failed', evidence, mapped ?? 'internal');
    case 'partially-applied':
    case 'uncertain': return outcome('uncertain', evidence, 'uncertain-result');
    case 'cancelled': return outcome('failed', evidence, 'cancelled');
  }
  throw new Error(receipt.outcome);
}

test('every controller receipt in the 1.x corpus and every receipt shape 1.x accepts convert to a valid reply or outcome', () => {
  const receipts = [];
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (['controllerId', 'deviceId', 'requestId', 'outcome', 'priorEffects'].every(key => key in value) && typeof value.outcome === 'string') receipts.push(value);
      Object.values(value).forEach(collect);
    }
  };
  const corpus = read('../../contracts/fixtures/controller-v1.json'), controller = read('../../contracts/schemas/controller-v1.schema.json');
  collect([...corpus.schemaCases.filter(item => item.valid), ...corpus.semanticCases]);
  const outcomes = new Set();
  for (const receipt of receipts) {
    valid(receiptMessage(receipt));
    outcomes.add(receipt.outcome);
  }
  assert.deepEqual([...outcomes].sort(), ['failed', 'partially-applied', 'queued', 'sent', 'uncertain']);
  // Every receipt shape the 1.x schema accepts: each outcome, prior effect, operation list and failure code. LIFX, for
  // one, reports a write cut short by a generation change as `cancelled` with `possible` prior effects.
  const codes = controller.$defs.failureCodeV1_1.enum;
  let shapes = 0, possible = 0, lost = 0;
  for (const outcome of controller.$defs.receiptV1_1.properties.outcome.enum) {
    for (const priorEffects of controller.$defs.priorEffects.enum) {
      for (const [completedOperations, uncertainOperations] of [[[], []], [['power'], []], [[], ['zone-two']], [['power'], ['zone-two']]]) {
        for (const failure of [undefined, ...codes.map(code => ({code}))]) {
          const receipt = {apiVersion: '1.1', controllerId: 'controller', deviceId: 'light', requestId: {epoch: 'requests-1', sequence: 1},
            configurationRevision: 5, generation: {epoch: 'generation-1', sequence: 3}, outcome, priorEffects, completedOperations, uncertainOperations,
            ...(failure === undefined ? {} : {failure})};
          if (!validateController('receiptV1_1', receipt)) continue;
          const converted = receiptMessage(receipt), data = converted.data, shape = JSON.stringify([outcome, priorEffects, failure?.code]);
          valid(converted);
          shapes++;
          if (outcome === 'queued') {
            assert.deepEqual([converted.kind, data.status], ['reply', 'accepted'], shape);
          } else if (priorEffects === 'possible') {
            possible++;
            const detail = failure !== undefined ? failure.code : outcome === 'uncertain' ? undefined : outcome;
            assert.deepEqual([converted.kind, data.result, data.evidence, data.error.code, data.error.detail],
              ['outcome', 'uncertain', 'none', 'uncertain-result', detail === 'uncertain-result' ? undefined : detail], shape);
          } else if (outcome === 'failed' && priorEffects === 'confirmed-transmission' && ['uncertain-result', 'transport-failure'].includes(failure?.code)) {
            // Sent, then its answer was lost: the profile reports that as uncertain.
            lost++;
            assert.deepEqual([converted.kind, data.result, data.evidence, data.error.code, data.error.detail],
              ['outcome', 'uncertain', 'transmitted', 'uncertain-result', failure.code === 'uncertain-result' ? undefined : failure.code], shape);
          } else if (converted.kind === 'outcome') {
            assert.deepEqual([data.result, data.evidence], [RESULTS[outcome], priorEffects === 'none' ? 'none' : 'transmitted'], shape);
          } else {
            assert.ok(outcome === 'failed' && ADMISSION.includes(failure?.code), shape);
          }
        }
      }
    }
  }
  assert.ok(shapes > 400 && possible > 50 && lost >= 2, `${shapes} receipt shapes, ${possible} with possible prior effects, ${lost} lost answers`);
});

// Publishes a real agent-state owner's changes as 2.0 messages (MAPPING.md "Agent-state session record") at the owner's
// clock. Its revision follows the owner's and also advances when only freshness changes, which 1.x did not count.
function publisher(owner) {
  let revision = owner.snapshot().revision;
  const published = new Map();
  const current = () => owner.snapshot('1.3');
  return {
    publish(reason) {
      const snapshot = current(), now = new Map(snapshot.sessions.map(session => [sessionEntityId(session.identity), session]));
      const messages = [], next = Math.max(revision + 1, snapshot.revision);
      for (const [id, session] of now) {
        const data = record(session, next), prior = published.get(id);
        if (prior !== undefined && JSON.stringify({...prior, revision: next}) === JSON.stringify(data)) continue;
        messages.push(state(data, snapshot.asOfMs));
        published.set(id, data);
      }
      for (const id of [...published.keys()].filter(id => !now.has(id))) {
        messages.push(message('removal', 'removal', 'org.bunny.session.removed', id, {entity: {family: 'session', id}, revision: next, reason},
          snapshot.asOfMs));
        published.delete(id);
      }
      if (messages.length > 0) revision = next;
      return messages;
    },
    sync(requestId) {
      const asOfMs = current().asOfMs;
      return [{...message('sync-request', 'sync-request', 'org.bunny.sync.requested', 'core', {requestId, families: ['session']}, asOfMs),
        expiresat: new Date(asOfMs + 5000).toISOString()},
      ...[...published.values()].map(data => state(data, asOfMs)),
      message('sync-completed', 'sync-completed', 'org.bunny.sync.completed', 'core',
        {requestId, revision, members: [...published.keys()].map(id => ({family: 'session', id}))}, asOfMs)];
    },
    published,
    revision: () => revision,
  };
}
const deliver = (copy, messages) => {
  for (const each of messages) {
    valid(each);
    copy.apply(each);
  }
};

test('the owner expiry scenario reaches a live and a synced consumer, and freshness flips publish a revision (agent-state retention test)', async () => {
  const DAY = 86400000;
  let clock = 1000;
  const identity = sessionId => ({provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'desktop', sessionId});
  const event = (sessionId, kind, extra = {}) => ({apiVersion: '1.0', identity: identity(sessionId), turn: {status: 'known', id: 'turn-1'},
    parent: {status: 'unknown'}, event: {kind}, observedAtMs: clock, ordering: {status: 'unknown'}, ...extra});
  const owner = await createAgentState({storage: new MemoryStorage(), ownerId: 'owner', consumers: [{id: 'nanoleaf', clearOnNewTurn: true}], clock: () => clock});
  try {
    const feed = publisher(owner), live = consumerCopy();
    await owner.ingest(event('renewed', 'session.started'));
    await owner.ingest(event('labelled', 'turn.started'));
    await owner.ingest(event('labelled', 'turn.ended'));
    deliver(live, feed.publish('expired'));
    // Five minutes without evidence: the owner's revision stands still, but both records turn uncertain.
    const [ownerRevision, published] = [owner.snapshot().revision, feed.revision()];
    clock += 300000;
    const flipped = feed.publish('expired');
    assert.equal(owner.snapshot().revision, ownerRevision);
    assert.deepEqual(flipped.map(each => [each.kind, each.data.freshness, each.data.revision]),
      [['state', 'uncertain', published + 1], ['state', 'uncertain', published + 1]]);
    deliver(live, flipped);
    clock += 3600000 - 300000;
    await owner.ingest(event('renewed', 'turn.started', {turn: {status: 'known', id: 'turn-2'}}));
    const labelled = owner.snapshot().sessions.find(session => session.identity.sessionId === 'labelled');
    await owner.setLabel(labelled.identity, 'Chosen label');
    deliver(live, feed.publish('expired'));
    clock += DAY - 3600000;
    await owner.maintain();
    const removed = feed.publish('expired');
    assert.deepEqual(removed.filter(each => each.kind === 'removal').map(each => each.data), [{entity: {family: 'session', id: sessionEntityId(identity('labelled'))},
      revision: feed.revision(), reason: 'expired'}]);
    deliver(live, removed);
    assert.deepEqual([...live.held.values()], [...feed.published.values()]);
    assert.deepEqual([...live.held.values()].map(each => each.identity.sessionId), ['renewed']);
    const synced = consumerCopy();
    deliver(synced, feed.sync('sync-1'));
    assert.deepEqual(synced.held, live.held);
  } finally {
    await owner.shutdown();
  }
});

test('the owner retirement scenario removes a subtree, and a consumer that missed it drops it at sync (agent-state retirement test)', async () => {
  let clock = 1000;
  const identity = sessionId => ({provider: 'claude', client: 'code', hostId: 'host', sourceId: 'source', sessionId});
  const event = (sessionId, kind, extra = {}) => ({apiVersion: '1.0', identity: identity(sessionId), turn: {status: 'known', id: 'turn-1'},
    parent: {status: 'top-level'}, event: {kind}, observedAtMs: clock, ordering: {status: 'unknown'}, ...extra});
  const owner = await createAgentState({storage: new MemoryStorage(), ownerId: 'owner', consumers: [{id: 'pixoo', clearOnNewTurn: false}], clock: () => clock});
  try {
    const feed = publisher(owner), live = consumerCopy(), missed = consumerCopy();
    await owner.ingest(event('parent', 'turn.started'));
    await owner.ingest(event('parent', 'turn.ended'));
    for (const [child, parent] of [['child', 'parent'], ['grandchild', 'child']]) {
      await owner.ingest(event(child, 'session.started', {parent: {status: 'known', identity: identity(parent)}}));
    }
    await owner.ingest(event('unrelated', 'turn.started'));
    const before = feed.publish('retired');
    deliver(live, before);
    deliver(missed, before);
    clock += 1000;
    assert.equal((await owner.ingest(event('parent', 'runtime.ended'))).outcome, 'applied');
    const retired = feed.publish('retired');
    const removals = retired.filter(each => each.kind === 'removal');
    assert.deepEqual(removals.map(each => each.subject).sort(), ['child', 'grandchild', 'parent'].map(id => sessionEntityId(identity(id))).sort());
    assert.equal(new Set(removals.map(each => each.data.revision)).size, 1, 'one revision retires the subtree');
    deliver(live, retired);
    assert.deepEqual([...live.held.values()], [...feed.published.values()]);
    assert.equal(missed.held.size, 4, 'the disconnected consumer still holds the retired subtree');
    deliver(missed, feed.sync('sync-1'));
    assert.deepEqual([...missed.held.values()].map(each => each.identity.sessionId), ['unrelated']);
    assert.deepEqual(missed.held, live.held);
  } finally {
    await owner.shutdown();
  }
});
