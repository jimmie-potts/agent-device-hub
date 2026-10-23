import {AssistantStore} from '../src/assistant/store.js';
import {randomUUID} from 'node:crypto';
import type {PreferenceView, ActivePreferences} from '../src/preferences/model.js';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';
import type {CompanionMessage, Conversation} from '../src/knowledge/model.js';

type WidgetRead = {schema: string; revision: number; conversation: Conversation | null; messages: CompanionMessage[]; next: number | null};
void test('Duck selection refuses private or missing conversations and preserves current choice on conflict', async t => {
  const w = await world(t);
  const archive = await privateRead<import('../src/knowledge/model.js').Archive>(w, 'companion-archive');
  archive.conversations.push({id: 'private-duck', participants: ['microduck'], epoch: 'private-duck', profile: 'microduck'});
  await mutate(w, {action: 'import-archive', archive});
  const denied = await mutate(w, {action: 'select-duck-conversation', conversationId: 'private-duck'});
  assert.equal(denied.status, 'rejected'); if (denied.status === 'rejected') assert.equal(denied.error.error.code, 'forbidden');
  const missing = await mutate(w, {action: 'select-duck-conversation', conversationId: 'missing'});
  assert.equal(missing.status, 'rejected'); if (missing.status === 'rejected') assert.equal(missing.error.error.code, 'not-found');
  await mutate(w, {action: 'fixture'});
  const list = await privateRead<{conversations: Conversation[]}>(w, 'companion-history', {profile: 'reachy'});
  const conversationId = list.conversations[0]?.id; assert.ok(conversationId !== undefined);
  const oldRevision = (await privateRead<WidgetRead>(w, 'duck-widget')).revision;
  const requestId = randomUUID();
  await mutate(w, {action: 'select-duck-conversation', conversationId}, requestId, oldRevision);
  const selected = await privateRead<WidgetRead>(w, 'duck-widget');
  const conflict = await mutate(w, {action: 'select-duck-conversation', conversationId: null}, randomUUID(), oldRevision);
  assert.equal(conflict.status, 'rejected'); if (conflict.status === 'rejected') assert.equal(conflict.error.error.code, 'revision-conflict');
  await mutate(w, {action: 'select-duck-conversation', conversationId}, requestId, oldRevision);
  assert.deepEqual(await privateRead(w, 'duck-widget'), selected, 'repeated admitted identity has no second effect');
  await refusal(w, 'duck-widget', {view: 'latest', after: '2'}, 'invalid-request');
  await refusal(w, 'duck-widget', {conversationId: 'private-duck'}, 'invalid-request');
  await refusal(w, 'duck-widget', {view: 'history', after: '-1'}, 'invalid-request');
});

void test('Duck selected history pages beyond twenty messages without changing latest on Reachy replies', async t => {
  const w = await world(t); await mutate(w, {action: 'fixture'});
  const archive = await privateRead<import('../src/knowledge/model.js').Archive>(w, 'companion-archive');
  const template = archive.messages[0]; assert.ok(template);
  archive.messages.push(...Array.from({length: 25}, (_, index) => ({...template, messageId: `later-${index}`, ordering: {...template.ordering, sequence: index + 5}})));
  await mutate(w, {action: 'import-archive', archive});
  await mutate(w, {action: 'select-duck-conversation', conversationId: template.conversationId});
  const first = await privateRead<WidgetRead>(w, 'duck-widget', {view: 'history'});
  assert.equal(first.messages.length, 16); assert.equal(first.next, 16);
  const next = await privateRead<WidgetRead>(w, 'duck-widget', {view: 'history', after: String(first.next)});
  assert.equal(next.messages.length, 13); assert.equal(next.next, null);
  assert.equal((await privateRead<WidgetRead>(w, 'duck-widget')).messages[0]?.ordering.sequence, 4);
  await mutate(w, {action: 'import-archive', archive});
  assert.equal((await privateRead<WidgetRead>(w, 'duck-widget')).conversation?.id, template.conversationId);
});
void test('Duck widget follows only the explicit shared conversation across correction, removal and restart', async t => {
  const w = await world(t);
  const widget = () => privateRead<WidgetRead>(w, 'duck-widget');
  assert.equal((await widget()).conversation, null);
  await mutate(w, {action: 'fixture'});
  const list = await privateRead<{conversations: Conversation[]}>(w, 'companion-history', {profile: 'reachy'});
  const conversationId = list.conversations[0]?.id; assert.ok(conversationId !== undefined);
  assert.equal((await widget()).conversation, null, 'creating a conversation never selects it');
  assert.equal((await mutate(w, {action: 'select-duck-conversation', conversationId})).status, 'accepted');
  const selected = await widget();
  assert.equal(selected.schema, 'duck-widget/1.0'); assert.equal(selected.conversation?.id, conversationId);
  assert.equal(selected.messages.length, 1); assert.equal(selected.messages[0]?.speakerId, 'microduck');
  const history = await privateRead<WidgetRead>(w, 'duck-widget', {view: 'history'});
  assert.equal(history.messages.length, 4);
  const first = history.messages[1], latest = selected.messages[0]; assert.ok(first !== undefined && latest !== undefined);
  await mutate(w, {action: 'fixture'});
  assert.equal((await widget()).conversation?.id, conversationId, 'new unrelated exchange never changes selection');
  await mutate(w, {action: 'correct-message', messageId: first.messageId, meaning: {kind: 'emotion', emotion: 'delighted'}});
  assert.equal((await widget()).messages[0]?.messageId, latest.messageId, 'correction cannot reorder messages');
  await mutate(w, {action: 'delete-message', messageId: latest.messageId});
  await w.restart();
  const remaining = await widget();
  assert.equal(remaining.messages[0]?.messageId, first.messageId);
  assert.equal(remaining.messages[0]?.createdAtMs, first.createdAtMs);
  assert.deepEqual(remaining.messages[0]?.meaning, {kind: 'emotion', emotion: 'delighted'});
  await mutate(w, {action: 'delete-message', messageId: first.messageId});
  assert.deepEqual((await widget()).messages, []); assert.equal((await widget()).conversation?.id, conversationId);
  await mutate(w, {action: 'select-duck-conversation', conversationId: null});
  await w.restart(); assert.equal((await widget()).conversation, null);
  assert.equal(w.module().inspectAssistant()?.enabled, false, 'reads do not execute the assistant');
});

async function world(t: TestContext) {
  let now = Date.now(); const clock = {now: () => now};
  const dir = await mkdtemp(join(tmpdir(), 'preferences-')), bus = new InProcessBus({now: clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let module = createCompanionsModule(), host = new ModuleHarness(module, {bus, stateDir: dir, clock});
  await host.start();
  t.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {core, bus, advance: (ms: number) => {now += ms;}, module: () => module, host: () => host, restart: async () => {
    await host.stop(); module = createCompanionsModule(); host = new ModuleHarness(module, {bus, stateDir: dir, clock}); await host.start();
  }};
}

async function read<T>(w: Awaited<ReturnType<typeof world>>, view = 'manage'): Promise<T> {
  const result = await w.module().manifest.content?.('knowledge', {query: {view}, signal: new AbortController().signal});
  assert.ok(result !== undefined && !('error' in result));
  return JSON.parse(Buffer.from(result.bytes).toString()) as T;
}
async function mutate(w: Awaited<ReturnType<typeof world>>, input: object, requestId = randomUUID(), expectedRevision?: number) {
  const revision = expectedRevision ?? (await read<PreferenceView>(w)).revision;
  const staged = await w.module().manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId,
    bytes: Buffer.from(JSON.stringify({...input, expectedRevision: revision})), signal: new AbortController().signal});
  assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
  const result = await w.core.request('bunny.cmd.assistant-input.knowledge', {type: 'org.bunny.assistant.input.requested', subject: 'knowledge',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  return result;
}
void test('explicit knowledge uses the existing owner and survives inactive edits and restart', async t => {
  const w = await world(t);
  const before = await read<PreferenceView>(w);
  assert.equal(before.schema, 'knowledge-view/1.0');
  assert.deepEqual(before.entries, []);
  assert.equal((await mutate(w, {action: 'create', title: 'Synthetic Frank', text: 'Frank is a fictional friend.'})).status, 'accepted');
  const first = (await read<PreferenceView>(w)).entries[0]; assert.ok(first);
  await mutate(w, {action: 'set-active', id: first.id, active: false});
  await mutate(w, {action: 'edit', id: first.id, title: 'Synthetic Frank', text: 'Frank likes fictional gardens.'});
  assert.deepEqual((await read<ActivePreferences>(w, 'active')).entries, []);
  await w.restart();
  const entry = (await read<PreferenceView>(w)).entries[0]; assert.ok(entry);
  assert.equal(entry.id, first.id); assert.equal(entry.active, false);
  assert.deepEqual(entry.history.map(event => event.action), ['created', 'deactivated', 'edited']);
  await mutate(w, {action: 'set-active', id: first.id, active: true});
  assert.equal((await read<ActivePreferences>(w, 'active')).entries[0]?.text, 'Frank likes fictional gardens.');
  assert.equal(w.module().inspectAssistant()?.enabled, false);
  assert.equal(JSON.stringify(w.host().logs).includes('fictional'), false);
});

void test('shared synthetic history corrects without reordering and deletion survives old imports', async t => {
  const w = await world(t);
  const content = async (ref: string, query: Record<string, string> = {}) => {
    const result = await w.module().manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(result !== undefined && !('error' in result), 'private attributed content exists');
    return JSON.parse(Buffer.from(result.bytes).toString()) as {conversations: {id: string}[]; messages: {messageId: string; speakerId: string; revision: number; ordering: {sequence: number}; meaning: {text?: string}}[]};
  };
  await mutate(w, {action: 'fixture'});
  const listing = await content('companion-history', {profile: 'microduck'});
  const conversationId = listing.conversations[0]?.id; assert.ok(conversationId !== undefined);
  const query = {profile: 'microduck', conversationId};
  const first = await content('companion-history', query);
  assert.equal(first.messages.length, 4);
  const ducks = first.messages.filter(message => message.speakerId === 'microduck'); assert.equal(ducks.length, 2);
  const older = ducks[0], latest = ducks[1]; assert.ok(older && latest);
  const exported = await content('companion-archive');
  await mutate(w, {action: 'correct-message', messageId: older.messageId, meaning: {kind: 'literal', text: 'Synthetic corrected meaning', language: 'en'}});
  await mutate(w, {action: 'delete-message', messageId: latest.messageId});
  await mutate(w, {action: 'import-archive', archive: exported});
  await w.restart();
  const remaining = await content('companion-history', {...query, latest: 'microduck'});
  assert.equal(remaining.messages.length, 1);
  assert.equal(remaining.messages[0]?.messageId, older.messageId);
  assert.equal(remaining.messages[0]?.meaning.text, 'Synthetic corrected meaning');
  assert.equal(remaining.messages[0]?.ordering.sequence, older.ordering.sequence);
  assert.equal(remaining.messages[0]?.revision, 2);
});

async function privateRead<T>(w: Awaited<ReturnType<typeof world>>, ref: string, query: Record<string, string> = {}): Promise<T> {
  const result = await w.module().manifest.content?.(ref, {query, signal: new AbortController().signal});
  assert.ok(result !== undefined && !('error' in result), JSON.stringify(result));
  return JSON.parse(Buffer.from(result.bytes).toString()) as T;
}
async function refusal(w: Awaited<ReturnType<typeof world>>, ref: string, query: Record<string, string>, code: string) {
  const result = await w.module().manifest.content?.(ref, {query, signal: new AbortController().signal});
  assert.ok(result !== undefined && 'error' in result); assert.equal(result.error.code, code);
}
async function archive(w: Awaited<ReturnType<typeof world>>) {return privateRead<import('../src/knowledge/model.js').Archive>(w, 'companion-archive');}

void test('current context excludes inactive knowledge, private conversations, removed messages and unapproved destinations', async t => {
  const w = await world(t);
  for (const [title, text] of [['Person', 'Synthetic Frank'], ['Relationship', 'Frank is a fictional friend'], ['Event', 'A fictional picnic happened last year'], ['Stated routine', 'The fictional owner states they walk daily']]) {
    await mutate(w, {action: 'create', title, text});
  }
  await mutate(w, {action: 'fixture'});
  let saved = await archive(w); const conversationId = saved.conversations[0]?.id, message = saved.messages[0]; assert.ok(conversationId !== undefined && message !== undefined);
  type Context = import('../src/knowledge/model.js').ContextDocument;
  const query = {profile: 'reachy', conversationId, messages: message.messageId};
  const current = await privateRead<Context>(w, 'companion-context', query);
  assert.equal(current.knowledge.length, 4); assert.equal(current.messages.length, 1); assert.equal(current.persona.id, 'reachy');
  assert.equal(current.knowledge.some(value => value.text.includes('fictional garden adventure')), false);
  await refusal(w, 'companion-context', {...query, profile: 'bunny'}, 'forbidden');
  await refusal(w, 'companion-context', {...query, destination: 'unselected-cloud'}, 'forbidden');
  await refusal(w, 'companion-history', {profile: 'bunny', conversationId}, 'forbidden');
  const first = saved.knowledge[0]; assert.ok(first);
  await mutate(w, {action: 'set-active', id: first.id, active: false});
  await mutate(w, {action: 'correct-message', messageId: message.messageId, meaning: {kind: 'unknown'}});
  const corrected = await privateRead<Context>(w, 'companion-context', query);
  assert.equal(corrected.knowledge.length, 3); assert.deepEqual(corrected.messages[0]?.meaning, {kind: 'unknown'});
  await mutate(w, {action: 'delete-message', messageId: message.messageId});
  assert.deepEqual((await privateRead<Context>(w, 'companion-context', query)).messages, []);
  assert.deepEqual((await privateRead<Context>(w, 'companion-context', {profile: 'reachy'})).messages, []);
  saved = await archive(w); assert.equal(JSON.stringify(saved).includes('A fictional garden adventure?'), false);
  await w.host().stop();
  await refusal(w, 'companion-history', {profile: 'reachy'}, 'unavailable');
});

void test('archive recovery preserves local entries and voice choices, adds missing entries inactive and retains removals on fresh restore', async t => {
  const origin = await world(t), target = await world(t);
  await mutate(origin, {action: 'create', title: 'Synthetic note', text: 'SYNTHETIC_KNOWLEDGE'});
  await mutate(origin, {action: 'fixture'}); await mutate(origin, {action: 'set-voice', persona: 'reachy', voiceRef: 'synthetic-voice-a'});
  const exported = await archive(origin);
  await mutate(target, {action: 'set-voice', persona: 'reachy', voiceRef: 'synthetic-voice-b'});
  assert.equal((await mutate(target, {action: 'import-archive', archive: exported})).status, 'accepted');
  let recovered = await archive(target);
  assert.equal(recovered.knowledge[0]?.active, false); assert.equal(recovered.voices.find(value => value.id === 'reachy')?.voiceRef, 'synthetic-voice-b');
  assert.ok(recovered.messages.every(value => value.provenance.imported));
  const note = recovered.knowledge[0], message = recovered.messages.at(-1); assert.ok(note !== undefined && message !== undefined);
  await mutate(target, {action: 'edit', id: note.id, title: 'Current', text: 'CURRENT_SYNTHETIC'});
  await mutate(target, {action: 'delete-message', messageId: message.messageId});
  recovered = await archive(target);
  await mutate(target, {action: 'import-archive', archive: exported}); await target.restart();
  assert.deepEqual(await archive(target), recovered);
  const fresh = await world(t);
  await mutate(fresh, {action: 'import-archive', archive: recovered});
  await mutate(fresh, {action: 'import-archive', archive: exported});
  const final = await archive(fresh);
  assert.equal(final.messages.some(value => value.messageId === message.messageId), false);
  assert.equal(final.removals[0]?.messageId, message.messageId);
  assert.equal(final.knowledge[0]?.active, false);
  // An older file on its own has no evidence of a deletion made later.
  const oldOnly = await world(t); await mutate(oldOnly, {action: 'import-archive', archive: exported});
  assert.ok((await archive(oldOnly)).messages.some(value => value.messageId === message.messageId));
});

void test('whole-archive validation, ordering conflicts and transaction interruption leave every family unchanged', async t => {
  const origin = await world(t), w = await world(t);
  await mutate(origin, {action: 'create', title: 'First', text: 'Synthetic first'}); await mutate(origin, {action: 'create', title: 'Second', text: 'Synthetic second'});
  await mutate(origin, {action: 'fixture'}); const exported = await archive(origin), before = await archive(w);
  const bad = [ {...exported, schema: 'companion-archive/9.0'}, {...exported, unknown: true}, {...exported, messages: [...exported.messages, exported.messages[0]]},
    {...exported, conversations: []}, {...exported, messages: [{...exported.messages[0], revision: 0}]} ];
  for (const value of bad) {
    const staged = await w.module().manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId: randomUUID(), signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'import-archive', archive: value, expectedRevision: 0}))});
    assert.ok(staged !== undefined && 'error' in staged); assert.deepEqual(await archive(w), before);
  }
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec("CREATE TRIGGER knowledge_interrupt BEFORE INSERT ON knowledge WHEN (SELECT COUNT(*) FROM knowledge)=1 BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
  const failed = await mutate(w, {action: 'import-archive', archive: exported}); assert.equal(failed.status, 'rejected');
  assert.deepEqual(await archive(w), before); assert.equal(w.module().inspectAssistant()?.revision, 0);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM knowledge_receipts').get()?.n), 0);
  db.exec('DROP TRIGGER knowledge_interrupt');
  await mutate(w, {action: 'import-archive', archive: exported});
  const saved = await archive(w), conflict = structuredClone(exported); const changed = conflict.messages[0]; assert.ok(changed); changed.createdAtMs += 1;
  assert.equal((await mutate(w, {action: 'import-archive', archive: conflict})).status, 'rejected'); assert.deepEqual(await archive(w), saved);
  const slot = structuredClone(exported); const duplicate = slot.messages[0]; assert.ok(duplicate); duplicate.messageId = randomUUID();
  assert.equal((await mutate(w, {action: 'import-archive', archive: slot})).status, 'rejected'); assert.deepEqual(await archive(w), saved);
});

void test('legacy messages preserve IDs, order and unknown evidence; unfinished tasks refuse correction and imported removal', async t => {
  const w = await world(t), db = w.host().moduleDatabase(); assert.ok(db);
  const store = new AssistantStore(db), task = store.newTask('bunny', 'Legacy synthetic task'); task.status = 'succeeded'; store.save(task);
  const conversationId = task.conversationId, taskId = task.id, messageId = randomUUID();
  db.prepare('INSERT INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms) VALUES(?,?,?,?,?,?)').run(messageId, conversationId, taskId, 'assistant', 'Legacy synthetic text', 1234);
  await w.restart();
  const original = (await archive(w)).messages.find(value => value.messageId === messageId); assert.ok(original);
  assert.equal(original.createdAtMs, 1234); assert.deepEqual(original.meaning, {kind: 'unknown'}); assert.equal(original.recipientIds, null); assert.deepEqual(original.deliveryRefs, []);
  const activeDb = w.host().moduleDatabase(); assert.ok(activeDb);
  activeDb.prepare("UPDATE assistant_tasks SET status='waiting' WHERE id=?").run(taskId);
  const before = await archive(w);
  for (const input of [{action: 'correct-message', messageId, meaning: {kind: 'literal', text: 'Changed', language: 'en'}}, {action: 'delete-message', messageId},
    {action: 'import-archive', archive: {...before, messages: [], removals: [{messageId, conversationId, ordering: original.ordering, removedAtMs: 9999}]}}]) {
    const response = await mutate(w, input); assert.equal(response.status, 'rejected'); if (response.status === 'rejected') assert.equal(response.error.error.code, 'invalid-state');
    assert.deepEqual(await archive(w), before);
  }
  activeDb.prepare("UPDATE assistant_tasks SET status='cancelled' WHERE id=?").run(taskId);
  const removed = await mutate(w, {action: 'delete-message', messageId}); assert.equal(removed.status, 'accepted');
  assert.equal((await archive(w)).messages.length, 0);
});

void test('knowledge staged requests enforce source, revision, expiry, duplicate identity and restart without applying text twice', async t => {
  const w = await world(t);
  const stage = async (requestId: string) => {
    const staged = await w.module().manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'create', title: 'Synthetic boundary', text: 'PRIVATE_SYNTHETIC_BOUNDARY', expectedRevision: (await read<PreferenceView>(w)).revision}))});
    assert.ok(staged !== undefined && !('error' in staged)); return staged;
  };
  const submit = (client: typeof w.core, requestId: string, data: object) => client.request('bunny.cmd.assistant-input.knowledge', {type: 'org.bunny.assistant.input.requested', subject: 'knowledge',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...data}}, {requestId, timeoutMs: 5000});
  const requestId = randomUUID(), staged = await stage(requestId), foreign = w.bus.connect('bunny/parts/foreign'); t.after(() => foreign.close());
  assert.equal((await submit(foreign, requestId, staged.data)).status, 'rejected');
  assert.equal((await submit(w.core, randomUUID(), staged.data)).status, 'rejected');
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted');
  const before = await archive(w);
  assert.equal((await submit(w.core, requestId, staged.data)).status, 'accepted'); assert.deepEqual(await archive(w), before);
  assert.equal((await mutate(w, {action: 'fixture'}, randomUUID(), 0)).status, 'rejected');
  const expiringId = randomUUID(), expiring = await stage(expiringId); w.advance(5001);
  assert.equal((await submit(w.core, expiringId, expiring.data)).status, 'rejected');
  const abandonedId = randomUUID(), abandoned = await stage(abandonedId); await w.restart();
  assert.equal((await submit(w.core, abandonedId, abandoned.data)).status, 'rejected'); assert.deepEqual(await archive(w), before);
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE_SYNTHETIC_BOUNDARY'), false);
});

void test('SQLite full disk refuses the complete archive including messages and revision, with no partial import', async t => {
  const source = await world(t), w = await world(t); await mutate(source, {action: 'fixture'}); await mutate(source, {action: 'create', title: 'Synthetic', text: 'Synthetic full disk'});
  const exported = await archive(source), before = await archive(w), requestId = randomUUID();
  const staged = await w.module().manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'import-archive', archive: exported, expectedRevision: 0}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec('CREATE TABLE knowledge_full_fixture (value BLOB); CREATE TRIGGER knowledge_full BEFORE INSERT ON knowledge BEGIN INSERT INTO knowledge_full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count); db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  const response = await w.core.request('bunny.cmd.assistant-input.knowledge', {type: 'org.bunny.assistant.input.requested', subject: 'knowledge',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  assert.equal(response.status, 'rejected'); if (response.status === 'rejected') assert.equal(response.error.error.code, 'capacity');
  assert.deepEqual(await archive(w), before); assert.equal(w.module().inspectAssistant()?.revision, 0);
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER knowledge_full');
});

void test('bounded history advances, recipient restrictions apply and deleting all Duck messages gives empty', async t => {
  const source = await world(t); await mutate(source, {action: 'fixture'}); const exported = await archive(source);
  const seed = exported.messages[0]; assert.ok(seed); const conversationId = seed.conversationId;
  exported.messages = Array.from({length: 20}, (_, index) => ({...structuredClone(seed), messageId: randomUUID(), ordering: {...seed.ordering, sequence: index + 1}}));
  const w = await world(t); await mutate(w, {action: 'import-archive', archive: exported});
  type Page = import('../src/knowledge/model.js').HistoryPage;
  const first = await privateRead<Page>(w, 'companion-history', {profile: 'microduck', conversationId});
  assert.equal(first.messages.length, 16); assert.equal(first.next, 16);
  const second = await privateRead<Page>(w, 'companion-history', {profile: 'microduck', conversationId, after: String(first.next)});
  assert.equal(second.messages.length, 4); assert.equal(second.next, null);
  const restricted = structuredClone(exported); const record = restricted.messages[0]; assert.ok(record); record.speakerId = 'owner'; record.recipientIds = ['reachy']; record.messageId = randomUUID(); record.ordering.sequence = 21;
  restricted.messages = [record]; await mutate(w, {action: 'import-archive', archive: restricted});
  await refusal(w, 'companion-context', {profile: 'microduck', conversationId, messages: record.messageId}, 'forbidden');
  assert.equal((await privateRead<Page>(w, 'companion-history', {profile: 'microduck', conversationId, after: '20'})).messages.length, 0);
  const original = await archive(source);
  for (const message of original.messages.filter(value => value.speakerId === 'microduck')) await mutate(source, {action: 'delete-message', messageId: message.messageId});
  assert.deepEqual((await privateRead<Page>(source, 'companion-history', {profile: 'microduck', conversationId, latest: 'microduck'})).messages, []);
});

void test('combined retained capacity refuses additions without discarding inactive history', async t => {
  const w = await world(t);
  const history = Array.from({length: 1050}, (_, index) => ({action: index === 0 ? 'created' : 'edited', source: 'owner', atMs: 1, title: 'Synthetic capacity', text: 'x'.repeat(4096), active: true}));
  const entry = {id: 'capacity-first', title: 'Synthetic capacity', text: 'x'.repeat(4096), active: true, createdAtMs: 1, updatedAtMs: 1, history};
  const library = {schema: 'knowledge-library/1.0', entries: [entry]};
  assert.equal((await mutate(w, {action: 'import', library})).status, 'accepted');
  const before = await read<PreferenceView>(w);
  const second = await mutate(w, {action: 'import', library: {...library, entries: [{...entry, id: 'capacity-second'}]}});
  assert.equal(second.status, 'rejected'); if (second.status === 'rejected') assert.equal(second.error.error.code, 'capacity');
  assert.deepEqual(await read<PreferenceView>(w), before); assert.equal(before.entries[0]?.history.length, 1051);
});

void test('imports cannot replace operational tool rows with conversation content or removals', async t => {
  const source = await world(t), w = await world(t); await mutate(source, {action: 'fixture'}); const exported = await archive(source);
  const message = exported.messages[0]; assert.ok(message); const db = w.host().moduleDatabase(); assert.ok(db);
  db.prepare('INSERT INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms) VALUES(?,?,?,?,?,?)').run(message.messageId, 'operational-conversation', 'operational-task', 'tool', 'Synthetic operational evidence', 1);
  assert.equal((await mutate(w, {action: 'import-archive', archive: exported})).status, 'rejected');
  const removed = {...exported, messages: [], removals: [{messageId: message.messageId, conversationId: message.conversationId, ordering: message.ordering, removedAtMs: 2}]};
  assert.equal((await mutate(w, {action: 'import-archive', archive: removed})).status, 'rejected');
  assert.equal(db.prepare('SELECT text FROM assistant_messages WHERE id=?').get(message.messageId)?.text, 'Synthetic operational evidence');
});

void test('archive order conflicts are independent of JSON property order', async t => {
  const source = await world(t), target = await world(t); await mutate(source, {action: 'fixture'});
  const exported = await archive(source), template = exported.messages[0]; assert.ok(template);
  const messages = Array.from({length: 16}, (_, index) => ({...template, messageId: randomUUID(), ordering: {...template.ordering, sequence: index + 1}}));
  const duplicate = {...template, messageId: randomUUID(), ordering: {sequence: 16, epoch: template.ordering.epoch, authority: template.ordering.authority}};
  const before = await archive(target);
  for (const conflict of [
    {...exported, messages: [...messages, duplicate]},
    {...exported, messages, removals: [{messageId: duplicate.messageId, conversationId: duplicate.conversationId, ordering: duplicate.ordering, removedAtMs: 1}]},
  ]) {
    const staged = await target.module().manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId: randomUUID(), signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'import-archive', archive: conflict, expectedRevision: 0}))});
    assert.ok(staged !== undefined && 'error' in staged, 'duplicate creation position must be refused before any write');
    assert.equal(staged.error.code, 'invalid-request'); assert.deepEqual(await archive(target), before);
  }
});

void test('continuing an imported conversation preserves its epoch and round-trip recovery', async t => {
  const w = await world(t), fresh = await world(t), initial = await archive(w);
  initial.conversations = [{id: 'imported-conversation', epoch: 'distinct-imported-epoch', profile: 'bunny', participants: ['bunny']}];
  assert.equal((await mutate(w, {action: 'import-archive', archive: initial})).status, 'accepted');
  const db = w.host().moduleDatabase(); assert.ok(db); const store = new AssistantStore(db);
  const task = store.newTask('bunny', 'Synthetic continuation'); task.status = 'succeeded'; store.save(task);
  store.message(task, randomUUID(), 'owner', 'Synthetic continued message', 1);
  const continued = await archive(w);
  assert.equal(continued.messages[0]?.ordering.epoch, 'distinct-imported-epoch');
  assert.equal((await mutate(fresh, {action: 'import-archive', archive: continued})).status, 'accepted');
  await fresh.restart(); assert.deepEqual((await archive(fresh)).messages.map(value => value.ordering), continued.messages.map(value => value.ordering));
});
