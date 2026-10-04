import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeSessions, codexArchived } from '../dist/windows/index.js';

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

test('missing Codex directories, bad IDs and oversized listings are distinguished', async t => {
  const home = scratch(t);
  assert.deepEqual(await codexArchived(home, thread), { status: 'known', value: false }, 'no archive yet');
  assert.deepEqual(await codexArchived(join(home, 'absent'), thread), { status: 'unknown', reason: 'codex-home-missing' });
  for (const id of ['', thread.toUpperCase(), `../${thread}`, `${thread}.jsonl`, 'x'.repeat(36)]) {
    assert.deepEqual(await codexArchived(home, id), { status: 'unknown', reason: 'invalid-thread-id' });
  }
  const archive = join(home, 'archived_sessions');
  mkdirSync(archive);
  for (let i = 0; i < 5; i += 1) writeFileSync(join(archive, `rollout-2026-10-01T12-30-0${i}-${other}.jsonl`), '');
  assert.deepEqual(await codexArchived(home, thread, { maxEntries: 4 }), { status: 'unknown', reason: 'codex-archive-too-large' });
  assert.deepEqual(await codexArchived(home, thread, { maxEntries: 5 }), { status: 'known', value: false });
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
