import assert from 'node:assert/strict';
import test from 'node:test';
import type {InboxItem, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeChildRequestId} from '../../src/core/mode-participants.ts';
import {modeInboxIssues as modeIssues} from '../src/hub-mode.ts';
const modeInboxIssues = async (...args: Parameters<typeof modeIssues>): Promise<string[]> => (await modeIssues(...args)).map(issue => issue.id);

const parent = (requestId: string, sentAtMs: number): OperationRecord => ({id: requestId, revision: sentAtMs, requestId, kind: 'mode', family: 'mode-set', command: 'org.bunny.mode.set.requested', target: 'hub', requestedBy: 'bunny/parts/dashboard', status: 'completed', result: 'succeeded', evidence: 'observed', sentAtMs, updatedAtMs: sentAtMs, deadlineAtMs: sentAtMs + 1000});
async function child(p: OperationRecord, target: string, result: OperationRecord['result']): Promise<OperationRecord> {
  const record: OperationRecord = {...p, id: `${p.id}-${target}`, requestId: await modeChildRequestId(p.requestId, target), kind: 'device', family: 'device-mode-set', command: 'org.bunny.device-mode.set.requested', target, requestedBy: 'bunny/core', status: result === undefined ? 'accepted' : result === 'conflict' ? 'conflict' : result === 'uncertain' ? 'uncertain' : 'completed', evidence: result === 'succeeded' ? 'transmitted' : 'none'};
  if (result === undefined) delete record.result; else record.result = result;
  return record;
}
function item(op: OperationRecord): InboxItem {
  return {id: `inbox-${op.id}`, revision: 1, createdAtMs: op.updatedAtMs, dismissedBy: [], item: {kind: 'operation', requestId: op.requestId, command: op.command, target: op.target, result: op.result ?? 'uncertain', ...op.evidence === undefined ? {} : {evidence: op.evidence}}};
}

void test('only related Inbox items warn, and handling removes the mode warning', async () => {
  const p = parent('first', 1), failure = await child(p, 'wall', 'failed'), entry = item(failure);
  const native = {...failure, id: 'native', requestId: 'native-request', requestedBy: 'bunny/parts/dashboard'}, unrelated = item(native);
  assert.deepEqual(await modeInboxIssues([p, failure, native], [unrelated, entry]), [entry.id]);
  assert.deepEqual(await modeInboxIssues([p, failure, native], [unrelated]), []);
});

void test('click, saved choice, acceptance, missing results and wrong sender do not resolve an issue', async () => {
  const first = parent('old', 1), failure = await child(first, 'wall', 'uncertain'), entry = item(failure), next = parent('new', 2);
  const pending = await child(next, 'wall', undefined);
  for (const extra of [[], [next], [next, pending], [next, {...pending, status: 'completed' as const, result: 'succeeded' as const, requestedBy: 'other'}], [next, await child(next, 'other', 'succeeded')]]) {
    assert.deepEqual(await modeInboxIssues([first, failure, ...extra], [entry]), [entry.id]);
  }
});

void test('later definitive target success clears a warning but preserves the historical Inbox', async () => {
  const old = parent('old', 1), failure = await child(old, 'wall', 'failed'), entry = item(failure), next = parent('new', 2), success = await child(next, 'wall', 'succeeded');
  const inbox = [entry];
  assert.deepEqual(await modeInboxIssues([old, failure, next, success], inbox), []);
  assert.deepEqual(inbox, [entry]);
  for (const result of ['failed', 'uncertain', 'conflict'] as const) assert.deepEqual(await modeInboxIssues([old, failure, next, await child(next, 'wall', result)], inbox), [entry.id]);
  const accepted = {...next, status: 'accepted' as const};
  assert.deepEqual(await modeInboxIssues([old, failure, accepted, success], inbox), [entry.id], 'a retained success value does not substitute for completed status');
  delete accepted.result;
  assert.deepEqual(await modeInboxIssues([old, failure, accepted, success], inbox), [entry.id]);
});

void test('a new independent mode failure and a direct parent failure each remain visible', async () => {
  const old = parent('old', 1), failure = await child(old, 'wall', 'failed'), next = parent('new', 2), success = await child(next, 'wall', 'succeeded'), other = await child(next, 'pixoo-1', 'uncertain');
  assert.deepEqual(await modeInboxIssues([old, failure, next, success, other], [item(failure), item(other)]), [item(other).id]);
  const rejected = {...next, requestId: 'refused', status: 'rejected' as const, result: 'failed' as const};
  assert.deepEqual(await modeInboxIssues([rejected], [item(rejected)]), [item(rejected).id]);
});

void test('retired child operation evidence still matches the retained Inbox by exact identity', async () => {
  const p = parent('old', 1), failure = await child(p, 'wall', 'failed'), entry = item(failure);
  assert.deepEqual(await modeInboxIssues([p], [entry]), [entry.id]);
  assert.deepEqual(await modeInboxIssues([], [entry]), [entry.id]);
  assert.deepEqual(await modeInboxIssues([], []), []);
  assert.deepEqual(await modeInboxIssues([{...failure, requestId: 'near-match', requestedBy: 'bunny/parts/dashboard'}], [{...entry, item: {...entry.item, requestId: 'near-match'}}]), []);
});

void test('fresh mounts retain a device-mode issue after its parent and child projections retire', async () => {
  const p = parent('retired-parent', 1), failure = await child(p, 'wall', 'failed'), entry = item(failure);
  assert.deepEqual(await modeInboxIssues([], [entry]), [entry.id]);
});

void test('unavailable association stays explicit and only later definitive target evidence clears it', async () => {
  const old = parent('retired', 1), entry = item(await child(old, 'wall', 'failed')), next = parent('new', 2), success = await child(next, 'wall', 'succeeded');
  assert.deepEqual(await modeIssues([], [entry]), [{id: entry.id, association: 'unavailable'}]);
  assert.deepEqual(await modeInboxIssues([next], [entry]), [entry.id]);
  assert.deepEqual(await modeInboxIssues([next, await child(next, 'other', 'succeeded')], [entry]), [entry.id]);
  assert.deepEqual(await modeInboxIssues([next, success], [entry]), []);
  assert.deepEqual(await modeInboxIssues([next, success], [{...entry, createdAtMs: 3}]), [entry.id], 'earlier success does not resolve a later failure');
  const independent = {...success, requestedBy: 'bunny/parts/dashboard', result: 'failed' as const};
  assert.deepEqual(await modeInboxIssues([independent], [item(independent)]), [], 'current evidence excludes a known independent native request');
  assert.deepEqual(await modeInboxIssues([], [item(independent)]), [item(independent).id], 'retired independent evidence has unknown association, never a claimed Hub failure');
});
