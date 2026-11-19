// Automations and the art alert over the shared session case set (Hub #1865, design decision 10): the attention they
// read is the hub's `needs-owner` status, and each case's occurrence sequence triggers the rule of each occurrence's
// kind, once, and no other. Synthetic sessions only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {sessionEntityId, type AgentOccurrence} from '@jimmie-potts/event-contracts/v2/families';
import {loadSessionCases, type CompactOccurrence} from '@jimmie-potts/event-contracts/v2/session-cases';
import {createAutomation, DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {automationEvent, ownerNeeded} from '../src/core/automation-part.js';

const cases = loadSessionCases();
const KINDS = ['attention-raised', 'attention-cleared', 'turn-ended', 'session-ended'] as const;
const NOW = 1_700_000_000_000;

void test('the alert and the art gates read attention as the hub\'s needs-owner status on every case', () => {
  let judged = 0, raised = 0;
  for (const item of cases.cases) {
    for (const [index, check] of item.checks.entries()) {
      const expected = Object.values(check.readers.status).some(status => status.startsWith('needs-owner/'));
      assert.equal(ownerNeeded(Object.values(check.views)), expected, `${item.id} check ${String(index)}`);
      judged++;
      if (expected) raised++;
    }
  }
  assert.ok(judged > 25 && raised > 0, 'the case set ran, with sessions that need the owner');
  assert.equal(ownerNeeded([]), false);
});

/** The occurrence the core publishes for one compact occurrence: its session, identity and turn. */
function occurrence(item: string, index: number, value: CompactOccurrence): {id: string; data: AgentOccurrence} {
  const named = cases.sessions[value.session];
  assert.ok(named, `${item}: the case names ${value.session}`);
  const turn = value.kind === 'attention-raised' || value.kind === 'attention-cleared' ? value.attention.turn : value.kind === 'turn-ended' ? value.notice : null;
  return {id: `${item}-${String(index)}`, data: {
    session: sessionEntityId(named.identity), identity: named.identity, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn},
    observedAtMs: NOW, ordering: {status: 'unknown'}, revision: index + 1,
  }};
}

void test('each case\'s occurrence sequence triggers the rule of each occurrence\'s kind once, and no other', async () => {
  let delivered = 0;
  for (const item of cases.cases) {
    const sequence = item.checks.flatMap(check => check.occurrences);
    if (sequence.length === 0) continue;
    const store = new AutomationStore(new DatabaseSync(':memory:'), () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
    const automation = createAutomation({store, routed: () => ['lines'], targets: () => Promise.resolve({presentation: 'content', alert: 'none', moments: 'supported'}),
      clock: () => NOW, monotonic: () => NOW, active: () => true,
      sender: (_target, moment) => Promise.resolve({kind: 'receipt', momentId: moment.momentId, requestId: `req-${moment.momentId}`, status: 'accepted'})});
    const rules = new Map<string, string>();
    for (const kind of KINDS) {
      const rule = automation.create({name: kind, kind: 'event', enabled: true, trigger: {source: 'core', kind},
        action: {mood: 'celebrate', priorityClass: 'event', durationMs: 1000, targets: ['lines']}}, true);
      rules.set(rule.id, kind);
    }
    for (const [index, value] of sequence.entries()) automation.submit(automationEvent(value.kind, occurrence(item.id, index, value)));
    await automation.settled();
    const logged = automation.log(500).map(entry => [entry.event.id, entry.event.kind, rules.get(entry.ruleId)]).sort();
    const expected = sequence.map((value, index) => [`${item.id}-${String(index)}`, value.kind, value.kind]).sort();
    assert.deepEqual(logged, expected, item.id);
    delivered += sequence.length;
  }
  assert.ok(delivered > 10, 'the case set holds occurrence sequences');
});
