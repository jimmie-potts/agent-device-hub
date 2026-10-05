import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_PAGES, SLOT_COUNT, SLOT_STATE_VERSION, SlotStateError, SlotStore, candidatesFromSessions, sessionsForSlot } from '../dist/routing/slots.js';
import { ManualClock } from '../dist/clock.js';
import { claudeTask, codexTask, hubSession, lid, onCleanup, tempDir, tid, view } from './routing-helpers.mjs';

const candidates = sessions => candidatesFromSessions(view(sessions).sessions);
const assignment = store => Object.fromEntries(store.entries().map(r => [r.slot, r.taskId]));

async function open(t, dir = tempDir(t), options = {}) {
  const path = join(dir, 'state', 'slots.json');
  const store = await SlotStore.open(path, { clock: new ManualClock(1_700_000_000_000), ...options });
  onCleanup(t, () => store.flush());
  return { path, dir, store };
}

test('first-free assignment uses the lowest free slot and sorts simultaneous discoveries deterministically', async t => {
  const { store } = await open(t);
  const result = store.reconcile(candidates([codexTask(3), claudeTask(9), codexTask(1), codexTask(2, { hostId: 'aa-host' })]));
  // Sort: provider (claude < codex), client, host (aa-host < pc), source, task ID.
  assert.deepEqual(assignment(store), { 1: lid(9), 2: tid(2), 3: tid(1), 4: tid(3) });
  assert.deepEqual(result.assigned.map(r => r.slot), [1, 2, 3, 4]);
  assert.equal(SLOT_COUNT, 15);
});

test('assignments stay stable through new tasks, restarts, reordering and Hub absence', async t => {
  const dir = tempDir(t);
  const first = await open(t, dir);
  first.store.reconcile(candidates([codexTask(5), codexTask(7)]));
  await first.store.flush();
  const reopened = await open(t, dir);
  assert.deepEqual(assignment(reopened.store), { 1: tid(5), 2: tid(7) }, 'a restart restores slots from the private file');
  reopened.store.reconcile(candidates([codexTask(7), codexTask(6), codexTask(5)]));
  assert.deepEqual(assignment(reopened.store), { 1: tid(5), 2: tid(7), 3: tid(6) }, 'a new task never shifts earlier ones');
  reopened.store.reconcile([]);
  assert.deepEqual(assignment(reopened.store), { 1: tid(5), 2: tid(7), 3: tid(6) }, 'Hub retirement, expiry or a stale feed frees nothing');
});

test('explicit release frees a slot and deterministic reuse fills the lowest free one', async t => {
  const { store } = await open(t);
  store.reconcile(candidates([codexTask(1), codexTask(3)]));
  assert.equal(store.release(1, 'archived').taskId, tid(1));
  assert.equal(store.release(1, 'archived'), undefined, 'releasing an empty slot is a no-op');
  store.reconcile(candidates([codexTask(3), codexTask(4), codexTask(2)]));
  assert.deepEqual(assignment(store), { 1: tid(2), 2: tid(3), 3: tid(4) });
});

test('a released task stays out while the Hub still lists it, and returns only with newer lifecycle evidence', async t => {
  const dir = tempDir(t);
  const first = await open(t, dir);
  first.store.reconcile(candidates([claudeTask(1, { lastEvidenceAtMs: 500 }), codexTask(2)]));
  first.store.release(1, 'release-gesture');
  first.store.reconcile(candidates([claudeTask(1, { lastEvidenceAtMs: 500 }), codexTask(2)]));
  assert.equal(first.store.get(1), undefined, 'the released Claude session is not placed again');
  assert.deepEqual(first.store.overflow(), [], 'nor reported as overflow');
  await first.store.flush();
  const second = await open(t, dir);
  second.store.reconcile(candidates([claudeTask(1, { lastEvidenceAtMs: 500 }), codexTask(2)]));
  assert.equal(second.store.get(1), undefined, 'the release survives a restart');
  second.store.reconcile(candidates([claudeTask(1, { lastEvidenceAtMs: 900 }), codexTask(2)]));
  assert.equal(second.store.get(1).taskId, lid(1), 'resumed work takes the lowest free slot again');
});

test('acceptance example 1: archive frees slot 1, then B takes 1 and D takes 3', async t => {
  const { store } = await open(t);
  store.reconcile(candidates([codexTask(1), codexTask(3)])); // A=1 in slot 1, C=3 in slot 2
  store.release(1, 'archived');
  store.reconcile(candidates([codexTask(3), codexTask(2), codexTask(4)])); // B=2, D=4
  assert.deepEqual(assignment(store), { 1: tid(2), 2: tid(3), 3: tid(4) });
});

test('full capacity reports overflow without moving or evicting, and a freed slot goes to the first overflow task', async t => {
  const { store } = await open(t);
  const sessions = Array.from({ length: 17 }, (_, i) => codexTask(i + 1));
  const result = store.reconcile(candidates(sessions));
  assert.equal(store.entries().length, 15);
  assert.deepEqual(result.overflow.map(c => c.taskId), [tid(16), tid(17)]);
  assert.deepEqual(store.overflow().map(c => c.taskId), [tid(16), tid(17)]);
  const before = assignment(store);
  store.reconcile(candidates([...sessions, codexTask(18)]));
  assert.deepEqual(assignment(store), before, 'nothing moves or is evicted');
  assert.equal(store.overflow().length, 3);
  store.release(7, 'archived');
  store.reconcile(candidates([...sessions, codexTask(18)]));
  assert.equal(store.get(7).taskId, tid(16));
  assert.deepEqual(store.overflow().map(c => c.taskId), [tid(17), tid(18)]);
});

test('duplicate names and IDs across sources stay separate; one Claude Desktop ID across /clear is one slot', async t => {
  const { store } = await open(t);
  store.reconcile(candidates([
    codexTask(1, { title: 'Same' }),
    codexTask(2, { title: 'Same' }),
    codexTask(1, { sourceId: 'other-source' }),
    claudeTask(4, { sessionId: 'before-clear', lastEvidenceAtMs: 100 }),
    claudeTask(4, { sessionId: 'after-clear', lastEvidenceAtMs: 200, title: 'Renamed' }),
  ]));
  const records = store.entries();
  assert.equal(records.length, 4);
  const claude = records.find(r => r.client === 'claude');
  assert.equal(claude.taskId, lid(4));
  assert.equal(claude.sessionId, 'after-clear', 'the newest Hub record supplies session ID and title');
  assert.equal(claude.title, 'Renamed');
  assert.deepEqual(records.filter(r => r.taskId === tid(1)).map(r => r.sourceId).sort(), ['codex-desktop', 'other-source']);
});

test('only root Desktop tasks with URI-safe IDs get slots', () => {
  const parent = { status: 'known', identity: { provider: 'codex', client: 'desktop', hostId: 'pc', sourceId: 'codex-desktop', sessionId: tid(1) } };
  const result = candidates([
    codexTask(1),
    codexTask(2, { parent }),
    hubSession({ provider: 'codex', client: 'cli', sessionId: tid(3) }),
    hubSession({ provider: 'claude', sessionId: 'cli-session' }),
    claudeTask(5, { parent: { status: 'known', identity: parent.identity } }),
    hubSession({ sessionId: 'has.dot' }),
    claudeTask(6, { parent: { status: 'unknown' } }),
  ]);
  assert.deepEqual(result.map(c => c.taskId), [lid(6), tid(1)]);
});

test('a slot keeps its last-known title and session ID, updated from later snapshots', async t => {
  const { store, path } = await open(t);
  store.reconcile(candidates([codexTask(1, { title: 'First' })]));
  store.reconcile(candidates([codexTask(1)]).map(c => ({ ...c, title: null })));
  assert.equal(store.get(1).title, 'First', 'a missing title keeps the cached one');
  store.reconcile(candidates([codexTask(1, { title: 'Second' })]));
  await store.flush();
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).slots[0].title, 'Second');
});

test('a Claude slot still matches its Hub record after a Hub restart drops the Desktop ID', async t => {
  const { store } = await open(t);
  store.reconcile(candidates([claudeTask(4, { sessionId: 'claude-session-4' })]));
  const record = store.get(1);
  const restarted = view([claudeTask(4, { hostSessionId: undefined, activity: 'active' }), claudeTask(5)]).sessions;
  assert.deepEqual(sessionsForSlot(record, restarted).map(s => s.identity.sessionId), ['claude-session-4']);
  const codex = await open(t);
  codex.store.reconcile(candidates([codexTask(1)]));
  assert.deepEqual(sessionsForSlot(codex.store.get(1), view([codexTask(1, { sourceId: 'elsewhere' }), codexTask(1)]).sessions).map(s => s.identity.sourceId), ['codex-desktop']);
});

test('the slot file is private, atomic and versioned; an invalid file stops start-up instead of reassigning', async t => {
  const { store, path, dir } = await open(t);
  store.reconcile(candidates([codexTask(1)]));
  await store.flush();
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.schemaVersion, 2, 'paged slot files are schema 2 (#822)');
  assert.deepEqual(Object.keys(saved.slots[0]).sort(), ['assignedAt', 'client', 'hostId', 'hubClient', 'provider', 'sessionId', 'slot', 'sourceId', 'taskId', 'title']);
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'state')).mode & 0o777, 0o700);
  }
  assert.deepEqual(readdirSync(join(dir, 'state')), ['slots.json'], 'no temporary file is left behind');

  const bad = join(dir, 'bad', 'slots.json');
  mkdirSync(join(dir, 'bad'), { mode: 0o700 });
  for (const content of ['{', JSON.stringify({ schemaVersion: 3, slots: [] }), JSON.stringify({ schemaVersion: 1, slots: [{ ...saved.slots[0], slot: 16 }] }),
    JSON.stringify({ schemaVersion: 1, slots: [saved.slots[0], { ...saved.slots[0], slot: 2 }] }),
    JSON.stringify({ schemaVersion: 2, slots: [{ ...saved.slots[0], slot: 121 }] }),
    JSON.stringify({ schemaVersion: 2, slots: [saved.slots[0], { ...saved.slots[0], slot: 40 }] })]) {
    writeFileSync(bad, content, { mode: 0o600 });
    await assert.rejects(SlotStore.open(bad, { clock: new ManualClock() }), error => error instanceof SlotStateError && error.code === 'invalid-slot-state');
  }
});

// Task pages (#822): acceptance examples written before the paged store.

const many = (n, from = 1) => Array.from({ length: n }, (_, i) => codexTask(from + i));

test('pages: the store holds 15 slots per page, numbered 1 to 15 times the page count, at most 8 pages', () => {
  assert.equal(SLOT_COUNT, 15, 'keys per page');
  assert.equal(MAX_PAGES, 8);
  assert.equal(SLOT_STATE_VERSION, 2);
});

test('pages: new tasks take the lowest free slot across all pages, in sort order', async t => {
  const { store } = await open(t, undefined, { pages: 2 });
  const result = store.reconcile(candidates(many(20)));
  assert.deepEqual(store.entries().map(r => r.slot), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(store.get(16).taskId, tid(16), 'task 16 is the first slot of page 2');
  assert.deepEqual(result.overflow, []);
  assert.equal(store.capacity, 30);
});

test('pages: overflow is reported only when every page is full', async t => {
  const { store } = await open(t, undefined, { pages: 2 });
  assert.deepEqual(store.reconcile(candidates(many(30))).overflow, []);
  const result = store.reconcile(candidates(many(32)));
  assert.equal(store.entries().length, 30);
  assert.deepEqual(result.overflow.map(c => c.taskId), [tid(31), tid(32)]);
});

test('pages: positions stay stable while other tasks come and go, and freed slots are reused first-free', async t => {
  const { store } = await open(t, undefined, { pages: 4 });
  store.reconcile(candidates(many(20)));
  const before = assignment(store);
  store.reconcile(candidates([...many(5), ...many(10, 11)])); // tasks 6-10 leave the feed; nothing moves
  assert.deepEqual(assignment(store), before, 'Hub absence never moves or frees a slot');
  store.release(17, 'codex-archived'); // a task on page 2
  store.release(3, 'codex-archived');
  store.reconcile(candidates([...many(20), codexTask(41), codexTask(42), codexTask(43)]));
  assert.equal(store.get(3).taskId, tid(41), 'the lowest free slot first');
  assert.equal(store.get(17).taskId, tid(42), 'then the freed slot on page 2');
  assert.equal(store.get(21).taskId, tid(43));
  for (const slot of [1, 2, 4, 16, 18, 20]) assert.equal(store.get(slot).taskId, before[slot], `slot ${slot} is unchanged`);
});

test('pages: a release on a hidden page is persisted and the task returns only with newer evidence', async t => {
  const { store, path } = await open(t, undefined, { pages: 2 });
  const sessions = many(18);
  store.reconcile(candidates(sessions));
  assert.equal(store.release(18, 'release-gesture').taskId, tid(18));
  await store.flush();
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).slots.some(r => r.slot === 18), false);
  store.reconcile(candidates(sessions));
  assert.equal(store.get(18), undefined, 'still out while the Hub lists it with old evidence');
});

test('pages: a version 1 file loads unchanged onto page 1 and is rewritten as version 2 at the next change', async t => {
  const dir = tempDir(t);
  const first = await open(t, dir);
  first.store.reconcile(candidates(many(3)));
  await first.store.flush();
  const v1 = JSON.parse(readFileSync(first.path, 'utf8'));
  writeFileSync(first.path, JSON.stringify({ ...v1, schemaVersion: 1 }), { mode: 0o600 }); // as the 5add03a bridge wrote it
  const { store, path } = await open(t, dir, { pages: 4 });
  assert.deepEqual(assignment(store), { 1: tid(1), 2: tid(2), 3: tid(3) }, 'slots 1-15 are page 1');
  await store.flush();
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 1, 'opening alone writes nothing, so a rollback before any change is free');
  store.reconcile(candidates(many(4)));
  await store.flush();
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.schemaVersion, 2);
  assert.deepEqual(saved.slots.map(r => [r.slot, r.taskId]), [[1, tid(1)], [2, tid(2)], [3, tid(3)], [4, tid(4)]]);
});

test('pages: fewer pages never drop or move a task; slots beyond the pages keep their tasks without keys', async t => {
  const { store, path } = await open(t, undefined, { pages: 2 });
  store.reconcile(candidates(many(20)));
  store.setPages(1);
  assert.equal(store.capacity, 15);
  assert.deepEqual(store.beyondPages().map(r => r.slot), [16, 17, 18, 19, 20]);
  assert.equal(store.entries().length, 20, 'nothing is dropped');
  const result = store.reconcile(candidates([...many(20), codexTask(21)]));
  assert.deepEqual(result.overflow.map(c => c.taskId), [tid(21)], 'new tasks never take a slot beyond the pages');
  store.release(16, 'codex-archived');
  assert.equal(store.get(16), undefined, 'archive release still works beyond the pages');
  await store.flush();
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).slots.length, 19, 'slots beyond the pages are persisted');
  store.setPages(2);
  assert.deepEqual(store.beyondPages(), []);
  assert.equal(store.get(17).taskId, tid(17), 'the task is back on its key when the page returns');
  for (const pages of [0, 9, 1.5]) assert.throws(() => store.setPages(pages), RangeError);
});

test('pages: an interrupted write leaves its temporary file behind and the last good file intact', async t => {
  const dir = tempDir(t);
  const first = await open(t, dir, { pages: 2 });
  first.store.reconcile(candidates(many(16)));
  await first.store.flush();
  const good = readFileSync(first.path, 'utf8');
  // A crash after the temporary file was written but before the rename.
  writeFileSync(join(dir, 'state', `.slots.json.4242.0123456789ab.tmp`), '{"schemaVersion":2,"slots":[', { mode: 0o600 });
  const { store, path } = await open(t, dir, { pages: 2 });
  assert.equal(store.get(16).taskId, tid(16), 'the last good file loads; the stray temporary file is ignored');
  assert.equal(readFileSync(path, 'utf8'), good);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    // A write that cannot complete: the directory refuses the temporary file.
    const errors = [];
    const failing = await open(t, dir, { pages: 2, onWriteError: error => errors.push(error) });
    chmodSync(join(dir, 'state'), 0o500);
    try {
      failing.store.reconcile(candidates(many(17)));
      await assert.rejects(failing.store.flush());
      assert.equal(errors.length, 1, 'the failure is reported');
      assert.equal(readFileSync(path, 'utf8'), good, 'the old file is intact');
      assert.equal(failing.store.get(17).taskId, tid(17), 'memory stays authoritative and the next change retries');
    } finally {
      chmodSync(join(dir, 'state'), 0o700);
    }
  }
});

test('pages: downgrade: a version 2 file is not a valid version 1 file, and the documented rollback makes it one', async t => {
  // This store's version 1 path stands in for the pre-#822 reader (5add03a), which accepted exactly that format and
  // refused any other schemaVersion.
  const dir = tempDir(t);
  const { store, path } = await open(t, dir, { pages: 2 });
  store.reconcile(candidates(many(18)));
  await store.flush();
  const v2 = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(v2.schemaVersion, 2, 'the 5add03a reader accepts only schemaVersion 1 and stops start-up on this file');
  // Relabeling without pruning is still not a valid version 1 file: slots above 15 do not exist there.
  writeFileSync(path, JSON.stringify({ ...v2, schemaVersion: 1 }), { mode: 0o600 });
  await assert.rejects(SlotStore.open(path, { clock: new ManualClock() }), SlotStateError);
  // The README rollback: back up, keep slots 1-15, set schemaVersion 1.
  writeFileSync(path, JSON.stringify({ ...v2, schemaVersion: 1, slots: v2.slots.filter(r => r.slot <= 15) }), { mode: 0o600 });
  const rolled = await SlotStore.open(path, { clock: new ManualClock() });
  assert.deepEqual(rolled.entries().map(r => r.slot), Array.from({ length: 15 }, (_, i) => i + 1));
});
