import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {backup, DatabaseSync} from 'node:sqlite';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {prepareMessage, type StateDraft} from '@jimmie-potts/sdk';
import {createCoreModule, Redactions, type CoreHandle} from '../src/index.js';
import {DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {PowerLimitStore, createPowerLimits} from '../src/core/power-limits.js';
import {deviceRecord} from './fixtures/device.js';
import type {Action} from '../src/core/tracker.js';
import {initialArtRecord} from '../src/core/art-schedule-model.js';
import {openModuleDatabase} from '../src/state.js';
import {History, type HistoryEntry, type WrittenChange} from '../src/core/history.js';
import {readSettingsHistory} from '../src/core/settings-history.js';
import {
  checkpointText, parseSettingsCheckpoint, SETTINGS_SCAN_LIMIT, settingsPatch, validSettingsMembers,
  type SettingsFamily, type SettingsPage, type SettingsRead, type SettingsSnapshot,
} from '../src/core/settings-contract.js';
import {edgeConfig, it, manualClock, run, stateDir} from './support.js';

const ingest = {source: 'bunny/parts/settings-ingest', token: 'synthetic-settings-ingest-token', scopes: ['ingest'] as const};
const reader = {source: 'bunny/parts/settings-reader', token: 'synthetic-settings-reader-token', scopes: ['read'] as const};

it('ordinary read scope can snapshot all core singleton defaults before any settings edit', async context => {
  const core = createCoreModule();
  const {config} = await edgeConfig(context, [reader]);
  const clock = manualClock(1_800_000_000_000);
  const {runtime} = await run(context, {modules: [core], configFile: config, edge: {schemas: {}}, clock, scheduler: clock.scheduler});
  const response = await fetch(new URL('/api/v2/history?settings=snapshot', runtime.url), {
    headers: {authorization: `Bearer ${reader.token}`},
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {schema: string; settings: string; origin: string; checkpoint: string;
    records: {family: string; id: string; value: unknown}[]};
  assert.equal(body.schema, 'history/2.0');
  assert.equal(body.settings, 'snapshot');
  assert.notEqual(body.origin, '');
  assert.notEqual(body.checkpoint, '');
  assert.deepEqual(body.records.map(({family}) => family).sort(), [
    'art-schedule', 'automation-interrupt-set', 'automation-settings', 'home-layout', 'lighting-layout', 'mode', 'playback-layout',
  ]);
  assert.deepEqual(body.records.find(({family}) => family === 'mode'), {family: 'mode', id: 'hub', value: {mode: 'free', overrides: []}});
});


const atMs = 1_800_000_000_000;
const state = (family: string, id: string, data: {id: string; revision: number} & Record<string, unknown>, version = '2.0'): StateDraft => ({
  type: `org.bunny.${family}.updated`, subject: id, dataschema: `${SCHEMA_BASE}${family}/${version}`, data,
});
const step = (requestId: string): HistoryEntry => ({
  kind: 'operation', step: {event: 'sent', requestId, kind: 'device', command: 'power-set',
    target: 'synthetic-lamp', requestedBy: 'bunny/parts/operator', status: 'sent'},
});
const fact = (draft: StateDraft, source = 'bunny/core'): HistoryEntry => ({
  kind: 'message', message: prepareMessage(source, {kind: 'state', ...draft}, {now: () => atMs}),
});
const ownerFact = (family: SettingsFamily, draft: StateDraft, before?: object): HistoryEntry => ({
  kind: 'message', message: prepareMessage('bunny/core', {kind: 'state', ...draft}, {now: () => atMs}),
  settings: settingsPatch(family, before, draft.data),
});
const removal = (family: string, id: string, entityId = id): HistoryEntry => ({
  kind: 'message', settings: {kind: 'removal'}, message: prepareMessage('bunny/core', {kind: 'removal', type: `org.bunny.${family}.removed`, subject: id,
    dataschema: `${SCHEMA_BASE}removal/2.0`, data: {entity: {family, id: entityId}, revision: 9, reason: 'deleted'}}, {now: () => atMs}),
});
const zero = (history: History): string => checkpointText({origin: history.origin, seq: 0, anchor: '-'});

function cursor(text: string) {
  const value = parseSettingsCheckpoint(text);
  assert.ok(value);
  return value;
}

function pageRead(after: string, through?: string): Extract<SettingsRead, {mode: 'page'}> {
  return {mode: 'page', after: cursor(after), ...(through === undefined ? {} : {through: cursor(through)})};
}

function page(history: History, after: string, through?: string): SettingsPage {
  const result = readSettingsHistory(history, pageRead(after, through), () => { throw new Error('page consulted current owners'); });
  assert.ok('settings' in result && result.settings === 'page', JSON.stringify(result));
  return result;
}

function snapshot(core: ReturnType<typeof createCoreModule>): SettingsSnapshot {
  const result = core.history.settings({mode: 'snapshot'});
  assert.ok('settings' in result && result.settings === 'snapshot', JSON.stringify(result));
  return result;
}

function readCode(history: History, read: SettingsRead): string {
  const result = readSettingsHistory(history, read, () => []);
  assert.ok('error' in result, JSON.stringify(result));
  return result.error.code;
}

function commit(database: DatabaseSync, history: History, entries: HistoryEntry[], revision: number): void {
  database.exec('BEGIN IMMEDIATE');
  history.write(entries, atMs, revision);
  database.exec('COMMIT');
}

it('fixed pages advance over unrelated rows and seal a split Lighting and Home transaction', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = zero(history);
  commit(db, history, Array.from({length: SETTINGS_SCAN_LIMIT - 1}, (_, index) => step(`synthetic-${index}`)), 1);
  const lighting = {rooms: [{id: 'synthetic-room', name: 'Synthetic room'}], assignments: [], groups: [], home: null};
  const home = {desktop: [{widget: 'light:room:synthetic-room', size: 'small', hidden: false, shape: 'tall'}], phone: []};
  commit(db, history, [
    ownerFact('lighting-layout', state('lighting-layout', 'lighting', {id: 'lighting', revision: 15, layout: lighting})),
    ownerFact('home-layout', state('home-layout', 'home', {id: 'home', revision: 15, version: 1, layouts: home}, '2.2')),
  ], 2);
  commit(db, history, [step('synthetic-after-layout')], 3);
  const first = page(history, initial);
  assert.equal(cursor(first.next).seq, SETTINGS_SCAN_LIMIT);
  assert.equal(cursor(first.applyThrough ?? '').seq, SETTINGS_SCAN_LIMIT - 1);
  assert.equal(first.done, false);
  assert.deepEqual(first.facts, [{family: 'lighting-layout', id: 'lighting', seq: SETTINGS_SCAN_LIMIT, revision: 2, atMs,
    kind: 'change', changed: {layout: lighting}, removed: []}]);

  commit(db, history, [step('synthetic-same-revision')], 3);
  commit(db, history, [removal('automation-rule', 'synthetic-rule')], 4);
  const second = page(history, first.next, first.through);
  assert.equal(second.done, true);
  assert.equal(second.next, first.through);
  assert.equal(second.applyThrough, first.through);
  assert.deepEqual(second.facts, [{family: 'home-layout', id: 'home', seq: SETTINGS_SCAN_LIMIT + 1, revision: 2, atMs,
    kind: 'change', changed: {version: 1, layouts: home}, removed: []}]);
  const third = page(history, second.next);
  assert.deepEqual(third.facts, [{family: 'automation-rule', id: 'synthetic-rule', seq: SETTINGS_SCAN_LIMIT + 4, revision: 4, atMs, kind: 'removal'}]);
  const empty = page(history, third.next);
  assert.deepEqual([empty.next, empty.applyThrough, empty.done, empty.facts], [third.next, third.next, true, []]);
  assert.equal(readCode(history, pageRead(third.next, first.through)), 'invalid-request');
});

it('a revision continuing through a whole page stays unsealed and projected-empty pages still advance', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = zero(history);
  commit(db, history, Array.from({length: SETTINGS_SCAN_LIMIT * 2 + 1}, (_, index) => step(`synthetic-${index}`)), 1);
  const first = page(history, initial);
  assert.deepEqual([cursor(first.next).seq, first.applyThrough, first.done, first.facts], [SETTINGS_SCAN_LIMIT, initial, false, []]);
  const middle = page(history, first.next, first.through);
  assert.deepEqual([cursor(middle.next).seq, middle.applyThrough, middle.done, middle.facts], [SETTINGS_SCAN_LIMIT * 2, null, false, []]);
  const last = page(history, middle.next, first.through);
  assert.deepEqual([last.next, last.applyThrough, last.done, last.facts], [first.through, first.through, true, []]);
});

it('a restored store loses the old anchor at a reused sequence even when the row has no message ID', async context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = zero(history);
  commit(db, history, [step('survives-restore')], 1);
  const preserved = page(history, initial).next;
  const file = join(await stateDir(context), 'saved-core.sqlite');
  await backup(db, file);
  commit(db, history, [step('abandoned-after-restore')], 2);
  const lost = page(history, preserved).next;
  assert.equal(history.after(history.origin, 1)[0]?.messageId, null);

  const restored = new DatabaseSync(file);
  context.after(() => restored.close());
  const reopened = new History(restored);
  assert.equal(reopened.origin, history.origin);
  commit(restored, reopened, [step('replacement-at-same-sequence')], 2);
  const replacement = page(reopened, preserved).next;
  assert.equal(cursor(replacement).seq, cursor(lost).seq);
  assert.notEqual(replacement, lost);
  assert.equal(readCode(reopened, pageRead(lost)), 'revision-conflict');
  assert.equal(readCode(reopened, pageRead(preserved, lost)), 'revision-conflict');
  const foreign = checkpointText({origin: randomUUID(), seq: 0, anchor: '-'});
  assert.equal(readCode(reopened, pageRead(foreign)), 'invalid-state');
  assert.equal(readCode(reopened, pageRead(preserved, foreign)), 'invalid-state');
});

it('the history migration adds one stable legacy barrier and refuses an ignored backfill or barrier write', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = zero(history);
  commit(db, history, Array.from({length: SETTINGS_SCAN_LIMIT + 1}, (_, index) => step(`synthetic-${index}`)), 1);
  const before = page(history, initial).next;
  const oldInsert = db.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, type, subject, record, origin, origin_seq)
    VALUES (?, 2, 'operation', 'bunny/parts/operator', 'power-set', 'synthetic-lamp', '{}', ?, ?)`);
  oldInsert.run(atMs, history.origin, SETTINGS_SCAN_LIMIT + 2);
  db.exec(`CREATE TRIGGER ignore_continuity BEFORE UPDATE OF continuity ON core_history BEGIN SELECT RAISE(IGNORE); END`);
  assert.throws(() => new History(db), /continuity barrier was not stored/);
  assert.equal(db.isTransaction, false);
  assert.equal(history.localHead()?.continuity, null);
  db.exec('DROP TRIGGER ignore_continuity');

  const reopened = new History(db);
  const tail = reopened.localHead();
  assert.ok(tail !== undefined && tail.continuity !== null);
  assert.ok(tail.continuity.startsWith('legacy:'));
  assert.deepEqual(new History(db).localHead(), tail);
  assert.equal(readCode(reopened, pageRead(initial)), 'revision-conflict', 'refuse before the first page can seal rows ahead of the barrier');
  assert.equal(readCode(reopened, pageRead(before)), 'revision-conflict');
  const barrier = checkpointText({origin: reopened.origin, seq: tail.originSeq, anchor: tail.continuity.slice('legacy:'.length)});
  assert.equal(page(reopened, barrier).done, true);
  commit(db, reopened, [step('after-legacy')], 3);
  assert.equal(cursor(page(reopened, barrier).next).seq, SETTINGS_SCAN_LIMIT + 3);

  oldInsert.run(atMs, null, null);
  db.exec(`CREATE TRIGGER ignore_origin BEFORE UPDATE OF origin ON core_history BEGIN SELECT RAISE(IGNORE); END`);
  assert.throws(() => new History(db), /history origin was not stored/);
  assert.equal(db.isTransaction, false);
  const prior = reopened.localHead();
  db.exec('DROP TRIGGER ignore_origin');
  const recovered = new History(db).localHead();
  assert.equal(recovered?.originSeq, (prior?.originSeq ?? 0) + 1);
  assert.equal(recovered?.continuity?.startsWith('legacy:'), true);
});

it('a current snapshot includes saved definitions and excludes an ambient write that rolls back', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const directory = await stateDir(context), clock = manualClock(atMs);
  const marker = 'Synthetic "quoted" rule';
  const event = {name: marker, kind: 'event', enabled: true, trigger: {source: 'core', kind: 'turn-ended'},
    action: {mood: 'celebrate', priorityClass: 'flourish', durationMs: 1000, targets: ['unavailable-display']}};
  const seeded = openModuleDatabase(directory, 'core');
  try {
    const store = new AutomationStore(seeded, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
    store.insertRule({id: 'synthetic-saved', name: event.name, enabled: true, kind: event.kind,
      trigger: JSON.stringify(event.trigger), action: JSON.stringify(event.action), createdAtMs: atMs, updatedAtMs: atMs}, 64);
    store.insertRule({id: 'legacy.routine', name: 'Retained routine', enabled: false, kind: 'routine',
      trigger: JSON.stringify({schema: 'routine/1.0', days: [1], time: '17:00'}),
      action: JSON.stringify({definitionId: 'legacy-definition', actions: [{target: 'unavailable-display', family: 'power-set', data: {on: true}}]}),
      createdAtMs: atMs, updatedAtMs: atMs}, 64);
    store.replaceInterruptSet([]);
  } finally { seeded.close(); }
  const {config} = await edgeConfig(context, [reader, ingest]);
  const redactions = new Redactions();
  const {runtime} = await run(context, {modules: [core], stateDir: directory, configFile: config,
    edge: {schemas: {}}, clock, scheduler: clock.scheduler, redactions});
  assert.ok(handle);
  const live = handle, before = snapshot(core);
  assert.equal(cursor(before.checkpoint).seq, 0);
  assert.deepEqual(before.records.find(item => item.id === 'synthetic-saved'), {
    family: 'automation-rule', id: 'synthetic-saved', value: {name: event.name, enabled: true, trigger: event.trigger, action: event.action},
  });
  assert.deepEqual(before.records.find(item => item.id === 'legacy.routine'), {family: 'automation-routine', id: 'legacy.routine',
    value: {name: 'Retained routine', enabled: false, days: [1], time: '17:00',
      actions: [{target: 'unavailable-display', family: 'power-set', data: {on: true}}]}});
  assert.deepEqual(before.records.find(item => item.family === 'automation-interrupt-set')?.value, {kinds: []});
  assert.equal(before.records.find(item => item.family === 'home-layout')?.value.layouts, null);

  let attempt = false;
  await assert.rejects(live.transaction(tx => {
    tx.database.prepare('UPDATE core_mode SET record = ?').run(JSON.stringify({id: 'hub', mode: 'quiet', revision: tx.revision(), selectedAtMs: atMs}));
    const denied = core.history.settings({mode: 'snapshot'});
    assert.ok('error' in denied);
    assert.equal(denied.error.code, 'unavailable');
    assert.equal(tx.database.isTransaction, true, 'the reader leaves the writer transaction open');
    attempt = true;
    throw new Error('synthetic rollback');
  }), /synthetic rollback/);
  assert.equal(attempt, true);
  assert.deepEqual(snapshot(core), before);

  const call = (query: string, token = reader.token) =>
    fetch(new URL(`/api/v2/history?${query}`, runtime.url), {headers: {authorization: `Bearer ${token}`}});
  for (const query of ['settings=', 'settings=snapshot&limit=1', 'settings=snapshot&settings=snapshot', 'settings=page',
    'settings=page&after=invalid', `settings=page&after=${before.checkpoint}&through=${before.checkpoint}&through=${before.checkpoint}`]) {
    const denied = await call(query);
    assert.equal(denied.status, 400, query);
    assert.equal((await denied.json() as {error: {code: string}}).error.code, 'invalid-request');
  }
  const unauthenticated = await call('settings=snapshot', 'unrecognized-credential');
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.text();
  const forbidden = await call('settings=snapshot', ingest.token);
  assert.equal(forbidden.status, 403);
  await forbidden.text();

  redactions.add(marker);
  const denied = await call('settings=snapshot');
  assert.equal(denied.status, 500);
  assert.doesNotMatch(await denied.text(), /Synthetic|synthetic-saved/);
  const first = await call(`settings=page&after=${before.checkpoint}`);
  assert.equal(first.status, 200, 'a protected snapshot value outside an empty page does not affect it');
  assert.deepEqual(await first.json(), {schema: 'history/2.0', settings: 'page', origin: before.origin, after: before.checkpoint,
    through: before.checkpoint, next: before.checkpoint, applyThrough: before.checkpoint, done: true, facts: []});

  await core.automation.remove('synthetic-saved');
  redactions.add('synthetic-saved');
  const protectedId = await call(`settings=page&after=${before.checkpoint}`);
  assert.equal(protectedId.status, 500);
  assert.ok(!(await protectedId.text()).includes('synthetic-saved'));
});

it('a snapshot and a page see a commit before deferred publication without writing or sending anything', async context => {
  let beforePublish: (() => void) | undefined;
  let attempted = 0;
  const core = createCoreModule({beforePublish: () => beforePublish?.()});
  const clock = manualClock(atMs);
  const withDeferredPublication = {...core, start: (context: Parameters<typeof core.start>[0]) =>
    core.start({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
      if (key === 'bunny.state.automation-interrupt-set.interrupt-set') {
        attempted += 1;
        return Promise.reject(new Error('synthetic publication refusal'));
      }
      return context.sdk.publishMessage(key, message);
    }}})};
  await run(context, {modules: [withDeferredPublication], clock, scheduler: clock.scheduler});
  const before = snapshot(core);
  const changes: [SettingsSnapshot, SettingsPage][] = [];
  beforePublish = () => {
    const result = core.history.settings(pageRead(before.checkpoint));
    assert.ok('settings' in result && result.settings === 'page');
    changes.push([snapshot(core), result]);
  };
  await core.automation.replaceInterruptSet({kinds: []});
  assert.equal(changes.length, 1);
  const [observed, observedPage] = changes[0] ?? [];
  assert.ok(observed && observedPage);
  assert.equal(observed.checkpoint, observedPage.next);
  assert.notEqual(observed.checkpoint, before.checkpoint);
  assert.deepEqual(observed.records.find(item => item.family === 'automation-interrupt-set')?.value, {kinds: []});
  assert.deepEqual(observedPage.facts.map(fact => fact.kind === 'change' ? fact.changed : fact.kind), [{kinds: []}]);
  const publicationCount = attempted;
  assert.deepEqual(snapshot(core), observed);
  assert.equal(attempted, publicationCount);
  assert.equal(changes.length, 1, 'the reads did not commit');
});

it('art run state and power-limit observations leave only their committed settings edits', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = zero(history), art = initialArtRecord();
  commit(db, history, [ownerFact('art-schedule', state('art-schedule', 'art', {...art, revision: 1, weather: 'unavailable'}), art)], 1);
  const runOnly = page(history, initial);
  assert.deepEqual(runOnly.facts, []);
  const policy = {...art.policy, browser: false};
  commit(db, history, [ownerFact('art-schedule', state('art-schedule', 'art', {...art, revision: 2, settingsRevision: 1, policy}), art)], 2);
  const power = {id: 'synthetic-lamp', revision: 3, settingsRevision: 1, enabled: true, durationMs: 1000,
    enforcement: 'hub-dependent', status: 'unavailable', startedAtMs: null, deadlineMs: null,
    observedAtMs: null, lastAttempt: null, updatedAtMs: atMs};
  commit(db, history, [ownerFact('power-limit', state('power-limit', power.id, power))], 3);
  commit(db, history, [ownerFact('power-limit', state('power-limit', power.id, {...power, revision: 4, status: 'off', observedAtMs: atMs}), power)], 4);
  commit(db, history, [ownerFact('art-schedule', state('art-schedule', 'art', {...art, revision: 5, settingsRevision: 1, policy, weather: 'unavailable'}), {policy})], 5);
  const changed = page(history, runOnly.next);
  assert.equal(cursor(changed.next).seq, 5);
  assert.deepEqual(changed.facts.map(fact => fact.kind === 'change' ? fact.changed : fact.kind), [
    {policy}, {enabled: true, durationMs: 1000},
  ]);
});

it('the settings validator rejects unexpected nested fields and invalid partial or reconstructed values', () => {
  assert.equal(validSettingsMembers('mode', 'hub', {overrides: [{target: 'display', mode: 'free'}]}, false), true);
  assert.equal(validSettingsMembers('mode', 'hub', {mode: 'free', overrides: [{target: 'display', mode: 'free'}]}, true), false);
  assert.equal(validSettingsMembers('mode', 'hub', {mode: 'free', overrides: [{target: 'display', mode: 'quiet', selectedAtMs: 5}]}, true), false);
  assert.equal(validSettingsMembers('automation-rule', 'synthetic-rule', {name: 'Readable rule'}, false), true);
  assert.equal(validSettingsMembers('automation-rule', 'synthetic-rule', {name: 'Readable rule'}, true), false);
  assert.equal(validSettingsMembers('automation-routine', 'synthetic-routine', {actions: [{target: 'lamp', family: 'power-set',
    data: {on: false, requestId: 'foreign'}}]}, false), false);
  assert.equal(validSettingsMembers('automation-settings', 'settings', {quietHours: {...DEFAULT_SETTINGS.quietHours, timeZone: 'invalid-zone'}}, false), false);
  assert.equal(validSettingsMembers('lighting-layout', 'lighting', {layout: {rooms: [], groups: [], home: null,
    assignments: [{device: 'light', room: 'missing'}]}}, false), false);
  assert.equal(validSettingsMembers('power-limit', 'synthetic-lamp', {durationMs: 999}, false), false);
});


it('an ignored core settings fact rolls back its owner save while ignored device history remains nonfatal', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const clock = manualClock(atMs);
  await run(context, {modules: [core], clock, scheduler: clock.scheduler});
  assert.ok(handle);
  const live = handle, before = snapshot(core);
  const art = core.automation.artSchedule;
  assert.ok(art);
  const initialPolicy = art.get().policy;
  await live.transaction(tx => {
    tx.database.exec(`CREATE TRIGGER skip_art_fact BEFORE INSERT ON core_history
      WHEN NEW.type = 'org.bunny.art-schedule.updated' BEGIN SELECT RAISE(IGNORE); END`);
  });
  const attempt = await Promise.allSettled([art.save({expectedSettingsRevision: 0, policy: {...initialPolicy, browser: false}})]);
  const afterFailure = snapshot(core), failedPage = core.history.settings(pageRead(before.checkpoint));
  assert.deepEqual({status: attempt[0]?.status, unchanged: afterFailure.checkpoint === before.checkpoint,
    samePolicy: JSON.stringify(art.get().policy) === JSON.stringify(initialPolicy)}, {status: 'rejected', unchanged: true, samePolicy: true});
  assert.deepEqual(afterFailure, before);
  assert.equal(art.get().settingsRevision, 0);
  assert.equal(art.get().revision, 0);
  assert.ok('settings' in failedPage && failedPage.settings === 'page');
  assert.deepEqual(failedPage.facts, []);

  await live.transaction(tx => {
    tx.database.exec(`DROP TRIGGER skip_art_fact;
      CREATE TRIGGER skip_device_fact BEFORE INSERT ON core_history
      WHEN NEW.type = 'org.bunny.device.updated' BEGIN SELECT RAISE(IGNORE); END`);
    const entry = fact(state('device', 'synthetic-lamp', {id: 'synthetic-lamp', revision: 1}), 'bunny/modules/wemo');
    assert.ok(entry.kind === 'message');
    tx.record(entry.message);
  });
  assert.deepEqual(snapshot(core), before, 'ignored unrelated device history remains nonfatal');
  const edited = await art.save({expectedSettingsRevision: 0, policy: {...initialPolicy, browser: false}});
  const afterSuccess = snapshot(core), successfulPage = core.history.settings(pageRead(before.checkpoint));
  assert.equal(edited.settingsRevision, 1);
  assert.deepEqual(afterSuccess.records.find(item => item.family === 'art-schedule')?.value, {policy: edited.policy});
  assert.ok('settings' in successfulPage && successfulPage.settings === 'page');
  assert.deepEqual(successfulPage.facts.map(fact => fact.kind === 'change' ? fact.changed : fact.kind), [{policy: edited.policy}]);
  assert.equal(successfulPage.next, afterSuccess.checkpoint);

  await live.transaction(tx => {
    tx.database.exec(`CREATE TRIGGER skip_art_latest BEFORE UPDATE ON core_history_latest
      WHEN NEW.family = 'art-schedule' BEGIN SELECT RAISE(IGNORE); END`);
  });
  await assert.rejects(art.save({expectedSettingsRevision: 1, policy: initialPolicy}), /settings change was not retained/);
  assert.deepEqual(snapshot(core), afterSuccess);
  await live.transaction(tx => { tx.database.exec('DROP TRIGGER skip_art_latest'); });
  await art.save({expectedSettingsRevision: 1, policy: initialPolicy});
  const reverted = core.history.settings(pageRead(afterSuccess.checkpoint));
  assert.ok('settings' in reverted && reverted.settings === 'page');
  assert.deepEqual(reverted.facts.map(fact => fact.kind === 'change' ? fact.changed : fact.kind), [{policy: initialPolicy}]);
});

it('ignored Art owner inserts and updates leave its policy, revision and settings history unchanged', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const clock = manualClock(atMs);
  await run(context, {modules: [core], clock, scheduler: clock.scheduler});
  const live = handle, art = core.automation.artSchedule;
  assert.ok(live && art);
  const initial = art.get();
  const policy = {...initial.policy, browser: false};
  for (const operation of ['INSERT', 'UPDATE']) {
    const before = snapshot(core), prior = art.get();
    await live.transaction(tx => {
      tx.database.exec(`CREATE TRIGGER ignore_art_owner BEFORE ${operation} ON automation_art_schedule BEGIN SELECT RAISE(IGNORE); END`);
    });
    const next = operation === 'INSERT' ? policy : initial.policy;
    await assert.rejects(art.save({expectedSettingsRevision: prior.settingsRevision, policy: next}), /the art schedule was not stored/);
    assert.deepEqual(art.get(), prior);
    assert.deepEqual(snapshot(core), before);
    const unchanged = core.history.settings(pageRead(before.checkpoint));
    assert.ok('settings' in unchanged && unchanged.settings === 'page');
    assert.deepEqual([unchanged.next, unchanged.facts], [before.checkpoint, []]);

    await live.transaction(tx => { tx.database.exec('DROP TRIGGER ignore_art_owner'); });
    const saved = await art.save({expectedSettingsRevision: prior.settingsRevision, policy: next});
    assert.equal(saved.settingsRevision, prior.settingsRevision + 1);
    const after = snapshot(core), changes = core.history.settings(pageRead(before.checkpoint));
    assert.deepEqual(after.records.find(record => record.family === 'art-schedule')?.value, {policy: next});
    assert.ok('settings' in changes && changes.settings === 'page');
    assert.deepEqual(changes.facts.map(row => row.kind === 'change' ? row.changed : row.kind), [{policy: next}]);
    assert.equal(changes.next, after.checkpoint);
  }
});

it('mode override timestamp and ordering changes advance the scan without an ineffective settings fact', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), start = zero(history);
  const choices = [{target: 'left', mode: 'quiet', selectedAtMs: atMs}, {target: 'right', mode: 'work', selectedAtMs: atMs}];
  let before: object | undefined;
  const mode = (revision: number, overrides: typeof choices, global = 'free') => {
    const value = {id: 'hub', revision, mode: global, selectedAtMs: atMs, overrides};
    const entry = ownerFact('mode', state('mode', 'hub', value, '2.1'), before);
    before = value;
    return entry;
  };
  commit(db, history, [mode(1, choices)], 1);
  const first = page(history, start);
  assert.equal(first.facts.length, 1);
  const [left, right] = choices;
  assert.ok(left && right);
  commit(db, history, [mode(2, [right, {...left, selectedAtMs: atMs + 1}])], 2);
  const repeated = page(history, first.next);
  assert.deepEqual(repeated.facts, []);
  assert.equal(cursor(repeated.next).seq, 2);
  const ordinary = history.read({limit: 1})[0];
  assert.deepEqual(ordinary?.record.changed, {overrides: [right, {...left, selectedAtMs: atMs + 1}]});

  commit(db, history, [mode(3, [right, {...left, mode: 'work'}])], 3);
  const changed = page(history, repeated.next).facts[0];
  assert.ok(changed?.family === 'mode' && changed.kind === 'change');
  assert.deepEqual(changed.changed, {overrides: [{target: 'left', mode: 'work'}, {target: 'right', mode: 'work'}]});
  const changedHead = page(history, repeated.next).next;
  commit(db, history, [mode(4, [right], 'quiet')], 4);
  const single = page(history, changedHead);
  commit(db, history, [mode(5, [{...right, selectedAtMs: atMs + 2}], 'quiet')], 5);
  const repeatedSingle = page(history, single.next);
  assert.deepEqual(repeatedSingle.facts, []);
  assert.equal(cursor(repeatedSingle.applyThrough ?? '').seq, 5);
  commit(db, history, [mode(6, [{...right, selectedAtMs: atMs + 3}])], 6);
  const changedMode = page(history, repeatedSingle.next).facts[0];
  assert.ok(changedMode?.family === 'mode' && changedMode.kind === 'change');
  assert.deepEqual(changedMode.changed, {mode: 'free'});
});

it('competing art policy saves from the same revision retain only the winning settings fact', async context => {
  const core = createCoreModule(), clock = manualClock(atMs);
  await run(context, {modules: [core], clock, scheduler: clock.scheduler});
  const art = core.automation.artSchedule;
  assert.ok(art);
  const initial = art.get(), before = snapshot(core);
  const left = {...initial.policy, browser: false}, right = {...initial.policy, ambient: false};
  const outcomes = await Promise.allSettled([left, right].map(policy => art.save({expectedSettingsRevision: initial.settingsRevision, policy})));
  const winner = outcomes.find(result => result.status === 'fulfilled');
  const loser = outcomes.find(result => result.status === 'rejected');
  assert.ok(winner && loser);
  assert.equal(winner.value.settingsRevision, initial.settingsRevision + 1);
  assert.ok(loser.reason instanceof Error && 'code' in loser.reason);
  assert.equal(loser.reason.code, 'revision-conflict');
  const current = snapshot(core), changes = core.history.settings(pageRead(before.checkpoint));
  assert.ok('settings' in changes && changes.settings === 'page');
  assert.equal(changes.next, current.checkpoint);
  assert.equal(changes.applyThrough, current.checkpoint);
  assert.deepEqual(current.records.find(item => item.family === 'art-schedule')?.value, {policy: winner.value.policy});
  assert.deepEqual(changes.facts.map(row => row.kind === 'change' ? row.changed : row.kind), [{policy: winner.value.policy}]);
});

it('ignored owner writes leave mode and layouts unchanged, including Home reconciliation in a Lighting save', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const clock = manualClock(atMs);
  await run(context, {modules: [core], clock, scheduler: clock.scheduler});
  const live = handle;
  assert.ok(live);
  const entries = ['light:device:lamp-a', 'light:device:lamp-b'].map(widget => ({widget, size: 'medium', hidden: false}));
  const layout = {rooms: [], assignments: [], groups: [{id: 'pair', name: 'Pair', scope: 'home', devices: ['lamp-a', 'lamp-b']}],
    home: [{kind: 'group', id: 'pair'}]};
  const command = (family: string, id: string, requestId: string, data: object): Action => ({
    key: `bunny.cmd.${family}-set.${id}`, requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: `org.bunny.${family}.set.requested`, subject: id, dataschema: `${SCHEMA_BASE}${family}-set/2.0`, data},
  });
  const currentPage = (after: string) => {
    const result = core.history.settings(pageRead(after));
    assert.ok('settings' in result && result.settings === 'page');
    return result;
  };
  const cases = [
    {table: 'core_mode', family: 'mode', id: 'hub', data: {mode: 'quiet', expectedRevision: 0}},
    {table: 'playback_layout', family: 'playback-layout', id: 'playback', data: {assignments: [{playback: 'synthetic-player', rooms: ['synthetic-room']}], expectedRevision: 0}},
    {table: 'home_layout', family: 'home-layout', id: 'home', data: {layouts: {desktop: entries, phone: entries}, expectedRevision: 0}},
    {table: 'lighting_layout', family: 'lighting-layout', id: 'lighting', data: {layout, expectedRevision: 0}},
    {table: 'home_layout', family: 'lighting-layout', id: 'lighting', data: {layout, expectedRevision: 0}},
  ];
  for (const [index, {table, family, id, data}] of cases.entries()) {
    const before = snapshot(core);
    await live.transaction(tx => {
      tx.database.exec(`CREATE TRIGGER ignore_layout_owner BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
    });
    const dispatch = (action: Action) => family === 'mode'
      ? core.actions.dispatch(action) : core.operatorActions.dispatch(action);
    const denied = await dispatch(command(family, id, `ignore-owner-${index}`, data));
    assert.ok('error' in denied, table);
    assert.deepEqual(snapshot(core).records, before.records);
    assert.deepEqual(currentPage(before.checkpoint).facts, []);
    await live.transaction(tx => { tx.database.exec('DROP TRIGGER ignore_layout_owner'); });
    // Leave Lighting at revision zero for the paired-write fault in the next case.
    if (table === 'lighting_layout') continue;
    const retry = await dispatch(command(family, id, `retry-owner-${index}`, data));
    assert.ok('status' in retry, table);
    const caughtUp = currentPage(before.checkpoint);
    assert.equal(caughtUp.next, snapshot(core).checkpoint);
    if (family === 'lighting-layout') {
      assert.deepEqual(caughtUp.facts.map(row => row.family), ['lighting-layout', 'home-layout']);
      assert.equal(new Set(caughtUp.facts.map(row => row.revision)).size, 1);
    } else {
      assert.deepEqual(caughtUp.facts.map(row => row.family), [family]);
    }
  }
});

it('an ignored power-limit definition leaves its owner and settings checkpoint unchanged', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const clock = manualClock(atMs), target = 'synthetic-plug';
  await run(context, {modules: [core], clock, scheduler: clock.scheduler});
  const live = handle;
  assert.ok(live);
  const store = await live.transaction(tx => {
    tx.database.exec('CREATE TRIGGER ignore_limit_owner BEFORE INSERT ON automation_power_limits BEGIN SELECT RAISE(IGNORE); END');
    return new PowerLimitStore(tx.database, work => live.transaction(work));
  });
  const device = deviceRecord(target, 1, 'wemo', 'available');
  const limits = createPowerLimits({store, clock: clock.now, scheduler: clock.scheduler, active: () => true,
    targets: () => [target], owner: () => 'bunny/modules/wemo', current: () => device, read: () => Promise.resolve(device),
    send: () => Promise.reject(new Error('unexpected device command'))});
  context.after(() => limits.close());
  const before = snapshot(core);
  const value = {enabled: false, durationMs: 2000};
  await assert.rejects(limits.save(target, {...value, expectedSettingsRevision: 0}), /the power limit was not stored/);
  assert.equal(limits.get(target), undefined);
  assert.deepEqual(snapshot(core), before);
  await live.transaction(tx => { tx.database.exec('DROP TRIGGER ignore_limit_owner'); });
  assert.equal((await limits.save(target, {...value, expectedSettingsRevision: 0})).settingsRevision, 1);
  const after = snapshot(core), result = core.history.settings(pageRead(before.checkpoint));
  assert.ok('settings' in result && result.settings === 'page');
  assert.deepEqual(after.records.find(row => row.id === target)?.value, value);
  assert.deepEqual(result.facts.map(row => row.kind === 'change' ? row.changed : row.kind), [value]);
  assert.equal(result.next, after.checkpoint);
});

it('a first owner edit after a legacy snapshot survives compaction against a phantom policy', async context => {
  const directory = await stateDir(context), db = openModuleDatabase(directory, 'core');
  const policy = initialArtRecord().policy, phantom = {...policy, browser: false};
  try {
    const history = new History(db);
    commit(db, history, [fact(state('art-schedule', 'art',
      {...initialArtRecord(), revision: 1, settingsRevision: 1, policy: phantom}))], 1);
    // The released writer kept this history even when its owner insert was ignored.
    db.exec(`UPDATE core_history SET continuity = NULL;
      CREATE TABLE core_revision (only INTEGER PRIMARY KEY CHECK (only = 1), value INTEGER NOT NULL, commits INTEGER NOT NULL) STRICT;
      INSERT INTO core_revision VALUES (1,1,1)`);
  } finally { db.close(); }

  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const clock = manualClock(atMs);
  await run(context, {modules: [core], stateDir: directory, clock, scheduler: clock.scheduler});
  const art = core.automation.artSchedule;
  assert.ok(art);
  const before = snapshot(core);
  assert.deepEqual(before.records.find(item => item.family === 'art-schedule')?.value, {policy});
  assert.equal(cursor(before.checkpoint).seq, 1);
  const live = handle;
  assert.ok(live);
  await live.transaction(tx => {
    tx.database.exec(`CREATE TRIGGER discard_settings_patch AFTER INSERT ON core_history
      WHEN NEW.settings_patch IS NOT NULL BEGIN UPDATE core_history SET settings_patch = NULL WHERE seq = NEW.seq; END`);
  });
  await assert.rejects(art.save({expectedSettingsRevision: 0, policy: phantom}), /settings change was not retained/);
  assert.deepEqual(snapshot(core), before);
  assert.equal(art.get().settingsRevision, 0);
  await live.transaction(tx => { tx.database.exec('DROP TRIGGER discard_settings_patch'); });
  assert.equal((await art.save({expectedSettingsRevision: 0, policy: phantom})).settingsRevision, 1);
  const current = snapshot(core), result = core.history.settings(pageRead(before.checkpoint));
  assert.ok('settings' in result && result.settings === 'page');
  assert.deepEqual(current.records.find(item => item.family === 'art-schedule')?.value, {policy: phantom});
  assert.deepEqual(result.facts.map(row => row.kind === 'change' ? row.changed : row.kind), [{policy: phantom}]);
  assert.equal(result.applyThrough, current.checkpoint);
  const raw = core.history.read({kind: 'change'});
  assert.ok(Array.isArray(raw));
  assert.equal(raw.length, 2);
  assert.deepEqual(raw[1]?.record.changed, {});
  assert.deepEqual(raw[1]?.record.removed, []);
  assert.equal(raw[1]?.record.previous, 1);
  assert.equal(cursor(current.checkpoint).seq, 2);
  const unchanged = await art.save({expectedSettingsRevision: 1, policy: phantom});
  assert.equal(unchanged.settingsRevision, 2);
  const empty = core.history.settings(pageRead(current.checkpoint));
  assert.ok('settings' in empty && empty.settings === 'page');
  assert.deepEqual(empty.facts, []);
});


it('the retained delta, span and alarm count stay accurate when an owner patch needs a row', context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  const history = new History(db), initial = initialArtRecord();
  const policy = {...initial.policy, browser: false};
  const recorded = {...initial, policy, settingsRevision: 1, revision: 1};
  const draft = (value: typeof recorded) => state('art-schedule', 'art', value);
  const counted: WrittenChange[] = [];
  history.write([fact(draft(recorded))], atMs, 1, counted);
  history.write([fact(draft({...recorded, revision: 2}))], atMs + 1, 2, counted);
  assert.equal(counted.length, 1);
  const before = page(history, zero(history));
  history.write([ownerFact('art-schedule', draft({...recorded, revision: 3}), initial)], atMs + 2, 3, counted);
  const raw = history.after(history.origin, 0);
  assert.deepEqual(raw.map(row => row.originSeq), [1, 2]);
  assert.deepEqual(raw[1]?.record, {family: 'art-schedule', id: 'art', revision: 3, previous: 1, changed: {}, removed: [],
    span: {sinceAtMs: atMs, lastConfirmedAtMs: atMs + 1, confirmations: 2}});
  assert.equal(counted.length, 1);
  const forced = page(history, before.next);
  assert.deepEqual(forced.facts, [{kind: 'change', family: 'art-schedule', id: 'art', seq: 2, revision: 3,
    atMs: atMs + 2, changed: {policy}, removed: []}]);

  // Generic history can differ from the owner's before value even when only run evidence changed.
  history.write([ownerFact('art-schedule', draft({...initial, revision: 4, weather: 'unavailable'}), initial)], atMs + 3, 4, counted);
  assert.deepEqual(page(history, forced.next).facts, []);
  assert.equal(counted.length, 2);
  assert.equal(history.read({limit: 1})[0]?.record.previous, 3);

  const next = page(history, forced.next).next;
  history.write([ownerFact('art-schedule', draft({...initial, revision: 5, weather: 'disabled'}), {policy})], atMs + 4, 5, counted);
  assert.deepEqual(history.read({limit: 1})[0]?.record.changed, {weather: 'disabled'});
  assert.deepEqual(page(history, next).facts.map(row => row.kind === 'change' ? row.changed : row.kind), [{policy: initial.policy}]);
  assert.equal(counted.length, 3);
});
