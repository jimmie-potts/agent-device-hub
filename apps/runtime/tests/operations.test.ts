// The action tracker's state machine (Hub #782): every transition of one tracked action, with no clock, store or bus.
// ADR 0012's "High-impact messages" and its "Late and conflicting outcomes" (owner decision, 2026-10-07) set the rules;
// tracker.test.ts drives the same machine through the runtime.
import assert from 'node:assert/strict';
import {DEADLINES, advance, kindOf, pending, type Operation, type OperationEvent, type TakenOutcome} from '../src/index.js';
import {it} from './support.js';

const SENT_AT = 1_000_000;
const sent = (overrides: Partial<Operation> = {}): Operation => ({
  requestId: 'req-1', kind: 'device', key: 'bunny.cmd.power-set.lamp-1', family: 'power-set', command: 'org.bunny.power.set.requested',
  dataschema: 'https://bunny.invalid/events/power-set/2.0', target: 'lamp-1', data: {on: true}, requestedBy: 'bunny/parts/operator',
  status: 'sent', outcomes: [], sentAtMs: SENT_AT, deadlineAtMs: SENT_AT + DEADLINES.device.outcomeMs, updatedAtMs: SENT_AT,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...overrides,
});
const accepted = (operation = sent()): Operation => step(operation, {type: 'reply', status: 'accepted', responder: 'bunny/modules/lamp', atMs: SENT_AT + 10});
const outcome = (result: TakenOutcome['result'], evidence: TakenOutcome['evidence'], id = `out-${result}`, atMs = SENT_AT + 20): OperationEvent => ({
  type: 'outcome', outcome: {
    source: 'bunny/modules/lamp', id, result, evidence, atMs,
    ...(result === 'failed' ? {error: {code: 'unavailable', retryable: true, detail: 'the lamp did not answer'}} : {}),
  },
});
/** The operation after `event`, which must change it. */
function step(operation: Operation, event: OperationEvent): Operation {
  const next = advance(operation, event);
  assert.ok(next, `${event.type} changes the operation`);
  return next;
}
const shape = (operation: Operation): unknown => [operation.status, operation.result, operation.evidence, operation.error?.code];

it('each kind has its own deadlines, and a family names its kind', () => {
  assert.deepEqual(DEADLINES, {
    device: {replyMs: 5000, outcomeMs: 30_000}, moment: {replyMs: 5000, outcomeMs: 150_000}, mode: {replyMs: 5000, outcomeMs: 60_000},
  });
  assert.deepEqual(['power-set', 'playback-control', 'lifx-color-set', 'moment-play', 'mode-set'].map(kindOf), ['device', 'device', 'device', 'moment', 'mode']);
});

it('sent, accepted, then completed by its outcome', () => {
  const replied = accepted();
  assert.deepEqual([replied.status, replied.result, replied.reply, replied.responder], ['accepted', undefined, 'accepted', 'bunny/modules/lamp']);
  assert.equal(pending(replied), true);
  const done = step(replied, outcome('succeeded', 'observed'));
  assert.deepEqual(shape(done), ['completed', 'succeeded', 'observed', undefined]);
  assert.equal(pending(done), false);
  assert.deepEqual(done.outcomes.map(item => item.id), ['out-succeeded']);
  assert.deepEqual(shape(step(accepted(), outcome('failed', 'none'))), ['completed', 'failed', 'none', 'unavailable']);
  assert.deepEqual(shape(step(accepted(), outcome('uncertain', 'transmitted'))), ['completed', 'uncertain', 'transmitted', undefined]);
});

it('a refusal proves no effect: rejected and failed, with no evidence; one still queued at its deadline is expired', () => {
  const refused = step(sent(), {type: 'reply', status: 'rejected', error: {code: 'not-found', retryable: false, detail: 'no such lamp'}, responder: 'bunny/modules/lamp', atMs: SENT_AT + 5});
  assert.deepEqual(shape(refused), ['rejected', 'failed', 'none', 'not-found']);
  assert.equal(refused.reply, 'not-found');
  assert.equal(refused.error?.requestId, 'req-1', 'the error names its request');
  const unrouted = step(sent(), {type: 'reply', status: 'rejected', error: {code: 'unavailable', retryable: true, detail: 'no responder for this routing key'}, atMs: SENT_AT + 1});
  assert.deepEqual(shape(unrouted), ['rejected', 'failed', 'none', 'unavailable'], 'a stopped module\'s command is failed');
  const expired = step(sent(), {type: 'reply', status: 'rejected', error: {code: 'expired', retryable: true, detail: 'still queued'}, atMs: SENT_AT + 5000});
  assert.deepEqual(shape(expired), ['expired', 'failed', 'none', 'expired']);
});

it('a handler that had it at its reply deadline leaves it uncertain; so does a deadline with no outcome; and nothing else moves it', () => {
  const held = step(sent(), {type: 'reply', status: 'uncertain', error: {code: 'uncertain-result', retryable: false, detail: 'no reply within 5000 ms'}, atMs: SENT_AT + 5000});
  assert.deepEqual(shape(held), ['uncertain', 'uncertain', 'none', 'uncertain-result']);
  assert.equal(held.reply, undefined, 'its reply is unknown');
  const replied = accepted();
  assert.equal(advance(replied, {type: 'deadline', atMs: replied.deadlineAtMs - 1}), undefined, 'not before its deadline');
  const late = step(replied, {type: 'deadline', atMs: replied.deadlineAtMs});
  assert.deepEqual(shape(late), ['uncertain', 'uncertain', 'none', 'uncertain-result']);
  // After a restart the request is gone: an action still sent ends uncertain at its deadline too, never sent again.
  assert.deepEqual(shape(step(sent(), {type: 'deadline', atMs: SENT_AT + 30_000})), ['uncertain', 'uncertain', 'none', 'uncertain-result']);
  for (const settled of [late, step(replied, outcome('succeeded', 'observed'))]) {
    assert.equal(advance(settled, {type: 'deadline', atMs: settled.deadlineAtMs + 1}), undefined, 'a deadline moves only a pending action');
  }
});

it('a late definitive outcome replaces an uncertain result, and an uncertain one after a definitive result adds only its evidence', () => {
  const uncertain = step(accepted(), {type: 'deadline', atMs: SENT_AT + 30_000});
  const late = step(uncertain, outcome('succeeded', 'observed', 'late', SENT_AT + 40_000));
  assert.deepEqual(shape(late), ['completed', 'succeeded', 'observed', undefined], 'the late outcome completes the record; its error goes');
  const reported = step(accepted(), outcome('uncertain', 'none', 'unsure'));
  assert.deepEqual(shape(step(reported, outcome('failed', 'none', 'failed-later'))), ['completed', 'failed', 'none', 'unavailable'], 'a module\'s own uncertain outcome is replaced too');
  const succeeded = step(accepted(), outcome('succeeded', 'transmitted'));
  const after = step(succeeded, outcome('uncertain', 'none', 'unsure-later'));
  assert.deepEqual(shape(after), ['completed', 'succeeded', 'transmitted', undefined]);
  assert.equal(after.outcomes.length, 2, 'both outcomes are kept');
  // An uncertain result, then another uncertain outcome: still uncertain, with the stronger evidence.
  const twice = step(step(uncertain, outcome('uncertain', 'transmitted', 'u1')), outcome('uncertain', 'none', 'u2'));
  assert.deepEqual([twice.status, twice.result, twice.evidence], ['uncertain', 'uncertain', 'transmitted']);
});

it('a succeeded and a failed outcome for one action are a conflict in either order, and arrival order never picks a winner', () => {
  for (const [first, second] of [['succeeded', 'failed'], ['failed', 'succeeded']] as const) {
    const one = step(accepted(), outcome(first, first === 'succeeded' ? 'observed' : 'none', 'one'));
    const both = step(one, outcome(second, second === 'succeeded' ? 'observed' : 'none', 'two'));
    assert.deepEqual([both.status, both.result], ['conflict', 'conflict'], `${first} then ${second}`);
    assert.deepEqual(both.outcomes.map(item => item.result), [first, second], 'both outcomes are kept for a person');
    assert.equal(both.evidence, 'observed', 'with the stronger evidence');
    // Further outcomes keep the conflict: nothing settles it but a person.
    const more = step(both, outcome('succeeded', 'observed', 'three'));
    assert.deepEqual([more.status, more.result, more.outcomes.length], ['conflict', 'conflict', 3]);
  }
  // A refusal proved no effect, so a succeeded outcome contradicts it.
  const refused = step(sent(), {type: 'reply', status: 'rejected', error: {code: 'invalid-state', retryable: false}, atMs: SENT_AT + 1});
  assert.equal(step(refused, outcome('succeeded', 'observed')).result, 'conflict');
  assert.equal(step(refused, outcome('failed', 'none')).result, 'failed', 'a failed outcome agrees with it');
});

it('an identical retransmission is no change, and a reply after an outcome only records what the owner said', () => {
  const done = step(accepted(), outcome('succeeded', 'observed', 'same'));
  assert.equal(advance(done, outcome('succeeded', 'observed', 'same')), undefined, 'the same (source, id) is taken once');
  // The outcome came before the reply was recorded, as it can in process.
  const early = step(sent(), outcome('succeeded', 'observed'));
  assert.equal(early.status, 'completed');
  const replied = step(early, {type: 'reply', status: 'accepted', responder: 'bunny/modules/lamp', atMs: SENT_AT + 30});
  assert.deepEqual([replied.status, replied.result, replied.reply], ['completed', 'succeeded', 'accepted']);
  assert.equal(advance(replied, {type: 'reply', status: 'accepted', atMs: SENT_AT + 40}), undefined, 'one reply');
});
