// The 1.x to 2.0 mapping (Hub #842, #918): MAPPING.md names every 1.x field, and the 1.x corpora and a real
// agent-state owner convert into valid 2.0 messages. The converters below follow MAPPING.md; the runtime's owners
// (#831) and the device modules publish 2.0 directly, so none of this ships.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createAgentState, MemoryStorage} from '@jimmie-potts/agent-state';
import * as legacyStatus from '@jimmie-potts/agent-status';
import {validate as validateController} from '@jimmie-potts/device-contracts';
import {MessageValidator} from '../dist/v2/index.js';
import {commandSupported, deviceFamilies, registerDeviceFamilies} from '../dist/v2/devices.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import {consumerCopy} from './consumer.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const validator = new MessageValidator();
registerCoreFamilies(validator);
registerDeviceFamilies(validator);
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

const sections = readFileSync(new URL('../MAPPING.md', import.meta.url), 'utf8').split(/^## /m);
const rows = heading => {
  const section = sections.find(part => part.startsWith(heading));
  assert.ok(section, `MAPPING.md has a "${heading}" section`);
  return section.split('\n').filter(line => line.startsWith('| `')).map(line => line.split(' | '));
};
// The backticked names in a row's first column.
const names = row => [...row[0].matchAll(/`([^`]+)`/g)].map(match => match[1]);
const named = heading => new Set(rows(heading).flatMap(names));
const controller = read('../../contracts/schemas/controller-v1.schema.json');

test('MAPPING.md names every field of the session record, lifecycle observation, controller receipt and moment command', () => {
  const snapshot = read('../../agent-state/schemas/snapshot-v1.3.schema.json');
  const durable = read('../../agent-state/schemas/durable-v2.1.schema.json');
  const lifecycle = read('../../lifecycle-contracts/schemas/lifecycle-v1.2.schema.json');
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

// Hub #918: the controller snapshot, its capabilities and the general command union.
test('MAPPING.md names every field of the controller snapshot and its capabilities, 1.0 and 1.1', () => {
  const paths = [
    ...fieldPaths(controller, controller.$defs.snapshot),
    ...fieldPaths(controller, controller.$defs.snapshotV1_1),
    ...fieldPaths(controller, controller.$defs.capabilitiesV1_1).map(path => `capabilities.${path}`),
  ];
  const listed = named('Controller snapshot');
  assert.deepEqual([...new Set(paths)].filter(path => !listed.has(path)), [], 'Controller snapshot misses fields');
  assert.ok(paths.length > 140, `${paths.length} snapshot paths`);
});

test('MAPPING.md maps the request and each kind of the general command union to one family, with every field', () => {
  const request = fieldPaths(controller, controller.$defs.request).filter(path => !path.startsWith('command.') || path === 'command.kind');
  const listed = named('General commands');
  assert.deepEqual(request.filter(path => !listed.has(path)), [], 'General commands misses request fields');
  const families = new Set(deviceFamilies.map(({family}) => family));
  const mapped = new Map();
  for (const branch of controller.$defs.command.oneOf) {
    const kind = branch.properties.kind.const, fields = Object.keys(branch.properties).filter(name => name !== 'kind');
    const row = rows('General commands').find(candidate => names(candidate)[0] === kind);
    assert.ok(row, `${kind} has a row`);
    assert.deepEqual(fields.filter(field => !names(row).includes(field)), [], `${kind}'s row names every field`);
    const family = row[1].match(/`([a-z-]+) \//)?.[1];
    assert.ok(families.has(family), `${kind} maps to a device family, not ${family}`);
    mapped.set(kind, family);
  }
  assert.equal(new Set(mapped.values()).size, mapped.size, 'each kind has its own family');
  assert.deepEqual([...families].filter(family => family !== 'device' && ![...mapped.values()].includes(family)), [], 'every command family has a 1.x kind');
});

test('MAPPING.md maps every export of the 1.x status helper', () => {
  const listed = named('Agent status');
  for (const name of ['sessionState', 'highestStatus', 'STATUS_COLORS']) {
    assert.notEqual(legacyStatus[name], undefined, `${name} is a 1.x export`);
    assert.ok(listed.has(name), name);
  }
  for (const name of ['HighestStatusOptions.feedAvailable', 'HighestStatusOptions.acknowledgingConsumers', 'Snapshot.collector']) assert.ok(listed.has(name), name);
});

const ordering = (order, identity) => order.status === 'known' ? {status: 'known', authority: identity.sourceId, epoch: order.epoch, sequence: order.sequence} : order;
function observation(envelope) {
  const {apiVersion: _version, eventId, event, ordering: order, ...rest} = envelope;
  // A consumer's acknowledgment is a notice-acknowledge command to the core in 2.0 (Hub #918), not a hook observation.
  if (event.kind === 'notice.acknowledged') {
    return {...message('notice-acknowledge', 'command', 'org.bunny.notice.acknowledge.requested', sessionEntityId(envelope.identity),
      {requestId: `req-${sent + 1}`, consumerId: event.consumerId, noticeId: event.noticeId}), expiresat: new Date(AT + 5000).toISOString()};
  }
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

// Valid 1.x observations that 2.0 refuses, and why. 1.x accepted any neutral notice ID in an acknowledgment, but the
// owner names every notice by a SHA-256 hash, so one naming anything else could only ever be stale (Hub #918).
const NARROWED = {'monitor-only-acknowledgment': 'payload /noticeId pattern'};

test('every valid lifecycle 1.x observation converts to a valid 2.0 observation, and per-observation refusals stay refused', () => {
  const cases = ['lifecycle-v1', 'lifecycle-v1.1', 'lifecycle-v1.2'].flatMap(name => read(`../../lifecycle-contracts/fixtures/${name}.json`).cases);
  for (const {id, input} of cases.filter(item => item.valid)) {
    const converted = observation(input);
    const result = validator.validate(converted);
    if (NARROWED[id] === undefined) assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.error)}`);
    else assert.equal(result.error?.detail, NARROWED[id], `${id} is narrowed in 2.0`);
  }
  const acknowledged = cases.filter(item => item.valid && item.input.event.kind === 'notice.acknowledged');
  assert.ok(acknowledged.length > 0, 'the corpus has an acknowledgment');
  for (const {input} of acknowledged) {
    const converted = observation({...input, event: {...input.event, noticeId: 'a'.repeat(64)}});
    assert.deepEqual([validator.validate(converted).ok, converted.kind, converted.type], [true, 'command', 'org.bunny.notice.acknowledge.requested']);
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
      return [{...message('sync-request', 'sync-request', 'org.bunny.sync.requested', 'session', {requestId, families: ['session']}, asOfMs),
        expiresat: new Date(asOfMs + 5000).toISOString()},
      ...[...published.values()].map(data => state(data, asOfMs)),
      message('sync-completed', 'sync-completed', 'org.bunny.sync.completed', 'session',
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

// The controller snapshot and general commands (Hub #918), converted by MAPPING.md's rules. A device module publishes
// device/2.0 directly; these converters only check that the table is complete and keeps each 1.x meaning.
const lower = value => value.toLowerCase();
const tagged = (value, map = same => same) => value.status === 'known' ? {status: 'known', value: map(value.value)} : {status: 'unknown'};
const AVAILABILITY = {unknown: 'unknown', ready: 'available', degraded: 'degraded', unavailable: 'unavailable'};
const COMMANDS = {'power.set': 'power-set', 'brightness.set': 'brightness-set', 'scene.activate': 'scene-activate', 'zone.power.set': 'zone-power-set',
  'media.start': 'media-start', 'media.control': 'media-control', 'mode.set': 'device-mode-set'};
// The family of each pending 1.x command, API 1.1's moment included.
const FAMILY = {...COMMANDS, moment: 'moment-play'};
const ticket = id => `${id.epoch}.${id.sequence}`;
// A controller-monotonic instant on the snapshot's clock, as an instant on the runtime's clock at the message time.
const onRuntimeClock = (snapshot, clock) => AT - Math.max(0, snapshot.sampleClock.sampledAtMs - clock.sampledAtMs);
function capabilities(v1) {
  const {modes, moments, ...rest} = v1;
  return {...rest, modes: modes?.supported === true ? {supported: true, values: modes.values.map(lower)} : {supported: false}, moments: moments ?? {supported: false}};
}
function deviceRecord(snapshot, revision = 1) {
  const {state} = snapshot;
  const last = state.lastOutcome.status === 'known' ? receiptMessage(state.lastOutcome.receipt) : undefined;
  const external = state.externalControl, sent = state.lastSuccessfulSend;
  return {
    id: snapshot.identity.deviceId, revision, kind: 'light', ...(snapshot.identity.label === undefined ? {} : {label: snapshot.identity.label}),
    availability: AVAILABILITY[snapshot.serviceHealth], configurationRevision: snapshot.configurationRevision, generation: snapshot.generation,
    capabilities: capabilities(snapshot.capabilities),
    desired: {power: tagged(state.desired.power), brightness: tagged(state.desired.brightness), mode: tagged(state.desired.mode, lower)},
    observed: state.observation.status === 'known' ?
      {status: 'known', observedAtMs: AT - Math.round(state.observation.evidenceAgeMs), power: state.observation.power, brightness: state.observation.brightness} :
      {status: 'unknown'},
    pending: state.pending.length,
    pendingKinds: [...new Set(state.pending.map(each => FAMILY[each.command.kind]))],
    // A receipt the receipt rule turns into a reply refused its request; it is not a completed outcome.
    lastOutcome: last?.kind === 'outcome' ? {status: 'known', outcome: last.data} : {status: 'unknown'},
    lastTransmission: sent.status === 'known' ?
      {status: 'known', requestId: ticket(sent.requestId), transmittedAtMs: onRuntimeClock(snapshot, sent.clock), operationIds: sent.operationIds} :
      {status: 'unknown'},
    externalControl: external.status === 'known' ? {status: 'known', owner: external.owner === 'controller' ? 'module' : 'external',
      observedAtMs: onRuntimeClock(snapshot, external.clock)} : {status: 'unknown'},
  };
}
const deviceState = record => ({...message('device', 'state', 'org.bunny.device.updated', record.id, record), source: 'bunny/modules/light'});
function deviceCommand(command, request = {}) {
  const {kind, ...fields} = command, family = COMMANDS[kind];
  const {type} = deviceFamilies.find(each => each.family === family);
  const guards = {
    ...(request.requestId === undefined ? {} : {requestId: `${request.requestId.epoch}.${request.requestId.sequence}`}),
    ...(request.expectedConfigurationRevision === undefined ? {} : {expectedConfigurationRevision: request.expectedConfigurationRevision}),
    ...(request.expectedGeneration === undefined ? {} : {expectedGeneration: request.expectedGeneration}),
  };
  const data = {requestId: `req-${sent + 1}`, ...guards, ...fields, ...(kind === 'mode.set' ? {mode: lower(fields.mode)} : {})};
  return {...message(family, 'command', type, request.deviceId ?? 'light', data), expiresat: new Date(AT + 5000).toISOString()};
}
// Every controller snapshot in the 1.x corpus: the valid schema cases, feeds included, and the semantic cases' inputs.
function controllerSnapshots() {
  const corpus = read('../../contracts/fixtures/controller-v1.json'), found = [];
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (['identity', 'sampleClock', 'capabilities', 'state'].every(key => key in value)) found.push(value);
      Object.values(value).forEach(collect);
    }
  };
  collect([...corpus.schemaCases.filter(item => item.valid), ...corpus.semanticCases]);
  return found;
}

test('every controller snapshot in the 1.x corpus converts to a valid device record that keeps desired and observed apart', () => {
  const snapshots = controllerSnapshots();
  assert.ok(snapshots.length > 50, `${snapshots.length} snapshots`);
  let differ = 0, unobserved = 0, transmitted = 0;
  for (const snapshot of snapshots) {
    const record = deviceRecord(snapshot);
    valid(deviceState(record));
    const {desired, observation, lastSuccessfulSend, pending} = snapshot.state;
    // The last send and the pending kinds have their own homes: a send is never an observation (Hub #918 review).
    assert.equal(record.lastTransmission.status, lastSuccessfulSend.status);
    if (lastSuccessfulSend.status === 'known') {
      transmitted++;
      assert.deepEqual(record.lastTransmission.operationIds, lastSuccessfulSend.operationIds);
    }
    assert.deepEqual(new Set(record.pendingKinds), new Set(pending.map(each => FAMILY[each.command.kind])));
    // Desired comes only from desired, and observed only from the observation: missing evidence stays unknown.
    assert.deepEqual(record.desired, {power: desired.power, brightness: desired.brightness, mode: tagged(desired.mode, lower)});
    assert.equal(record.observed.status, observation.status);
    if (observation.status === 'known') {
      assert.deepEqual([record.observed.power, record.observed.brightness], [observation.power, observation.brightness]);
      if (JSON.stringify(observation.power) !== JSON.stringify(desired.power) || JSON.stringify(observation.brightness) !== JSON.stringify(desired.brightness)) differ++;
    } else {
      unobserved++;
      if (snapshot.serviceHealth === 'ready') assert.equal(record.availability, 'available', 'a healthy service is no observation');
    }
  }
  assert.ok(differ > 0 && unobserved > 0 && transmitted > 0,
    `${differ} snapshots whose desired and observed values differ, ${unobserved} unobserved, ${transmitted} with a last send`);
});

test('every service health, external control owner and capability shape the 1.x schema accepts has a 2.0 home', () => {
  const [base] = controllerSnapshots();
  for (const health of controller.$defs.snapshot.properties.serviceHealth.enum) {
    const record = deviceRecord({...base, serviceHealth: health});
    valid(deviceState(record));
    assert.equal(record.availability, AVAILABILITY[health]);
  }
  for (const owner of controller.$defs.externalControl.oneOf[1].properties.owner.enum) {
    const snapshot = structuredClone(base);
    snapshot.state.externalControl = {status: 'known', owner, clock: snapshot.sampleClock};
    valid(deviceState(deviceRecord(snapshot)));
  }
  const corpus = read('../../contracts/fixtures/controller-v1.json');
  const shapes = corpus.schemaCases.filter(item => item.valid && ['capabilities', 'capabilitiesV1_1'].includes(item.definition));
  assert.ok(shapes.length >= 5);
  // A desired mode must be advertised, so the shapes without modes carry an unknown one.
  for (const {value} of shapes) {
    const record = deviceRecord(base);
    valid(deviceState({...record, capabilities: capabilities(value), desired: {...record.desired, mode: {status: 'unknown'}}}));
  }
});

test('every 1.x general command converts to its 2.0 family, and the capability rule agrees with 1.x admission', () => {
  const corpus = read('../../contracts/fixtures/controller-v1.json');
  const commands = [];
  for (const item of corpus.schemaCases.filter(each => each.valid)) {
    if (['command', 'commandV1_1'].includes(item.definition)) commands.push([item.value, {}]);
    if (['request', 'requestV1_1'].includes(item.definition)) commands.push([item.value.command, item.value]);
  }
  for (const snapshot of controllerSnapshots()) for (const pending of snapshot.state.pending) commands.push([pending.command, {requestId: pending.requestId}]);
  for (const {input} of corpus.semanticCases.filter(item => item.input.operation === 'admit' && validateController('request', item.input.request))) {
    commands.push([input.request.command, input.request]);
  }
  const kinds = new Set();
  for (const [command, request] of commands.filter(([each]) => each.kind !== 'moment')) {
    valid(deviceCommand(command, request));
    kinds.add(command.kind);
  }
  assert.deepEqual([...kinds].sort(), Object.keys(COMMANDS).sort(), 'the corpus covers every kind of the union');
  // 1.x admission refuses an unsupported or unadvertised operation with unsupported-capability; 2.0 modules ask
  // commandSupported. Moments carry their 1.x clock, so only their mood and duration are taken here.
  let compared = 0;
  for (const {id, input, expected} of corpus.semanticCases.filter(item => item.input.operation === 'admit')) {
    if (!['queued', 'unsupported-capability'].includes(expected.decision)) continue;
    const {command} = input.request, caps = capabilities(input.state.capabilities);
    const converted = command.kind === 'moment' ?
      {family: 'moment-play', data: {requestId: 'req-1', momentId: command.momentId, mood: command.mood, durationMs: command.durationMs,
        priorityClass: command.priorityClass, coversStatus: command.coversStatus, startAtMs: AT, toleranceMs: command.start.toleranceMs}} :
      {family: COMMANDS[command.kind], data: deviceCommand(command).data};
    assert.equal(commandSupported(caps, converted), expected.decision === 'queued', id);
    compared++;
  }
  assert.ok(compared >= 20, `${compared} admission cases compared`);
});
