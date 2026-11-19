// Codex approvals and subagents from the Mac Codex hook wrapper (Hub #1867): each synthetic hook payload goes through the
// wrapper's sanitizer (`bin/mac-codex-hook.mjs`), the runtime's hook adapter and the core store, as the hook process and
// the core run them, on the runtime's manual clock. A Codex approval carries no request ID, so it is forgotten at its
// turn's end or when a newer turn retires its turn, and a runtime end removes it with its session. A subagent is its
// own session under its parent's session, with an unknown turn.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {sessionEntityId, type AttentionCleared, type AttentionRaised, type Identity, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {normalizeHook} from '../src/hook/adapter.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

type Sanitized = {hook_event_name: string} & Record<string, unknown>;
type Wrapper = {sanitizeMacCodexHook: (raw: unknown) => Sanitized | null};
const {sanitizeMacCodexHook} = await import(new URL('../../bin/mac-codex-hook.mjs', import.meta.url).href) as Wrapper;

const SOURCE = {provider: 'codex', client: 'local', hostId: 'synthetic-mac', sourceId: 'codex-local-hooks'} as const;
const root: Identity = {...SOURCE, sessionId: 'root-session'};
const child = (sessionId: string): Identity => ({...SOURCE, sessionId});
// Content fields the documented Codex payloads carry; none may reach the core.
const CONTENT = {cwd: '/PRIVATE_CANARY', transcript_path: '/PRIVATE_CANARY', model: 'PRIVATE_CANARY', permission_mode: 'default'};

const open = (context: TestContext): Promise<World> => World.open(context, {clock: manualClock(START)});

/**
 * Runs one hook a millisecond after the last: `dropped` when the wrapper or the adapter sends nothing, otherwise the
 * store's outcome or refusal code.
 */
async function hook(w: World, raw: unknown): Promise<string> {
  w.clock.advance(1);
  const sanitized = sanitizeMacCodexHook(raw);
  if (sanitized === null) return 'dropped';
  const observation = normalizeHook(sanitized, SOURCE, sanitized.hook_event_name, w.clock.now());
  if (observation === null) return 'dropped';
  const result = await w.take(lifecycleMessage(observation, w.clock.now()));
  return result.ok ? result.outcome : result.code;
}

const held = (w: World, who: Identity): Session30Record | undefined => w.store.records().find(item => item.id === sessionEntityId(who));
const record = (w: World, who: Identity): Session30Record => {
  const found = held(w, who);
  assert.ok(found, `${who.sessionId} is held`);
  return found;
};
const approvals = (w: World, who: Identity): unknown[] => record(w, who).attention.items.map(item => ({kind: item.kind, id: item.id, turn: item.turn}));
const occurrences = <T>(w: World, type: string): T[] => w.published.filter(item => item.message.type === type).map(item => item.message.data as T);
const cleared = (w: World): string[] => occurrences<AttentionCleared>(w, 'org.bunny.attention.cleared').map(item => item.cause);

const start = {hook_event_name: 'SessionStart', session_id: root.sessionId, source: 'startup', ...CONTENT};
const prompt = (turn: string): object => ({hook_event_name: 'UserPromptSubmit', session_id: root.sessionId, turn_id: turn, prompt: 'PRIVATE_CANARY', ...CONTENT});
const approval = (turn: string): object => ({hook_event_name: 'PermissionRequest', session_id: root.sessionId, turn_id: turn, tool_name: 'Bash',
  tool_input: {command: 'PRIVATE_CANARY', description: 'PRIVATE_CANARY'}, ...CONTENT});
const stop = (turn: string): object => ({hook_event_name: 'Stop', session_id: root.sessionId, turn_id: turn, stop_hook_active: false,
  last_assistant_message: 'PRIVATE_CANARY', ...CONTENT});
const interrupt = (turn: string): object => ({hook_event_name: 'Interrupt', session_id: root.sessionId, turn_id: turn, ...CONTENT});
const end = {hook_event_name: 'SessionEnd', session_id: root.sessionId, reason: 'other', ...CONTENT};
const subagent = (hook_event_name: 'SubagentStart' | 'SubagentStop', agent: string, parent = root.sessionId): object => ({hook_event_name,
  session_id: parent, turn_id: 'parent-turn', agent_id: agent, agent_type: 'PRIVATE_CANARY', agent_transcript_path: '/PRIVATE_CANARY',
  last_assistant_message: 'PRIVATE_CANARY', stop_hook_active: false, ...CONTENT});
const pending = (turn: string): unknown => ({kind: 'approval', id: {status: 'unknown'}, turn: {status: 'known', id: turn}});

function private_(w: World): void {
  assert.equal(JSON.stringify(w.published).includes('PRIVATE_CANARY'), false);
  assert.equal(JSON.stringify(w.store.records()).includes('PRIVATE_CANARY'), false);
}

it('an approval is raised on its turn and forgotten at that turn\'s Stop', async context => {
  const w = await open(context);
  for (const raw of [start, prompt('t1'), approval('t1')]) assert.equal(await hook(w, raw), 'applied');
  assert.deepEqual(approvals(w, root), [pending('t1')]);
  assert.equal(record(w, root).work.state, 'active');
  const raised = occurrences<AttentionRaised>(w, 'org.bunny.attention.raised');
  assert.deepEqual(raised.map(item => [item.attention.kind, item.attention.id, item.attention.turn]),
    [['approval', {status: 'unknown'}, {status: 'known', id: 't1'}]]);
  assert.equal(await hook(w, stop('t1')), 'applied');
  assert.deepEqual(approvals(w, root), []);
  assert.deepEqual(cleared(w), ['turn-ended']);
  assert.equal(record(w, root).work.state, 'idle');
  assert.deepEqual(record(w, root).outcome.notices.map(notice => [notice.kind, notice.turn]), [['turn-ended', {status: 'known', id: 't1'}]]);
  private_(w);
});

it('an approval at Interrupt stays until a newer turn retires its turn or the session ends', async context => {
  const w = await open(context);
  for (const raw of [start, prompt('t1'), approval('t1')]) assert.equal(await hook(w, raw), 'applied');
  // The core keeps an interruption distinct from a turn's end, so the interrupted turn's approval stays. An unordered
  // interruption of active work leaves the work unknown: the core's existing rule for every Interrupt on this path.
  assert.equal(await hook(w, interrupt('t1')), 'ambiguous');
  assert.equal(record(w, root).work.state, 'unknown');
  assert.deepEqual(record(w, root).status, {class: 'needs-owner', detail: 'approval'});
  assert.deepEqual(approvals(w, root), [pending('t1')]);
  assert.deepEqual(cleared(w), []);
  assert.equal(await hook(w, prompt('t2')), 'applied');
  assert.deepEqual(approvals(w, root), []);
  assert.deepEqual(cleared(w), ['turn-retired']);
  // An approval on the newer turn, then an interruption and a runtime end: the session goes with its approval.
  assert.equal(await hook(w, approval('t2')), 'applied');
  assert.equal(await hook(w, interrupt('t2')), 'ambiguous');
  assert.deepEqual(approvals(w, root), [pending('t2')]);
  assert.equal(await hook(w, end), 'applied');
  assert.equal(held(w, root), undefined);
  assert.equal(occurrences(w, 'org.bunny.session.ended').length, 1);
  private_(w);
});

it('a subagent starts and stops as its own session under its known parent, without the parent\'s turn', async context => {
  const w = await open(context);
  for (const raw of [start, prompt('t1')]) assert.equal(await hook(w, raw), 'applied');
  assert.equal(await hook(w, subagent('SubagentStart', 'agent-1')), 'applied');
  const started = record(w, child('agent-1'));
  assert.deepEqual(started.parent, {status: 'known', identity: root});
  assert.deepEqual(started.turn, {status: 'unknown'}, 'the payload\'s turn_id is never the child\'s turn');
  assert.equal(started.work.state, 'active');
  assert.equal(started.title, undefined);
  assert.deepEqual(record(w, root).relationships.children, {working: 1, unconfirmed: 0});
  assert.deepEqual(record(w, root).turn, {status: 'known', id: 't1'}, 'the parent keeps its own turn');
  // A child's stop has no turn to match its start, so the core reads the child's work as unknown; it no longer
  // counts as working, and the child shows its finished notice.
  assert.equal(await hook(w, subagent('SubagentStop', 'agent-1')), 'ambiguous');
  assert.deepEqual(record(w, child('agent-1')).status, {class: 'finished', detail: 'turn-ended'});
  assert.equal(record(w, root).relationships.children.working, 0);
  assert.deepEqual(record(w, root).turn, {status: 'known', id: 't1'});
  assert.equal(record(w, root).work.state, 'active', 'a child\'s stop is not its parent\'s');
  // The root's runtime end removes it with its child.
  assert.equal(await hook(w, end), 'applied');
  assert.deepEqual(w.store.records(), []);
  private_(w);
});

it('a subagent of a session the core has not seen keeps its parent selector and invents no parent', async context => {
  const w = await open(context);
  assert.equal(await hook(w, subagent('SubagentStart', 'agent-2', 'unseen-root')), 'applied');
  assert.deepEqual(record(w, child('agent-2')).parent, {status: 'known', identity: child('unseen-root')});
  assert.equal(held(w, child('unseen-root')), undefined);
});

it('a child payload without a usable parent or child identity sends nothing', async context => {
  const w = await open(context);
  for (const hook_event_name of ['SubagentStart', 'SubagentStop'] as const) {
    const base = subagent(hook_event_name, 'agent-3') as Record<string, unknown>;
    const {agent_id: _agent, ...withoutAgent} = base;
    const {session_id: _session, ...withoutParent} = base;
    for (const raw of [withoutAgent, withoutParent, {...base, agent_id: base.session_id}, {...base, agent_id: null}, {...base, agent_id: ''},
      {...base, agent_id: 'has spaces'}, {...base, session_id: 'x'.repeat(129)}, {...base, session_id: 7}]) {
      assert.equal(await hook(w, raw), 'dropped');
    }
  }
  // Events that carry an agent_id but are not subagent events are dropped whole, never attributed to the parent.
  for (const raw of [{...approval('t1'), agent_id: 'agent-3'}, {...stop('t1'), agent_id: 'agent-3'}, {...prompt('t1'), agent_id: 'agent-3'}]) {
    assert.equal(await hook(w, raw), 'dropped');
  }
  assert.deepEqual(w.store.records(), []);
  assert.deepEqual(w.published, []);
});

it('repeated approvals, subagent starts and stops', async context => {
  const w = await open(context);
  for (const raw of [start, prompt('t1'), approval('t1')]) await hook(w, raw);
  // Each hook run is its own process and observation time; the same approval on the same turn is one item.
  assert.equal(await hook(w, approval('t1')), 'applied');
  assert.deepEqual(approvals(w, root), [pending('t1')]);
  assert.equal(occurrences(w, 'org.bunny.attention.raised').length, 1);
  await hook(w, subagent('SubagentStart', 'agent-4'));
  await hook(w, subagent('SubagentStart', 'agent-4'));
  assert.equal(w.store.records().length, 2);
  await hook(w, subagent('SubagentStop', 'agent-4'));
  await hook(w, subagent('SubagentStop', 'agent-4'));
  assert.deepEqual(record(w, child('agent-4')).status, {class: 'finished', detail: 'turn-ended'});
  // A child's stop carries no turn, and each hook run has its own observation time, so the core cannot tell a
  // repeated stop from a second one: each keeps its own notice. Root stops on a known turn keep one.
  assert.equal(record(w, child('agent-4')).outcome.notices.length, 2);
  assert.equal(record(w, root).relationships.children.working, 0);
  await hook(w, stop('t1'));
  await hook(w, stop('t1'));
  assert.equal(record(w, root).outcome.notices.length, 1);
  assert.deepEqual(cleared(w), ['turn-ended']);
  // The same message delivered again is a duplicate and publishes nothing.
  const observation = normalizeHook(sanitizeMacCodexHook(stop('t1')), SOURCE, 'Stop', w.clock.now());
  assert.ok(observation);
  const message = lifecycleMessage(observation, w.clock.now());
  await w.take(message);
  const revision = w.store.revision;
  const again = await w.take(message);
  assert.ok(again.ok);
  assert.equal(again.outcome, 'duplicate');
  assert.equal(w.store.revision, revision);
});

it('a malformed payload sends nothing', async context => {
  const w = await open(context);
  for (const raw of [null, [], 'text', 2, {}, {hook_event_name: 'PermissionRequest', session_id: root.sessionId},
    {...approval('t1'), turn_id: 'has spaces'}, {...approval('t1'), session_id: ''}, {...approval('t1'), hook_event_name: 'PreToolUse'},
    {...approval('t1'), hook_event_name: 'PostToolUse', tool_use_id: 'call-1'}, {...start, source: 'compact'}]) {
    assert.equal(await hook(w, raw), 'dropped');
  }
  assert.deepEqual(w.store.records(), []);
  assert.deepEqual(w.published, []);
});
