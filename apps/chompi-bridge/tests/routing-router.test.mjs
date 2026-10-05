import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskRouter } from '../dist/routing/router.js';
import { createUnsupportedAdapter } from '../dist/windows/index.js';
import { SlotStore } from '../dist/routing/slots.js';
import { DEFAULT_PROFILE_PATH, validateProfile } from '../dist/routing/profile.js';
import { ManualClock } from '../dist/clock.js';
import { CLAUDE_PACKAGE, CODEX_PACKAGE, FakeAdapter, FakeLights, advance, claudeTask, codexTask, known, lid, settle, tempDir, tid, unknown, view } from './routing-helpers.mjs';

const base = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
const PROFILE = validateProfile(base);
const withProfile = overrides => validateProfile({ ...base, ...overrides });
const SLOT = n => n; // default profile: slot n is key control n
const RECORD = 26, WHEEL = 33, PLAY = 27, LOOP = 28;

async function setup(t, { sessions = [], status = 'current', profile = PROFILE, dir = tempDir(t) } = {}) {
  const clock = new ManualClock(1_700_000_000_000);
  const adapter = new FakeAdapter(clock);
  const lights = new FakeLights();
  const slots = await SlotStore.open(join(dir, 'slots.json'), { clock });
  const logs = [];
  const router = new TaskRouter({ adapter, lights, slots, profile, clock, log: event => logs.push(event) });
  t.after(() => router.close());
  router.start();
  let sequence = 1;
  const event = (control, kind, extra = {}) => ({ type: 'input', at: clock.now(), epoch: 7, sequence: sequence++, control, kind, delta: 0, synthetic: false, ...extra });
  const ctx = {
    clock, adapter, lights, slots, logs, router, dir,
    feed(list = sessions, s = status) {
      router.handleFeed(view(list, { status: s }));
      for (const session of list) {
        if (session.identity.provider === 'codex') adapter.codexThreads.set(session.identity.sessionId, session.title?.value ?? null);
        else if (session.hostSessionId && !adapter.claudeRecords.has(session.hostSessionId)) adapter.claudeRecords.set(session.hostSessionId, { localId: session.hostSessionId, isArchived: false, lastFocusedAt: clock.now() - 60_000 });
      }
    },
    press: control => router.handleBridgeEvent(event(control, 'press')),
    release: control => router.handleBridgeEvent(event(control, 'release')),
    turn: (control, delta) => router.handleBridgeEvent({ ...event(control, 'turn'), delta }),
    synthetic: (control, reason) => router.handleBridgeEvent({ type: 'input', at: clock.now(), epoch: 7, sequence: null, control, kind: 'release', delta: 0, synthetic: true, reason }),
    bridge: (type, extra = {}) => router.handleBridgeEvent({ type, at: clock.now(), epoch: 7, ...extra }),
    async click(control) { ctx.press(control); await settle(); ctx.release(control); await settle(); },
    /** Presses and releases a slot key and lets verification finish. */
    async focus(slot, wait = 0) { ctx.press(SLOT(slot)); await settle(); if (wait) await advance(clock, wait); ctx.release(SLOT(slot)); await settle(); },
    failures: () => logs.filter(l => l.type === 'focus-failed'),
    lastLog: type => logs.filter(l => l.type === type).at(-1),
    keysAfterOpen() { return adapter.keys; },
  };
  if (sessions.length) ctx.feed();
  return ctx;
}

const target = ctx => ctx.router.status().target;

// Focus: Codex

test('a Codex key press opens the exact thread, verifies selection and composer, and types nothing else', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  await ctx.focus(2);
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(2)}`]);
  assert.deepEqual(target(ctx), { slot: 2, client: 'codex' });
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }], 'only the composer shortcut');
  assert.ok(ctx.adapter.calls.some(c => c[0] === 'codexSelectedThread' && c[1] === tid(2) && c[2] === 'Task 2'));
  assert.ok(ctx.adapter.count('codexArchived') >= 1, 'the target check reads archive evidence first');
  assert.equal(ctx.lastLog('focused').slot, 2);
  assert.equal('evidence' in ctx.lastLog('focused'), false, 'Codex verification logs no Claude evidence code');
  assert.ok(!JSON.stringify(ctx.logs).includes('Task 2'), 'logs never carry titles');
});

test('matrix: a key for an empty slot opens nothing and lights the error state', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(5);
  assert.deepEqual(ctx.adapter.opened, []);
  assert.equal(ctx.failures().at(-1).reason, 'empty-slot');
  assert.equal(ctx.router.status().slots[4].error, true);
  assert.equal(target(ctx), null);
  await advance(ctx.clock, PROFILE.timing.errorFlashMs + 50, 100);
  assert.equal(ctx.router.status().slots[4].error, false, 'the error flash ends');
});

test('matrix: a key for an archived Codex task opens nothing, lights error and releases the slot', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.codexArchivedIds.add(tid(1));
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.opened, []);
  assert.equal(ctx.failures().at(-1).reason, 'archived');
  assert.equal(ctx.slots.get(1), undefined);
  assert.equal(ctx.lastLog('slot-released').reason, 'codex-archived');
});

test('unknown archive evidence fails closed and keeps the slot', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.unknownArchive = true;
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.opened, []);
  assert.equal(ctx.failures().at(-1).reason, 'archive-unknown');
  assert.equal(ctx.slots.get(1).taskId, tid(1));
});

test('matrix: a stale Hub feed with no cached target opens nothing; with a cached target the task still opens', async t => {
  const empty = await setup(t);
  empty.router.handleFeed({ status: 'unavailable', revision: null, snapshotVersion: null, sessions: [], reason: 'snapshot-http-503' });
  await empty.focus(1);
  assert.deepEqual(empty.adapter.opened, []);
  assert.equal(empty.failures().at(-1).reason, 'empty-slot');

  const cached = await setup(t, { sessions: [codexTask(1)] });
  cached.router.handleFeed(view([codexTask(1)], { status: 'stale' }));
  await cached.focus(1);
  assert.deepEqual(cached.adapter.opened, [`codex://threads/${tid(1)}`]);
  assert.deepEqual(target(cached), { slot: 1, client: 'codex' });
});

test('matrix: a session the Hub retires after idle keeps its slot, shows ended and still opens the same task', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  ctx.feed([codexTask(2)]);
  assert.equal(ctx.slots.get(1).taskId, tid(1));
  assert.equal(ctx.router.status().slots[0].state, 'ended');
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(1)}`]);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
});

test('matrix: link opened but a different Codex task stays selected; foreground alone is not enough', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  ctx.adapter.codexThreads.delete(tid(2)); // Codex does not know the ID: it raises its window and keeps task 1 selected
  ctx.adapter.codexSelected = tid(1);
  ctx.press(SLOT(2));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.adapter.foreground.packageIdentity, CODEX_PACKAGE, 'Codex is in front');
  assert.equal(ctx.failures().at(-1).step, 'verify');
  assert.equal(ctx.failures().at(-1).reason, 'selection-mismatch');
  assert.deepEqual(ctx.adapter.keys, [], 'nothing typed');
  assert.equal(target(ctx), null);
  assert.ok(ctx.adapter.count('codexSelectedThread') > 3, 'verification polls within its bound');
  assert.ok(ctx.adapter.count('codexSelectedThread') <= Math.ceil(PROFILE.timing.verifyTimeoutMs / PROFILE.timing.verifyPollMs) + 1);
  assert.equal(ctx.adapter.count('openUri'), 1, 'the link is not reopened');
});

test('matrix: two live tasks with the same title fail Codex verification closed', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: 'Same' }), codexTask(2, { title: 'Same' })] });
  ctx.press(SLOT(2));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'title-not-unique');
  assert.deepEqual(ctx.adapter.keys, []);
});

test('a Codex slot with neither a Codex name nor a Hub title cannot be verified', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: undefined })] });
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'title-missing');
  assert.deepEqual(ctx.adapter.keys, [], 'nothing is typed');
  assert.equal(target(ctx), null);
  assert.equal(ctx.adapter.count('openUri'), 1, 'the link opens once and is never repeated');
});

test('matrix: a Codex name another thread also has fails closed even when that row is not rendered', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: undefined })] });
  ctx.adapter.codexNames.set(tid(1), 'Shared name');
  ctx.adapter.codexThreads.set(tid(1), 'Shared name');
  ctx.adapter.codexNames.set(tid(9), 'Shared name'); // a collapsed or deleted thread: no sidebar row
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'title-not-unique');
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(target(ctx), null);
});

test('a Codex slot without a Hub title verifies by the name Codex keeps for the thread', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: undefined }), codexTask(2)] });
  ctx.adapter.codexNames.set(tid(1), 'Codex name 1');
  ctx.adapter.codexThreads.set(tid(1), 'Codex name 1');
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  assert.ok(ctx.adapter.calls.some(c => c[0] === 'codexSelectedThread' && c[1] === tid(1) && c[2] === null));
  assert.ok(!JSON.stringify(ctx.logs).includes('Codex name 1'), 'logs never carry titles');
});

test('the Codex name takes precedence over a stale Hub title', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: 'Old Hub title' })] });
  ctx.adapter.codexNames.set(tid(1), 'Renamed in Codex');
  ctx.adapter.codexThreads.set(tid(1), 'Renamed in Codex');
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  assert.ok(!JSON.stringify(ctx.logs).includes('Renamed in Codex') && !JSON.stringify(ctx.logs).includes('Old Hub title'), 'logs never carry names');
});

test('matrix: the target app not in the foreground after open gets no input', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.appsFollowLinks = false;
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'foreground-mismatch');
  assert.deepEqual(ctx.adapter.keys, []);
});

test('failed composer readiness leaves no target', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.composerUnknown = true;
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).step, 'composer');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }], 'the composer shortcut is sent once, never retried');
});

test('an adapter call that never answers times out and fails closed', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.hang.foregroundWindow = true;
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + PROFILE.timing.adapterTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).step, 'verify');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, []);
});

// Focus: Claude

test('a Claude key press opens the Desktop ID link and verifies by lastFocusedAt', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  await ctx.focus(2);
  assert.deepEqual(ctx.adapter.opened, [`claude://code/continue?session=${lid(2)}`]);
  assert.deepEqual(target(ctx), { slot: 2, client: 'claude' });
  assert.deepEqual(ctx.adapter.keys, [], 'Claude needs no composer shortcut');
  assert.equal(ctx.adapter.foreground.packageIdentity, CLAUDE_PACKAGE);
});

test('matrix: two live tasks with the same title still verify by ID in Claude', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1, { title: 'Same' }), claudeTask(2, { title: 'Same' })] });
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'claude' });
});

test('matrix: a Claude Desktop record that is missing, unreadable or archived opens nothing', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2), claudeTask(3)] });
  ctx.adapter.claudeRecords.delete(lid(1));
  await ctx.focus(1);
  assert.equal(ctx.failures().at(-1).reason, 'claude-record-missing');
  assert.equal(ctx.slots.get(1).taskId, lid(1), 'a missing record is not archive evidence');
  ctx.adapter.claudeUnknown = true;
  await ctx.focus(2);
  assert.equal(ctx.failures().at(-1).reason, 'claude-record-unknown');
  ctx.adapter.claudeUnknown = false;
  ctx.adapter.claudeRecords.get(lid(3)).isArchived = true;
  await ctx.focus(3);
  assert.equal(ctx.failures().at(-1).reason, 'archived');
  assert.equal(ctx.slots.get(3), undefined);
  assert.equal(ctx.lastLog('slot-released').reason, 'claude-archived');
  assert.deepEqual(ctx.adapter.opened, []);
});

test('Claude verification fails when the link shows Code home or another session also became visible', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  ctx.adapter.appsFollowLinks = false;
  ctx.adapter.foreground = { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  // The fed sessions tie on lastFocusedAt, so no session is strictly the newest and only the advance rule applies.
  // With a strictly newest target this case passes: see the accepted residual test below.
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'selection-mismatch', 'Code home: the target was never stamped');

  ctx.adapter.appsFollowLinks = true;
  const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
  ctx.adapter.openUri = async uri => { await realOpen(uri); ctx.adapter.claudeRecords.get(lid(2)).lastFocusedAt = ctx.clock.now() + 2; };
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).reason, 'selection-ambiguous');
  assert.equal(target(ctx), null);
});

/** Puts Claude in front showing the session `id`, focused `ago` ms before now; the fed sessions are older. */
function claudeShowing(ctx, id, ago = 1_000) {
  ctx.adapter.foreground = { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.adapter.claudeSelected = id;
  ctx.adapter.claudeRecords.get(id).lastFocusedAt = ctx.clock.now() - ago;
  ctx.adapter.composer.claude = true;
}

/** Index of the first adapter call matching `predicate`, or -1. */
const callIndex = (ctx, predicate) => ctx.adapter.calls.findIndex(predicate);

test('a press for the Claude session already selected in front verifies by its already-newest lastFocusedAt', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(1));
  const focusedAt = ctx.adapter.claudeRecords.get(lid(1)).lastFocusedAt;
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'claude' });
  assert.equal(ctx.lastLog('focused').evidence, 'already-newest', 'the log names the evidence');
  assert.equal(ctx.adapter.claudeRecords.get(lid(1)).lastFocusedAt, focusedAt, 'Claude stamped nothing');
  assert.deepEqual(ctx.adapter.opened, [`claude://code/continue?session=${lid(1)}`], 'the link opens once');
  assert.deepEqual(ctx.adapter.keys, [], 'no keystroke is added');
  const open = callIndex(ctx, c => c[0] === 'openUri');
  assert.ok(callIndex(ctx, c => c[0] === 'foregroundWindow') < open, 'the foreground was read before the link');
  assert.ok(callIndex(ctx, c => c[0] === 'claudeSessions' && c[1].length === 2) < open, 'every known record was read before the link');
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.lastLog('dictation-started')?.slot, 1, 'the Record re-check accepts the target');
});

test('a press for another Claude session while Claude is in front still verifies by the advanced lastFocusedAt', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(2));
  const pressedAt = ctx.clock.now();
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'claude' });
  assert.ok(ctx.adapter.claudeRecords.get(lid(1)).lastFocusedAt > pressedAt, 'the link changed the selection');
  assert.equal(ctx.lastLog('focused').evidence, 'advanced', 'the log names the evidence');
});

test('an unknown foreground before the link gives no already-selected evidence; the advance rule applies', async t => {
  for (const stamps of [false, true]) {
    const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
    claudeShowing(ctx, lid(1));
    const realForeground = ctx.adapter.foregroundWindow.bind(ctx.adapter);
    ctx.adapter.foregroundWindow = async () => (ctx.adapter.opened.length === 0 ? unknown('no foreground') : realForeground());
    const record = ctx.adapter.claudeRecords.get(lid(1));
    const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
    ctx.adapter.openUri = async uri => {
      const focusedAt = record.lastFocusedAt;
      await realOpen(uri);
      record.lastFocusedAt = stamps ? ctx.clock.now() + 1 : focusedAt;
    };
    ctx.press(SLOT(1));
    await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
    if (stamps) {
      assert.deepEqual(target(ctx), { slot: 1, client: 'claude' }, 'an advance still verifies');
      assert.equal(ctx.lastLog('focused').evidence, 'advanced');
    } else {
      assert.equal(ctx.failures().at(-1)?.reason, 'selection-mismatch', 'without an advance nothing verifies');
      assert.equal(target(ctx), null);
    }
    assert.deepEqual(ctx.adapter.keys, []);
  }
});

test('accepted residual: Claude in front on Code home with the target strictly newest verifies when the link does not navigate', async t => {
  // The window's view is unobserved. Owner decision on #743: a strictly newest target with Claude in front counts as
  // selected; only the link navigating covers Code home, the Chat tab and sessions the bridge does not know.
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(1));
  ctx.adapter.claudeSelected = null; // Code home: no session shown
  ctx.adapter.appsFollowLinks = false;
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'claude' });
  assert.equal(ctx.lastLog('focused').evidence, 'already-newest');
});

test('matrix: an already-selected Claude target that is not strictly the newest fails closed', async t => {
  for (const [name, other] of [['tie', 0], ['another session newer', 500]]) {
    const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
    claudeShowing(ctx, lid(1));
    ctx.adapter.claudeRecords.get(lid(2)).lastFocusedAt = ctx.adapter.claudeRecords.get(lid(1)).lastFocusedAt + other;
    ctx.press(SLOT(1));
    await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
    assert.equal(ctx.failures().at(-1)?.step, 'verify', name);
    assert.equal(ctx.failures().at(-1).reason, 'selection-mismatch', name);
    assert.equal(target(ctx), null, name);
    assert.deepEqual(ctx.adapter.keys, [], name);
    assert.equal(ctx.adapter.count('openUri'), 1, `${name}: the link is not reopened`);
  }
});

test('an incomplete Claude read before the link gives no already-selected evidence', async t => {
  const sessions = Array.from({ length: 80 }, (_, i) => claudeTask(i + 1));
  const ctx = await setup(t, { sessions });
  const id = ctx.slots.get(1).taskId;
  claudeShowing(ctx, id);
  const realRead = ctx.adapter.claudeSessions.bind(ctx.adapter);
  // Before the link, the second bounded call (IDs 65 to 80) cannot be read; afterwards every call answers.
  ctx.adapter.claudeSessions = async ids => (ctx.adapter.opened.length === 0 && ids.includes(lid(80)) ? unknown('store busy') : realRead(ids));
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1)?.reason, 'selection-mismatch');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('the already-selected evidence needs Claude in front before the link', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(1));
  ctx.adapter.foreground = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };
  // A link that raises Claude without stamping: only already-newest evidence could pass, and it must not apply.
  const record = ctx.adapter.claudeRecords.get(lid(1));
  const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
  ctx.adapter.openUri = async uri => { const focusedAt = record.lastFocusedAt; await realOpen(uri); record.lastFocusedAt = focusedAt; };
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.adapter.foreground.packageIdentity, CLAUDE_PACKAGE, 'Claude is in front after the link');
  assert.equal(ctx.failures().at(-1)?.reason, 'selection-mismatch');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('an already-selected Claude target fails when another session moves past the press', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(1));
  const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
  ctx.adapter.openUri = async uri => { await realOpen(uri); ctx.adapter.claudeRecords.get(lid(2)).lastFocusedAt = ctx.clock.now() + 2; };
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1)?.step, 'verify');
  assert.equal(ctx.failures().at(-1).reason, 'selection-mismatch');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('an already-selected Claude target must still be strictly the newest after the link', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(1));
  // A Desktop session the router learns of only after the link, focused after the target but before the press.
  ctx.adapter.claudeRecords.set(lid(3), { localId: lid(3), isArchived: false, lastFocusedAt: ctx.clock.now() - 500 });
  const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
  ctx.adapter.openUri = async uri => { await realOpen(uri); ctx.feed([claudeTask(1), claudeTask(2), claudeTask(3)]); };
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1)?.reason, 'selection-mismatch');
  assert.equal(target(ctx), null);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('matrix: an unqualified client version disables that client only', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), codexTask(2)] });
  ctx.adapter.versions = { codex: known('26.930.3930.0'), claude: known('2.20000.0.0') };
  await ctx.focus(1);
  assert.equal(ctx.failures().at(-1).reason, 'client-unqualified');
  assert.deepEqual(ctx.adapter.opened, []);
  await ctx.focus(2);
  assert.deepEqual(target(ctx), { slot: 2, client: 'codex' }, 'Codex is unaffected');
  ctx.adapter.versions = { codex: known('26.930.3930.0'), claude: unknown('package not found') };
  await ctx.focus(1);
  assert.equal(ctx.failures().at(-1).reason, 'client-version-unknown');
});

test('an unqualified Codex version disables Codex only, because its UI selectors are version-dependent', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), codexTask(2)] });
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: known('26.1001.0.0') };
  await ctx.focus(2);
  assert.equal(ctx.failures().at(-1).reason, 'client-unqualified');
  assert.equal(ctx.failures().at(-1).observedVersion, '26.1001.0.0', 'the log names the version to qualify');
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: unknown('package not found') };
  await ctx.focus(2);
  assert.equal(ctx.failures().at(-1).reason, 'client-version-unknown');
  assert.deepEqual(ctx.adapter.opened, []);
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'claude' }, 'Claude is unaffected');
});

test('a client update seen only after the link opens fails closed before any keystroke', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  let reads = 0;
  // Cached version at the gate; the adapter re-reads after the updated client comes to the foreground.
  ctx.adapter.clientVersions = async () => { ctx.adapter.calls.push(['clientVersions']); reads++; return { codex: known(reads === 1 ? '26.930.3930.0' : '26.1001.0.0'), claude: known('2.19675.0.0') }; };
  ctx.press(SLOT(1));
  await settle();
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(1)}`], 'the first gate passed on the cached version');
  const failure = ctx.failures().at(-1);
  assert.equal(failure.reason, 'client-unqualified');
  assert.equal(failure.observedVersion, '26.1001.0.0');
  assert.deepEqual(ctx.adapter.keys, [], 'not even the composer shortcut');
  assert.equal(target(ctx), null);
  assert.equal(ctx.router.status().slots[0].error, true);
});

test('Record and Send re-check the client version before their keystrokes', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: known('26.1001.0.0') };
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'client-unqualified');
  assert.equal(ctx.lastLog('send-refused').observedVersion, '26.1001.0.0');
  await ctx.focus(1);
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: known('26.930.3930.0') };
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: unknown('package not found') };
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.lastLog('record-refused').reason, 'client-version-unknown');
  assert.deepEqual(ctx.adapter.keys, [], 'no chord and no Enter');
  assert.equal(target(ctx), null);
});

// Task switch

test('matrix: a task switch between Record and Send clears the pending target and Send is refused', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  ctx.adapter.hang.codexArchived = true; // slot 2's check is still running when Send arrives
  ctx.press(SLOT(2));
  await settle();
  assert.equal(target(ctx), null, 'the earlier target is gone at once');
  assert.ok(ctx.adapter.count('releaseAll') >= 1);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 0);
  assert.equal(ctx.lastLog('send-refused').reason, 'no-target');
});

test('a later key press cancels an earlier focus still in progress', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  ctx.adapter.appsFollowLinks = false;
  ctx.press(SLOT(1));
  await advance(ctx.clock, 300, 50);
  ctx.adapter.appsFollowLinks = true;
  ctx.release(SLOT(1));
  await ctx.focus(2);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.deepEqual(target(ctx), { slot: 2, client: 'codex' });
  assert.equal(ctx.failures().filter(f => f.slot === 1 && f.reason !== 'superseded').length, 0, 'the superseded attempt does not flash error');
});

test('a task key press never acknowledges, approves or dismisses anything', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] })] });
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }]);
  assert.equal(ctx.router.status().slots[0].state, 'attention', 'attention remains');
  assert.equal(typeof ctx.router.acknowledge, 'undefined', 'the router has no Hub write path');
});

test('a focused key with pending attention keeps pulsing and the press reaches no Hub', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] })] });
  await ctx.focus(1);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  const seen = new Set();
  for (let i = 0; i < 4; i++) { seen.add(JSON.stringify(ctx.lights.last[0])); await advance(ctx.clock, PROFILE.timing.attentionPulseMs / 2, 50); }
  assert.ok(seen.has(JSON.stringify(PROFILE.colors.attention)), 'the attention color still shows on the focused key');
  assert.ok(seen.has(JSON.stringify(PROFILE.colors.selected)), 'alternating with the selected color');
  assert.equal(ctx.router.status().slots[0].state, 'attention');
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }], 'only the composer shortcut; nothing approves');
  assert.equal(typeof ctx.router.acknowledge, 'undefined', 'the router has no Hub write path');
});

test('the Claude ambiguity check reads every known Desktop ID, beyond 63', async t => {
  const sessions = Array.from({ length: 80 }, (_, i) => claudeTask(i + 1));
  const ctx = await setup(t, { sessions });
  const realOpen = ctx.adapter.openUri.bind(ctx.adapter);
  // The 80th known session, which never gets a slot, also becomes visible: verification must see it.
  ctx.adapter.openUri = async uri => { await realOpen(uri); ctx.adapter.claudeRecords.get(lid(80)).lastFocusedAt = ctx.clock.now() + 2; };
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1)?.reason, 'selection-ambiguous');
  assert.equal(target(ctx), null);
  const queried = new Set(ctx.adapter.calls.filter(c => c[0] === 'claudeSessions').flatMap(c => c[1]));
  assert.equal(queried.size, 80, 'every known Desktop ID was read');
});

// Send

test('the big-wheel click sends the draft once to the verified composer', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['Enter'] }]);
  assert.equal(ctx.lastLog('sent').slot, 1);
  for (const name of ['foregroundWindow', 'codexSelectedThread', 'composerFocused', 'approvalVisible']) assert.ok(ctx.adapter.count(name) >= 1, name);
});

test('matrix: duplicate or repeated wheel clicks produce one Enter at most', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(WHEEL);
  ctx.press(WHEEL);
  await settle();
  ctx.release(WHEEL);
  await advance(ctx.clock, 200, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1);
  assert.equal(ctx.lastLog('send-refused').reason, 'repeat');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 2, 'a deliberate later Send to the same verified task works');
});

test('matrix: an uncertain Send is never retried and clears the target', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.reject.sendKeys = new Error('SendInput inserted 0 of 2 events');
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.count('sendKeys'), 2, 'Alt+L plus one Enter attempt');
  assert.equal(ctx.lastLog('send-uncertain').slot, 1);
  assert.equal(target(ctx), null);
  assert.equal(ctx.router.status().slots[0].error, true);
  delete ctx.adapter.reject.sendKeys;
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs + 100, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 0, 'nothing typed later either: the target is gone');
});

test('a Send keystroke that never returns is uncertain, not retried', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.hang.sendKeys = true;
  ctx.press(WHEEL);
  await advance(ctx.clock, PROFILE.timing.adapterTimeoutMs + 100, 50);
  assert.equal(ctx.lastLog('send-uncertain').slot, 1);
  assert.equal(ctx.adapter.count('sendKeys'), 2);
});

test('matrix: an approval pending on the target refuses Send', async t => {
  // Claude sorts before Codex, so the Claude task holds slot 1 and the Codex task slot 2.
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] }), claudeTask(2)] });
  await ctx.focus(2);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'hub-approval-pending');
  assert.equal(ctx.router.status().send, 'blocked');

  await ctx.focus(1);
  ctx.adapter.approval.claude = known(true);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'approval-visible');
  ctx.adapter.approval.claude = unknown('no UIA tree');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs + 100, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'approval-unknown');
  assert.equal(ctx.adapter.enters, 0);
});

test('question and input attention do not block Send', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['question', 'input'] })] });
  await ctx.focus(1);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1);
});

test('Send is refused while the feed is stale, because a pending approval would be unknown', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.router.handleFeed(view([codexTask(1)], { status: 'stale' }));
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'feed-not-current');
  assert.equal(ctx.adapter.enters, 0);
});

test('Send re-verifies: focus moved to another app, another task or off the composer refuses it', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  await ctx.focus(1);
  ctx.adapter.foreground = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'foreground-mismatch');
  assert.equal(target(ctx), null, 'a failed re-check invalidates the target');

  await ctx.focus(1);
  ctx.adapter.codexSelected = tid(2);
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs + 100, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'selection-mismatch');

  await ctx.focus(1);
  ctx.adapter.composer.codex = false;
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs + 100, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'composer-unfocused');
  assert.equal(ctx.adapter.enters, 0);
});

test('a Claude Send is refused once another session became visible after verification', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  await ctx.focus(1);
  ctx.clock.advance(10);
  ctx.adapter.claudeRecords.get(lid(2)).lastFocusedAt = ctx.clock.now();
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'selection-mismatch');
  assert.equal(ctx.adapter.enters, 0);
});

test('small-knob clicks, the volume click and encoder turns never send', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  for (const control of [29, 30, 31, 32, 34]) await ctx.click(control);
  for (const control of [41, 42, 43, 44, 45, 46]) { ctx.turn(control, 3); ctx.turn(control, -2); await settle(); }
  assert.equal(ctx.adapter.enters, 0);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' }, 'knobs and scrolling leave the target alone');
});

test('Play sends with the default profile, and only when the profile maps it to Send', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 1);

  const unmapped = await setup(t, { sessions: [codexTask(1)], profile: withProfile({ controls: { ...base.controls, send: [33] } }) });
  await unmapped.focus(1);
  await unmapped.click(PLAY);
  assert.equal(unmapped.adapter.enters, 0);
});

test('Send while Record is held is refused', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'dictating');
  assert.equal(ctx.adapter.enters, 0);
});

// Record

test('Record holds the Wispr chord only after a verified target, and its release inserts a draft without sending', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.press(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, [{ action: 'down', keys: ['LeftControl', 'LeftWindows'] }]);
  assert.equal(ctx.router.status().dictating, true);
  ctx.release(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys.at(-1), { action: 'up', keys: ['LeftControl', 'LeftWindows'] });
  assert.equal(ctx.adapter.enters, 0, 'release never sends');
  assert.equal(ctx.adapter.held.size, 0);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' }, 'the draft can be sent next');
});

test('Record without a verified target presses nothing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.press(RECORD);
  await settle();
  ctx.release(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(ctx.lastLog('record-refused').reason, 'no-target');
});

test('Record released before its checks finish presses nothing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.press(RECORD);
  ctx.release(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(ctx.adapter.held.size, 0);
});

test('Record refuses when the composer lost focus', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1)] });
  await ctx.focus(1);
  ctx.adapter.composer.claude = false;
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.lastLog('record-refused').reason, 'composer-unfocused');
  assert.deepEqual(ctx.adapter.keys, []);
});

test('matrix: a disconnect during a Record hold releases modifiers, sends no draft and needs a fresh press', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 2);
  ctx.synthetic(RECORD, 'device-closed');
  ctx.bridge('disconnected', { reason: 'device-closed' });
  await settle();
  assert.equal(ctx.adapter.held.size, 0);
  assert.ok(ctx.adapter.count('releaseAll') >= 1);
  assert.equal(ctx.adapter.enters, 0);
  assert.equal(target(ctx), null);
  ctx.bridge('connected', { firmware: [0, 1, 0] });
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 0, 'no replay after reconnect');
  assert.equal(ctx.slots.get(1).taskId, tid(1), 'slots are retained');
});

for (const [name, events] of [
  ['session-restart', [['session-restart', { cause: 'same-epoch-hello' }]]],
  ['stale', [['stale', {}], ['recovered', {}]]],
]) {
  test(`a bridge ${name} releases held keys and requires a fresh action`, async t => {
    const ctx = await setup(t, { sessions: [codexTask(1)] });
    await ctx.focus(1);
    ctx.press(RECORD);
    await settle();
    ctx.synthetic(RECORD, name);
    for (const [type, extra] of events) ctx.bridge(type, extra);
    await settle();
    assert.equal(ctx.adapter.held.size, 0);
    assert.equal(target(ctx), null);
    await ctx.click(WHEEL);
    assert.equal(ctx.adapter.enters, 0);
  });
}

test('matrix: a bridge restart keeps slots and replays nothing', async t => {
  const dir = tempDir(t);
  const first = await setup(t, { sessions: [codexTask(1), claudeTask(2)], dir });
  await first.focus(1);
  await first.router.close();
  const second = await setup(t, { dir });
  assert.deepEqual(second.slots.entries().map(r => [r.slot, r.taskId]), [[1, lid(2)], [2, tid(1)]]);
  assert.equal(target(second), null);
  assert.deepEqual(second.adapter.opened, []);
  assert.deepEqual(second.adapter.keys, []);
  await second.click(WHEEL);
  assert.equal(second.adapter.enters, 0);
});

// Profile reload

test('a profile reload clears the target, releases held keys, applies brightness and replays nothing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  const opened = ctx.adapter.opened.length;
  ctx.router.setProfile(withProfile({ brightnessPercent: 15 }));
  await settle();
  assert.equal(ctx.adapter.held.size, 0);
  assert.equal(target(ctx), null);
  assert.equal(ctx.lights.brightness.at(-1), 15);
  assert.equal(ctx.adapter.opened.length, opened, 'no earlier press is replayed');
  ctx.release(RECORD);
  await settle();
  assert.equal(ctx.adapter.enters, 0);
});

test('remapped controls apply to new presses only', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.router.setProfile(withProfile({ controls: { ...base.controls, send: [27] } }));
  await ctx.focus(1);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 0, 'the wheel is no longer Send');
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 1);
});

// Release gesture and Back

test('the Claude release gesture frees the slot after the hold; on a Codex slot it only flashes error', async t => {
  // Claude sorts first: slot 1 is the Claude task, slot 2 the Codex task.
  const ctx = await setup(t, { sessions: [codexTask(1), claudeTask(2)] });
  ctx.press(SLOT(1));
  await advance(ctx.clock, 300, 50);
  ctx.press(LOOP);
  await settle();
  assert.equal(ctx.slots.get(1).taskId, lid(2), 'a short hold is not the gesture');
  ctx.release(LOOP);
  await advance(ctx.clock, PROFILE.timing.releaseHoldMs, 50);
  ctx.press(LOOP);
  await settle();
  assert.equal(ctx.slots.get(1), undefined);
  assert.equal(ctx.lastLog('slot-released').reason, 'release-gesture');
  assert.equal(target(ctx), null);
  ctx.release(LOOP);
  ctx.release(SLOT(1));
  await ctx.slots.flush();
  const saved = JSON.parse(readFileSync(join(ctx.dir, 'slots.json'), 'utf8'));
  assert.deepEqual(saved.slots.map(s => s.slot), [2], 'the release is persisted');

  ctx.press(SLOT(2));
  await advance(ctx.clock, PROFILE.timing.releaseHoldMs + 50, 50);
  ctx.press(LOOP);
  await settle();
  assert.equal(ctx.slots.get(2).taskId, tid(1), 'Codex slots need an owner decision for the gesture');
  assert.equal(ctx.lastLog('release-refused').reason, 'codex-gesture-not-enabled');
  assert.equal(ctx.router.status().slots[1].error, true);
});

test('Back alone clears the target and releases keys', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  await ctx.click(LOOP);
  assert.equal(target(ctx), null);
  assert.ok(ctx.adapter.count('releaseAll') >= 1);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 0);
});

// Archive evidence

test('the periodic archive check releases slots on explicit evidence only', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2), claudeTask(3), claudeTask(4)] });
  ctx.adapter.codexArchivedIds.add(tid(1));
  ctx.adapter.claudeRecords.get(lid(3)).isArchived = true;
  ctx.adapter.claudeRecords.delete(lid(4));
  await advance(ctx.clock, PROFILE.timing.archiveCheckMs + 100, 1000);
  assert.deepEqual(ctx.slots.entries().map(r => r.slot), [2, 4], 'archived Codex and Claude slots are released; a missing record is not evidence');
  ctx.adapter.unknownArchive = true;
  ctx.adapter.claudeUnknown = true;
  await advance(ctx.clock, PROFILE.timing.archiveCheckMs + 100, 1000);
  assert.deepEqual(ctx.slots.entries().map(r => r.slot), [2, 4], 'unknown evidence releases nothing');
});

test('a freed slot is reused deterministically by the next task', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(3)] });
  ctx.adapter.codexArchivedIds.add(tid(1));
  await advance(ctx.clock, PROFILE.timing.archiveCheckMs + 100, 1000);
  ctx.feed([codexTask(3), codexTask(4), codexTask(2)]);
  assert.deepEqual(ctx.slots.entries().map(r => [r.slot, r.taskId]), [[1, tid(2)], [2, tid(3)], [3, tid(4)]]);
});

// Lights and overflow

test('the router lights slots from feed state, marks the target and pulses attention', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { activity: 'active' }), codexTask(2, { attention: ['approval'] })] });
  await settle();
  const frame = ctx.lights.last;
  assert.deepEqual(frame[0], PROFILE.colors.active);
  assert.deepEqual(frame[1], PROFILE.colors.attention);
  await advance(ctx.clock, PROFILE.timing.attentionPulseMs / 2 + 50, 50);
  assert.notDeepEqual(ctx.lights.last[1], PROFILE.colors.attention, 'attention pulses');
  await ctx.focus(1);
  assert.deepEqual(ctx.lights.last[0], PROFILE.colors.selected);
  assert.deepEqual(ctx.lights.last[30], PROFILE.colors.sendReady);
  ctx.router.handleFeed(view([], { status: 'stale' }));
  await settle();
  assert.deepEqual(ctx.lights.last[1], PROFILE.colors.stale, 'a stale feed is never shown as current state');
  assert.equal(ctx.lights.brightness[0], PROFILE.brightnessPercent);
  assert.deepEqual(ctx.router.status().slots[1].state, 'stale');
});

test('overflow is reported without moving existing slots', async t => {
  const sessions = Array.from({ length: 16 }, (_, i) => codexTask(i + 1));
  const ctx = await setup(t, { sessions });
  assert.equal(ctx.router.status().overflow, 1);
  assert.equal(ctx.lastLog('overflow').count, 1);
  assert.equal(ctx.slots.get(15).taskId, tid(15));
});

// Scroll

// Scroll

test('the big wheel scrolls the target client conversation without typing or changing the target', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.turn(45, 2);
  await settle();
  ctx.turn(45, -1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['codex', -2], ['codex', 1]], 'clockwise scrolls down; positive notches scroll up');
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(ctx.adapter.enters, 0);
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  assert.equal(ctx.adapter.count('openUri'), 1, 'scroll never selects a task');
});

test('scroll steps and direction come from the profile', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)], profile: withProfile({ scroll: { notchesPerStep: 3, invert: true } }) });
  await ctx.focus(1);
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['codex', 3]]);
});

test('without a target the wheel scrolls the foreground Desktop client, and nothing else', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.foreground = { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['claude', -1]]);
  ctx.adapter.foreground = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };
  ctx.turn(45, 1);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1, 'another app in front gets no wheel input');
  ctx.adapter.foregroundUnknown = true;
  ctx.turn(45, 1);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1);
  assert.equal(target(ctx), null, 'scrolling selects nothing');
  assert.deepEqual(ctx.adapter.opened, []);
});

test('the wheel never scrolls while dictation is held', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  ctx.turn(45, 2);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 0);
  ctx.release(RECORD);
  await settle();
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['codex', -1]]);
});

test('an unknown or false scroll result is not retried and leaves state unchanged', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.adapter.scrollUnknown = true;
  ctx.turn(45, 3);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1, 'no retry');
  assert.equal(ctx.lastLog('scroll-unknown').client, 'codex');
  ctx.adapter.scrollUnknown = false;
  ctx.adapter.foreground = { packageIdentity: 'Other', processName: 'other.exe' };
  ctx.turn(45, 1);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 2);
  assert.deepEqual(ctx.adapter.scrolled, [], 'the adapter answered false: nothing scrolled');
  assert.deepEqual(target(ctx), { slot: 1, client: 'codex' });
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(ctx.router.status().slots[0].error, false, 'scroll never flashes error');
});

test('fast spins coalesce into bounded calls while one is running', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  for (let i = 0; i < 30; i++) ctx.turn(45, 1);
  await settle();
  const total = ctx.adapter.scrolled.reduce((sum, [, n]) => sum + n, 0);
  assert.equal(total, -30, 'every notch arrives once');
  assert.ok(ctx.adapter.scrolled.every(([, n]) => Math.abs(n) <= 10), 'at most 10 notches per call');
  assert.ok(ctx.adapter.count('scrollClient') < 30, 'turns coalesce');
});

test('other encoder turns are inert', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  for (const control of [41, 42, 43, 44, 46]) { ctx.turn(control, 2); await settle(); }
  assert.equal(ctx.adapter.count('scrollClient'), 0);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('on a platform without an adapter every focus fails closed and nothing is typed', async t => {
  const clock = new ManualClock(1_700_000_000_000);
  const slots = await SlotStore.open(join(tempDir(t), 'slots.json'), { clock });
  const logs = [];
  const router = new TaskRouter({ adapter: createUnsupportedAdapter('linux'), lights: new FakeLights(), slots, profile: PROFILE, clock, log: e => logs.push(e) });
  t.after(() => router.close());
  router.start();
  router.handleFeed(view([codexTask(1), claudeTask(2)]));
  let sequence = 1;
  for (const control of [1, 2, WHEEL, RECORD]) {
    router.handleBridgeEvent({ type: 'input', at: clock.now(), epoch: 1, sequence: sequence++, control, kind: 'press', delta: 0, synthetic: false });
    await settle();
  }
  assert.deepEqual(logs.filter(l => l.type === 'focus-failed').map(l => l.reason), ['client-version-unknown', 'client-version-unknown']);
  assert.equal(router.status().target, null);
  assert.equal(logs.filter(l => l.type === 'sent').length, 0);
});

test('close releases held keys and stops timers', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  await ctx.router.close();
  assert.equal(ctx.adapter.held.size, 0);
  assert.equal(ctx.clock.pending, 0);
  await ctx.slots.flush();
});
