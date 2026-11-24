// The Conversation page's read of the message queue (Hub #2030): the route's document is decoded strictly, the hold
// names its control, and the module's queue limit is the bound `assistant-state/2.2` publishes; returned steers may pass
// it up to the bound of `assistant-state/2.3` (Hub #2031). Synthetic data only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {LIMITS} from '../src/assistant/limits.js';
import {decodeQueue, holdText} from '../src/frontend/conversation-queue-read.js';

const message = (id: string, text = `Synthetic ${id}`) => ({id, text, queuedAtMs: 1, updatedAtMs: 2});
const document = (extra: Record<string, unknown> = {}) => ({version: 1, profile: 'bunny', conversationId: 'conversation-1', revision: 7, current: true, held: null, messages: [message('queued-1')], ...extra});

void test('the queue document decodes only as the module writes it', () => {
  assert.deepEqual(decodeQueue(document(), 'bunny'), {profile: 'bunny', conversationId: 'conversation-1', revision: 7, current: true, held: null, messages: [message('queued-1')], steers: []});
  assert.equal(decodeQueue(document({revision: -1}), 'bunny'), undefined, 'the read names the revision it was read at');
  assert.equal(decodeQueue(document({current: 'yes'}), 'bunny'), undefined);
  assert.deepEqual(decodeQueue(document({conversationId: null, messages: []}), 'bunny')?.messages, []);
  assert.equal(decodeQueue(document({held: {reason: 'stop', code: null, detail: null}}), 'bunny')?.held?.reason, 'stop');
  assert.equal(decodeQueue(document(), 'reachy'), undefined, 'another profile\'s queue');
  assert.equal(decodeQueue(document({version: 2}), 'bunny'), undefined);
  assert.equal(decodeQueue(document({messages: [message('queued-1'), message('queued-1')]}), 'bunny'), undefined, 'one entry per message');
  // Steers a stopped turn returned may take a queue past its limit, up to its bound (Hub #2031).
  const many = (count: number) => Array.from({length: count}, (_, index) => message(`queued-${String(index)}`));
  assert.equal(decodeQueue(document({messages: many(LIMITS.queuedMessages + 1)}), 'bunny')?.messages.length, LIMITS.queuedMessages + 1);
  assert.equal(decodeQueue(document({messages: many(LIMITS.queueBound)}), 'bunny')?.messages.length, LIMITS.queueBound);
  assert.equal(decodeQueue(document({messages: many(LIMITS.queueBound + 1)}), 'bunny'), undefined, 'at most the bound');
  assert.equal(decodeQueue(document({messages: [message('queued 1')]}), 'bunny'), undefined, 'an ID is a request ID');
  assert.equal(decodeQueue(document({messages: [message('queued-1', '  ')]}), 'bunny'), undefined, 'a queued message has text');
  assert.equal(decodeQueue(document({held: {reason: 'paused', code: null, detail: null}}), 'bunny'), undefined);
  assert.equal(decodeQueue(document({held: {reason: 'stop', code: null, detail: null}, messages: []}), 'bunny'), undefined, 'only a queue with messages is held');
});

void test('the queue document carries the running task\'s unread steers, and a release before them sends none (Hub #2031)', () => {
  const steer = (id: string, text = `Synthetic ${id}`) => ({id, text, savedAtMs: 3});
  assert.deepEqual(decodeQueue(document({steers: [steer('steer-1'), steer('steer-2')]}), 'bunny')?.steers, [steer('steer-1'), steer('steer-2')]);
  assert.deepEqual(decodeQueue(document({messages: [], steers: [steer('steer-1')]}), 'bunny')?.steers, [steer('steer-1')], 'a steer needs no queued message');
  assert.equal(decodeQueue(document({steers: [steer('steer-1'), steer('steer-1')]}), 'bunny'), undefined, 'one entry per steer');
  assert.equal(decodeQueue(document({steers: [steer('steer 1')]}), 'bunny'), undefined, 'an ID is a request ID');
  assert.equal(decodeQueue(document({steers: [steer('steer-1', ' ')]}), 'bunny'), undefined, 'a steer has text');
  assert.equal(decodeQueue(document({steers: [{id: 'steer-1', text: 'Synthetic'}]}), 'bunny'), undefined, 'and the time it was saved');
  assert.equal(decodeQueue(document({steers: Array.from({length: LIMITS.steers + 1}, (_, index) => steer(`steer-${String(index)}`))}), 'bunny'), undefined, 'at most the limit');
  assert.equal(decodeQueue(document({steers: 'none'}), 'bunny'), undefined);
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

void test('the queue\'s bound with returned steers is the count assistant-state/2.3 allows (Hub #2031)', () => {
  const schema = coreFamilies.find(family => family.dataschema === 'https://bunny.invalid/events/assistant-state/2.3')?.schema as
    {properties: {queues: {items: {properties: {messages: {maximum: number}}}}}} | undefined;
  assert.equal(schema?.properties.queues.items.properties.messages.maximum, LIMITS.queueBound);
  assert.equal(LIMITS.queueBound, LIMITS.queuedMessages + LIMITS.steers, 'a full queue and a full set of steers fit');
});
