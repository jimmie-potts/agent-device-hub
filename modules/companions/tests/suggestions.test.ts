import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {inspectEvidence, observationTime, propose, replacementRefusal, type TaskEvidence, type SuggestionContext} from '../src/frontend/suggestion-model.js';
const now = Date.parse('2026-10-24T12:00:00Z');
const session: SessionRecord = {id: 'synthetic-session', revision: 2, generation: 1,
  identity: {provider: 'codex', client: 'cli', hostId: 'synthetic-host', sourceId: 'synthetic-source', sessionId: 'synthetic-native-session'},
  parent: {status: 'unknown'}, turn: {status: 'known', id: 'turn-1'}, activity: 'idle', attention: [], notices: [], read: 'unknown',
  unavailable: [], ordering: {status: 'unknown'}, observedAtMs: now, lastEvidenceAtMs: now, freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}};
const evidence = (): TaskEvidence => ({task: 'synthetic-task', repository: 'synthetic-repo', base: '', head: 'a'.repeat(40), evidenceHead: 'a'.repeat(40),
  observedAtMs: now, session: structuredClone(session), checks: {tests: {status: 'passed', reference: 'test-receipt-1'}, build: {status: 'passed', reference: 'build-receipt-1'},
    browser: {status: 'unrun', reference: 'browser-plan-1'}, accessibility: {status: 'unknown', reference: ''}}});
const context = (): SuggestionContext => ({nowMs: now, connected: true, available: true,
  settings: {enabled: true, muted: [], snoozedUntilMs: 0, timeZone: 'UTC'}, mode: 'work', sessions: [structuredClone(session)]});
void test('passed tests and an explicitly unrun browser check produce an attributed browser prompt', () => {
  const result = propose(evidence(), context());
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.target, 'browser');
  assert.match(result.text, /Owner-supplied/);
  for (const fact of ['synthetic-task', 'synthetic-native-session', 'synthetic-host', 'synthetic-source', 'turn-1', 'tests: passed', 'browser: unrun', 'test-receipt-1', 'browser-plan-1', 'a'.repeat(40)]) assert.ok(result.text.includes(fact), fact);
  assert.doesNotMatch(result.text, /approved|task completed|all checks passed/);
  assert.equal(result.validUntilMs, now + 300_000);
});
void test('fixed corpus rejects missing identity, unsupported claims and every distinct evidence status honestly', () => {
  const cases: [string, (input: TaskEvidence) => void, string][] = [
    ['missing task', input => {input.task = '';}, 'task-identity-required'],
    ['unknown head', input => {input.head = '';}, 'matching-head-required'],
    ['stale revision', input => {input.evidenceHead = 'b'.repeat(40);}, 'matching-head-required'],
    ['unsupported status', input => {Object.assign(input.checks.tests, {status: 'success'});}, 'unsupported-check-claim'],
    ['unsupported check', input => {Object.assign(input.checks, {deployment: {status: 'passed', reference: 'claim'}});}, 'unsupported-check-claim'],
    ['unsupported claim', input => {input.checks.tests.reference = '';}, 'unsupported-check-claim'],
    ['unknown tests', input => {input.checks.tests.status = 'unknown';}, 'no-supported-next-check'],
    ['unrun tests', input => {input.checks.tests.status = 'unrun';}, 'no-supported-next-check'],
    ['skipped tests', input => {input.checks.tests.status = 'skipped';}, 'no-supported-next-check'],
    ['turn metadata alone', input => {for (const check of Object.values(input.checks)) {check.status = 'unknown'; check.reference = '';}}, 'no-supported-next-check'],
    ['stale observation', input => {input.observedAtMs = now - 300_000;}, 'expired-evidence'],
    ['future observation', input => {input.observedAtMs = now + 1;}, 'expired-evidence'],
  ];
  for (const [name, change, reason] of cases) {
    const input = evidence(); change(input); assert.deepEqual(propose(input, context()), {kind: 'gap', reason}, name);
  }
  const failed = evidence(); failed.checks.tests.status = 'failed';
  const result = propose(failed, context()); assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') {assert.equal(result.target, 'tests'); assert.match(result.text, /investigate the failed tests/); assert.match(result.text, /tests: failed/);}
  const skipped = evidence(); skipped.checks.browser = {status: 'skipped', reference: 'browser-skipped'}; skipped.checks.accessibility.status = 'unrun';
  const next = propose(skipped, context()); assert.equal(next.kind, 'proposal');
  if (next.kind === 'proposal') {assert.equal(next.target, 'accessibility'); assert.match(next.text, /browser: skipped/); assert.match(next.text, /accessibility: unrun/);}
});
void test('current policy and exact source snapshot fence copy at its final check', () => {
  const patches: [string, (ctx: SuggestionContext) => void, string][] = [
    ['disabled', ctx => {ctx.settings.enabled = false;}, 'disabled'],
    ['muted', ctx => {ctx.settings.muted = ['coding-notice'];}, 'category-muted'],
    ['offline output', ctx => {ctx.available = false;}, 'presentation-unavailable'],
    ['disconnected', ctx => {ctx.connected = false;}, 'core-unavailable'],
    ['unknown mode', ctx => {ctx.mode = undefined;}, 'core-unavailable'],
    ['other session', ctx => {ctx.sessions = [{...session, id: 'other'}];}, 'stale-session'],
    ['new source revision', ctx => {ctx.sessions = [{...session, revision: 3}];}, 'session-changed'],
    ['new generation', ctx => {ctx.sessions = [{...session, generation: 2}];}, 'session-changed'],
    ['other identity', ctx => {ctx.sessions = [{...session, identity: {...session.identity, sessionId: 'other'}}];}, 'session-changed'],
    ['next turn', ctx => {ctx.sessions = [{...session, turn: {status: 'known', id: 'turn-2'}}];}, 'session-changed'],
    ['uncertain source', ctx => {ctx.sessions = [{...session, freshness: 'uncertain'}];}, 'stale-session'],
    ['restart uncertainty', ctx => {ctx.sessions = [{...session, restartUncertain: true}];}, 'stale-session'],
    ['stale source', ctx => {ctx.sessions = [{...session, lastEvidenceAtMs: now - 300_000}];}, 'stale-session'],
    ['attention elsewhere', ctx => {ctx.sessions = [session, {...session, id: 'other', attention: [{id: {status: 'unknown'}, kind: 'approval', turn: {status: 'unknown'}}]}];}, 'attention-priority'],
  ];
  for (const [name, change, reason] of patches) {const ctx = context(); change(ctx); assert.deepEqual(propose(evidence(), ctx), {kind: 'gap', reason}, name);}
  for (const mode of ['work', 'free', 'quiet'] as const) assert.equal(propose(evidence(), {...context(), mode}).kind, 'proposal');
  assert.deepEqual(propose(evidence(), {...context(), nowMs: now + 300_000}), {kind: 'gap', reason: 'expired-evidence'});
});

void test('supersession is deterministic, scoped and never fills unknown context', () => {
  const input = evidence(), prior = evidence();
  assert.equal(replacementRefusal(input, prior), undefined);
  assert.deepEqual(propose(input, context()), propose(prior, context()));
  assert.equal(replacementRefusal({...input, observedAtMs: now - 1}, prior), 'older-evidence');
  assert.equal(replacementRefusal({...input, head: 'b'.repeat(40)}, prior), 'ambiguous-replacement');
  assert.equal(replacementRefusal({...input, observedAtMs: now + 1}, prior), undefined);
  assert.equal(replacementRefusal({...input, task: 'other-task'}, prior), undefined);
  assert.equal(replacementRefusal({...input, session: {...session, id: 'other-session'}}, prior), undefined);
  const unknown = {...input, repository: '', session: {...session, turn: {status: 'unknown'} as const}};
  const result = propose(unknown, {...context(), sessions: [unknown.session]});
  assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') {assert.match(result.text, /turn: unknown/); assert.match(result.text, /Repository: unknown; base: unknown/);}
  for (const checks of [{...input.checks, build: {status: 'unrun' as const, reference: ''}}, {...input.checks, browser: {status: 'passed' as const, reference: 'browser-1'}}]) {
    const candidate = propose({...input, checks}, context());
    assert.equal(candidate.kind, checks.build.status === 'unrun' ? 'proposal' : 'gap');
    if (candidate.kind === 'proposal') assert.equal(candidate.target, 'build');
  }
});

void test('the form requires an actual unambiguous UTC observation instant', () => {
  assert.equal(observationTime('2026-10-24T12:00:00.000Z'), now);
  for (const value of ['', '2026-10-24T12:00:00', '2026-02-30T12:00:00.000Z', '2026-10-24', 'unknown']) assert.ok(Number.isNaN(observationTime(value)), value);
});

void test('a newer evidence gap supersedes a useful proposal and cannot restore its older claims', () => {
  const old = evidence();
  const initial = inspectEvidence(old, context(), undefined);
  assert.equal(initial.decision.kind, 'proposal');
  const next = {...evidence(), observedAtMs: now + 1}; next.checks.tests.status = 'unknown';
  const updated = inspectEvidence(next, {...context(), nowMs: now + 1}, initial.latest);
  assert.deepEqual(updated.decision, {kind: 'gap', reason: 'no-supported-next-check'});
  assert.deepEqual(inspectEvidence(old, {...context(), nowMs: now + 1}, updated.latest).decision, {kind: 'gap', reason: 'older-evidence'});
});
