import assert from 'node:assert/strict';
import {test} from 'node:test';
import {historyCursor, type CurrentTask, type RecentConversationPage} from '../src/assistant/history-contract.js';
import {decodeConversationList, decodeConversationWindow, loadEarlierConversationHistory, refreshConversationHistory, type ConversationHistory} from '../src/frontend/conversation-history.js';

const profile = 'bunny';
const conversationId = 'synthetic-thread';
const cursor = (seq: number): string => historyCursor({profile, conversationId, seq});
const signal = (): AbortSignal => new AbortController().signal;
const currentTask: CurrentTask = {taskId: 't', question: {id: 'q', text: 'Synthetic question', kind: 'clarification', answer: null, proposal: null}};

function page(sequences: number[], older: string | null, task: CurrentTask | null = null): RecentConversationPage {
  return {version: 2, profile, conversationId, older, currentTask: task, messages: sequences.map(seq => ({seq, id: `m-${String(seq)}`, taskId: 't', role: 'owner', text: 'Synthetic history', atMs: 0}))};
}

const sequences = (history: ConversationHistory): number[][] => history.windows.map(window => window.messages.map(message => message.seq));

void test('refresh and earlier reads merge one window at a time without replacing the current task', async () => {
  let requests = 0;
  const read = (response: RecentConversationPage, before?: string) => (path: string): Promise<unknown> => {
    assert.equal(path, `/modules/companions/content/conversation?profile=bunny&view=recent${before === undefined ? '' : `&before=${before}`}`);
    requests += 1;
    return Promise.resolve(response);
  };
  const initial = await refreshConversationHistory(read(page([7, 8, 9], cursor(7), currentTask)), profile, signal());
  const earlier = await loadEarlierConversationHistory(read(page([4, 5, 6], cursor(4)), cursor(7)), initial, cursor(7), signal());
  assert.deepEqual(sequences(earlier), [[4, 5, 6, 7, 8, 9]]);
  assert.equal(earlier.currentTask, initial.currentTask);
  const overlap = await refreshConversationHistory(read(page([8, 9, 10], cursor(8), currentTask)), profile, signal(), earlier);
  assert.deepEqual(sequences(overlap), [[4, 5, 6, 7, 8, 9, 10]]);
  assert.equal(overlap.windows[0]?.older, cursor(4));
  const updatedTask: CurrentTask = {taskId: 'delegated', question: {id: 'q2', kind: 'delegation', text: 'Waiting for the worker', answer: null, proposal: null}};
  const gap = await refreshConversationHistory(read(page([15, 16], cursor(15), updatedTask)), profile, signal(), overlap);
  assert.equal(requests, 4, 'refresh never walks earlier pages');
  assert.deepEqual(sequences(gap), [[4, 5, 6, 7, 8, 9, 10], [15, 16]]);
  assert.deepEqual(gap.currentTask, updatedTask);
  const gapReduced = await loadEarlierConversationHistory(read(page([12, 13, 14], cursor(12)), cursor(15)), gap, cursor(15), signal());
  assert.deepEqual(sequences(gapReduced), [[4, 5, 6, 7, 8, 9, 10], [12, 13, 14, 15, 16]]);
  const joined = await loadEarlierConversationHistory(read(page([9, 10, 11], cursor(9)), cursor(12)), gapReduced, cursor(12), signal());
  assert.deepEqual(sequences(joined), [[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]]);
  assert.equal(joined.windows[0]?.older, cursor(4));
  assert.equal(joined.currentTask, gap.currentTask);
  await assert.rejects(loadEarlierConversationHistory(() => Promise.reject(new Error('Read unavailable')), joined, cursor(4), signal()), /Read unavailable/);
  const retried = await loadEarlierConversationHistory(read(page([1, 2, 3], null), cursor(4)), joined, cursor(4), signal());
  assert.deepEqual(sequences(retried), [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]]);
  assert.equal(retried.windows[0]?.older, null);
});

void test('profile changes and aborts fence late results and response identity', async () => {
  let resolve: (page: RecentConversationPage) => void = () => assert.fail('not started');
  const late = new Promise<unknown>(done => {resolve = done;});
  const controller = new AbortController();
  const obsolete = refreshConversationHistory(() => late, profile, controller.signal);
  controller.abort();
  const active = await refreshConversationHistory(() => Promise.resolve({...page([], null), conversationId: null, profile: 'reachy'}), 'reachy', signal());
  resolve(page([1], null, currentTask));
  await assert.rejects(obsolete, {name: 'AbortError'});
  assert.equal(active.profile, 'reachy');
  const first = await refreshConversationHistory(() => Promise.resolve(page([7, 8, 9], cursor(7), currentTask)), profile, signal());
  const replacement = await refreshConversationHistory(() => Promise.resolve({...page([50], null), conversationId: 'replacement'}), profile, signal(), first);
  assert.deepEqual(sequences(replacement), [[50]]);
  for (const value of [
    {...page([], null), profile: 'reachy'}, {...page([], null), conversationId: 'other'}, page([7], null),
    page([6], cursor(7)), page([5, 4], null), page([], null, currentTask),
  ]) assert.throws(() => decodeConversationWindow(value, {profile, before: cursor(7)}), /Invalid conversation window/);
  assert.throws(() => decodeConversationWindow(page([1], null), {profile: 'reachy'}), /Invalid conversation window/);
  assert.throws(() => decodeConversationWindow(page(Array.from({length: 17}, (_, index) => index + 1), null), {profile}), /Invalid conversation window/);
});

void test('an earlier conversation is read by its ID, stays read only and pages within itself (Hub #2029)', async () => {
  const paths: string[] = [];
  const read = (response: unknown) => (path: string): Promise<unknown> => {paths.push(path); return Promise.resolve(response);};
  const opened = await refreshConversationHistory(read(page([3, 4], cursor(3))), profile, signal(), undefined, conversationId);
  assert.deepEqual([opened.earlier, opened.conversationId, opened.currentTask], [true, conversationId, null]);
  const paged = await loadEarlierConversationHistory(read(page([1, 2], null)), opened, cursor(3), signal());
  assert.deepEqual(sequences(paged), [[1, 2, 3, 4]]);
  assert.deepEqual(paths, [`/modules/companions/content/conversation?profile=bunny&view=recent&conversationId=${conversationId}`,
    `/modules/companions/content/conversation?profile=bunny&view=recent&before=${cursor(3)}&conversationId=${conversationId}`]);
  // A page for another conversation, or one that claims a current task, is refused.
  await assert.rejects(refreshConversationHistory(read({...page([3], null), conversationId: 'another-thread'}), profile, signal(), undefined, conversationId));
  await assert.rejects(refreshConversationHistory(read(page([3], null, currentTask)), profile, signal(), undefined, conversationId));
  // The current conversation's read starts fresh rather than merging into an earlier one's windows.
  const current = await refreshConversationHistory(read(page([5], null, currentTask)), profile, signal(), paged);
  assert.deepEqual([current.earlier, sequences(current)], [false, [[5]]]);
});

void test('the conversation list is checked before the page shows it', () => {
  const entry = {conversationId: 'c-2', current: true, messages: 0, firstAtMs: null, lastAtMs: null, title: {value: 'B.U.N.N.Y.', source: 'provider'}};
  assert.deepEqual(decodeConversationList({version: 1, profile, older: null, conversations: [entry]}, profile).conversations, [entry]);
  assert.throws(() => decodeConversationList({version: 1, profile: 'reachy', older: null, conversations: [entry]}, profile));
  assert.throws(() => decodeConversationList({version: 1, profile, older: null, conversations: [{...entry, title: {value: 'x', source: 'model'}}]}, profile));
});
