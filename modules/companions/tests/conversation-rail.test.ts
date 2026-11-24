// What the rail's conversation group and the Conversation page share (Hub #1890): the chosen profile, and which
// conversations need the owner's answer.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AssistantProfile, AssistantState, AssistantStatus, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import {ConversationRailStore, conversationRail, knownKind, pendingQuestions, profiles, questionToRead, waitingElsewhere, waitingProfiles,
  type ConversationRailState} from '../src/frontend/conversation-rail.js';

const task = (profile: AssistantProfile, status: AssistantStatus, questionId: string | null, hasAnswer = false): AssistantTaskSummary => ({
  taskId: `task-${profile}`, conversationId: `conversation-${profile}`, profile, status, runId: null, questionId, hasAnswer, code: null,
  modelCalls: 1, toolCalls: 0, questions: questionId === null ? 0 : 1, activeMs: 10, usageUnits: null, reservedUnits: 0});
const assistant = (...tasks: AssistantTaskSummary[]): AssistantState => ({id: 'assistant', revision: 4, enabled: true, available: true, provider: 'synthetic', model: 'synthetic', tools: [], tasks});

void test('the profiles are listed in the rail\'s order, each by its name alone, with no Demo label', () => {
  // Every profile uses the configured model (Hub #2026), so none is labelled a demo.
  assert.deepEqual(Object.entries(profiles), [['bunny', {name: 'B.U.N.N.Y.'}], ['reachy', {name: 'Reachy'}], ['microduck', {name: 'MicroDuck'}]]);
});

void test('the store starts on B.U.N.N.Y., keeps the chosen profile and tells its listeners once for each change', () => {
  const store = new ConversationRailStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => {notified += 1;});
  assert.deepEqual(store.getSnapshot(), {profile: 'bunny', open: false, questions: {}, waiting: []});
  const first = store.getSnapshot();
  store.select('bunny');
  store.setOpen(false);
  store.setWaiting([]);
  assert.equal(store.getSnapshot(), first, 'an unchanged value keeps the same snapshot');
  assert.equal(notified, 0);
  store.select('reachy');
  store.setOpen(true);
  assert.deepEqual([store.getSnapshot().profile, store.getSnapshot().open], ['reachy', true]);
  assert.equal(notified, 2);
  store.setOpen(false);
  assert.equal(store.getSnapshot().profile, 'reachy', 'a page that is left keeps its profile for the next visit');
  unsubscribe();
  store.select('microduck');
  assert.equal(notified, 3, 'an unsubscribed listener hears nothing more');
  assert.deepEqual(conversationRail.getSnapshot(), {profile: 'bunny', open: false, questions: {}, waiting: []}, 'the page\'s one store starts the same way');
});

void test('a question\'s kind is kept for its profile, a newer question replaces it and the same one is not a change', () => {
  const store = new ConversationRailStore();
  let notified = 0;
  store.subscribe(() => {notified += 1;});
  store.learn('bunny', {taskId: 'task-bunny', questionId: 'q1', kind: 'clarification'});
  store.learn('bunny', {taskId: 'task-bunny', questionId: 'q1', kind: 'clarification'});
  assert.equal(notified, 1);
  store.learn('reachy', {taskId: 'task-reachy', questionId: 'q7', kind: 'delegation'});
  store.learn('bunny', {taskId: 'task-bunny', questionId: 'q2', kind: 'approval'});
  assert.deepEqual(store.getSnapshot().questions, {bunny: {taskId: 'task-bunny', questionId: 'q2', kind: 'approval'}, reachy: {taskId: 'task-reachy', questionId: 'q7', kind: 'delegation'}});
  assert.equal(notified, 3);
});

void test('the waiting list is copied, compared by value and empty again when nothing waits', () => {
  const store = new ConversationRailStore();
  let notified = 0;
  store.subscribe(() => {notified += 1;});
  const given: AssistantProfile[] = ['reachy'];
  store.setWaiting(given);
  given.push('bunny');
  assert.deepEqual(store.getSnapshot().waiting, ['reachy'], 'a later change to the caller\'s list changes nothing');
  store.setWaiting(['reachy']);
  assert.equal(notified, 1);
  store.setWaiting(['reachy', 'bunny']);
  store.setWaiting([]);
  assert.deepEqual(store.getSnapshot().waiting, []);
  assert.equal(notified, 3);
});

void test('a task waits on a question only while it is waiting or paused, unanswered and read from a live copy', () => {
  const state = assistant(task('bunny', 'waiting', 'q1'), task('reachy', 'paused', 'q2'), task('microduck', 'waiting', 'q3', true));
  assert.deepEqual(pendingQuestions(state, true), [
    {profile: 'bunny', taskId: 'task-bunny', questionId: 'q1'}, {profile: 'reachy', taskId: 'task-reachy', questionId: 'q2'}]);
  assert.deepEqual(pendingQuestions(state, false), [], 'a copy that is not live claims nothing');
  assert.deepEqual(pendingQuestions(undefined, true), [], 'a missing copy claims nothing');
  for (const status of ['running', 'succeeded', 'failed', 'cancelled', 'uncertain'] satisfies AssistantStatus[]) {
    assert.deepEqual(pendingQuestions(assistant(task('bunny', status, 'q1')), true), [], status);
  }
  assert.deepEqual(pendingQuestions(assistant(task('bunny', 'waiting', null)), true), [], 'a wait with no question is not a question');
});

void test('a conversation needs the owner for a clarification or an approval, never for delegated work or an unread question', () => {
  const pending = pendingQuestions(assistant(task('bunny', 'waiting', 'q1'), task('reachy', 'waiting', 'q2'), task('microduck', 'paused', 'q3')), true);
  assert.deepEqual(waitingProfiles(pending, {}), [], 'a question nobody has read is not claimed');
  const questions: ConversationRailState['questions'] = {
    bunny: {taskId: 'task-bunny', questionId: 'q1', kind: 'clarification'},
    reachy: {taskId: 'task-reachy', questionId: 'q2', kind: 'delegation'},
    microduck: {taskId: 'task-microduck', questionId: 'q3', kind: 'approval'},
  };
  assert.deepEqual(waitingProfiles(pending, questions), ['bunny', 'microduck'], 'a wait on the coding worker needs nothing from the owner');
  const [bunny] = pending;
  assert.ok(bunny !== undefined);
  assert.equal(knownKind(bunny, questions), 'clarification');
  assert.equal(knownKind(bunny, {bunny: {taskId: 'task-bunny', questionId: 'q0', kind: 'approval'}}), undefined, 'an earlier question\'s kind says nothing about this one');
  assert.equal(knownKind(bunny, {bunny: {taskId: 'task-older', questionId: 'q1', kind: 'approval'}}), undefined, 'another task\'s question says nothing about this one');
  assert.deepEqual(waitingProfiles(pending, {bunny: {taskId: 'task-bunny', questionId: 'q0', kind: 'approval'}}), []);
});

void test('the phone marker is for a conversation other than the one the page shows', () => {
  const base: ConversationRailState = {profile: 'bunny', open: true, questions: {}, waiting: []};
  assert.equal(waitingElsewhere(base), false);
  assert.equal(waitingElsewhere({...base, waiting: ['bunny']}), false, 'the open conversation shows its own question');
  assert.equal(waitingElsewhere({...base, waiting: ['bunny'], open: false}), true, 'on another page the same conversation is elsewhere');
  assert.equal(waitingElsewhere({...base, waiting: ['reachy']}), true);
  assert.equal(waitingElsewhere({...base, waiting: ['bunny', 'reachy']}), true);
});

void test('the rail reads a question\'s kind only when nobody has read it and the open page is not reading it', () => {
  const pending = pendingQuestions(assistant(task('bunny', 'waiting', 'q1'), task('reachy', 'waiting', 'q2')), true);
  const closed: ConversationRailState = {profile: 'bunny', open: false, questions: {}, waiting: []};
  assert.deepEqual(questionToRead(pending, closed), {profile: 'bunny', taskId: 'task-bunny', questionId: 'q1'});
  assert.deepEqual(questionToRead(pending, {...closed, open: true}), {profile: 'reachy', taskId: 'task-reachy', questionId: 'q2'},
    'the open Conversation page reads its own profile and shares the kind');
  assert.deepEqual(questionToRead(pending, {...closed, open: true, profile: 'reachy'}), {profile: 'bunny', taskId: 'task-bunny', questionId: 'q1'});
  const known: ConversationRailState['questions'] = {bunny: {taskId: 'task-bunny', questionId: 'q1', kind: 'clarification'}, reachy: {taskId: 'task-reachy', questionId: 'q2', kind: 'delegation'}};
  assert.equal(questionToRead(pending, {...closed, questions: known}), undefined, 'a kind that is known is not read again');
  assert.deepEqual(questionToRead(pending, {...closed, questions: {...known, bunny: {taskId: 'task-bunny', questionId: 'q0', kind: 'clarification'}}}),
    {profile: 'bunny', taskId: 'task-bunny', questionId: 'q1'}, 'a new question is read');
  assert.equal(questionToRead([], closed), undefined);
});
