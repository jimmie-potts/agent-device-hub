import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';

void test('abrupt process exit preserves question and committed answer; restart never invokes work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-process-'));
  const child = (mode: string, status = 0) => {
    const run = spawnSync(process.execPath, [new URL('./assistant-child.js', import.meta.url).pathname, dir, mode], {encoding: 'utf8', timeout: 20_000});
    assert.equal(run.status, status, run.stderr);
    return run.stdout === '' ? undefined : JSON.parse(run.stdout) as {state: AssistantState; calls: number};
  };
  try {
    const first = child('start', 17)?.state.tasks[0]; assert.ok(first);
    const restarted = child('inspect'); assert.equal(restarted?.calls, 0); assert.equal(restarted?.state.tasks[0]?.questionId, first.questionId);
    child('answer-crash', 18);
    const saved = child('inspect'); assert.equal(saved?.calls, 0); assert.equal(saved?.state.tasks[0]?.hasAnswer, true); assert.equal(saved?.state.tasks[0]?.status, 'paused');
    const done = child('resume'); assert.equal(done?.calls, 1); assert.equal(done?.state.tasks[0]?.taskId, first.taskId);
    assert.equal(done?.state.tasks[0]?.conversationId, first.conversationId); assert.notEqual(done?.state.tasks[0]?.runId, first.runId);
    assert.equal(done?.state.tasks[0]?.modelCalls, 2); assert.equal(done?.state.tasks[0]?.toolCalls, 1);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

void test('process loss after call admission preserves unknown usage and refuses a retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-lost-'));
  const child = (mode: string) => spawnSync(process.execPath, [new URL('./assistant-child.js', import.meta.url).pathname, dir, mode], {encoding: 'utf8', timeout: 20_000});
  try {
    const lost = child('lost-call'); assert.equal(lost.status, 19, lost.stderr);
    const inspected = child('refuse'); assert.equal(inspected.status, 0, inspected.stderr);
    const value = JSON.parse(inspected.stdout) as {state: AssistantState; calls: number; refused: string};
    assert.equal(value.calls, 0); assert.equal(value.refused, 'rejected');
    assert.equal(value.state.tasks[0]?.status, 'uncertain'); assert.equal(value.state.tasks[0]?.usageUnits, null);
    assert.ok((value.state.tasks[0]?.activeMs ?? 0) >= 30_000); assert.ok((value.state.tasks[0]?.activeMs ?? 120_000) < 120_000); assert.equal(value.state.tasks[0]?.reservedUnits, 2048);
  } finally {rmSync(dir, {recursive: true, force: true});}
});
