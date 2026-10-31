import {randomUUID} from 'node:crypto';
import type {PreferenceView, PreferenceLibrary, ActivePreferences} from '../src/preferences/model.js';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {fullDisk, InProcessBus, type Participant} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';

async function world(t: TestContext) {
  let now = Date.now(); const clock = {now: () => now};
  const dir = await mkdtemp(join(tmpdir(), 'preferences-')), bus = new InProcessBus({now: clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let module = createCompanionsModule(), host = new ModuleHarness(module, {bus, stateDir: dir, clock, section: {}});
  await host.start();
  t.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {core, bus, advance: (ms: number) => {now += ms;}, module: () => module, host: () => host, restart: async () => {
    await host.stop(); module = createCompanionsModule(); host = new ModuleHarness(module, {bus, stateDir: dir, clock, section: {}}); await host.start();
  }};
}

void test('the existing companion owner exposes an empty private preference library with synthetic tasks disabled', async t => {
  const w = await world(t);
  const result = await w.module().manifest.content?.('preferences', {query: {view: 'manage'}, signal: new AbortController().signal});
  assert.ok(result !== undefined && !('error' in result), 'private preference read exists');
  const body = JSON.parse(Buffer.from(result.bytes).toString()) as {schema: string; entries: unknown[]};
  assert.equal(body.schema, 'preference-view/1.0'); assert.deepEqual(body.entries, []);
  assert.equal(w.module().inspectAssistant()?.enabled, false);
  assert.equal(w.module().inspect()?.settings.enabled, false);
});

async function read<T>(w: Awaited<ReturnType<typeof world>>, view = 'manage'): Promise<T> {
  const result = await w.module().manifest.content?.('preferences', {query: {view}, signal: new AbortController().signal});
  assert.ok(result !== undefined && !('error' in result));
  return JSON.parse(Buffer.from(result.bytes).toString()) as T;
}
async function mutate(w: Awaited<ReturnType<typeof world>>, input: object, requestId = randomUUID(), expectedRevision?: number) {
  const revision = expectedRevision ?? (await read<PreferenceView>(w)).revision;
  const staged = await w.module().manifest.upload?.stage({target: 'preferences', name: 'preferences.json', requestId,
    bytes: Buffer.from(JSON.stringify({...input, expectedRevision: revision})), signal: new AbortController().signal});
  assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
  const result = await w.core.request('bunny.cmd.assistant-input.preferences', {type: 'org.bunny.assistant.input.requested', subject: 'preferences',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  return result;
}
void test('explicit preferences retain identity, history and inactive edits across restart', async t => {
  const w = await world(t);
  assert.equal((await mutate(w, {action: 'create', title: 'SYNTHETIC_TITLE', text: 'SYNTHETIC_OLD_TEXT'})).status, 'accepted');
  const first = (await read<PreferenceView>(w)).entries[0]; assert.ok(first); assert.equal(first.active, true);
  assert.equal((await mutate(w, {action: 'set-active', id: first.id, active: false})).status, 'accepted');
  assert.equal((await mutate(w, {action: 'edit', id: first.id, title: 'SYNTHETIC_TITLE', text: 'SYNTHETIC_NEW_TEXT'})).status, 'accepted');
  assert.deepEqual((await read<ActivePreferences>(w, 'active')).entries, []);
  await w.restart();
  const entry = (await read<PreferenceView>(w)).entries[0]; assert.ok(entry);
  assert.equal(entry.id, first.id); assert.equal(entry.active, false); assert.equal(entry.text, 'SYNTHETIC_NEW_TEXT');
  assert.deepEqual(entry.history.map(item => item.action), ['created', 'deactivated', 'edited']);
  assert.equal(entry.history[0]?.text, 'SYNTHETIC_OLD_TEXT');
  assert.equal((await mutate(w, {action: 'set-active', id: first.id, active: true})).status, 'accepted');
  const active = await read<ActivePreferences>(w, 'active');assert.equal(active.entries[0]?.text, 'SYNTHETIC_NEW_TEXT');
  assert.equal(JSON.stringify(active).includes('SYNTHETIC_OLD_TEXT'), false);
  assert.equal('history' in (active.entries[0] ?? {}), false);
  assert.equal(w.module().inspectAssistant()?.enabled, false);
  assert.equal(JSON.stringify(w.host().logs).includes('SYNTHETIC_'), false);
});

void test('versioned imports preserve existing IDs and histories, add missing IDs inactive and remain safe on repeat and old exports', async t => {
  const origin = await world(t);
  await mutate(origin, {action: 'create', title: 'Existing', text: 'SYNTHETIC_OLD'});
  await mutate(origin, {action: 'create', title: 'Missing', text: 'SYNTHETIC_IMPORTED'});
  const exported = await read<PreferenceLibrary>(origin, 'export');
  assert.equal(exported.schema, 'preference-library/1.0');
  const first = exported.entries[0], second = exported.entries[1]; assert.ok(first && second);
  const w = await world(t);
  assert.equal((await mutate(w, {action: 'import', library: {schema: exported.schema, entries: [first]}})).status, 'accepted');
  let imported = (await read<PreferenceView>(w)).entries[0]; assert.ok(imported);
  assert.equal(imported.id, first.id); assert.equal(imported.active, false);
  assert.deepEqual(imported.history.slice(0, -1), first.history);
  assert.deepEqual(imported.history.at(-1), {action: 'imported', source: 'import', atMs: imported.updatedAtMs, title: first.title, text: first.text, active: false});
  assert.deepEqual((await read<ActivePreferences>(w, 'active')).entries, []);
  await mutate(w, {action: 'set-active', id: first.id, active: true});
  await mutate(w, {action: 'edit', id: first.id, title: 'Current', text: 'SYNTHETIC_CURRENT'});
  await mutate(w, {action: 'set-active', id: first.id, active: false});
  const current = (await read<PreferenceView>(w)).entries[0];
  assert.equal((await mutate(w, {action: 'import', library: exported})).status, 'accepted');
  const entries = (await read<PreferenceView>(w)).entries;
  assert.equal(entries.length, 2); assert.deepEqual(entries[0], current);
  imported = entries[1]; assert.ok(imported); assert.equal(imported.id, second.id); assert.equal(imported.active, false);
  assert.deepEqual(imported.history.slice(0, -1), second.history);
  await mutate(w, {action: 'import', library: exported}); await w.restart();
  assert.deepEqual((await read<PreferenceLibrary>(w, 'export')).entries, entries);
  // An exported inactive preference also stays inactive in a different installation.
  const fresh = await world(t);
  await mutate(fresh, {action: 'import', library: await read<PreferenceLibrary>(w, 'export')});
  assert.equal((await read<PreferenceView>(fresh)).entries.every(entry => !entry.active), true);
});

void test('invalid complete imports and a failed transaction leave every entry and revision unchanged', async t => {
  const origin = await world(t);
  await mutate(origin, {action: 'create', title: 'One', text: 'SYNTHETIC_ONE'});
  await mutate(origin, {action: 'create', title: 'Two', text: 'SYNTHETIC_TWO'});
  const library = await read<PreferenceLibrary>(origin, 'export');
  const w = await world(t), before = await read<PreferenceView>(w);
  const invalid = [
    '{broken',
    JSON.stringify({action: 'import', expectedRevision: before.revision, library: {...library, schema: 'preference-library/2.0'}}),
    JSON.stringify({action: 'import', expectedRevision: before.revision, library: {...library, entries: [...library.entries, library.entries[0]]}}),
    JSON.stringify({action: 'import', expectedRevision: before.revision, library: {...library, entries: [library.entries[0], {...library.entries[1], history: []}]}}),
  ];
  for (const bytes of invalid) {
    const result = await w.module().manifest.upload?.stage({target: 'preferences', name: 'preferences.json', requestId: randomUUID(), bytes: Buffer.from(bytes), signal: new AbortController().signal});
    assert.ok(result !== undefined && 'error' in result); assert.equal(result.error.code, 'invalid-request');
    assert.deepEqual(await read<PreferenceView>(w), before);
  }
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec(`CREATE TRIGGER fail_second_preference BEFORE INSERT ON preferences WHEN (SELECT COUNT(*) FROM preferences)=1 BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;`);
  const refused = await mutate(w, {action: 'import', library});
  assert.equal(refused.status, 'rejected'); assert.equal(refused.status === 'rejected' && refused.error.error.code, 'internal');
  assert.deepEqual(await read<PreferenceView>(w), before, 'the first insertion and revision roll back with the second');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM preference_receipts').get() as {n: number}).n, 0);
  db.exec('DROP TRIGGER fail_second_preference');
  assert.equal((await mutate(w, {action: 'import', library})).status, 'accepted');
  assert.equal((await read<PreferenceView>(w)).entries.length, 2);
});

async function stage(w: Awaited<ReturnType<typeof world>>, requestId: string) {
  const result = await w.module().manifest.upload?.stage({target: 'preferences', name: 'preferences.json', requestId,
    bytes: Buffer.from(JSON.stringify({action: 'create', title: 'Synthetic', text: 'SYNTHETIC_BOUNDARY', expectedRevision: (await read<PreferenceView>(w)).revision})), signal: new AbortController().signal});
  assert.ok(result !== undefined && !('error' in result)); return result;
}
async function submit(core: Participant, requestId: string, data: object) {
  return core.request('bunny.cmd.assistant-input.preferences', {type: 'org.bunny.assistant.input.requested', subject: 'preferences',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...data}}, {requestId, timeoutMs: 5000});
}
void test('staged inputs bind request, source and revision, expire, and never replay on restart', async t => {
  const w = await world(t), requestId = randomUUID(), staged = await stage(w, requestId);
  const foreign = w.bus.connect('bunny/parts/foreign'); t.after(() => foreign.close());
  assert.equal((await submit(foreign, requestId, staged.data)).status, 'rejected');
  assert.equal((await submit(w.core, randomUUID(), staged.data)).status, 'rejected');
  assert.deepEqual((await read<PreferenceView>(w)).entries, []);
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted');
  const saved = await read<PreferenceView>(w);
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted');
  assert.deepEqual(await read<PreferenceView>(w), saved, 'duplicate request does not append history or revision');
  const changedRef = await stage(w, requestId);
  const conflict = await submit(w.core, requestId, changedRef.data);
  assert.equal(conflict.status, 'rejected'); if (conflict.status === 'rejected') assert.equal(conflict.error.error.code, 'duplicate-conflict');
  const oldRevision = await mutate(w, {action: 'create', title: 'Stale', text: 'SYNTHETIC_STALE'}, randomUUID(), 0);
  assert.equal(oldRevision.status, 'rejected'); if (oldRevision.status === 'rejected') assert.equal(oldRevision.error.error.code, 'revision-conflict');
  const expiringId = randomUUID(), expiring = await stage(w, expiringId); w.advance(5001);
  const expired = await submit(w.core, expiringId, expiring.data);
  assert.equal(expired.status, 'rejected'); if (expired.status === 'rejected') assert.equal(expired.error.error.code, 'expired');
  const abandonedId = randomUUID(), abandoned = await stage(w, abandonedId);
  await w.restart();
  assert.deepEqual(await read<PreferenceView>(w), saved);
  assert.equal((await submit(w.core, abandonedId, abandoned.data)).status, 'rejected');
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted', 'committed receipt survives restart');
  assert.deepEqual(await read<PreferenceView>(w), saved);
});

void test('real SQLite capacity failure rolls back import and returns a content-free refusal', async t => {
  const origin = await world(t); await mutate(origin, {action: 'create', title: 'Synthetic', text: 'SYNTHETIC_FULL_DISK'});
  const library = await read<PreferenceLibrary>(origin, 'export'), w = await world(t), before = await read<PreferenceView>(w);
  const requestId = randomUUID();
  const staged = await w.module().manifest.upload?.stage({target: 'preferences', name: 'preferences.json', requestId,
    bytes: Buffer.from(JSON.stringify({action: 'import', expectedRevision: before.revision, library})), signal: new AbortController().signal});
  assert.ok(staged !== undefined && !('error' in staged));
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec('CREATE TABLE preference_full_fixture (value BLOB); CREATE TRIGGER preference_full BEFORE INSERT ON preferences BEGIN INSERT INTO preference_full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count); db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  assert.throws(() => db.prepare('INSERT INTO preferences VALUES(?,?)').run('synthetic-probe', '{}'), error => fullDisk(error));
  const result = await submit(w.core, requestId, staged.data);
  assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.error.error.code, 'capacity');
  assert.deepEqual(await read<PreferenceView>(w), before);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_FULL_DISK'), false); assert.equal(JSON.stringify(result).includes('SQLITE'), false);
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER preference_full');
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted', 'no false committed receipt prevents the explicit retry');
});
