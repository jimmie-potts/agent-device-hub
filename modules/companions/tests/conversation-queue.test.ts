// The Conversation page's read of the message queue (Hub #2030): the route's document is decoded strictly, the hold
// names its control, and the module's queue limit is the bound `assistant-state/2.2` publishes. Synthetic data only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {LIMITS} from '../src/assistant/limits.js';
import {decodeQueue, holdText} from '../src/frontend/conversation-queue-read.js';

const message = (id: string, text = `Synthetic ${id}`) => ({id, text, queuedAtMs: 1, updatedAtMs: 2});
const document = (extra: Record<string, unknown> = {}) => ({version: 1, profile: 'bunny', conversationId: 'conversation-1', revision: 7, current: true, held: null, messages: [message('queued-1')], ...extra});

void test('the queue document decodes only as the module writes it', () => {
  assert.deepEqual(decodeQueue(document(), 'bunny'), {profile: 'bunny', conversationId: 'conversation-1', revision: 7, current: true, held: null, messages: [message('queued-1')]});
  assert.equal(decodeQueue(document({revision: -1}), 'bunny'), undefined, 'the read names the revision it was read at');
  assert.equal(decodeQueue(document({current: 'yes'}), 'bunny'), undefined);
  assert.deepEqual(decodeQueue(document({conversationId: null, messages: []}), 'bunny')?.messages, []);
  assert.equal(decodeQueue(document({held: {reason: 'stop', code: null, detail: null}}), 'bunny')?.held?.reason, 'stop');
  assert.equal(decodeQueue(document(), 'reachy'), undefined, 'another profile\'s queue');
  assert.equal(decodeQueue(document({version: 2}), 'bunny'), undefined);
  assert.equal(decodeQueue(document({messages: [message('queued-1'), message('queued-1')]}), 'bunny'), undefined, 'one entry per message');
  assert.equal(decodeQueue(document({messages: Array.from({length: LIMITS.queuedMessages + 1}, (_, index) => message(`queued-${String(index)}`))}), 'bunny'), undefined, 'at most the limit');
  assert.equal(decodeQueue(document({messages: [message('queued 1')]}), 'bunny'), undefined, 'an ID is a request ID');
  assert.equal(decodeQueue(document({messages: [message('queued-1', '  ')]}), 'bunny'), undefined, 'a queued message has text');
  assert.equal(decodeQueue(document({held: {reason: 'paused', code: null, detail: null}}), 'bunny'), undefined);
  assert.equal(decodeQueue(document({held: {reason: 'stop', code: null, detail: null}, messages: []}), 'bunny'), undefined, 'only a queue with messages is held');
});

void test('a hold names why and the control that releases it: Start after a restart, Resume queue otherwise', () => {
  assert.deepEqual(holdText({reason: 'restart', code: null, detail: null}), {text: 'The queue is held because B.U.N.N.Y. restarted. Nothing in it starts until you start it.', action: 'Start'});
  assert.deepEqual(holdText({reason: 'stop', code: null, detail: null}), {text: 'The queue is held because you stopped the task. Nothing in it starts until you resume it.', action: 'Resume queue'});
  assert.deepEqual(holdText({reason: 'refused', code: 'capacity', detail: 'The daily spend limit of $20.00 is reached.'}),
    {text: 'The queue is held because its next message could not start: The daily spend limit of $20.00 is reached.', action: 'Resume queue'});
  assert.equal(holdText({reason: 'refused', code: 'unavailable', detail: null}).text, 'The queue is held because its next message could not start (unavailable).');
});

void test('the module\'s queue limit is the count assistant-state/2.2 allows', () => {
  const schema = coreFamilies.find(family => family.dataschema === 'https://bunny.invalid/events/assistant-state/2.2')?.schema as
    {properties: {queues: {items: {properties: {messages: {maximum: number}}}}}} | undefined;
  assert.equal(schema?.properties.queues.items.properties.messages.maximum, LIMITS.queuedMessages);
});
