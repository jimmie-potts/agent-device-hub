import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CompanionOpportunity, CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {buildSession, type SessionFacts, type SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {attentionPriority, presentedPriority, speechRefusal} from '../src/presentation-policy.js';
import {admissionKey, defaultSettings, localDay, refusal, selectCard, type Policy} from '../src/rules.js';
const nowMs = Date.parse('2026-10-11T12:00:00Z');
const event: CompanionOpportunity = {origin: {id: 'fixture-1', source: 'bunny/modules/companions', type: 'org.bunny.companion-fixture.run.requested'},
  sourceKind: 'simulated-apartment', context: 'scenario', category: 'simulated-social', cue: 'arrival', revision: 1, generation: 1,
  session: null, identity: null, turn: {status: 'unknown'}, attention: null, noticeId: null, evidence: 'fixture', occurredAtMs: nowMs, observedAtMs: nowMs,
  validUntilMs: nowMs + 30_000, busy: false, media: false, visitor: null, location: null};
const policy = (): Policy => ({nowMs, settings: {...defaultSettings(), enabled: true, timeZone: 'America/New_York'}, mode: 'free', synced: true,
  sessions: [], priority: [], scenarioAttention: false, allowance: {day: '', count: 0, lastAtMs: null}, admissions: [], available: true});
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

// The 30-second question window (Hub #1865, decision 2), on a mock clock. The question's opportunity carries the
// reporting host's instant and the core's 30-second validity; the window lives in the policy's `priority`.
const identity = {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'synthetic-source', sessionId: 'synthetic-session'} as const;
const question = {id: {status: 'known', id: 'question-1'}, kind: 'question', turn: {status: 'known', id: 'turn-1'}} as const;
/** A session/3.0 record, which is the session's view. */
const record = (patch: Partial<SessionFacts> = {}): SessionView => buildSession({id: 'synthetic-entity', revision: 3, generation: 2, identity, parent: {status: 'unknown'},
  turn: {status: 'known', id: 'turn-1'}, work: 'active', attention: [question], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'},
  observedAtMs: nowMs, lastEvidenceAtMs: nowMs, children: {working: 0, unconfirmed: 0}, ...patch});
const asked: CompanionOpportunity = {origin: {id: 'raised-1', source: 'bunny/core', type: 'org.bunny.attention.raised'}, sourceKind: 'coding', context: 'live',
  category: 'coding-attention', cue: 'question', revision: 3, generation: 2, session: 'synthetic-entity', identity, turn: {status: 'known', id: 'turn-1'},
  attention: question, noticeId: null, evidence: 'lifecycle-metadata', occurredAtMs: null, observedAtMs: nowMs, validUntilMs: nowMs + 30_000,
  busy: null, media: null, visitor: null, location: null};
const notice = (id: string): CompanionOpportunity => ({...asked, origin: {...asked.origin, id}, session: 'other-entity', identity: {...identity, sessionId: 'other-session'},
  category: 'coding-notice', cue: 'turn-ended', attention: null, noticeId: 'notice-1', revision: 1, generation: 1});
const other = (patch: Partial<SessionFacts> = {}): SessionView => record({id: 'other-entity', revision: 1, generation: 1, identity: {...identity, sessionId: 'other-session'},
  work: 'idle', attention: [], notices: [{id: 'notice-1', kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy: []}], ...patch});
const windowed = (at: number, sessions = [record(), other()]): Policy => ({...policy(), nowMs: at, mode: 'work', sessions, priority: [asked]});

void test('a question holds priority over background cards and speech at 29 s and not at 30 s, from its own instant', () => {
  const card = (at: number): CompanionOpportunity => ({...notice(`notice-at-${String(at)}`), observedAtMs: at, validUntilMs: at + 30_000});
  assert.equal(refusal(card(nowMs + 29_000), windowed(nowMs + 29_000)), 'attention-priority');
  assert.equal(refusal(card(nowMs + 30_000), windowed(nowMs + 30_000)), undefined);
  assert.equal(attentionPriority([asked], [record(), other()], nowMs + 29_999), true);
  assert.equal(attentionPriority([asked], [record(), other()], nowMs + 30_000), false);
  const spoken = (at: number) => speechRefusal(selectCard(card(at), at, 'seed'), windowed(at));
  assert.equal(spoken(nowMs + 29_000), 'attention-priority', 'the speech check holds automatic speech inside the window');
  assert.equal(spoken(nowMs + 30_000), undefined);
  assert.equal(refusal(asked, windowed(nowMs + 29_000)), undefined, 'the question itself is never held by its own window');
});

void test('progress renews nothing, an answered question ends the window, and work uncertainty or silence never refuses a card', () => {
  const later = (at: number): CompanionOpportunity => ({...notice(`late-${String(at)}`), observedAtMs: at, validUntilMs: at + 30_000});
  const progressed = [record({revision: 9, lastEvidenceAtMs: nowMs + 20_000, observedAtMs: nowMs + 20_000}), other()];
  assert.equal(refusal(later(nowMs + 29_000), windowed(nowMs + 29_000, progressed)), 'attention-priority');
  assert.equal(refusal(later(nowMs + 30_000), windowed(nowMs + 30_000, progressed)), undefined, 'progress 20 s in does not extend the window');
  assert.equal(refusal(later(nowMs + 10_000), windowed(nowMs + 10_000, [record({attention: []}), other()])), undefined, 'a cleared question ends the window early');
  assert.equal(refusal(later(nowMs + 10_000), {...windowed(nowMs + 10_000), priority: []}), undefined, 'no admitted opportunity, as after a restart, opens no window');
  // Six minutes of silence: the running work a restart left unconfirmed; the finished session is unchanged by silence.
  const quiet = [record({unconfirmed: 'restart', lastEvidenceAtMs: nowMs - 360_000}), other({lastEvidenceAtMs: nowMs - 360_000})];
  assert.equal(refusal(later(nowMs + 10_000), {...windowed(nowMs + 10_000), sessions: quiet, priority: []}), undefined,
    'a notice from a session silent for six minutes is admitted');
  assert.equal(refusal(asked, {...windowed(nowMs + 10_000), sessions: quiet}), undefined, 'a question from unconfirmed work is admitted');
});

void test('the browser takes the window from the live question card Reachy presents', () => {
  const state = (opportunity: CompanionOpportunity): CompanionState => ({id: 'reachy', revision: 1, settings: policy().settings, decision: 'presented',
    availability: 'available', presentation: {...selectCard(opportunity, nowMs, 'seed'), history: true}});
  assert.deepEqual(presentedPriority(state(asked)), [asked]);
  assert.deepEqual(presentedPriority(state(notice('shown'))), []);
  assert.deepEqual(presentedPriority(state({...asked, context: 'scenario'})), []);
  assert.deepEqual(presentedPriority(undefined), []);
});
