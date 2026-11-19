// The shared synthetic session cases (Hub #1865, design decision 10) through the module's read rules. The module reads
// each session through `readSession` and settles on the view's work state. For every case's expected copy, the evidence
// it gives equals what the settle rule, written out here over each `session/3.0` record's work and outcome claims,
// gives, with the Desktop session listed or not, and read at the check's instant or once the flag has had time to appear.
import assert from 'node:assert/strict';
import type {Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {readSession} from '@jimmie-potts/event-contracts/v2/session';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {READ_SETTLE_MS, readEvidence, type DesktopSource} from '../src/index.js';
import {it} from './support.js';

/** The settle rule over `session/3.0` records: a reference the module's code over views must agree with. */
function recordEvidence(records: readonly Session30Record[], unread: ReadonlySet<string>, source: DesktopSource, nowMs: number): string[] {
  return records.flatMap(record => {
    const {identity} = record, {read} = record.outcome;
    if (identity.provider !== 'codex' || identity.client !== 'desktop' || identity.hostId !== source.hostId || identity.sourceId !== source.sourceId ||
      record.parent.status === 'known') return [];
    const settled = read === 'unknown' && record.work.state !== 'active' && nowMs - record.lastEvidenceAtMs >= READ_SETTLE_MS;
    const state = unread.has(identity.sessionId) ? 'unread' : read === 'unread' || settled ? 'read' : undefined;
    return state !== undefined && state !== read ? [`${identity.sessionId} ${state}`] : [];
  });
}

it('every shared case gives the read evidence the settle rule gives over its records', () => {
  const cases = loadSessionCases();
  const desktop = cases.sessions.desktop?.identity;
  assert.ok(desktop);
  const source: DesktopSource = {hostId: desktop.hostId, sourceId: desktop.sourceId};
  const given = new Set<string>();
  for (const sessionCase of cases.cases) for (const check of sessionCase.checks) {
    const views = check.messages.flatMap(message => readSession(message) ?? []);
    assert.equal(views.length, check.messages.length, `${sessionCase.id}: readSession reads every expected record`);
    const records = check.messages.map(message => message.data);
    for (const nowMs of [cases.startAtMs + check.atMs, cases.startAtMs + check.atMs + READ_SETTLE_MS]) {
      for (const unread of [new Set<string>(), new Set([desktop.sessionId])]) {
        const evidence = readEvidence(views, unread, source, nowMs).map(item => `${item.session.identity.sessionId} ${item.state}`);
        assert.deepEqual(evidence, recordEvidence(records, unread, source, nowMs), `${sessionCase.id} after ${check.after} at ${nowMs}`);
        for (const item of evidence) given.add(`${sessionCase.id} ${item}`);
      }
    }
  }
  // The cases reach both states: a listed session is unread, and an unlisted one settles to read.
  assert.ok([...given].some(item => item.endsWith(' unread')) && [...given].some(item => item.endsWith(' read')), [...given].join(', '));
});

it('the settle rule waits on the view\'s active work, whatever the record\'s age', () => {
  const cases = loadSessionCases();
  const desktop = cases.sessions.desktop?.identity;
  assert.ok(desktop);
  const message = cases.cases.flatMap(sessionCase => sessionCase.checks.flatMap(check => check.messages))
    .find(item => item.data.identity.client === 'desktop' && item.data.outcome.read === 'unknown');
  assert.ok(message);
  const view = readSession(message);
  assert.ok(view);
  const source: DesktopSource = {hostId: desktop.hostId, sourceId: desktop.sourceId};
  const later = view.lastEvidenceAtMs + READ_SETTLE_MS;
  assert.deepEqual(readEvidence([view], new Set(), source, later - 1).map(item => item.state), [], 'the flag has not had time to appear');
  assert.deepEqual(readEvidence([view], new Set(), source, later).map(item => item.state), ['read']);
  const working = {...view, work: {...view.work, state: 'active' as const}};
  assert.deepEqual(readEvidence([working], new Set(), source, later + 600_000), [], 'a known running turn waits');
  assert.deepEqual(readEvidence([working], new Set([desktop.sessionId]), source, later).map(item => item.state), ['unread']);
});
