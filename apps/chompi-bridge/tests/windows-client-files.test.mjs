import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeSessions, claudeSettings, CodexArchiveIndex, codexArchived, CodexThreadNames } from '../dist/windows/index.js';

const thread = '019a3b1c-7d2e-7f00-8a11-0123456789ab';
const other = '019a3b1c-7d2e-7f00-8a11-ba9876543210';
const localA = 'local_4f1e2d3c-1b2a-4c5d-8e9f-a0b1c2d3e4f5';
const localB = 'local_5e2f3a4b-2c3d-4e5f-9a0b-b1c2d3e4f5a6';
const localC = 'local_6a3b4c5d-3e4f-4a5b-8c6d-c2d3e4f5a6b7';
const CANARY = 'CANARY-private-prompt-7c1d';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chompi-windows-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a Codex thread is archived only when an exact rollout filename exists', async t => {
  const home = scratch(t);
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  writeFileSync(join(archive, `rollout-2026-10-01T12-30-05-${other}.jsonl`), `{"text":"${CANARY}"}`);
  writeFileSync(join(archive, `rollout-2026-10-01T12-30-05-${thread}_${other}.jsonl`), '');
  writeFileSync(join(archive, `rollout-2026-10-01T12-30-05-x${thread}.jsonl`), '');
  writeFileSync(join(archive, `${thread}.jsonl`), '');
  mkdirSync(join(archive, `rollout-2026-10-01T12-30-05-${thread}.jsonl.d`));
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: false });
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`), CANARY);
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: true });
});

test('a Codex archive directory that is a directory entry, not a file, does not count', async t => {
  const home = scratch(t);
  mkdirSync(join(home, 'archived_sessions', `rollout-2026-10-02T08-00-00-${thread}.jsonl`), { recursive: true });
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: false });
});

test('missing Codex directories and bad IDs are distinguished', async t => {
  const home = scratch(t);
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: false }, 'no archive yet');
  assert.deepEqual(await codexArchived(join(home, 'absent'), thread), { status: 'unknown', reason: 'codex-home-missing' });
  for (const id of ['', thread.toUpperCase(), `../${thread}`, `${thread}.jsonl`, 'x'.repeat(36)]) {
    assert.deepEqual(await codexArchived(home, id), { status: 'unknown', reason: 'invalid-thread-id' });
  }
});

test('a large archive has no entry limit; only the scan time bound makes it unknown', async t => {
  const home = scratch(t);
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  for (let i = 0; i < 300; i += 1) writeFileSync(join(archive, `rollout-2026-10-01T12-30-00-019a3b1c-7d2e-7f00-8a11-${String(i).padStart(12, '0')}.jsonl`), '');
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`), '');
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: true }, '301 entries are fine');
  let clock = 0;
  const slow = new CodexArchiveIndex(home, { scanTimeoutMs: 50, now: () => (clock += 1) });
  assert.deepEqual(await slow.archivedThread(other), { status: 'unknown', reason: 'codex-archive-timeout' });
});

test('one scan answers every slot, and its answers hold only for the TTL', async t => {
  const home = scratch(t);
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`), '');
  let clock = 1000;
  const index = new CodexArchiveIndex(home, { ttlMs: 10_000, now: () => clock });
  const [a, b] = await Promise.all([index.archivedThread(thread), index.archivedThread(other)]);
  assert.deepEqual([a, b], [{ status: 'known', value: true }, { status: 'known', value: false }], 'concurrent lookups share one scan');
  // The owner archives `other` and unarchives `thread`.
  writeFileSync(join(archive, `rollout-2026-10-02T09-00-00-${other}.jsonl`), '');
  rmSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`));
  clock += 9_999;
  assert.deepEqual(await index.archivedThread(other), { status: 'known', value: false }, 'within the TTL: the last complete scan answers');
  assert.deepEqual(await index.archivedThread(thread), { status: 'known', value: true }, 'within the TTL: still archived per the last scan');
  clock += 2;
  assert.deepEqual(await index.archivedThread(thread), { status: 'known', value: false }, 'after the TTL an unarchived thread reads as not archived');
  assert.deepEqual(await index.archivedThread(other), { status: 'known', value: true }, 'and a newly archived one as archived');
});

test('after the TTL a timed-out scan never falls back to the stale complete set', async t => {
  const home = scratch(t);
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`), '');
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-01-${other}.jsonl`), '');
  let clock = 0;
  let step = 0;
  const index = new CodexArchiveIndex(home, { ttlMs: 10, scanTimeoutMs: 1000, now: () => (clock += step) });
  assert.deepEqual(await index.archivedThread(thread), { status: 'known', value: true }, 'complete scan');
  clock += 100;
  step = 2000; // each clock read jumps past the bound, so the next scan reads nothing
  assert.deepEqual(await index.archivedThread(thread), { status: 'unknown', reason: 'codex-archive-timeout' }, 'not true from the expired set');
  assert.deepEqual(await index.archivedThread(other), { status: 'unknown', reason: 'codex-archive-timeout' }, 'and not false either');
});

test('a timed-out scan answers its own positive matches and leaves misses unknown', async t => {
  const home = scratch(t);
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  // Two rollouts of one thread: whichever is listed first is read, the second crosses the time bound.
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-00-${thread}.jsonl`), '');
  writeFileSync(join(archive, `rollout-2026-10-02T08-00-01-${thread}.jsonl`), '');
  let clock = 0;
  const index = new CodexArchiveIndex(home, { scanTimeoutMs: 1, now: () => (clock += 1) });
  const [found, missing] = await Promise.all([index.archivedThread(thread), index.archivedThread(other)]);
  assert.deepEqual(found, { status: 'known', value: true });
  assert.deepEqual(missing, { status: 'unknown', reason: 'codex-archive-timeout' });
});

function claudeStore(t) {
  const root = scratch(t);
  const org = join(root, '11111111-2222-4333-8444-555555555555', '66666666-7777-4888-9999-aaaaaaaaaaaa');
  mkdirSync(org, { recursive: true });
  const record = (id, fields) => writeFileSync(join(org, `${id}.json`), JSON.stringify({
    sessionId: id, title: `${CANARY} title`, cwd: `C:\\Users\\${CANARY}`, model: 'x', messages: [{ text: CANARY }], ...fields,
  }));
  return { root, org, record };
}

const indexLine = (id, name, at) => JSON.stringify({ id, thread_name: name, updated_at: at });

const nameOf = async (names, id) => { const read = await names.read(); return read.status === 'known' ? read.value.nameOf(id) : read; };

test("a thread's last session index line is its current name; a tie goes to the later line", async t => {
  const home = scratch(t);
  const third = '019a3b1c-7d2e-7f00-8a11-333333333333';
  writeFileSync(join(home, 'session_index.jsonl'), [
    indexLine(thread, 'First name', '2026-10-03T14:00:10.359352509Z'),
    indexLine(other, 'Other thread', '2026-10-03T15:00:00Z'),
    indexLine(thread, 'Renamed', '2026-10-03T16:00:00.5Z'),
    'not json',
    JSON.stringify({ id: 'not-a-thread', thread_name: 'x', updated_at: '2026-10-03T17:00:00Z' }),
    JSON.stringify([thread, 'array']),
    indexLine(other, 'Tie later line', '2026-10-03T15:00:00Z'),
    indexLine(third, 'Third', '2026-10-03T15:00:00Z'),
    '',
  ].join('\r\n'));
  const names = new CodexThreadNames(home);
  assert.deepEqual(await nameOf(names, thread), { status: 'named', name: 'Renamed' });
  assert.deepEqual(await nameOf(names, other), { status: 'named', name: 'Tie later line' });
  assert.deepEqual(await nameOf(names, '019a3b1c-7d2e-7f00-8a11-000000000000'), { status: 'none' });
});

test('an unusable or out-of-order newest entry makes the name unusable instead of falling back to an older one', async t => {
  const home = scratch(t);
  const ids = ['019a3b1c-7d2e-7f00-8a11-000000000001', '019a3b1c-7d2e-7f00-8a11-000000000002', '019a3b1c-7d2e-7f00-8a11-000000000003', '019a3b1c-7d2e-7f00-8a11-000000000004'];
  writeFileSync(join(home, 'session_index.jsonl'), [
    indexLine(ids[0], 'Good', '2026-10-03T14:00:00Z'), indexLine(ids[0], '', '2026-10-03T15:00:00Z'),
    indexLine(ids[1], 'Good', '2026-10-03T14:00:00Z'), indexLine(ids[1], 'x'.repeat(1025), '2026-10-03T15:00:00Z'),
    indexLine(ids[2], 'Good', '2026-10-03T14:00:00Z'), indexLine(ids[2], 'No time', 'yesterday'),
    indexLine(ids[3], 'Newer', '2026-10-03T16:00:00Z'), indexLine(ids[3], 'Older line written later', '2026-10-03T12:00:00Z'),
  ].join('\n'));
  const names = new CodexThreadNames(home);
  for (const id of ids) assert.deepEqual(await nameOf(names, id), { status: 'invalid' }, id);
});

test('a name counts as shared when any other thread currently has it, rendered or not', async t => {
  const home = scratch(t);
  const third = '019a3b1c-7d2e-7f00-8a11-333333333333';
  writeFileSync(join(home, 'session_index.jsonl'), [
    indexLine(thread, 'Same', '2026-10-03T14:00:00Z'),
    indexLine(other, 'Same', '2026-10-03T14:00:01Z'),
    indexLine(third, 'Was same', '2026-10-03T14:00:00Z'), indexLine(third, 'Unique now', '2026-10-03T15:00:00Z'),
  ].join('\n'));
  const read = await new CodexThreadNames(home).read();
  assert.equal(read.status, 'known');
  assert.equal(read.value.sharedWithOtherThread('Same', thread), true);
  assert.equal(read.value.sharedWithOtherThread('Unique now', third), false);
  assert.equal(read.value.sharedWithOtherThread('Was same', thread), false, 'only current names count');
  assert.equal(read.value.sharedWithOtherThread('Unique now', thread), true, 'a fallback title another thread holds is shared');
});

test('a thread with an unusable current name counts as holding every name its lines carried', async t => {
  const home = scratch(t);
  writeFileSync(join(home, 'session_index.jsonl'), [
    indexLine(thread, 'Target', '2026-10-03T14:00:00Z'),
    indexLine(other, 'Target', '2026-10-03T13:00:00Z'), indexLine(other, '', '2026-10-03T15:00:00Z'),
  ].join('\n'));
  const read = await new CodexThreadNames(home).read();
  assert.deepEqual(read.value.nameOf(other), { status: 'invalid' });
  assert.equal(read.value.sharedWithOtherThread('Target', thread), true, 'its row might still show the old name');
});

test('a missing index is an empty index, a missing Codex home is unknown, and an oversized index is unknown', async t => {
  const home = scratch(t);
  assert.deepEqual(await nameOf(new CodexThreadNames(home), thread), { status: 'none' });
  assert.deepEqual(await new CodexThreadNames(join(home, 'absent')).read(), { status: 'unknown', reason: 'codex-home-missing' });
  writeFileSync(join(home, 'session_index.jsonl'), indexLine(thread, 'Name', '2026-10-03T14:00:00Z'));
  assert.deepEqual(await new CodexThreadNames(home, { maxBytes: 10 }).read(), { status: 'unknown', reason: 'codex-index-too-large' });
  mkdirSync(join(home, 'dir-home'));
  mkdirSync(join(home, 'dir-home', 'session_index.jsonl'));
  assert.equal((await new CodexThreadNames(join(home, 'dir-home')).read()).status, 'unknown');
});

test('the parsed index is reused until the file changes', async t => {
  const home = scratch(t);
  const path = join(home, 'session_index.jsonl');
  writeFileSync(path, indexLine(thread, 'Before', '2026-10-03T14:00:00Z') + '\n');
  const names = new CodexThreadNames(home);
  assert.deepEqual(await nameOf(names, thread), { status: 'named', name: 'Before' });
  writeFileSync(path, indexLine(thread, 'Before', '2026-10-03T14:00:00Z') + '\n' + indexLine(thread, 'After rename', '2026-10-03T15:00:00Z') + '\n');
  assert.deepEqual(await nameOf(names, thread), { status: 'named', name: 'After rename' });
});

test('Claude records return only the local ID, archive flag and focus time', async t => {
  const { root, record } = claudeStore(t);
  record(localA, { isArchived: false, lastFocusedAt: 1759500000123 });
  record(localB, { isArchived: true });
  const result = await claudeSessions(root, [localA, localB, localC]);
  assert.equal(result.status, 'known');
  assert.deepEqual(result.value, [
    { localId: localA, isArchived: false, lastFocusedAt: 1759500000123 },
    { localId: localB, isArchived: true, lastFocusedAt: null },
  ], 'a missing record is omitted');
  for (const session of result.value) assert.deepEqual(Object.keys(session).sort(), ['isArchived', 'lastFocusedAt', 'localId']);
  assert.equal(JSON.stringify(result).includes(CANARY), false, 'no other record key crosses the boundary');
  assert.deepEqual(await claudeSessions(root, []), { status: 'known', value: [] });
  assert.deepEqual(await claudeSessions(join(root, 'absent'), [localA]), { status: 'known', value: [] });
});

test('an unreadable or malformed Claude record makes the whole observation unknown without leaking content', async t => {
  const cases = [
    ['not json', `{"sessionId":"${localA}", ${CANARY}`, 'claude-record-unreadable'],
    ['wrong id', JSON.stringify({ sessionId: localB, isArchived: false }), 'claude-record-mismatch'],
    ['archive flag type', JSON.stringify({ sessionId: localA, isArchived: 'no' }), 'claude-record-invalid'],
    ['missing archive flag', JSON.stringify({ sessionId: localA }), 'claude-record-invalid'],
    ['focus type', JSON.stringify({ sessionId: localA, isArchived: false, lastFocusedAt: '2026' }), 'claude-record-invalid'],
    ['array', JSON.stringify([localA]), 'claude-record-invalid'],
  ];
  for (const [label, body, reason] of cases) {
    const { root, org } = claudeStore(t);
    writeFileSync(join(org, `${localA}.json`), body);
    const result = await claudeSessions(root, [localA]);
    assert.deepEqual(result, { status: 'unknown', reason }, label);
  }
  const { root, org, record } = claudeStore(t);
  record(localA, { isArchived: false, padding: 'x'.repeat(2048) });
  assert.deepEqual(await claudeSessions(root, [localA], { maxRecordBytes: 1024 }), { status: 'unknown', reason: 'claude-record-too-large' });
  if (process.platform === 'win32') return; // creating a symlink needs a privilege Windows users rarely have
  rmSync(join(org, `${localA}.json`));
  symlinkSync(join(org, 'elsewhere.json'), join(org, `${localA}.json`));
  assert.deepEqual(await claudeSessions(root, [localA]), { status: 'unknown', reason: 'claude-record-not-file' });
});

test('a record unreadable by permission is unknown', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const { root, org, record } = claudeStore(t);
  record(localA, { isArchived: false });
  chmodSync(join(org, `${localA}.json`), 0o000);
  assert.deepEqual(await claudeSessions(root, [localA]), { status: 'unknown', reason: 'claude-record-unreadable' });
});

test('Claude IDs are validated and a record found under two organizations is ambiguous', async t => {
  const { root, record } = claudeStore(t);
  for (const id of ['', localA.toUpperCase(), localA.replace('local_', ''), `${localA}/../x`, 'local_x']) {
    assert.deepEqual(await claudeSessions(root, [id]), { status: 'unknown', reason: 'invalid-local-id' });
  }
  assert.deepEqual(await claudeSessions(root, Array(65).fill(localA)), { status: 'unknown', reason: 'too-many-local-ids' });
  record(localA, { isArchived: false });
  const second = join(root, '11111111-2222-4333-8444-555555555555', 'bbbbbbbb-7777-4888-9999-aaaaaaaaaaaa');
  mkdirSync(second);
  writeFileSync(join(second, `${localA}.json`), JSON.stringify({ sessionId: localA, isArchived: true }));
  assert.deepEqual(await claudeSessions(root, [localA]), { status: 'unknown', reason: 'claude-record-duplicate' });
  assert.deepEqual(await claudeSessions(root, [localA], { maxDirectories: 1 }), { status: 'unknown', reason: 'claude-store-too-large' });
});

test('Claude settings come from one session record\'s model and effort keys only (#906)', async t => {
  const { root, org, record } = claudeStore(t);
  record(localA, { isArchived: false, model: 'claude-haiku-4-5-20251001', effort: 'medium', title: CANARY });
  const result = await claudeSettings(root, localA);
  assert.deepEqual(result, { status: 'known', value: { model: 'claude-haiku-4-5-20251001', effort: 'medium' } });
  assert.equal(JSON.stringify(result).includes(CANARY), false, 'no other record key crosses the boundary');
  record(localB, { isArchived: false, model: undefined, effort: 3 });
  assert.deepEqual(await claudeSettings(root, localB), { status: 'known', value: { model: null, effort: '3' } }, 'absent is null; a number is kept as text');
  assert.deepEqual(await claudeSettings(root, localC), { status: 'known', value: null }, 'no record');
  for (const [label, body] of [
    ['model type', { sessionId: localA, isArchived: false, model: { id: 'x' } }],
    ['long model', { sessionId: localA, isArchived: false, model: 'x'.repeat(129) }],
    ['control characters', { sessionId: localA, isArchived: false, effort: 'hi\nthere' }],
    ['wrong id', { sessionId: localB, isArchived: false, model: 'm' }],
  ]) {
    writeFileSync(join(org, `${localA}.json`), JSON.stringify(body));
    assert.equal((await claudeSettings(root, localA)).status, 'unknown', label);
  }
  assert.deepEqual(await claudeSettings(root, 'local_x'), { status: 'unknown', reason: 'invalid-local-id' });
});
