import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {emptyCheckpoint} from '@langchain/langgraph-checkpoint';
import {fullDisk, openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {SqliteCheckpointSaver} from '../src/assistant/checkpointer.js';

void test('SDK SQLite checkpoint survives process termination before projection and explicitly resumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-checkpoint-'));
  const file = join(dir, 'companions.sqlite');
  const child = (mode: string) => spawnSync(process.execPath, [new URL('./checkpointer-child.js', import.meta.url).pathname, file, mode], {encoding: 'utf8'});
  try {
    const pause = child('pause'); assert.equal(pause.status, 17, pause.stderr);
    const inspect = child('inspect'); assert.equal(inspect.status, 0, inspect.stderr);
    const saved = JSON.parse(inspect.stdout) as {next: string[]; tasks: {interrupts: {value: {questionId: string}}[]}[]};
    assert.deepEqual(saved.next, ['question']); assert.equal(saved.tasks[0]?.interrupts[0]?.value.questionId, 'question-1');
    const resume = child('resume'); assert.equal(resume.status, 0, resume.stderr);
    const value = JSON.parse(resume.stdout) as {result: {task: string; answer: string}};
    assert.deepEqual(value.result, {task: 'task-1', answer: 'synthetic-answer'});
  } finally {rmSync(dir, {recursive: true, force: true});}
});

void test('pending writes preserve ordinary first values, replace special writes, order paths and isolate namespaces', async () => {
  const database = openModuleDatabaseFile(':memory:');
  try {
    const saver = new SqliteCheckpointSaver(database);
    const root = {configurable: {thread_id: 'task', checkpoint_ns: 'a'}};
    const checkpoint = emptyCheckpoint();
    const config = await saver.put(root, checkpoint, {source: 'input', step: -1, parents: {}}, {});
    await saver.putWrites(config, [['text', 'first']], 'z', 'b');
    await saver.putWrites(config, [['text', 'duplicate']], 'z', 'b');
    await saver.putWrites(config, [['__error__', 'old']], 'a', 'a');
    await saver.putWrites(config, [['__error__', 'new']], 'a', 'a');
    const saved = await saver.getTuple(root);
    assert.deepEqual(saved?.pendingWrites, [['a', '__error__', 'new'], ['z', 'text', 'first']]);
    assert.equal(await saver.getTuple({configurable: {thread_id: 'task', checkpoint_ns: 'b'}}), undefined);
    const child = {...emptyCheckpoint(), id: `${checkpoint.id}-next`};
    await saver.put(config, child, {source: 'loop', step: 0, parents: {}}, {});
    assert.deepEqual((await saver.getTuple(root))?.parentConfig, config);
    const listed = []; for await (const tuple of saver.list(root, {limit: 1, before: {configurable: {checkpoint_id: child.id}}})) listed.push(tuple);
    assert.equal(listed.length, 1); assert.equal(listed[0]?.checkpoint.id, checkpoint.id);
    assert.equal(database.isTransaction, false);
  } finally {database.close();}
});

void test('SQLITE_FULL preserves the capacity code and rolls back every pending write', async () => {
  const database = openModuleDatabaseFile(':memory:');
  try {
    const saver = new SqliteCheckpointSaver(database);
    const config = await saver.put({configurable: {thread_id: 'full'}}, emptyCheckpoint(), {source: 'input', step: -1, parents: {}}, {});
    const pages = database.prepare('PRAGMA page_count').get()?.page_count;
    assert.equal(typeof pages, 'number');
    database.exec(`PRAGMA max_page_count=${String(pages)}`);
    await assert.rejects(saver.putWrites(config, [['small', 'not committed'], ['large', 'x'.repeat(8192)]], 'full-task'), error => fullDisk(error));
    assert.deepEqual((await saver.getTuple(config))?.pendingWrites, []);
    assert.equal(database.isTransaction, false);
  } finally {database.close();}
});

void test('serialized working state and pending writes are bounded before SQLite changes', async () => {
  const database = openModuleDatabaseFile(':memory:');
  try {
    const saver = new SqliteCheckpointSaver(database), root = {configurable: {thread_id: 'bounded'}};
    const checkpoint = {...emptyCheckpoint(), channel_values: {text: 'x'.repeat(32 * 1024)}};
    await assert.rejects(saver.put(root, checkpoint, {source: 'input', step: -1, parents: {}}, {}), /checkpoint-capacity/);
    assert.equal(await saver.getTuple(root), undefined);
    const config = await saver.put(root, emptyCheckpoint(), {source: 'input', step: -1, parents: {}}, {});
    await assert.rejects(saver.putWrites(config, [['text', 'x'.repeat(32 * 1024)]], 'task'), /checkpoint-capacity/);
    assert.deepEqual((await saver.getTuple(config))?.pendingWrites, []);
  } finally {database.close();}
});
