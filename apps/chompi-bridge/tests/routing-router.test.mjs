import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskRouter } from '../dist/routing/router.js';
import { createUnsupportedAdapter } from '../dist/windows/index.js';
import { SlotStore } from '../dist/routing/slots.js';
import { DEFAULT_PROFILE_PATH, validateProfile } from '../dist/routing/profile.js';
import { ManualClock } from '../dist/clock.js';
import { CLAUDE_PACKAGE, CODEX_PACKAGE, FakeAdapter, FakeLights, HELPER_FOCUS_SETTLE_MS, advance, claudeTask, codexTask, known, lid, onCleanup, settle, tempDir, tid, unknown, view } from './routing-helpers.mjs';

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
  onCleanup(t, () => router.close());
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

/** Slots whose focus verified, in order. A focus arms nothing: Send and Record never read it. */
const focused = ctx => ctx.logs.filter(l => l.type === 'focused').map(l => l.slot);

/** Puts `client` in front with its composer focused and no card, as a mouse click into a task would. */
function front(ctx, client) {
  ctx.adapter.foreground = client === 'codex' ? { packageIdentity: CODEX_PACKAGE, processName: 'ChatGPT.exe' } : { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.adapter.composer[client] = true;
}
const TERMINAL = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };

// Focus: Codex

test('a Codex key press opens the exact thread, verifies selection and composer, and types nothing else', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  await ctx.focus(2);
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(2)}`]);
  assert.deepEqual(focused(ctx), [2]);
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
  assert.deepEqual(focused(ctx), []);
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

test('matrix: a stale Hub feed with no cached slot opens nothing; with a cached slot the task still opens', async t => {
  const empty = await setup(t);
  empty.router.handleFeed({ status: 'unavailable', revision: null, snapshotVersion: null, sessions: [], reason: 'snapshot-http-503' });
  await empty.focus(1);
  assert.deepEqual(empty.adapter.opened, []);
  assert.equal(empty.failures().at(-1).reason, 'empty-slot');

  const cached = await setup(t, { sessions: [codexTask(1)] });
  cached.router.handleFeed(view([codexTask(1)], { status: 'stale' }));
  await cached.focus(1);
  assert.deepEqual(cached.adapter.opened, [`codex://threads/${tid(1)}`]);
  assert.deepEqual(focused(cached), [1]);
});

test('matrix: a session the Hub retires after idle keeps its slot, shows ended and still opens the same task', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  ctx.feed([codexTask(2)]);
  assert.equal(ctx.slots.get(1).taskId, tid(1));
  assert.equal(ctx.router.status().slots[0].state, 'ended');
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(1)}`]);
  assert.deepEqual(focused(ctx), [1]);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), []);
});

test('a Codex slot without a Hub title verifies by the name Codex keeps for the thread', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: undefined }), codexTask(2)] });
  ctx.adapter.codexNames.set(tid(1), 'Codex name 1');
  ctx.adapter.codexThreads.set(tid(1), 'Codex name 1');
  await ctx.focus(1);
  assert.deepEqual(focused(ctx), [1]);
  assert.ok(ctx.adapter.calls.some(c => c[0] === 'codexSelectedThread' && c[1] === tid(1) && c[2] === null));
  assert.ok(!JSON.stringify(ctx.logs).includes('Codex name 1'), 'logs never carry titles');
});

test('the Codex name takes precedence over a stale Hub title', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { title: 'Old Hub title' })] });
  ctx.adapter.codexNames.set(tid(1), 'Renamed in Codex');
  ctx.adapter.codexThreads.set(tid(1), 'Renamed in Codex');
  await ctx.focus(1);
  assert.deepEqual(focused(ctx), [1]);
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

test('failed composer readiness fails the focus', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.composerUnknown = true;
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).step, 'composer');
  assert.deepEqual(focused(ctx), []);
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }], 'the composer shortcut is sent once, never retried');
});

test('an adapter call that never answers times out and fails closed', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.hang.foregroundWindow = true;
  ctx.press(SLOT(1));
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + PROFILE.timing.adapterTimeoutMs + 200, 50);
  assert.equal(ctx.failures().at(-1).step, 'verify');
  assert.deepEqual(focused(ctx), []);
  assert.deepEqual(ctx.adapter.keys, []);
});

// Focus: Claude

test('a Claude key press opens the Desktop ID link and verifies by lastFocusedAt', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  await ctx.focus(2);
  assert.deepEqual(ctx.adapter.opened, [`claude://code/continue?session=${lid(2)}`]);
  assert.deepEqual(focused(ctx), [2]);
  assert.deepEqual(ctx.adapter.keys, [], 'Claude needs no composer shortcut');
  assert.equal(ctx.adapter.foreground.packageIdentity, CLAUDE_PACKAGE);
});

test('matrix: two live tasks with the same title still verify by ID in Claude', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1, { title: 'Same' }), claudeTask(2, { title: 'Same' })] });
  await ctx.focus(1);
  assert.deepEqual(focused(ctx), [1]);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), [1]);
  assert.equal(ctx.lastLog('focused').evidence, 'already-newest', 'the log names the evidence');
  assert.equal(ctx.adapter.claudeRecords.get(lid(1)).lastFocusedAt, focusedAt, 'Claude stamped nothing');
  assert.deepEqual(ctx.adapter.opened, [`claude://code/continue?session=${lid(1)}`], 'the link opens once');
  assert.deepEqual(ctx.adapter.keys, [], 'no keystroke is added');
  const open = callIndex(ctx, c => c[0] === 'openUri');
  assert.ok(callIndex(ctx, c => c[0] === 'foregroundWindow') < open, 'the foreground was read before the link');
  assert.ok(callIndex(ctx, c => c[0] === 'claudeSessions' && c[1].length === 2) < open, 'every known record was read before the link');
});

test('a press for another Claude session while Claude is in front still verifies by the advanced lastFocusedAt', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), claudeTask(2)] });
  claudeShowing(ctx, lid(2));
  const pressedAt = ctx.clock.now();
  await ctx.focus(1);
  assert.deepEqual(focused(ctx), [1]);
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
      assert.deepEqual(focused(ctx), [1], 'an advance still verifies');
      assert.equal(ctx.lastLog('focused').evidence, 'advanced');
    } else {
      assert.equal(ctx.failures().at(-1)?.reason, 'selection-mismatch', 'without an advance nothing verifies');
      assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), [1]);
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
    assert.deepEqual(focused(ctx), [], name);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), []);
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
  assert.deepEqual(focused(ctx), []);
  assert.deepEqual(ctx.adapter.keys, []);
});

test('matrix: an unqualified client version disables that client only', async t => {
  const ctx = await setup(t, { sessions: [claudeTask(1), codexTask(2)] });
  ctx.adapter.versions = { codex: known('26.930.3930.0'), claude: known('2.20000.0.0') };
  await ctx.focus(1);
  assert.equal(ctx.failures().at(-1).reason, 'client-unqualified');
  assert.deepEqual(ctx.adapter.opened, []);
  await ctx.focus(2);
  assert.equal(focused(ctx).at(-1), 2, 'Codex is unaffected');
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
  assert.equal(focused(ctx).at(-1), 1, 'Claude is unaffected');
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
  assert.deepEqual(focused(ctx), []);
  assert.equal(ctx.router.status().slots[0].error, true);
});

test('Send gates the client version in front at the press; Record has no gate', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  front(ctx, 'codex');
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: known('26.1001.0.0') };
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'client-unqualified');
  assert.equal(ctx.lastLog('send-refused').observedVersion, '26.1001.0.0', 'the log names the version to qualify');
  ctx.adapter.versions = { ...ctx.adapter.versions, codex: unknown('package not found') };
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'client-version-unknown');
  assert.equal(ctx.adapter.enters, 0);
  ctx.press(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, [{ action: 'down', keys: ['LeftControl', 'LeftWindows'] }], 'Record holds the chord like a keyboard shortcut');
});

// Task switch

test('a slot press while Record is held ends dictation; the next Send is evaluated at its own press', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1), codexTask(2)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 2);
  ctx.adapter.hang.codexArchived = true; // slot 2's check is still running when Send arrives
  ctx.press(SLOT(2));
  await settle();
  assert.equal(ctx.adapter.held.size, 0, 'the chord is released at once');
  assert.equal(ctx.router.status().dictating, false);
  ctx.release(RECORD);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1, 'Codex is still in front with its composer focused, so the fresh press sends');
  assert.equal(ctx.lastLog('sent').client, 'codex');
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
  assert.deepEqual(focused(ctx), [2]);
  assert.equal(ctx.failures().filter(f => f.slot === 1 && f.reason !== 'superseded').length, 0, 'the superseded attempt does not flash error');
});

test('a task key press never acknowledges, approves or dismisses anything', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] })] });
  await ctx.focus(1);
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['LeftAlt', 'L'] }]);
  assert.equal(ctx.router.status().slots[0].state, 'attention', 'attention remains');
  assert.equal(typeof ctx.router.acknowledge, 'undefined', 'the router has no Hub write path');
});

test('a focused key with pending attention keeps pulsing, shows no selection and the press reaches no Hub', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] })] });
  await ctx.focus(1);
  assert.deepEqual(focused(ctx), [1]);
  const seen = new Set();
  for (let i = 0; i < 4; i++) { seen.add(JSON.stringify(ctx.lights.last[0])); await advance(ctx.clock, PROFILE.timing.attentionPulseMs / 2, 50); }
  assert.ok(seen.has(JSON.stringify(PROFILE.colors.attention)), 'the attention color still shows on the focused key');
  assert.equal(seen.size, 2, 'it alternates between attention and its dimmed pulse only; no key marks a selection');
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
  assert.deepEqual(focused(ctx), []);
  const queried = new Set(ctx.adapter.calls.filter(c => c[0] === 'claudeSessions').flatMap(c => c[1]));
  assert.equal(queried.size, 80, 'every known Desktop ID was read');
});

// Send at the press

test('Send types one Enter into the Codex or Claude task in front with no slot press', async t => {
  for (const client of ['codex', 'claude']) {
    const ctx = await setup(t);
    front(ctx, client); // chosen with the mouse
    await ctx.click(PLAY);
    assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['Enter'] }], client);
    assert.deepEqual(ctx.lastLog('sent'), { type: 'sent', client }, client);
    assert.deepEqual(ctx.adapter.opened, [], 'nothing was opened');
    for (const name of ['foregroundWindow', 'clientVersions', 'composerFocused', 'approvalVisible']) assert.ok(ctx.adapter.count(name) >= 1, `${client}: ${name}`);
    for (const name of ['codexSelectedThread', 'claudeSessions']) assert.equal(ctx.adapter.count(name), 0, `${client}: Send identifies no task (${name})`);
    await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
    await ctx.click(WHEEL);
    assert.equal(ctx.adapter.enters, 2, `${client}: the wheel click sends too`);
  }
});

test('Send still acts on the window in front after a profile reload or Back', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.router.setProfile(withProfile({ brightnessPercent: 15 }));
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 1, 'a reload no longer leaves Send without a target');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(LOOP);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 2, 'Back no longer leaves Send without a target');
});

test('matrix: Send with another app in front types nothing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.foreground = { ...TERMINAL };
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'not-agent-client');
  ctx.adapter.foreground = { packageIdentity: null, processName: 'notepad.exe' };
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'not-agent-client');
  ctx.adapter.foregroundUnknown = true;
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'foreground-unknown');
  assert.equal(ctx.adapter.enters, 0);
  assert.equal(ctx.adapter.count('composerFocused'), 1, 'only the focus checked its composer; Send asked no other app');
});

test('matrix: Send refuses a missing or unknown composer', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  ctx.adapter.composer.claude = false;
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'composer-unfocused');
  ctx.adapter.composerUnknown = true;
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'composer-unknown');
  assert.equal(ctx.adapter.enters, 0);
});

test('matrix: a visible or unknown card refuses Send', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  ctx.adapter.approval.claude = known(true);
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'approval-visible');
  ctx.adapter.approval.claude = unknown('no UIA tree');
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'approval-unknown');
  assert.equal(ctx.adapter.enters, 0);
});

test('cut: Hub approval attention and a stale feed no longer block Send', async t => {
  // Owner decision on #821: the bridge's own card and composer checks are Send's only guards.
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] }), claudeTask(2, { attention: ['question', 'input'] })] });
  // Claude sorts first: slot 1 is the Claude task, slot 2 the Codex task with Hub approval attention.
  await ctx.focus(2);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1, 'Hub approval attention alone does not refuse');
  await ctx.focus(1);
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 2, 'question and input attention do not refuse either');
  ctx.router.handleFeed(view([codexTask(1)], { status: 'stale' }));
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 3, 'a stale feed does not refuse');
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
  assert.equal(ctx.adapter.enters, 2, 'a deliberate later Send works');
});

test('matrix: a wheel click and Play share one repeat window', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.click(WHEEL);
  await advance(ctx.clock, 200, 50);
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 1);
  assert.equal(ctx.lastLog('send-refused').reason, 'repeat');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(PLAY);
  assert.equal(ctx.adapter.enters, 2, 'Play sends after the window');
  const refusals = () => ctx.logs.filter(entry => entry.type === 'send-refused').length;
  const before = refusals();
  await advance(ctx.clock, 200, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 2, 'the wheel inside the window after Play types nothing');
  assert.equal(refusals(), before + 1);
  assert.equal(ctx.lastLog('send-refused').reason, 'repeat');
});

test('matrix: an uncertain Send is never retried; a later press is a new Send', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.reject.sendKeys = new Error('SendInput inserted 0 of 2 events');
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.count('sendKeys'), 1, 'one Enter attempt');
  assert.deepEqual(ctx.lastLog('send-uncertain'), { type: 'send-uncertain', client: 'codex', reason: 'rejected' });
  for (const index of [30, 31]) assert.deepEqual(ctx.lights.last[index], PROFILE.colors.error, 'the wheel LEDs flash the error color');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs * 3, 100);
  assert.equal(ctx.adapter.count('sendKeys'), 1, 'nothing retries it');
  delete ctx.adapter.reject.sendKeys;
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1, 'a fresh press after the window is a new Send');
});

test('a Send keystroke that never returns is uncertain, not retried', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  ctx.adapter.hang.sendKeys = true;
  ctx.press(PLAY);
  await advance(ctx.clock, PROFILE.timing.adapterTimeoutMs + 100, 50);
  assert.equal(ctx.lastLog('send-uncertain').reason, 'timeout');
  assert.equal(ctx.adapter.count('sendKeys'), 1);
});

test('small-knob clicks, the volume click and encoder turns never send', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  for (const control of [29, 30, 31, 32, 34]) await ctx.click(control);
  for (const control of [41, 42, 43, 44, 45, 46]) { ctx.turn(control, 3); ctx.turn(control, -2); await settle(); }
  assert.equal(ctx.adapter.enters, 0);
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
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.press(RECORD);
  await settle();
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'dictating');
  assert.equal(ctx.adapter.enters, 0);
});

// Record

test('Record holds the Wispr chord with any app in front, and its release never sends', async t => {
  const ctx = await setup(t);
  ctx.adapter.foreground = { ...TERMINAL };
  ctx.press(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, [{ action: 'down', keys: ['LeftControl', 'LeftWindows'] }]);
  assert.equal(ctx.router.status().dictating, true);
  assert.deepEqual(ctx.lastLog('dictation-started'), { type: 'dictation-started' });
  ctx.release(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys.at(-1), { action: 'up', keys: ['LeftControl', 'LeftWindows'] });
  assert.equal(ctx.adapter.enters, 0, 'release never sends');
  assert.equal(ctx.adapter.held.size, 0);
  for (const name of ['foregroundWindow', 'composerFocused', 'approvalVisible', 'cardButtons', 'clientVersions']) assert.equal(ctx.adapter.count(name), 0, `Record checks nothing (${name})`);
});

test('cut: Record holds the chord while a card is open or the composer has no focus', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  ctx.adapter.openCard('claude', 4);
  ctx.adapter.composer.claude = false;
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 2, 'dictation into a card field is allowed');
  ctx.release(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 0);
});

test('Record pressed and released at once still releases the chord', async t => {
  const ctx = await setup(t);
  ctx.press(RECORD);
  ctx.release(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 0);
  assert.equal(ctx.adapter.enters, 0);
});

test('Record during a Send check presses the chord at once and abandons that Send', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.hang.approvalVisible = true;
  ctx.press(PLAY);
  await settle();
  ctx.press(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, [{ action: 'down', keys: ['LeftControl', 'LeftWindows'] }], 'Record has no checks and is never refused');
  await advance(ctx.clock, PROFILE.timing.adapterTimeoutMs + 100, 50);
  assert.equal(ctx.lastLog('send-refused').reason, 'superseded');
  assert.equal(ctx.adapter.enters, 0);
  assert.equal(ctx.logs.filter(l => l.type === 'record-refused').length, 0);
});

test('Record during the Enter keystroke presses the chord right after it, so no modifier joins the Enter', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  let finishEnter;
  const realSend = ctx.adapter.sendKeys.bind(ctx.adapter);
  ctx.adapter.sendKeys = async request => {
    if (request.keys.includes('Enter')) await new Promise(resolve => { finishEnter = resolve; });
    return realSend(request);
  };
  ctx.press(PLAY);
  await settle();
  assert.equal(typeof finishEnter, 'function', 'the Enter keystroke is in flight');
  ctx.press(RECORD);
  await settle();
  assert.deepEqual(ctx.adapter.keys, [], 'the chord waits for the keystroke');
  finishEnter();
  await settle();
  assert.deepEqual(ctx.adapter.keys, [{ action: 'tap', keys: ['Enter'] }, { action: 'down', keys: ['LeftControl', 'LeftWindows'] }]);
  assert.equal(ctx.lastLog('sent').client, 'codex', 'the Send was already typing and completes');
  ctx.release(RECORD);
  await settle();
  assert.equal(ctx.adapter.held.size, 0);

  const early = await setup(t);
  front(early, 'codex');
  const realEarly = early.adapter.sendKeys.bind(early.adapter);
  let finishEarly;
  early.adapter.sendKeys = async request => {
    if (request.keys.includes('Enter')) await new Promise(resolve => { finishEarly = resolve; });
    return realEarly(request);
  };
  early.press(PLAY);
  await settle();
  early.press(RECORD);
  early.release(RECORD);
  finishEarly();
  await settle();
  assert.deepEqual(early.adapter.keys, [{ action: 'tap', keys: ['Enter'] }], 'a Record released before the keystroke ends presses nothing');
});

test('a chord that fails to go down releases every key', async t => {
  const ctx = await setup(t);
  ctx.adapter.reject.sendKeys = new Error('SendInput inserted 0 of 2 events');
  const releases = ctx.adapter.count('releaseAll');
  ctx.press(RECORD);
  await settle();
  assert.equal(ctx.lastLog('record-refused').reason, 'dictation-keys-failed');
  assert.ok(ctx.adapter.count('releaseAll') > releases);
  assert.equal(ctx.router.status().dictating, false);
});

test('matrix: a disconnect during a Record hold releases modifiers and replays nothing; a fresh press after reconnect is new', async t => {
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
  ctx.bridge('connected', { firmware: [0, 1, 0] });
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  assert.equal(ctx.adapter.enters, 0, 'the reconnect itself types nothing');
  assert.equal(ctx.adapter.held.size, 0, 'and presses no chord');
  assert.equal(ctx.slots.get(1).taskId, tid(1), 'slots are retained');
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1, 'a click after the reconnect is a new press, evaluated against the window in front');
});

for (const [name, events] of [
  ['session-restart', [['session-restart', { cause: 'same-epoch-hello' }]]],
  ['stale', [['stale', {}], ['recovered', {}]]],
]) {
  test(`a bridge ${name} releases held keys and replays nothing`, async t => {
    const ctx = await setup(t, { sessions: [codexTask(1)] });
    await ctx.focus(1);
    ctx.press(RECORD);
    await settle();
    ctx.synthetic(RECORD, name);
    for (const [type, extra] of events) ctx.bridge(type, extra);
    await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
    assert.equal(ctx.adapter.held.size, 0);
    assert.equal(ctx.adapter.enters, 0, 'nothing typed without a fresh press');
  });
}

test('matrix: a bridge restart keeps slots and replays nothing', async t => {
  const dir = tempDir(t);
  const first = await setup(t, { sessions: [codexTask(1), claudeTask(2)], dir });
  await first.focus(1);
  await first.router.close();
  const second = await setup(t, { dir });
  assert.deepEqual(second.slots.entries().map(r => [r.slot, r.taskId]), [[1, lid(2)], [2, tid(1)]]);
  await advance(second.clock, 500, 100);
  assert.deepEqual(second.adapter.opened, []);
  assert.deepEqual(second.adapter.keys, []);
  await second.click(WHEEL);
  assert.equal(second.adapter.enters, 0);
  assert.equal(second.lastLog('send-refused').reason, 'not-agent-client', 'a fresh press is evaluated against the window in front');
});

// Profile reload

test('a profile reload ends dictation, releases held keys, applies brightness and replays nothing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.press(RECORD);
  await settle();
  const opened = ctx.adapter.opened.length;
  ctx.router.setProfile(withProfile({ brightnessPercent: 15 }));
  await settle();
  assert.equal(ctx.adapter.held.size, 0);
  assert.equal(ctx.router.status().dictating, false);
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

test('Back alone ends dictation, releases keys and cancels a focus in progress', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.appsFollowLinks = false;
  ctx.press(SLOT(1));
  await advance(ctx.clock, 300, 50);
  ctx.release(SLOT(1));
  ctx.press(RECORD);
  await settle();
  await ctx.click(LOOP);
  assert.equal(ctx.adapter.held.size, 0);
  assert.ok(ctx.adapter.count('releaseAll') >= 1);
  assert.equal(ctx.router.status().focusing, null);
  assert.equal(ctx.lastLog('invalidated').reason, 'back');
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200, 50);
  assert.equal(ctx.failures().length, 0, 'the cancelled focus reports nothing');
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

test('the router lights slots from feed state only and pulses attention; the wheel LEDs stay off', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { activity: 'active' }), codexTask(2, { attention: ['approval'] })] });
  await settle();
  const frame = ctx.lights.last;
  assert.deepEqual(frame[0], PROFILE.colors.active);
  assert.deepEqual(frame[1], PROFILE.colors.attention);
  await advance(ctx.clock, PROFILE.timing.attentionPulseMs / 2 + 50, 50);
  assert.notDeepEqual(ctx.lights.last[1], PROFILE.colors.attention, 'attention pulses');
  await ctx.focus(1);
  assert.deepEqual(ctx.lights.last[0], PROFILE.colors.active, 'a focused key still shows its task state, not a selection');
  for (const index of [30, 31]) assert.deepEqual(ctx.lights.last[index], [0, 0, 0], 'no Send-readiness light');
  ctx.adapter.openCard('codex', 2, 1);
  ctx.turn(45, 6);
  await settle();
  for (const index of [30, 31]) assert.deepEqual(ctx.lights.last[index], [0, 0, 0], 'no card-mode light');
  ctx.router.handleFeed(view([], { status: 'stale' }));
  await settle();
  assert.deepEqual(ctx.lights.last[1], PROFILE.colors.stale, 'a stale feed is never shown as current state');
  assert.equal(ctx.lights.brightness[0], PROFILE.brightnessPercent);
  assert.deepEqual(ctx.router.status().slots[1].state, 'stale');
  assert.equal('selected' in ctx.router.status().slots[0], false);
});

test('overflow is reported without moving existing slots', async t => {
  const sessions = Array.from({ length: 16 }, (_, i) => codexTask(i + 1));
  const ctx = await setup(t, { sessions });
  assert.equal(ctx.router.status().overflow, 1);
  assert.equal(ctx.lastLog('overflow').count, 1);
  assert.equal(ctx.slots.get(15).taskId, tid(15));
});

// Scroll

test('the big wheel scrolls the foreground client conversation without typing', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.turn(45, 2);
  await settle();
  ctx.turn(45, -1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['codex', -2], ['codex', 1]], 'clockwise scrolls down; positive notches scroll up');
  assert.deepEqual(ctx.adapter.keys, []);
  assert.equal(ctx.adapter.count('openUri'), 1, 'scroll never selects a task');
  assert.equal(ctx.adapter.count('cardButtons'), 1, 'one card observation serves turns within its reuse time');
});

test('scroll steps and direction come from the profile', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)], profile: withProfile({ scroll: { notchesPerStep: 3, invert: true } }) });
  await ctx.focus(1);
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['codex', 3]]);
});

test('the wheel scrolls the foreground Desktop client, and nothing else', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  ctx.adapter.foreground = { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['claude', -1]]);
  ctx.adapter.foreground = { ...TERMINAL };
  ctx.turn(45, 1);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1, 'another app in front gets no wheel input');
  ctx.adapter.foregroundUnknown = true;
  ctx.turn(45, 1);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1);
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

test('an unknown or false scroll result is not retried', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1)] });
  await ctx.focus(1);
  ctx.adapter.keys.length = 0;
  ctx.adapter.scrollUnknown = true;
  ctx.turn(45, 3);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 1, 'no retry');
  assert.equal(ctx.lastLog('scroll-unknown').client, 'codex');
  ctx.adapter.scrollUnknown = false;
  ctx.adapter.scrollAnswer = known(false); // the pointer is outside the window
  ctx.turn(45, 25);
  await settle();
  assert.equal(ctx.adapter.count('scrollClient'), 2, 'a false answer drops the rest of the turn');
  assert.deepEqual(ctx.adapter.scrolled, []);
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
  assert.equal(ctx.adapter.count('cardButtons'), 0);
  assert.deepEqual(ctx.adapter.keys, []);
});

// Big-wheel card answers

const STEP = PROFILE.cards.stepCounts;
const STILL = PROFILE.cards.clickStillMs;
/** Claude in front with an open card whose composer kept focus, as the qualified client shows one. */
async function claudeCard(t, buttons = 3, focusedIndex = null, options = {}) {
  const ctx = await setup(t, options);
  front(ctx, 'claude');
  ctx.adapter.openCard('claude', buttons, focusedIndex);
  return ctx;
}

test('the default card detent is about a quarter turn at the measured 25 counts and the stillness 250 ms', () => {
  assert.equal(STEP, 6);
  assert.equal(STILL, 250);
});

test('card: turns step focus one button per threshold, starting from the first', async t => {
  const ctx = await claudeCard(t);
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0]], 'the first clockwise step focuses the first button');
  ctx.turn(45, STEP - 1);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0]], 'less than a step moves nothing');
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0], ['claude', 1]], 'the remainder adds up');
  ctx.turn(45, 3 * STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused.at(-1), ['claude', 2], 'steps stop at the last button');
  assert.deepEqual(ctx.adapter.scrolled, [], 'nothing scrolls on a card');
  assert.equal(ctx.adapter.enters, 0);
  assert.deepEqual(ctx.adapter.cardPressed, []);
});

test('card: the first counter-clockwise step focuses the last button', async t => {
  const ctx = await claudeCard(t, 4);
  ctx.turn(45, -STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 3]]);
});

test('card: a direction reversal restarts the count, so a small wiggle back never steps back', async t => {
  const ctx = await claudeCard(t, 3, 1);
  ctx.turn(45, STEP - 1);
  ctx.turn(45, -(STEP - 1));
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'the reversal discards the forward progress and steps nowhere');
  ctx.turn(45, 2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'reversing again restarts again');
  ctx.turn(45, STEP - 2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 2]]);
  ctx.turn(45, -2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 2]], 'a small turn back after a step does not step back');
  ctx.turn(45, -(STEP - 2));
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused.at(-1), ['claude', 1], 'a full step back does');
});

test('card: a still wheel click presses the focused button once and types nothing', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.turn(45, STEP);
  ctx.turn(45, STEP);
  await settle();
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['claude', 1]]);
  assert.deepEqual(ctx.lastLog('card-pressed'), { type: 'card-pressed', client: 'claude', index: 1, count: 3 });
  assert.equal(ctx.adapter.enters, 0, 'a card press is not a Send');
  assert.deepEqual(ctx.adapter.keys, []);
  ctx.adapter.openCard('claude', 3, 0); // the next question
  await advance(ctx.clock, 200, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.cardPressed.length, 1, 'the repeat window covers card presses');
  assert.equal(ctx.lastLog('send-refused').reason, 'repeat');
});

test('card: a click within the stillness time, or with nothing focused, presses nothing', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.turn(45, STEP);
  await settle();
  await advance(ctx.clock, STILL - 100, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-wheel-moving');
  const idle = await claudeCard(t, 3);
  await idle.click(WHEEL);
  assert.equal(idle.lastLog('card-refused').reason, 'card-nothing-focused');
  for (const c of [ctx, idle]) {
    assert.deepEqual(c.adapter.cardPressed, []);
    assert.equal(c.adapter.enters, 0, 'a refused card click never falls through to Send');
  }
});

test('card: rotation while the click is held is discarded, and the press clears partial rotation', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.turn(45, STEP - 1);
  await advance(ctx.clock, STILL, 50);
  ctx.press(WHEEL);
  await settle();
  assert.equal(ctx.lastLog('card-refused').reason, 'card-nothing-focused');
  ctx.turn(45, 2 * STEP);
  await settle();
  ctx.release(WHEEL);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'turns during the click move nothing');
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'the partial turn before the press was cleared');
  ctx.turn(45, STEP - 1);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0]]);
});

test('card: a click while a step is in flight presses nothing', async t => {
  const ctx = await claudeCard(t, 3, 0);
  ctx.adapter.hang.focusCardButton = true;
  ctx.turn(45, STEP);
  await advance(ctx.clock, STILL + 50, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-busy');
  assert.deepEqual(ctx.adapter.cardPressed, []);
});

test('card: Play never presses a card button and is refused', async t => {
  const ctx = await claudeCard(t, 3, 0);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'approval-visible');
  assert.equal(ctx.adapter.count('invokeCardButton'), 0);
  assert.equal(ctx.adapter.enters, 0);
  const codex = await setup(t);
  front(codex, 'codex');
  codex.adapter.openCard('codex', 2, 1);
  await advance(codex.clock, STILL, 50);
  await codex.click(PLAY);
  assert.equal(codex.lastLog('send-refused').reason, 'composer-unfocused', 'focus is on a Codex card button, not the composer');
  assert.equal(codex.adapter.count('invokeCardButton'), 0);
  assert.equal(codex.adapter.enters, 0);
});

test('card: a Codex card starts on its focused button; the wheel reaches Deny and a still click presses it', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, 1);
  ctx.turn(45, -STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['codex', 0]]);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['codex', 0]]);
  assert.equal(ctx.adapter.enters, 0);
});

test('card: when the card closes the wheel scrolls again and its click sends', async t => {
  const ctx = await claudeCard(t, 2);
  ctx.turn(45, STEP);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['claude', 0]]);
  ctx.turn(45, 1);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['claude', -1]], 'the click read the card afresh and dropped it');
  ctx.adapter.openCard('claude', 2, 0);
  await advance(ctx.clock, 600, 100);
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0], ['claude', 1]], 'a new card turns the wheel back into card navigation');
  ctx.adapter.closeCard('claude'); // closed with the mouse
  await advance(ctx.clock, 600, 100);
  ctx.turn(45, 2);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled.at(-1), ['claude', -2], 'after the reuse time the wheel scrolls again');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.adapter.enters, 1);
});

test('card: an unknown card state or Codex container makes the wheel inert', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, 1);
  ctx.adapter.cards.codex = 'unknown'; // no composer, and focus is not on a button the container rule accepts
  ctx.turn(45, 3 * STEP);
  await settle();
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'card-unknown');
  assert.equal(ctx.adapter.count('scrollClient'), 0, 'nothing scrolls');
  assert.equal(ctx.adapter.count('focusCardButton') + ctx.adapter.count('invokeCardButton'), 0, 'nothing is focused or pressed');
  assert.equal(ctx.adapter.enters, 0, 'nothing is typed');
  assert.equal(ctx.lastLog('card-unknown').client, 'codex');

  const claude = await setup(t);
  front(claude, 'claude');
  claude.adapter.hang.cardButtons = true;
  claude.turn(45, STEP);
  await advance(claude.clock, PROFILE.timing.adapterTimeoutMs + 100, 50);
  assert.equal(claude.adapter.count('scrollClient'), 0, 'a timed-out card read scrolls nothing');
});

test('card: a press that fails or finds focus moved is never retried', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.turn(45, 3 * STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 2]]);
  ctx.adapter.reject.invokeCardButton = new Error('UIA invoke failed');
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.lastLog('card-press-uncertain'), { type: 'card-press-uncertain', client: 'claude', reason: 'rejected' });
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs * 3, 100);
  assert.equal(ctx.adapter.count('invokeCardButton'), 1);
  delete ctx.adapter.reject.invokeCardButton;
  ctx.adapter.invokeCardButton = async (...args) => { ctx.adapter.calls.push(['invokeCardButton', ...args]); return known(false); };
  ctx.turn(45, -STEP); // the failed press used up the choice; step again
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-focus-moved');
  assert.equal(ctx.adapter.count('invokeCardButton'), 2);
  assert.equal(ctx.adapter.enters, 0);
});

test('card: an unqualified client never navigates cards; its wheel scrolls', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.adapter.versions = { ...ctx.adapter.versions, claude: known('2.20000.0.0') };
  ctx.turn(45, STEP);
  await settle();
  assert.equal(ctx.adapter.count('cardButtons'), 0);
  assert.deepEqual(ctx.adapter.scrolled, [['claude', -STEP]]);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'client-unqualified');
  assert.equal(ctx.adapter.count('invokeCardButton'), 0);
});

test('card: steps follow the profile threshold and stillness', async t => {
  const ctx = await claudeCard(t, 3, null, { profile: withProfile({ cards: { stepCounts: 2, clickStillMs: 600 } }) });
  ctx.turn(45, 2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0]]);
  await advance(ctx.clock, 400, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-wheel-moving');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['claude', 0]]);
});

test('card: a click presses only a button the wheel itself moved to on this card', async t => {
  // Owner decision on #821: a Codex card opens with its approve button focused, and a click without a turn must not
  // approve it.
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, 1);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-nothing-chosen');
  assert.deepEqual(ctx.adapter.cardPressed, [], 'the focused approve button is not pressed');
  assert.equal(ctx.adapter.enters, 0);
  ctx.turn(45, -STEP);
  await settle();
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['codex', 0], ['codex', 1]]);
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['codex', 1]], 'after a deliberate step back to it, it is');

  const moved = await claudeCard(t, 3);
  moved.turn(45, STEP);
  await settle();
  moved.adapter.cards.claude.focused = 2; // the mouse moved focus within the card after the step
  await advance(moved.clock, STILL, 50);
  await moved.click(WHEEL);
  assert.equal(moved.lastLog('card-refused').reason, 'card-nothing-chosen');
  assert.deepEqual(moved.adapter.cardPressed, []);

  const reopened = await claudeCard(t, 2);
  reopened.turn(45, STEP);
  await settle();
  reopened.adapter.closeCard('claude'); // answered with the mouse; the wheel never sees it close
  reopened.adapter.openCard('claude', 2, 0); // a new card with the same buttons, focused on the same index by the client
  await advance(reopened.clock, 600, 100);
  await reopened.click(WHEEL);
  assert.equal(reopened.lastLog('card-refused').reason, 'card-nothing-chosen', 'a choice never carries to another card');
  assert.deepEqual(reopened.adapter.cardPressed, []);
});

test('card: a clamped step chooses nothing; approving a card that opens on its last stop needs a turn away and back', async t => {
  // Owner decision on #821 (issuecomment-6003766052): approval comes from a click on a stop the wheel visibly moved
  // to, never from a turn that could not move the focus.
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, 1); // approve is the last stop and opens focused
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'focus is already on the last stop; nothing moves and no adapter call is made');
  assert.equal(ctx.adapter.count('focusCardButton'), 0);
  assert.deepEqual(ctx.lastLog('card-step'), { type: 'card-step', client: 'codex', index: 1, count: 2 });
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-nothing-chosen');
  assert.deepEqual(ctx.adapter.cardPressed, [], 'the clamped step approved nothing');
  ctx.turn(45, -STEP);
  await settle();
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['codex', 0], ['codex', 1]], 'away to Deny and back to approve');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['codex', 1]], 'a still click after the real move presses approve once');
  assert.equal(ctx.adapter.enters, 0);

  const kept = await claudeCard(t, 2);
  kept.turn(45, 2 * STEP);
  await settle();
  assert.deepEqual(kept.adapter.cardFocused, [['claude', 1]], 'a real move onto the last stop');
  kept.turn(45, STEP);
  await settle();
  assert.deepEqual(kept.adapter.cardFocused, [['claude', 1]], 'a further clamped step calls nothing');
  await advance(kept.clock, STILL, 50);
  await kept.click(WHEEL);
  assert.deepEqual(kept.adapter.cardPressed, [['claude', 1]], 'the clamped step left the earlier choice from the real move');
});

test('Record pressed and released during a Send check abandons that Send', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  let answer;
  ctx.adapter.approvalVisible = async client => { ctx.adapter.calls.push(['approvalVisible', client]); return new Promise(resolve => { answer = resolve; }); };
  ctx.press(PLAY);
  await settle();
  ctx.press(RECORD);
  await settle();
  ctx.release(RECORD);
  await settle();
  answer(known(false));
  await settle();
  assert.equal(ctx.lastLog('send-refused').reason, 'superseded');
  assert.equal(ctx.adapter.enters, 0, 'the quick tap still abandons the Send');
  assert.deepEqual(ctx.adapter.keys, [{ action: 'down', keys: ['LeftControl', 'LeftWindows'] }, { action: 'up', keys: ['LeftControl', 'LeftWindows'] }]);
});

test('a repeat bounce or a Send abandoned for Record does not flash the wheel LEDs', async t => {
  const ctx = await setup(t);
  const wheel = () => [ctx.lights.last[30], ctx.lights.last[31]];
  const off = [[0, 0, 0], [0, 0, 0]];
  front(ctx, 'codex');
  await ctx.click(WHEEL);
  await advance(ctx.clock, 200, 50);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('send-refused').reason, 'repeat');
  assert.deepEqual(wheel(), off, 'a bounce right after a Send is not shown as a failure');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  ctx.adapter.hang.approvalVisible = true;
  ctx.press(PLAY);
  await settle();
  ctx.press(RECORD);
  await advance(ctx.clock, PROFILE.timing.adapterTimeoutMs + 100, 50);
  assert.equal(ctx.lastLog('send-refused').reason, 'superseded');
  assert.deepEqual(wheel(), off, 'Record was pressed on purpose');
  ctx.release(RECORD);
  delete ctx.adapter.hang.approvalVisible;
  ctx.adapter.composer.codex = false;
  await ctx.click(PLAY);
  assert.equal(ctx.lastLog('send-refused').reason, 'composer-unfocused');
  assert.deepEqual(wheel(), [PROFILE.colors.error, PROFILE.colors.error], 'other refusals still flash');
});

test('card: focus that Claude applies within the helper\'s read-back poll is chosen; later focus is not', async t => {
  // Live check on 2026-10-05: Claude reported no focus right after SetFocus and the requested button 300 ms later.
  const ctx = await claudeCard(t, 3);
  ctx.adapter.focusLagMs = 300; // within the helper's read-back: the reply names the requested index
  ctx.turn(45, STEP);
  await advance(ctx.clock, 300, 25);
  assert.deepEqual(ctx.lastLog('card-step'), { type: 'card-step', client: 'claude', index: 0, count: 3 });
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['claude', 0]]);

  const late = await claudeCard(t, 3);
  late.adapter.focusLagMs = HELPER_FOCUS_SETTLE_MS + 200; // past the read-back: the reply says no button has focus
  late.turn(45, STEP);
  await advance(late.clock, HELPER_FOCUS_SETTLE_MS, 25);
  assert.deepEqual(late.lastLog('card-step'), { type: 'card-step', client: 'claude', index: null, count: 3 });
  await advance(late.clock, 300, 50);
  assert.equal(late.adapter.cards.claude.focused, 0, 'focus landed after the reply');
  await late.click(WHEEL);
  assert.equal(late.lastLog('card-refused').reason, 'card-nothing-chosen', 'a choice is recorded only when the reply names the requested button');
  assert.deepEqual(late.adapter.cardPressed, []);
});

test('card: a still click during a lagging focus read-back is refused and presses nothing', async t => {
  const ctx = await claudeCard(t, 3);
  ctx.adapter.focusLagMs = STILL + 100; // the read-back is still running when the wheel has been still long enough
  ctx.turn(45, STEP);
  await advance(ctx.clock, STILL + 25, 25);
  assert.equal(ctx.lastLog('card-step'), undefined, 'the step is still in flight');
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-busy');
  assert.deepEqual(ctx.adapter.cardPressed, []);
  assert.equal(ctx.adapter.enters, 0);
  await advance(ctx.clock, 200, 25);
  assert.deepEqual(ctx.lastLog('card-step'), { type: 'card-step', client: 'claude', index: 0, count: 3 }, 'the step completes afterwards');
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['claude', 0]], 'a later still click presses the chosen option');
});

test('card: a Codex card with nothing focused: one clockwise step focuses Deny and a still click presses it', async t => {
  // Live check on 2026-10-05: Codex gave its escalation card no keyboard focus.
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, null);
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['codex', 0]], 'the first stop, Deny');
  await advance(ctx.clock, STILL, 50);
  await ctx.click(WHEEL);
  assert.deepEqual(ctx.adapter.cardPressed, [['codex', 0]]);
  assert.equal(ctx.adapter.enters, 0);

  const approve = await setup(t);
  front(approve, 'codex');
  approve.adapter.openCard('codex', 2, null);
  approve.turn(45, -STEP);
  await settle();
  assert.deepEqual(approve.adapter.cardFocused, [['codex', 1]], 'a counter-clockwise step focuses the last stop, approve');
});

test('card: a Codex card stays usable while focus rests on a button outside it, such as the sidebar row', async t => {
  // The adapter reports the card with no stop focused (focused: null) wherever focus is outside its stops.
  const ctx = await setup(t);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2, null);
  ctx.turn(45, STEP);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['codex', 0]], 'one clockwise step focuses Deny');
  assert.equal(ctx.logs.filter(l => l.type === 'card-unknown').length, 0, 'the card was never unknown');
});

test('scroll counts never shorten the first card step', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  ctx.turn(45, STEP - 2);
  await settle();
  assert.deepEqual(ctx.adapter.scrolled, [['claude', -(STEP - 2)]]);
  ctx.adapter.openCard('claude', 3);
  await advance(ctx.clock, 600, 100);
  ctx.turn(45, 2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [], 'the earlier scroll counts were dropped');
  ctx.turn(45, STEP - 2);
  await settle();
  assert.deepEqual(ctx.adapter.cardFocused, [['claude', 0]], 'a full step of turns made on the card');
});

test('a refused or uncertain Send or card press flashes the wheel LEDs red for the error flash time', async t => {
  const ctx = await setup(t);
  const wheel = () => [ctx.lights.last[30], ctx.lights.last[31]];
  const off = [[0, 0, 0], [0, 0, 0]];
  const red = [PROFILE.colors.error, PROFILE.colors.error];
  ctx.adapter.foreground = { ...TERMINAL };
  await ctx.click(PLAY);
  assert.deepEqual(wheel(), red, 'a refused Send');
  await advance(ctx.clock, PROFILE.timing.errorFlashMs + 100, 100);
  assert.deepEqual(wheel(), off, 'the flash ends on the render tick; nothing polls the desktop');
  front(ctx, 'codex');
  await ctx.click(PLAY);
  assert.deepEqual(wheel(), off, 'a Send that types its Enter does not flash');
  ctx.adapter.openCard('codex', 2, 1);
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs, 100);
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-refused').reason, 'card-nothing-chosen');
  assert.deepEqual(wheel(), red, 'a refused card press');
  await advance(ctx.clock, PROFILE.timing.errorFlashMs + 100, 100);
  ctx.turn(45, -STEP);
  await advance(ctx.clock, STILL, 50);
  ctx.adapter.reject.invokeCardButton = new Error('UIA invoke failed');
  await ctx.click(WHEEL);
  assert.equal(ctx.lastLog('card-press-uncertain').reason, 'rejected');
  assert.deepEqual(wheel(), red, 'an uncertain card press');
  assert.equal(ctx.adapter.enters, 1);
});

// Task pages (#822)

const KNOB4 = 43, KNOB4_CLICK = 31, PAGE_LED = 29;
const PAGE_STEP = PROFILE.pages.stepCounts;
const codexMany = (n, from = 1, options = {}) => Array.from({ length: n }, (_, i) => codexTask(from + i, options));
const page = ctx => ctx.router.status().page;

test('pages: the default profile has 4 pages stepped like big-wheel card steps', () => {
  assert.equal(PROFILE.pages.count, 4);
  assert.equal(PAGE_STEP, PROFILE.cards.stepCounts);
  assert.equal(PROFILE.colors.pages.length, 8);
});

test('pages: knob 4 changes the visible page one page per detent, ignoring light touches and stopping at the ends', async t => {
  const ctx = await setup(t, { sessions: codexMany(20) });
  assert.equal(page(ctx), 1, 'the bridge starts on page 1');
  ctx.turn(KNOB4, PAGE_STEP - 1);
  assert.equal(page(ctx), 1, 'a light touch moves nothing');
  ctx.turn(KNOB4, 1);
  assert.equal(page(ctx), 2);
  assert.deepEqual(ctx.lastLog('page'), { type: 'page', page: 2, pages: 4 });
  ctx.turn(KNOB4, PAGE_STEP - 1);
  ctx.turn(KNOB4, -(PAGE_STEP - 1));
  assert.equal(page(ctx), 2, 'a reversal restarts the count, so a wiggle never pages');
  ctx.turn(KNOB4, 10 * PAGE_STEP);
  assert.equal(page(ctx), 4, 'paging stops at the last page');
  ctx.turn(KNOB4, -10 * PAGE_STEP);
  assert.equal(page(ctx), 1, 'and at the first');
});

test('pages: paging is never input: no keystroke, link, focus, adapter call or acknowledgement', async t => {
  const ctx = await setup(t, { sessions: codexMany(20, 1, { attention: ['approval'] }) });
  front(ctx, 'codex');
  const calls = ctx.adapter.calls.length;
  for (let i = 0; i < 3; i++) { ctx.turn(KNOB4, PAGE_STEP); ctx.turn(KNOB4, -PAGE_STEP); }
  await ctx.click(KNOB4_CLICK);
  await settle();
  assert.equal(ctx.adapter.calls.length, calls, 'paging asks the desktop nothing');
  assert.deepEqual(ctx.adapter.keys, []);
  assert.deepEqual(ctx.adapter.opened, []);
  assert.equal(ctx.router.status().slots[0].state, 'attention', 'attention stays');
  assert.equal(typeof ctx.router.acknowledge, 'undefined');
});

test('pages: slot keys act on the visible page', async t => {
  const ctx = await setup(t, { sessions: codexMany(20) });
  ctx.turn(KNOB4, PAGE_STEP);
  await ctx.focus(2);
  assert.deepEqual(ctx.adapter.opened, [`codex://threads/${tid(17)}`], 'key 2 on page 2 is slot 17');
  assert.deepEqual(focused(ctx), [17]);
  assert.equal(ctx.router.status().slots[1].slot, 17);
});

test('pages: the Claude release gesture frees a slot on page 2', async t => {
  const ctx = await setup(t, { sessions: Array.from({ length: 17 }, (_, i) => claudeTask(i + 1)) });
  ctx.turn(KNOB4, PAGE_STEP);
  ctx.press(SLOT(2));
  await advance(ctx.clock, PROFILE.timing.releaseHoldMs + 50, 50);
  ctx.press(LOOP);
  await settle();
  assert.equal(ctx.slots.get(17), undefined);
  assert.deepEqual([ctx.lastLog('slot-released').slot, ctx.lastLog('slot-released').reason], [17, 'release-gesture']);
  assert.equal(ctx.slots.get(2).taskId, lid(2), 'page 1 is untouched');
});

test('pages: overflow is reported only when every page is full', async t => {
  const full = await setup(t, { sessions: codexMany(60) });
  assert.equal(full.router.status().overflow, 0);
  assert.equal(full.lastLog('overflow'), undefined);
  const over = await setup(t, { sessions: codexMany(61) });
  assert.equal(over.router.status().overflow, 1);
  assert.equal(over.lastLog('overflow').count, 1);
});

test('pages: keys show the visible page; knob 4\'s LED shows the page color and pulses for attention on a hidden page', async t => {
  const ctx = await setup(t, { sessions: [codexTask(1, { attention: ['approval'] }), ...codexMany(19, 2)] });
  const pulses = async () => {
    const seen = new Set();
    for (let i = 0; i < 4; i++) { seen.add(JSON.stringify(ctx.lights.last[PAGE_LED])); await advance(ctx.clock, PROFILE.timing.attentionPulseMs / 2, 50); }
    return seen;
  };
  assert.deepEqual([...await pulses()], [JSON.stringify(PROFILE.colors.pages[0])], 'page 1 in its color; the attention task is visible, so no pulse');
  ctx.turn(KNOB4, PAGE_STEP);
  await settle();
  for (let i = 0; i < 5; i++) assert.deepEqual(ctx.lights.last[i], PROFILE.colors.idle, `key ${i + 1} shows slot ${16 + i}`);
  for (let i = 5; i < 15; i++) assert.deepEqual(ctx.lights.last[i], [0, 0, 0], `key ${i + 1} is an empty slot and stays off`);
  const seen = await pulses();
  assert.ok(seen.has(JSON.stringify(PROFILE.colors.pages[1])), 'page 2 in its color');
  assert.ok(seen.has(JSON.stringify(PROFILE.colors.attention)), 'alternating with the attention color for slot 1 on hidden page 1');
  assert.equal(seen.size, 2);
});

test('pages: a profile reload with fewer pages clamps the visible page and keeps every task', async t => {
  const ctx = await setup(t, { sessions: codexMany(35) });
  ctx.turn(KNOB4, 2 * PAGE_STEP);
  assert.equal(page(ctx), 3);
  ctx.router.setProfile(withProfile({ pages: { count: 2 } }));
  assert.equal(page(ctx), 2, 'the visible page is clamped');
  assert.equal(ctx.slots.entries().length, 35, 'nothing is dropped or moved');
  assert.equal(ctx.router.status().beyondPages, 5);
  assert.deepEqual(ctx.lastLog('slots-beyond-pages'), { type: 'slots-beyond-pages', count: 5, pages: 2 });
  ctx.router.setProfile(withProfile({ pages: { count: 4 } }));
  assert.equal(ctx.router.status().beyondPages, 0);
  ctx.turn(KNOB4, 2 * PAGE_STEP);
  assert.equal(ctx.router.status().slots[0].slot, 46 - 15, 'page 3 shows slot 31 again');
  assert.equal(ctx.router.status().slots[0].client, 'codex');
});

test('on a platform without an adapter every focus and Send fails closed and nothing is typed', async t => {
  const clock = new ManualClock(1_700_000_000_000);
  const slots = await SlotStore.open(join(tempDir(t), 'slots.json'), { clock });
  const logs = [];
  const router = new TaskRouter({ adapter: createUnsupportedAdapter('linux'), lights: new FakeLights(), slots, profile: PROFILE, clock, log: e => logs.push(e) });
  onCleanup(t, () => router.close());
  router.start();
  router.handleFeed(view([codexTask(1), claudeTask(2)]));
  let sequence = 1;
  for (const control of [1, 2, WHEEL, PLAY, RECORD]) {
    router.handleBridgeEvent({ type: 'input', at: clock.now(), epoch: 1, sequence: sequence++, control, kind: 'press', delta: 0, synthetic: false });
    await settle();
  }
  assert.deepEqual(logs.filter(l => l.type === 'focus-failed').map(l => l.reason), ['client-version-unknown', 'client-version-unknown']);
  assert.equal(logs.filter(l => l.type === 'sent').length, 0);
  assert.equal(logs.filter(l => l.type === 'focused').length, 0);
  assert.equal(logs.filter(l => l.type === 'record-refused').at(-1).reason, 'dictation-keys-failed');
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
