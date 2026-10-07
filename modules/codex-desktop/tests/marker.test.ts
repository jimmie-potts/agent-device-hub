// Codex Desktop's read marker (Hub #926): the old Hub's parser and read rules (apps/hub/tests/codex-desktop.test.mjs at
// main 8590332f), the real reader's own process on a synthetic marker in a temporary Codex home, and a reader stuck in a
// file system call that the module's stop still ends. No test reads a real Codex file.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod, mkdtemp, open, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {MARKER_FILE, MAX_MARKER_BYTES, folderReader, markerReadOf, readMarker, unreadSessions, type MarkerRead} from '../src/index.js';
import {it} from './support.js';

const marker = (ids: unknown, version = 1): string =>
  JSON.stringify({'local-projects': {}, 'electron-thread-read-state-v1': {version, unreadByIdentity: {host: {'local:a': ids}}, legacyMigration: {}}});

async function home(context: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-home-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

const listed = (read: MarkerRead): readonly string[] | null | string => read.status === 'read' ? read.unread : read.status;

it('the unread marker parser accepts only the known Desktop shape', () => {
  assert.deepEqual([...unreadSessions(marker(['one', 'two'])) ?? []], ['one', 'two']);
  const twoHosts = JSON.parse(marker(['one'])) as {'electron-thread-read-state-v1': {unreadByIdentity: Record<string, unknown>}};
  twoHosts['electron-thread-read-state-v1'].unreadByIdentity.other = {'local:b': ['three']};
  assert.deepEqual([...unreadSessions(JSON.stringify(twoHosts)) ?? []].sort(), ['one', 'three']);
  assert.deepEqual([...unreadSessions(marker([])) ?? ['not']], []);
  for (const invalid of [marker(['one'], 2), marker([1]), marker(['has space']), marker('one'), '{"electron-thread-read-state-v1":{"version":1}}',
    JSON.stringify({'electron-persisted-atom-state': {'unread-thread-ids-by-host-v1': {local: ['one']}}}), '[]', 'not json']) {
    assert.equal(unreadSessions(invalid), null, invalid);
  }
});

it('a read gives the unread threads with the file\'s stamp, nothing new for the same stamp, and nothing from an unusable marker', async context => {
  const dir = await home(context);
  const file = join(dir, MARKER_FILE);
  assert.deepEqual(readMarker(dir, ''), {status: 'read', stamp: '', unread: null}, 'a missing marker');
  await writeFile(file, marker(['one']));
  const first = readMarker(dir, '');
  assert.equal(first.status, 'read');
  assert.deepEqual(listed(first), ['one']);
  const stamp = first.status === 'read' ? first.stamp : '';
  assert.match(stamp, /^\d+:\d+$/);
  assert.deepEqual(readMarker(dir, stamp), {status: 'unchanged'});
  await writeFile(file, marker(['one', 'two']));
  assert.deepEqual(listed(readMarker(dir, stamp)), ['one', 'two']);
  // Unusable markers: another format, invalid JSON, not UTF-8, unreadable, oversized, a directory. A stable one keeps its stamp.
  for (const content of [marker([], 2), '{"truncated":', JSON.stringify({'electron-persisted-atom-state': {}}), Buffer.from([0x7b, 0xff, 0x7d])]) {
    await writeFile(file, content);
    const read = readMarker(dir, '');
    assert.equal(listed(read), null);
    assert.notEqual(read.status === 'read' ? read.stamp : '', '');
  }
  await chmod(file, 0o000);
  assert.deepEqual(readMarker(dir, ''), {status: 'read', stamp: '', unread: null}, 'an unreadable marker');
  await chmod(file, 0o600);
  const large = await open(file, 'w');
  try {
    await large.truncate(MAX_MARKER_BYTES + 1);
  } finally {
    await large.close();
  }
  assert.equal(listed(readMarker(dir, '')), null, 'an oversized marker');
  await rm(file);
  execFileSync('mkfifo', [file]);
  assert.equal(listed(readMarker(dir, '')), null, 'a FIFO is not read, so it never blocks the reader');
  // The reader only reads: the Codex home holds what the test put there.
  assert.deepEqual(await readdir(dir), [MARKER_FILE]);
});

it('a reply from the reader\'s process is taken only in one of its three shapes', () => {
  assert.deepEqual(markerReadOf({status: 'unchanged'}), {status: 'unchanged'});
  assert.deepEqual(markerReadOf({status: 'retry'}), {status: 'retry'});
  assert.deepEqual(markerReadOf({status: 'read', stamp: '1:2', unread: ['one']}), {status: 'read', stamp: '1:2', unread: ['one']});
  assert.deepEqual(markerReadOf({status: 'read', stamp: '1:2', unread: null}), {status: 'read', stamp: '1:2', unread: null});
  for (const invalid of [undefined, 'read', {status: 'read', stamp: 1, unread: []}, {status: 'read', stamp: '1', unread: ['has space']}, {status: 'other'}]) {
    assert.deepEqual(markerReadOf(invalid), {status: 'read', stamp: '', unread: null});
  }
});

it('the real reader reads the marker in its own process, and starts again after it ended', async context => {
  const dir = await home(context);
  await writeFile(join(dir, MARKER_FILE), marker(['one']));
  const before = await stat(join(dir, MARKER_FILE));
  const reader = folderReader();
  try {
    const first = await reader.read(dir, '');
    assert.deepEqual(listed(first), ['one']);
    assert.deepEqual(await reader.read(dir, first.status === 'read' ? first.stamp : ''), {status: 'unchanged'});
    reader.close();
    assert.deepEqual(listed(await reader.read(dir, '')), ['one'], 'a new reader after the first ended');
  } finally {
    reader.close();
  }
  const after = await stat(join(dir, MARKER_FILE));
  assert.deepEqual([after.mtimeMs, after.size], [before.mtimeMs, before.size], 'the marker was only read');
});

it('a reader stuck in a file system call never answers, and closing the transport ends it', async context => {
  const dir = await home(context);
  // A FIFO with no writer: a blocking open of it does not return, as a read on a stalled mount would not.
  execFileSync('mkfifo', [join(dir, MARKER_FILE)]);
  const reader = folderReader(new URL('./fixtures/blocking-reader.js', import.meta.url));
  const reading = reader.read(dir, '');
  const settled = await Promise.race([reading.then(() => 'answered', () => 'failed'), new Promise(resolve => { setTimeout(() => { resolve('waiting'); }, 500); })]);
  assert.equal(settled, 'waiting', 'the stuck reader does not answer');
  const started = performance.now();
  reader.close();
  await assert.rejects(reading, /the marker reader ended/);
  assert.ok(performance.now() - started < 2000, 'the stuck reader was ended at once');
});
