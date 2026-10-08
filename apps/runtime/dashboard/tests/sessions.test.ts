// What the dashboard shows of each agent session (Hub #922), from the session record alone: the name's precedence, the
// chip's state, a finished turn unread until a consumer's acknowledgment, the next turn or positive read evidence on the
// record clears it (owner decision, 2026-10-08), and the attention lines and facts the old dashboard showed.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CHIP_TEXT, age, chipOf, clientName, finishedUnread, matches, sessionName, sessionRow} from '../src/sessions.ts';

const NOTICE = 'a'.repeat(64);
/** A synthetic, current, idle Claude Code session. */
function record(change: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'b'.repeat(64), revision: 4, generation: 1,
    identity: {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'},
    parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'}, activity: 'idle', attention: [], notices: [], read: 'unknown',
    unavailable: [], ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000, freshness: 'current', restartUncertain: false,
    children: {active: 0, uncertain: 0}, ...change,
  };
}
const finished = (acknowledgedBy: string[] = []): SessionRecord['notices'] => [{id: NOTICE, kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy}];

void test('a session is named by its label, then its title, then its native ID, and placed by project and client', () => {
  assert.equal(sessionName(record({label: {value: 'Port the wall', origin: 'user'}, title: {value: 'A title', source: 'provider'}})), 'Port the wall');
  assert.equal(sessionName(record({title: {value: 'A title', source: 'provider'}})), 'A title');
  assert.equal(sessionName(record()), 'session-sim-1', 'the neutral fallback');
  assert.deepEqual(sessionRow(record({label: {value: 'Explicit', origin: 'user'}, title: {value: 'Provider title', source: 'provider'}})).label, {value: 'Explicit', origin: 'user'});
  assert.equal(sessionRow(record({title: {value: 'Provider title', source: 'provider'}})).label, undefined, 'editing the label never prefills a title');
  assert.equal(sessionRow(record({project: 'agent-device-hub'})).where, 'agent-device-hub · Claude Code');
  assert.equal(sessionRow(record()).where, 'Claude Code');
  assert.deepEqual([clientName({...record().identity, provider: 'codex', client: 'cli'}), clientName({...record().identity, provider: 'codex', client: 'desktop'})],
    ['Codex CLI', 'Codex Desktop']);
});

void test('the chip ranks attention over work over a finished turn, and names the attention', () => {
  const approval = {id: {status: 'known', id: 'approval-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}} as const;
  const question = {id: {status: 'known', id: 'question-1'}, kind: 'question', turn: {status: 'known', id: 'turn-1'}} as const;
  assert.equal(chipOf(record({activity: 'active', attention: [question, approval], notices: finished()})), 'approval', 'an approval outranks a question');
  assert.equal(chipOf(record({activity: 'active', attention: [question]})), 'question');
  assert.equal(chipOf(record({activity: 'active', notices: finished()})), 'working');
  assert.equal(chipOf(record({activity: 'idle', children: {active: 1, uncertain: 0}})), 'working', 'an active child keeps its root working');
  assert.equal(chipOf(record({notices: finished()})), 'finished');
  assert.deepEqual([chipOf(record()), chipOf(record({activity: 'interrupted'})), chipOf(record({activity: 'unknown'}))], ['idle', 'interrupted', 'unknown']);
  const row = sessionRow(record({activity: 'active', attention: [question, approval]}));
  assert.deepEqual(row.attention, ['Question · continuing', 'Approval · blocked attention']);
  assert.equal(row.chipText, 'Waiting for approval');
  assert.equal(CHIP_TEXT.finished, 'Finished · unread');
});

void test('a finished turn stays unread until the record holds evidence that clears it, never inferred from missing evidence', () => {
  const unread = sessionRow(record({notices: finished()}));
  assert.equal(unread.chip, 'finished');
  assert.deepEqual(unread.notices, [{id: NOTICE, turn: 'turn-1', acknowledgedBy: []}]);
  assert.equal(finishedUnread(record({notices: finished(), read: 'unread'})), true, 'unread evidence keeps it');
  assert.equal(finishedUnread(record({notices: finished(), read: 'unknown'})), true, 'no read evidence is not read');
  // Any consumer's acknowledgment on the record clears it, as on LIFX and Tidbyt, #1009's operator clear among them.
  for (const consumer of ['pixoo', 'nanoleaf', 'dashboard', 'operator']) {
    assert.deepEqual([sessionRow(record({notices: finished([consumer])})).chip, finishedUnread(record({notices: finished([consumer])}))], ['idle', false], consumer);
  }
});

void test('positive read evidence on the record clears a finished turn', () => {
  const desktop = {...record().identity, provider: 'codex', client: 'desktop'} as const;
  assert.equal(sessionRow(record({identity: desktop, notices: finished(), read: 'unread'})).chip, 'finished');
  assert.equal(sessionRow(record({identity: desktop, notices: finished(), read: 'read'})).chip, 'idle', 'Codex Desktop\'s read marker clears it');
});

void test('the session\'s next turn clears the earlier finished turn, while an unknown turn proves nothing', () => {
  assert.equal(chipOf(record({turn: {status: 'known', id: 'turn-2'}, notices: finished()})), 'idle', 'turn-2 started after turn-1 ended');
  assert.equal(chipOf(record({turn: {status: 'unknown'}, notices: finished()})), 'finished', 'an unknown current turn is no evidence of a next one');
  const unknownNotice: SessionRecord['notices'] = [{id: NOTICE, kind: 'turn-ended', turn: {status: 'unknown'}, acknowledgedBy: []}];
  assert.equal(chipOf(record({turn: {status: 'known', id: 'turn-2'}, notices: unknownNotice})), 'finished', 'a notice on an unknown turn stays');
});

void test('a record whose evidence is uncertain says so, and its facts are the old Details', () => {
  assert.equal(sessionRow(record()).uncertain, false);
  assert.equal(sessionRow(record({freshness: 'uncertain'})).uncertain, true);
  assert.equal(sessionRow(record({freshness: 'uncertain', restartUncertain: true})).uncertain, true);
  const child = sessionRow(record({parent: {status: 'known', identity: {...record().identity, sessionId: 'parent-1'}}, children: {active: 2, uncertain: 1}, read: 'unread'}));
  assert.deepEqual(child.facts, {source: 'host-sim / claude-code', sessionId: 'session-sim-1', activity: 'idle', read: 'unread', parent: 'parent-1', children: '2 active / 1 uncertain'});
});

void test('the search matches the label, title, project or session ID, ignoring case, within one provider', () => {
  const labelled = record({label: {value: 'Port the Wall', origin: 'user'}, project: 'agent-device-hub'});
  assert.equal(matches(labelled, 'wall', ''), true);
  assert.equal(matches(labelled, 'DEVICE-HUB', ''), true);
  assert.equal(matches(labelled, 'sim-1', 'claude'), true);
  assert.equal(matches(labelled, '', 'codex'), false);
  assert.equal(matches(labelled, 'nothing', ''), false);
  assert.deepEqual([age(500), age(42_000), age(180_000)], ['less than 1s', '42s', '3m']);
});
