// What the dashboard shows of each agent session (Hub #922), from the shared session view alone (Hub #1865): the name's
// precedence, the chip's state, a finished turn unread until a consumer's acknowledgment, a known later turn or positive
// read evidence on the record clears it (owner decision, 2026-10-08), the attention lines and facts the old dashboard
// showed, and uncertainty only for an unknown status or unconfirmed work. The shared case set runs through the rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sessionView, type SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {
  CHIP_TEXT, agentSummary, needsAttention, age, chipOf, clientName, faceText, finishedUnread, matches, sessionName, sessionRow, uncertainOf,
} from '../src/sessions.ts';

const NOTICE = 'a'.repeat(64);
/** A synthetic, current, idle Claude Code session record. */
function record(change: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'b'.repeat(64), revision: 4, generation: 1,
    identity: {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'},
    parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'}, activity: 'idle', attention: [], notices: [], read: 'unknown',
    unavailable: [], ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000, freshness: 'current', restartUncertain: false,
    children: {active: 0, uncertain: 0}, ...change,
  };
}
/** The same session as every dashboard reader sees it. */
const view = (change: Partial<SessionRecord> = {}): SessionView => sessionView(record(change));
const finished = (acknowledgedBy: string[] = []): SessionRecord['notices'] => [{id: NOTICE, kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy}];
const question = {id: {status: 'known', id: 'question-1'}, kind: 'question', turn: {status: 'known', id: 'turn-1'}} as const;
const approval = {id: {status: 'known', id: 'approval-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}} as const;

void test('a session is named by its label, then its title, then its native ID, and placed by project and client', () => {
  assert.equal(sessionName(view({label: {value: 'Port the wall', origin: 'user'}, title: {value: 'A title', source: 'provider'}})), 'Port the wall');
  assert.equal(sessionName(view({title: {value: 'A title', source: 'provider'}})), 'A title');
  assert.equal(sessionName(view()), 'session-sim-1', 'the neutral fallback');
  assert.deepEqual(sessionRow(view({label: {value: 'Explicit', origin: 'user'}, title: {value: 'Provider title', source: 'provider'}})).label, {value: 'Explicit', origin: 'user'});
  assert.equal(sessionRow(view({title: {value: 'Provider title', source: 'provider'}})).label, undefined, 'editing the label never prefills a title');
  assert.equal(sessionRow(view({project: 'agent-device-hub'})).where, 'agent-device-hub · Claude Code');
  assert.equal(sessionRow(view()).where, 'Claude Code');
  assert.deepEqual([clientName({...record().identity, provider: 'codex', client: 'cli'}), clientName({...record().identity, provider: 'codex', client: 'desktop'})],
    ['Codex CLI', 'Codex Desktop']);
  assert.equal(clientName({...record().identity,provider:'codex',client:'local'}),'Codex (local)');
  assert.equal(clientName({...record().identity, provider: 'codex', client: 'local', hostId: 'mac-mini', sourceId: 'codex-local-hooks'}), 'Mac Codex');
  assert.equal(clientName({...record().identity, provider: 'codex', client: 'local', hostId: 'another-host', sourceId: 'codex-local-hooks'}), 'Codex (local)');
});

void test('the chip follows the hub status: attention over work over a finished turn, and names the attention', () => {
  assert.equal(chipOf(view({activity: 'active', attention: [question, approval], notices: finished()})), 'approval', 'an approval outranks a question');
  assert.equal(chipOf(view({activity: 'active', attention: [question]})), 'question');
  assert.equal(chipOf(view({activity: 'active', notices: finished()})), 'working');
  assert.equal(chipOf(view({activity: 'idle', children: {active: 1, uncertain: 0}})), 'working', 'a working child keeps its root working');
  assert.equal(chipOf(view({notices: finished()})), 'finished');
  assert.deepEqual([chipOf(view()), chipOf(view({activity: 'interrupted'})), chipOf(view({activity: 'unknown'}))], ['idle', 'interrupted', 'unknown']);
  const row = sessionRow(view({activity: 'active', attention: [question, approval]}));
  assert.deepEqual(row.attention, ['Question · continuing', 'Approval · blocked attention']);
  assert.equal(row.chipText, 'Waiting for approval');
  assert.equal(CHIP_TEXT.finished, 'Finished · unread');
});

void test('a detail this version does not know falls back to its class', () => {
  const waiting = view({attention: [question]});
  assert.equal(chipOf({...waiting, status: {class: 'needs-owner', detail: 'review'}}), 'needs-owner');
  assert.equal(CHIP_TEXT['needs-owner'], 'Needs you');
  assert.equal(chipOf({...view({activity: 'active'}), status: {class: 'working', detail: 'remote'}}), 'working');
  assert.equal(chipOf({...view({notices: finished()}), status: {class: 'finished', detail: 'failed-remotely'}}), 'finished');
  assert.equal(chipOf({...view({activity: 'interrupted'}), status: {class: 'quiet', detail: 'paused'}}), 'interrupted');
});

void test('a finished turn stays unread until the record holds evidence that clears it, never inferred from missing evidence', () => {
  const unread = sessionRow(view({notices: finished()}));
  assert.equal(unread.chip, 'finished');
  assert.deepEqual(unread.notices, [{id: NOTICE, turn: 'turn-1', acknowledgedBy: []}]);
  assert.equal(finishedUnread(view({notices: finished(), read: 'unread'})), true, 'unread evidence keeps it');
  assert.equal(finishedUnread(view({notices: finished(), read: 'unknown'})), true, 'no read evidence is not read');
  // Any consumer's acknowledgment on the record clears it, as on LIFX and Tidbyt, #1009's operator clear among them.
  for (const consumer of ['pixoo', 'nanoleaf', 'dashboard', 'operator']) {
    assert.deepEqual([sessionRow(view({notices: finished([consumer])})).chip, finishedUnread(view({notices: finished([consumer])}))], ['idle', false], consumer);
  }
});

void test('positive read evidence on the record clears a finished turn', () => {
  const desktop = {...record().identity, provider: 'codex', client: 'desktop'} as const;
  assert.equal(sessionRow(view({identity: desktop, notices: finished(), read: 'unread'})).chip, 'finished');
  assert.equal(sessionRow(view({identity: desktop, notices: finished(), read: 'read'})).chip, 'idle', 'Codex Desktop\'s read marker clears it');
});

void test('the session\'s known next turn clears the earlier finished turn, while an unknown turn proves nothing', () => {
  assert.equal(chipOf(view({turn: {status: 'known', id: 'turn-2'}, notices: finished()})), 'idle', 'turn-2 started after turn-1 ended');
  assert.equal(chipOf(view({turn: {status: 'unknown'}, notices: finished()})), 'finished', 'an unknown current turn is no evidence of a next one');
  const unknownNotice: SessionRecord['notices'] = [{id: NOTICE, kind: 'turn-ended', turn: {status: 'unknown'}, acknowledgedBy: []}];
  assert.equal(chipOf(view({turn: {status: 'known', id: 'turn-2'}, notices: unknownNotice})), 'finished', 'a notice on an unknown turn stays');
});

void test('only an unknown status or unconfirmed working is uncertain: silence never marks a waiting or finished session', () => {
  assert.equal(sessionRow(view()).uncertain, false);
  // Silence: the 2.x record's freshness is uncertain after five minutes and after a restart.
  for (const silent of [{freshness: 'uncertain'}, {freshness: 'uncertain', restartUncertain: true}] as const) {
    assert.equal(sessionRow(view({...silent, activity: 'active'})).uncertain, true, 'unconfirmed work');
    assert.equal(sessionRow(view({...silent, activity: 'active', attention: [question]})).uncertain, false, 'a question waits however long it is silent');
    assert.equal(sessionRow(view({...silent, notices: finished()})).uncertain, false, 'a finished turn stays finished');
    assert.equal(sessionRow(view({...silent})).uncertain, false, 'an idle session stays idle');
  }
  assert.equal(uncertainOf(view({activity: 'active', unavailable: [{dimension: 'activity', reason: 'lost'}]})), 'Its work is unconfirmed.', 'lost evidence on running work');
  assert.equal(uncertainOf(view({activity: 'unknown'})), 'The hub does not know what this session is doing.');
  const working = sessionRow(view({activity: 'active', freshness: 'uncertain'}));
  assert.deepEqual([faceText(working, true), faceText(working, false), faceText(sessionRow(view()), false)], ['Unconfirmed', 'Stale', 'Stale'],
    'unconfirmed work is named, and a copy that is not synced shows its last records as stale');
  assert.equal(working.facts.work, 'active, unconfirmed (deadline)');
  const child = sessionRow(view({parent: {status: 'known', identity: {...record().identity, sessionId: 'parent-1'}}, children: {active: 2, uncertain: 1}, read: 'unread'}));
  assert.deepEqual(child.facts, {source: 'host-sim / claude-code', sessionId: 'session-sim-1', work: 'idle', read: 'unread', parent: 'parent-1', children: '2 working / 1 unconfirmed'});
});

void test('the search matches the label, title, project or session ID, ignoring case, within one provider', () => {
  const labelled = view({label: {value: 'Port the Wall', origin: 'user'}, project: 'agent-device-hub'});
  assert.equal(matches(labelled, 'wall', ''), true);
  assert.equal(matches(labelled, 'DEVICE-HUB', ''), true);
  assert.equal(matches(labelled, 'sim-1', 'claude'), true);
  assert.equal(matches(labelled, '', 'codex'), false);
  assert.equal(matches(labelled, 'nothing', ''), false);
  assert.deepEqual([age(500), age(42_000), age(180_000)], ['less than 1s', '42s', '3m']);
});

void test('agent summaries count confirmed work separately from retained attention and unread', () => {
  const working = sessionRow(view({activity: 'active'}));
  const unconfirmed = sessionRow(view({activity: 'active', freshness: 'uncertain'}));
  const unread = sessionRow(view({notices: finished()}));
  const attention = sessionRow(view({attention: [question]}));
  assert.deepEqual(agentSummary([working, unconfirmed, unread, attention], true), {working: 1, attention: 1, unread: 1});
  assert.deepEqual(agentSummary([working, unconfirmed, unread, attention], false), {working: 0, attention: 1, unread: 1});
  assert.equal(needsAttention(attention), true);
  assert.equal(needsAttention(unread), false);
  assert.equal(needsAttention(unconfirmed), false);
});

void test('unread summary evidence survives higher-priority attention and work', () => {
  const notices = finished();
  const working = sessionRow(view({activity: 'active', notices}));
  const attention = sessionRow(view({notices, attention: [approval]}));
  assert.deepEqual(agentSummary([working, attention], true), {working: 1, attention: 1, unread: 2});
  assert.equal(working.chip, 'working');
  assert.equal(attention.chip, 'approval');
});

void test('every case in the shared case set shows the dashboard chip it expects, and marks only unknown or unconfirmed working', () => {
  let checks = 0;
  for (const item of loadSessionCases().cases) {
    for (const [index, check] of item.checks.entries()) {
      const where = `${item.id} check ${String(index)}`;
      const views = Object.entries(check.views);
      assert.deepEqual(Object.fromEntries(views.map(([name, shown]) => [name, chipOf(shown)])), check.readers.dashboard, where);
      for (const [name, shown] of views) {
        const row = sessionRow(shown), status = check.readers.status[name] ?? '';
        const expected = status.startsWith('unknown/') || status === 'working/unconfirmed';
        assert.equal(row.uncertain, expected, `${where}: ${name} is ${status}`);
        assert.equal(faceText(row, check.synced) === 'Stale', !check.synced, `${where}: ${name} on a copy that is ${check.synced ? '' : 'not '}synced`);
      }
      checks++;
    }
  }
  assert.ok(checks > 25, 'the case set ran');
});
