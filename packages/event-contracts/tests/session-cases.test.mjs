// The shared synthetic session case set (Hub #1865, design decision 10). This suite runs every case's reader
// expectations through the shared read function: the hub's status, each named policy, `highestStatus` as LIFX shows
// it and opportunity matching come from the package; the Tronbyt, Pixoo, Nanoleaf and dashboard outputs come from the
// reader rules design decision 10 states, as a reference each reader's own suite replaces with its code.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as legacy from '@jimmie-potts/agent-status';
import {sessionEntityId} from '../dist/v2/families.js';
import {loadSessionCases, noticeIdOf, policyView, statusText} from '../dist/v2/session-cases.js';
import {forConsumer, highestStatus, opportunityMatches, readSession, sessionState} from '../dist/v2/session.js';

const set = loadSessionCases();
const DESIGN_CASES = ['launch', 'clear-resume', 'compaction', 'approval', 'question-silent', 'working-silent', 'restart', 'stale-start',
  'parent-child', 'child-only', 'duplicates', 'out-of-order', 'ambiguous', 'capacity', 'expiry', 'runtime-end', 'acknowledgment',
  'unknown-detail', 'lost-prompt', 'stop-without-turn', 'unknown-turn-notice', 'superseded-notice', 'activity-lost', 'unsynced', 'reset'];
const every = function* () {
  for (const item of set.cases) for (const [index, check] of item.checks.entries()) yield {item, index, check, where: `${item.id} check ${index}`};
};
const named = check => Object.entries(check.views);
const isRoot = view => view.parent.status !== 'known';
const childrenOf = (check, root) => named(check).filter(([, view]) => view.parent.status === 'known' &&
  sessionEntityId(view.parent.identity) === root.id).map(([, view]) => view);

// Design decision 10: the Tronbyt tile shows each root's shared state, ASK, RUN or DONE, newest evidence first within a
// state, and marks `?` only for an unsynced copy or working status with unconfirmed work (a waiting or finished session
// is never `?` from age).
const DISPLAY = {attention: 'ASK', working: 'RUN', done: 'DONE'};
const RANK = {ASK: 0, RUN: 1, DONE: 2};
const legacyHash = ({provider, client, hostId, sourceId, sessionId}) =>
  createHash('sha256').update(JSON.stringify([provider, client, hostId, sourceId, sessionId])).digest('hex');
function tronbyt(check) {
  const unconfirmed = view => view.status.class === 'working' && view.work.state === 'active' && view.work.confidence === 'unconfirmed';
  return named(check).map(([, view]) => view).filter(isRoot)
    .map(view => ({view, state: DISPLAY[sessionState(view)], hash: legacyHash(view.identity)}))
    .filter(row => row.state !== undefined)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.view.lastEvidenceAtMs - a.view.lastEvidenceAtMs || (a.hash < b.hash ? -1 : 1))
    .map(({view, state}) => [state, !check.synced || unconfirmed(view)]);
}

// Design decision 10, Pixoo marker: the copy is not current, the status is unknown, the status is working with
// unconfirmed work, an unavailable warning applies, or the parent is ambiguous. Age, an unknown parent and an unknown
// turn alone no longer mark a row.
const warns = ({dimension, reason}) => !((dimension === 'ordering' || dimension === 'read') && ['missing', 'unsupported', 'inaccessible'].includes(reason));
const ambiguousParent = view => view.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous');
const pixoo = (check, view) => !check.synced || view.status.class === 'unknown' ||
  (view.status.class === 'working' && view.work.confidence === 'unconfirmed') || view.unavailable.some(warns) || ambiguousParent(view);
// The children marker: the row's unconfirmed child count is above zero, a parent is ambiguous, or the copy is not current.
const pixooChildren = (check, view) => !check.synced || view.relationships.children.unconfirmed > 0 ||
  named(check).some(([, other]) => ambiguousParent(other));

// Design decision 10, Nanoleaf: each task is a root and its subagents, read with Nanoleaf's policy. A member that needs
// the owner with `approval` or `input` blocks; with `question` it asks. Otherwise the task shows its root's status:
// working, unread when finished for Nanoleaf, and otherwise idle. A subagent's work reaches the task only through the
// root's `subagent` detail, which counts confirmed children, as on every other device. A task working on its root's own
// unconfirmed work holds steady.
function nanoleaf(check, root) {
  const members = [root, ...childrenOf(check, root)].map(view => policyView(set, 'nanoleaf', view));
  const [own] = members;
  const needs = detail => members.some(view => view.status.class === 'needs-owner' && detail.includes(view.status.detail));
  const task = needs(['approval', 'input']) ? 'blocked' : needs(['question']) ? 'question' : own?.status.class === 'working' ? 'working'
    : own?.status.class === 'finished' ? 'unread' : 'idle';
  return {task, steady: task === 'working' && own?.work.state === 'active' && own.work.confidence === 'unconfirmed'};
}

// The dashboard chip from its own policy: the attention kind, working, finished, or otherwise the work state.
function dashboard(view) {
  const shown = policyView(set, 'dashboard', view);
  switch (shown.status.class) {
    case 'needs-owner': return shown.status.detail;
    case 'working': return 'working';
    case 'finished': return 'finished';
    case 'quiet':
    case 'unknown':
      return shown.work.state;
  }
}

/** A live coding opportunity the core raised from a session's view, for its attention item or its latest notice. */
function opportunity(view, kind) {
  const attention = kind === 'attention' ? view.attention.items[0] : undefined;
  const notice = kind === 'notice' ? view.outcome.notices.at(-1) : undefined;
  assert.ok(attention !== undefined || notice !== undefined, 'the opportunity names an item or a notice');
  return {
    origin: {id: `raised-${view.id.slice(0, 8)}`, source: 'bunny/core', type: 'org.bunny.attention.raised'}, sourceKind: 'coding', context: 'live',
    category: attention === undefined ? 'coding-notice' : 'coding-attention', cue: attention?.kind ?? 'turn-ended', revision: view.revision,
    generation: view.generation, session: view.id, identity: view.identity, turn: view.turn, attention: attention ?? null, noticeId: notice?.id ?? null,
    evidence: 'lifecycle-metadata', occurredAtMs: null, observedAtMs: view.lastEvidenceAtMs, validUntilMs: view.lastEvidenceAtMs + 30_000,
    busy: null, media: null, visitor: null, location: null,
  };
}

test('the case set holds every case design decision 10 lists, each with valid messages and at least one check', () => {
  assert.deepEqual(set.cases.map(item => item.id), DESIGN_CASES);
  assert.ok(set.cases.every(item => item.steps.length > 0 && item.checks.length > 0 && ['now', 'step 7', 'step 8'].includes(item.since)));
  assert.deepEqual(Object.keys(set.policies), ['default', 'dashboard', 'nanoleaf']);
  for (const {check, where} of every()) {
    for (const message of check.messages) assert.deepEqual(readSession(message) !== undefined, true, where);
    for (const {session} of check.removed) assert.equal(Object.hasOwn(check.views, session), false, `${where}: ${session} was removed`);
    for (const occurrence of check.occurrences) assert.ok(Object.hasOwn(set.sessions, occurrence.session), where);
  }
});

test('the case set is synthetic: no session, host or title other than its own named ones', () => {
  const identities = Object.values(set.sessions).map(({identity}) => identity);
  assert.ok(identities.every(identity => identity.hostId === 'synthetic-host' && identity.sessionId.startsWith('synthetic-')));
  for (const {check} of every()) {
    for (const {data} of check.messages) {
      assert.ok(data.identity.sessionId.startsWith('synthetic-') && data.identity.hostId === 'synthetic-host');
      assert.equal(data.title ?? data.label ?? data.project ?? data.hostSessionId, undefined);
    }
  }
});

test('notice IDs are derived as the core derives them for a known turn', () => {
  // The core's derivation over today's path, recorded for this identity and turn by running the reference reducer.
  assert.equal(noticeIdOf(set.sessions.claude.identity, 'p1'), '714c12a90f33be18985afd75ec27276faea4a11038478893081c962ea11167b6');
});

test('every check\'s sessions read as the hub status it expects', () => {
  for (const {check, where} of every()) {
    const shown = Object.fromEntries(named(check).map(([name, view]) => [name, statusText(view)]));
    assert.deepEqual(shown, check.readers.status, where);
  }
});

test('each named policy shows the status it expects', () => {
  for (const {check, where} of every()) {
    for (const policy of Object.keys(set.policies)) {
      const expected = Object.fromEntries(named(check).map(([name]) => [name, check.readers.policies?.[policy]?.[name] ?? check.readers.status[name]]));
      const shown = Object.fromEntries(named(check).map(([name, view]) => [name, statusText(policyView(set, policy, view))]));
      assert.deepEqual(shown, expected, `${where}: ${policy}`);
    }
    for (const policy of Object.keys(check.readers.policies ?? {})) assert.ok(Object.hasOwn(set.policies, policy), `${where}: ${policy}`);
  }
});

test('LIFX shows highestStatus over the whole copy, fillers included', () => {
  for (const {check, where} of every()) {
    const views = check.messages.map(message => readSession(message)).map(view => check.views[Object.keys(check.views).find(name => check.views[name].id === view.id)] ?? view);
    assert.equal(highestStatus({synced: check.synced, sessions: views}), check.readers.lifx, where);
  }
});

test('the Tronbyt rows follow the shared state, and only unconfirmed work marks `?`', () => {
  for (const {check, where} of every()) assert.deepEqual(tronbyt(check), check.readers.tronbyt, where);
});

test('the Pixoo markers follow the shared status, not age or an unknown parent', () => {
  let pinned = 0;
  for (const {check, where} of every()) {
    const marked = Object.fromEntries(named(check).filter(([, view]) => isRoot(view)).map(([name, view]) => [name, pixoo(check, view)]));
    assert.deepEqual(marked, check.readers.pixoo, where);
    if (check.readers.pixooChildren === undefined) continue;
    const children = Object.fromEntries(named(check).filter(([, view]) => isRoot(view)).map(([name, view]) => [name, pixooChildren(check, view)]));
    assert.deepEqual(children, check.readers.pixooChildren, `${where}: children marker`);
    pinned++;
  }
  assert.ok(pinned >= 7, `${pinned} children-marker expectations`);
});

// The shared helper ranks every case's roots as the 1.x helper ranks the same sessions, except where a known later turn
// superseded an unacknowledged notice (status rule 3, owner decision 2026-11-18): the 1.x helper still shows it done.
test('the view helper ranks every case\'s roots as the 1.x helper does, but for a superseded notice', () => {
  const superseded = [];
  for (const {check, where} of every()) {
    for (const [name, view] of named(check).filter(([, found]) => isRoot(found))) {
      const snapshot = {identity: view.identity, parent: view.parent, turn: view.turn, activity: view.work.state, attention: view.attention.items,
        notices: view.outcome.notices, children: {active: view.relationships.children.working, uncertain: view.relationships.children.unconfirmed}, observationAgeMs: 0};
      const expected = legacy.sessionState(snapshot);
      if (sessionState(view) === expected) continue;
      assert.equal(expected, 'done', `${where}: ${name} against 1.x`);
      assert.ok(view.outcome.notices.some(notice => notice.turn.status === 'known' && view.turn.status === 'known' && notice.turn.id !== view.turn.id), where);
      superseded.push(where);
    }
  }
  // The core acknowledges a superseded notice for Nanoleaf and Pixoo at the later turn's start, so no case differs today.
  assert.deepEqual(superseded, []);
});

test('the Nanoleaf tasks follow the hub\'s status with Nanoleaf\'s policy and no session rule of their own', () => {
  for (const {check, where} of every()) {
    const roots = named(check).filter(([, view]) => isRoot(view));
    const tasks = Object.fromEntries(roots.map(([name, view]) => [name, nanoleaf(check, view).task]));
    const steady = roots.filter(([, view]) => nanoleaf(check, view).steady).map(([name]) => name);
    assert.deepEqual({tasks, steady}, check.readers.nanoleaf, where);
  }
});

test('the dashboard chips follow its policy', () => {
  for (const {check, where} of every()) {
    assert.deepEqual(Object.fromEntries(named(check).map(([name, view]) => [name, dashboard(view)])), check.readers.dashboard, where);
  }
});

test('opportunities match only while the session still holds them', () => {
  let judged = 0;
  for (const {item, check, where} of every()) {
    for (const expected of check.readers.opportunities ?? []) {
      const raisedFrom = item.checks[expected.raisedAt]?.views[expected.session];
      assert.ok(raisedFrom, `${where}: raised from a view`);
      const view = check.views[expected.session];
      const matches = view !== undefined && opportunityMatches(view, opportunity(raisedFrom, expected.for), expected.consumer);
      assert.equal(matches, expected.matches, `${where}: ${expected.session} ${expected.for} for ${expected.consumer}`);
      judged++;
    }
  }
  assert.ok(judged >= 10, `${judged} opportunity expectations`);
});

test('a restart, the reset and silence change no class but work', () => {
  const byId = Object.fromEntries(set.cases.map(item => [item.id, item]));
  const [before, after] = byId.restart.checks;
  for (const name of ['codex', 'claude']) assert.equal(statusText(after.views[name]), statusText(before.views[name]), name);
  assert.deepEqual(after.views['claude-b'].work.reasons, ['restart']);
  assert.deepEqual(after.occurrences, [], 'a restart publishes no occurrence');
  const [, reset, back] = byId.reset.checks;
  assert.deepEqual([reset.messages, reset.removed, reset.occurrences], [[], [], []], 'the reset publishes nothing and the next sync serves no session');
  assert.ok(back.views.claude.generation > byId.reset.checks[0].views.claude.generation, 'a returning session has a new generation');
  const silent = byId['question-silent'].checks[1].views.codex;
  assert.deepEqual([statusText(silent), silent.attention.confidence, silent.work.reasons], ['needs-owner/question', 'confirmed', ['deadline']]);
  assert.equal(statusText(forConsumer(silent, set.policies.nanoleaf)), 'needs-owner/question');
});
