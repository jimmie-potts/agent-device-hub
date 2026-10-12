import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {admissionKey, defaultSettings, localDay, refusal, selectCard, type Policy} from '../src/rules.js';
const nowMs = Date.parse('2026-10-11T12:00:00Z');
const event: CompanionOpportunity = {origin: {id: 'fixture-1', source: 'bunny/modules/companions', type: 'org.bunny.companion-fixture.run.requested'},
  sourceKind: 'simulated-apartment', context: 'scenario', category: 'simulated-social', cue: 'arrival', revision: 1, generation: 1,
  session: null, identity: null, turn: {status: 'unknown'}, attention: null, noticeId: null, evidence: 'fixture', occurredAtMs: nowMs, observedAtMs: nowMs,
  validUntilMs: nowMs + 30_000, busy: false, media: false, visitor: null, location: null};
const policy = (): Policy => ({nowMs, settings: {...defaultSettings(), enabled: true, timeZone: 'America/New_York'}, mode: 'free', synced: true,
  sessions: [], scenarioAttention: false, allowance: {day: '', count: 0, lastAtMs: null}, admissions: [], available: true});
void test('social policy checks known facts, mode, snooze and independent spacing/daily allowance', () => {
  assert.equal(refusal(event, policy()), undefined);
  assert.equal(refusal({...event, occurredAtMs: null}, policy()), undefined);
  for (const [patch, reason] of [[{mode: 'quiet'}, 'restrictive-mode'], [{mode: 'work'}, 'restrictive-mode'],
    [{mode: undefined}, 'core-unavailable'], [{synced: false}, 'core-unavailable'], [{available: false}, 'presentation-unavailable'],
    [{scenarioAttention: true}, 'attention-priority'], [{nowMs: event.validUntilMs}, 'expired']] as const) {
    assert.equal(refusal(event, {...policy(), ...patch}), reason);
  }
  assert.equal(refusal({...event, busy: null}, policy()), 'unknown-context');
  assert.equal(refusal({...event, media: null}, policy()), 'unknown-context');
  assert.equal(refusal({...event, busy: true}, policy()), 'busy');
  assert.equal(refusal({...event, media: true}, policy()), 'media');
  assert.equal(refusal(event, {...policy(), settings: {...policy().settings, snoozedUntilMs: nowMs + 1}}), 'snoozed');
  assert.equal(refusal(event, {...policy(), allowance: {day: localDay(nowMs, policy().settings.timeZone), count: 3, lastAtMs: nowMs - 20_000_000}}), 'social-budget');
  assert.equal(refusal(event, {...policy(), allowance: {day: 'yesterday', count: 3, lastAtMs: nowMs - 10_799_999}}), 'social-spacing');
  assert.equal(refusal(event, {...policy(), allowance: {day: 'yesterday', count: 3, lastAtMs: nowMs - 10_800_000}}), undefined);
});
void test('coding attention has its separate allowance, survives Work/Quiet, and fixed variation is repeatable', () => {
  const coding: CompanionOpportunity = {...event, sourceKind: 'coding', category: 'coding-attention', cue: 'approval',
    attention: {id: {status: 'unknown'}, turn: {status: 'unknown'}, kind: 'approval'}};
  for (const mode of ['work', 'quiet', 'free'] as const) assert.equal(refusal(coding, {...policy(), mode,
    allowance: {day: localDay(nowMs, policy().settings.timeZone), count: 3, lastAtMs: nowMs}, scenarioAttention: true}), undefined);
  assert.deepEqual(selectCard(coding, nowMs, 'seed'), selectCard(coding, nowMs, 'seed'));
  assert.match(selectCard(coding, nowMs, 'seed').text, /review|decision/);
  assert.doesNotMatch(selectCard(coding, nowMs, 'seed').text, /recommend|approved|go ahead/);
  assert.notEqual(admissionKey(event), admissionKey({...event, origin: {...event.origin, id: 'new-explicit-scenario'}}));
  assert.equal(refusal(event, {...policy(), admissions: [{key: admissionKey(event), atMs: nowMs}]}), 'repetition');
  assert.equal(refusal(event, {...policy(), settings: {...policy().settings, enabled: false}}), 'disabled');
  assert.equal(refusal(event, {...policy(), settings: {...policy().settings, muted: ['simulated-social']}}), 'category-muted');
});
