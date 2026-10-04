import type { BridgeEvent } from '../bridge.js';
import { systemClock, type Clock } from '../clock.js';
import type { Client, OsAdapter } from '../os-adapter.js';
import type { Rgb } from '../protocol.js';
import type { FeedStatus, FeedView } from './feed.js';
import { renderFrame, slotState, type SlotLight, type SlotState } from './lights.js';
import type { RoutingProfile } from './profile.js';
import { SLOT_COUNT, candidatesFromSessions, sessionsForSlot, slotKey, type SlotReleaseReason, type SlotRecord, type SlotStore } from './slots.js';

/** Package families the qualification report recorded for each Desktop client. Fixed in code, never configurable. */
export const CLIENT_PACKAGES: Readonly<Record<Client, string>> = Object.freeze({
  codex: 'OpenAI.Codex_2p2nqsd0c76g0',
  claude: 'Claude_pzs8sxrjxfjjc',
});

/** The only links the router opens: an existing Codex thread or an existing Claude Desktop Code session. */
export function taskLink(client: Client, taskId: string): string {
  return client === 'codex' ? `codex://threads/${encodeURIComponent(taskId)}` : `claude://code/continue?session=${encodeURIComponent(taskId)}`;
}

export interface LightSink {
  setLeds(colors: readonly Rgb[]): void;
  setBrightness(percent: number): void;
}

/** Structured router events for the operator log. They carry slot numbers and reason codes, never titles or text. */
export interface RouterLog { type: string; [field: string]: unknown }

export interface RouterOptions {
  adapter: OsAdapter;
  lights: LightSink;
  slots: SlotStore;
  profile: RoutingProfile;
  clock?: Clock;
  log?: (event: RouterLog) => void;
}

export interface RouterStatus {
  target: { slot: number; client: Client } | null;
  focusing: number | null;
  dictating: boolean;
  send: 'none' | 'ready' | 'blocked';
  feed: FeedStatus;
  overflow: number;
  slots: { slot: number; client: Client | null; state: SlotState; error: boolean; selected: boolean }[];
}

interface Target { slot: number; client: Client; key: string; taskId: string; title: string | null }
type Call<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'rejected' };
type Check = { ok: true } | { ok: false; reason: string };

const RENDER_TICK_MS = 100;
const MAX_CLAUDE_IDS = 64;
/** Bounds on wheel notches: per adapter call, and waiting while a call runs. */
const MAX_NOTCHES_PER_CALL = 10;
const MAX_PENDING_NOTCHES = 50;

/**
 * Turns bridge events and Hub feed views into fail-closed task focus, dictation and Send. Every keystroke follows a
 * verified target; any doubt refuses, lights the key's error state and leaves no target. It has no Hub write path.
 */
export class TaskRouter {
  readonly #adapter: OsAdapter;
  readonly #lights: LightSink;
  readonly #slots: SlotStore;
  readonly #clock: Clock;
  readonly #log: (event: RouterLog) => void;
  #profile: RoutingProfile;
  #feed: FeedView = { status: 'unavailable', revision: null, snapshotVersion: null, sessions: [], reason: 'connecting' };
  /** Incremented by every invalidation; async steps stop when it changes. */
  #generation = 0;
  #target: Target | null = null;
  #focusing: number | null = null;
  /** Physically held controls and when they were pressed, from bridge events. */
  readonly #held = new Map<number, number>();
  #recordHeld = false;
  #recordToken = 0;
  #chordDown = false;
  #sending = false;
  #lastSendAt = Number.NEGATIVE_INFINITY;
  /** Wheel notches waiting for the single scroll worker (positive scrolls up, as the adapter defines). */
  #scrollPending = 0;
  #scrolling = false;
  readonly #errors = new Map<number, number>();
  #overflow = 0;
  #startedAt = 0;
  #lastFrame = '';
  #renderTimer: unknown;
  #archiveTimer: unknown;
  #archiveBusy = false;
  readonly #callTimers = new Map<unknown, () => void>();
  #closed = false;

  constructor(options: RouterOptions) {
    this.#adapter = options.adapter;
    this.#lights = options.lights;
    this.#slots = options.slots;
    this.#profile = options.profile;
    this.#clock = options.clock ?? systemClock;
    this.#log = options.log ?? (() => undefined);
  }

  start(): void {
    this.#startedAt = this.#clock.now();
    this.#lights.setBrightness(this.#profile.brightnessPercent);
    this.#render(true);
    this.#renderTimer = this.#clock.setInterval(() => this.#render(), RENDER_TICK_MS);
    this.#startArchiveTimer();
  }

  /** Releases held keys, stops timers and flushes slot state. Nothing pending runs afterwards. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation++;
    this.#target = null;
    this.#chordDown = false;
    for (const timer of [this.#renderTimer, this.#archiveTimer]) if (timer !== undefined) this.#clock.clearInterval(timer);
    for (const [timer, settle] of this.#callTimers) { this.#clock.clearTimeout(timer); settle(); }
    this.#callTimers.clear();
    await this.#releaseAll();
    await this.#slots.flush().catch(error => this.#log({ type: 'slot-state-write-failed', message: (error as Error).message }));
  }

  status(): RouterStatus {
    const now = this.#clock.now();
    return {
      target: this.#target && { slot: this.#target.slot, client: this.#target.client },
      focusing: this.#focusing,
      dictating: this.#chordDown,
      send: this.#sendState(),
      feed: this.#feed.status,
      overflow: this.#overflow,
      slots: this.#slotLights(now).map((light, i) => ({ slot: i + 1, client: this.#slots.get(i + 1)?.client ?? null, ...light })),
    };
  }

  /** Applies a validated profile whole: clears the target, releases keys and replays nothing. */
  setProfile(profile: RoutingProfile): void {
    const archiveChanged = profile.timing.archiveCheckMs !== this.#profile.timing.archiveCheckMs;
    this.#profile = profile;
    this.invalidate('profile-reload');
    this.#lights.setBrightness(profile.brightnessPercent);
    if (archiveChanged && !this.#closed) this.#startArchiveTimer();
    this.#log({ type: 'profile-applied', profileVersion: profile.profileVersion });
    this.#render(true);
  }

  /** Clears the target and any dictation, and releases every key the adapter holds. */
  invalidate(reason: string): void {
    this.#generation++;
    const had = this.#target !== null || this.#focusing !== null || this.#chordDown || this.#recordHeld;
    this.#target = null;
    this.#focusing = null;
    this.#chordDown = false;
    this.#recordHeld = false;
    this.#recordToken++;
    void this.#releaseAll();
    if (had) this.#log({ type: 'invalidated', reason });
    this.#render();
  }

  handleFeed(view: FeedView): void {
    if (this.#closed) return;
    this.#feed = view;
    if (view.status !== 'unavailable') this.#reconcile();
    this.#render();
  }

  handleBridgeEvent(event: BridgeEvent): void {
    if (this.#closed) return;
    switch (event.type) {
      case 'connected':
        this.#lights.setBrightness(this.#profile.brightnessPercent);
        this.#render(true);
        return;
      case 'stale':
      case 'session-restart':
      case 'disconnected':
        this.#held.clear();
        this.invalidate(event.type);
        return;
      case 'recovered':
        return;
      case 'input':
        break;
    }
    const { controls } = this.#profile;
    if (event.kind === 'turn') {
      // The big wheel scrolls; every other turn is inert here (the knobs belong to #744).
      if (event.control === controls.scroll) this.#scrollTurn(event.delta);
      return;
    }
    if (event.kind === 'release') {
      this.#held.delete(event.control);
      if (event.control === controls.record) this.#track(this.#recordRelease());
      return;
    }
    this.#held.set(event.control, this.#clock.now());
    const slot = controls.slots.indexOf(event.control) + 1;
    if (slot > 0) this.#slotPress(slot);
    else if (event.control === controls.record) this.#track(this.#recordPress());
    else if (controls.send.includes(event.control)) this.#track(this.#send());
    else if (event.control === controls.back) this.#back();
    // Every other control is inert here: small knobs, the volume knob and unmapped keys belong to #744.
  }

  // Slots and feed

  #reconcile(): void {
    const { assigned, overflow } = this.#slots.reconcile(candidatesFromSessions(this.#feed.sessions));
    for (const record of assigned) this.#log({ type: 'slot-assigned', slot: record.slot, client: record.client });
    if (overflow.length !== this.#overflow) {
      this.#overflow = overflow.length;
      this.#log({ type: 'overflow', count: overflow.length });
    }
  }

  #releaseSlot(slot: number, reason: SlotReleaseReason): void {
    const record = this.#slots.release(slot, reason);
    if (!record) return;
    this.#log({ type: 'slot-released', slot, client: record.client, reason });
    if (this.#target?.slot === slot || this.#focusing === slot) this.invalidate('slot-released');
    if (this.#feed.status !== 'unavailable') this.#reconcile();
    this.#render();
  }

  #startArchiveTimer(): void {
    if (this.#archiveTimer !== undefined) this.#clock.clearInterval(this.#archiveTimer);
    this.#archiveTimer = this.#clock.setInterval(() => this.#track(this.#checkArchives()), this.#profile.timing.archiveCheckMs);
  }

  /** Releases slots whose task has explicit archive evidence. Unknown, missing or failed reads release nothing. */
  async #checkArchives(): Promise<void> {
    if (this.#archiveBusy || this.#closed) return;
    this.#archiveBusy = true;
    try {
      const records = this.#slots.entries();
      for (const record of records.filter(r => r.client === 'codex')) {
        const archived = await this.#call(() => this.#adapter.codexArchived(record.taskId));
        if (this.#closed) return;
        if (archived.ok && archived.value.status === 'known' && archived.value.value && this.#slots.get(record.slot)?.taskId === record.taskId) {
          this.#releaseSlot(record.slot, 'codex-archived');
        }
      }
      const claude = records.filter(r => r.client === 'claude');
      if (claude.length) {
        const sessions = await this.#call(() => this.#adapter.claudeSessions(claude.map(r => r.taskId)));
        if (this.#closed || !sessions.ok || sessions.value.status !== 'known') return;
        for (const desktop of sessions.value.value) {
          const record = claude.find(r => r.taskId === desktop.localId);
          if (record && desktop.isArchived && this.#slots.get(record.slot)?.taskId === record.taskId) this.#releaseSlot(record.slot, 'claude-archived');
        }
      }
    } finally {
      this.#archiveBusy = false;
    }
  }

  // Focus

  #slotPress(slot: number): void {
    this.invalidate('task-switch');
    const generation = this.#generation;
    this.#focusing = slot;
    this.#render();
    this.#track(this.#focus(slot, generation, this.#clock.now()));
  }

  async #focus(slot: number, generation: number, pressedAt: number): Promise<void> {
    const alive = () => generation === this.#generation && !this.#closed;
    const fail = (step: string, reason: string) => {
      if (!alive()) return;
      this.#focusing = null;
      this.#flash(slot);
      this.#log({ type: 'focus-failed', slot, step, reason });
    };
    const record = this.#slots.get(slot);
    if (!record) return fail('target', 'empty-slot');
    const { client } = record;

    // 1. Target check
    const gate = await this.#versionGate(client);
    if (!alive()) return;
    if (!gate.ok) return fail('target', gate.reason);
    if (client === 'codex') {
      if (!record.title) return fail('target', 'title-missing');
      const archived = await this.#call(() => this.#adapter.codexArchived(record.taskId));
      if (!alive()) return;
      if (!archived.ok || archived.value.status !== 'known') return fail('target', 'archive-unknown');
      if (archived.value.value) {
        fail('target', 'archived');
        return this.#releaseSlot(slot, 'codex-archived');
      }
    } else {
      const desktop = await this.#call(() => this.#adapter.claudeSessions([record.taskId]));
      if (!alive()) return;
      if (!desktop.ok || desktop.value.status !== 'known') return fail('target', 'claude-record-unknown');
      const entry = desktop.value.value.find(s => s.localId === record.taskId);
      if (!entry) return fail('target', 'claude-record-missing');
      if (entry.isArchived) {
        fail('target', 'archived');
        return this.#releaseSlot(slot, 'claude-archived');
      }
    }

    // 2. Open
    const opened = await this.#call(() => this.#adapter.openUri(taskLink(client, record.taskId)));
    if (!alive()) return;
    if (!opened.ok) return fail('open', 'open-failed');

    // 3. Verify, polling observations only
    const { verifyTimeoutMs, verifyPollMs } = this.#profile.timing;
    const verifyStart = this.#clock.now();
    let verified: Check = { ok: false, reason: 'not-verified' };
    for (;;) {
      verified = await this.#verifySelection(record, pressedAt);
      if (!alive()) return;
      if (verified.ok || this.#clock.now() - verifyStart + verifyPollMs > verifyTimeoutMs) break;
      await this.#sleep(verifyPollMs);
      if (!alive()) return;
    }
    if (!verified.ok) return fail('verify', verified.reason);

    // 4. Composer
    if (client === 'codex') {
      const shortcut = await this.#call(() => this.#adapter.sendKeys({ action: 'tap', keys: this.#profile.shortcuts.codexComposer }));
      if (!alive()) return;
      if (!shortcut.ok) return fail('composer', 'composer-shortcut-failed');
    }
    const composerStart = this.#clock.now();
    let composer: Check = { ok: false, reason: 'composer-unfocused' };
    for (;;) {
      composer = await this.#composer(client);
      if (!alive()) return;
      if (composer.ok || this.#clock.now() - composerStart + verifyPollMs > verifyTimeoutMs) break;
      await this.#sleep(verifyPollMs);
      if (!alive()) return;
    }
    if (!composer.ok) return fail('composer', composer.reason);

    const current = this.#slots.get(slot);
    if (!current || slotKey(current) !== slotKey(record)) return fail('target', 'slot-changed');
    this.#focusing = null;
    this.#target = { slot, client, key: slotKey(record), taskId: record.taskId, title: record.title };
    this.#log({ type: 'focused', slot, client });
    this.#render();
  }

  async #versionGate(client: Client): Promise<Check> {
    const qualified = this.#profile.qualifiedVersions[client];
    const versions = await this.#call(() => this.#adapter.clientVersions());
    if (!versions.ok) return { ok: false, reason: 'client-version-unknown' };
    const version = versions.value[client];
    if (version.status !== 'known') return { ok: false, reason: 'client-version-unknown' };
    return qualified.includes(version.value) ? { ok: true } : { ok: false, reason: 'client-unqualified' };
  }

  /** Other Claude Desktop IDs the router knows, for the "no other session became visible" check. */
  #otherClaudeIds(except: string): string[] {
    const ids = new Set<string>();
    for (const record of this.#slots.entries()) if (record.client === 'claude') ids.add(record.taskId);
    for (const session of this.#feed.sessions) if (session.hostSessionId) ids.add(session.hostSessionId);
    ids.delete(except);
    return [...ids].sort().slice(0, MAX_CLAUDE_IDS - 1);
  }

  async #foreground(client: Client): Promise<Check> {
    const window = await this.#call(() => this.#adapter.foregroundWindow());
    if (!window.ok || window.value.status !== 'known' || window.value.value === null) return { ok: false, reason: 'foreground-unknown' };
    return window.value.value.packageIdentity === CLIENT_PACKAGES[client] ? { ok: true } : { ok: false, reason: 'foreground-mismatch' };
  }

  async #codexSelection(title: string | null): Promise<Check> {
    if (!title) return { ok: false, reason: 'title-missing' };
    const selection = await this.#call(() => this.#adapter.codexSelectedTitle(title));
    if (!selection.ok || selection.value.status !== 'known') return { ok: false, reason: 'selection-unknown' };
    if (!selection.value.value.matches) return { ok: false, reason: 'selection-mismatch' };
    return selection.value.value.sameTitleRows === 1 ? { ok: true } : { ok: false, reason: 'title-not-unique' };
  }

  /**
   * After the link: the foreground package matches, and the exact task is selected. Codex: the selected row's title
   * equals the slot's title and no other row shares it. Claude: only the target's `lastFocusedAt` moved past the press.
   */
  async #verifySelection(record: SlotRecord, pressedAt: number): Promise<Check> {
    const foreground = await this.#foreground(record.client);
    if (!foreground.ok) return foreground;
    if (record.client === 'codex') return this.#codexSelection(record.title);
    const others = this.#otherClaudeIds(record.taskId);
    const desktop = await this.#call(() => this.#adapter.claudeSessions([record.taskId, ...others]));
    if (!desktop.ok || desktop.value.status !== 'known') return { ok: false, reason: 'selection-unknown' };
    const target = desktop.value.value.find(s => s.localId === record.taskId);
    if (!target || target.isArchived || target.lastFocusedAt === null || target.lastFocusedAt <= pressedAt) return { ok: false, reason: 'selection-mismatch' };
    const moved = desktop.value.value.some(s => s.localId !== record.taskId && s.lastFocusedAt !== null && s.lastFocusedAt > pressedAt);
    return moved ? { ok: false, reason: 'selection-ambiguous' } : { ok: true };
  }

  async #composer(client: Client): Promise<Check> {
    const focused = await this.#call(() => this.#adapter.composerFocused(client));
    if (!focused.ok || focused.value.status !== 'known') return { ok: false, reason: 'composer-unknown' };
    return focused.value.value ? { ok: true } : { ok: false, reason: 'composer-unfocused' };
  }

  /** The single-pass check before Record or Send: still the same task, in front, with the composer focused. */
  async #recheck(target: Target): Promise<Check> {
    const record = this.#slots.get(target.slot);
    if (!record || slotKey(record) !== target.key) return { ok: false, reason: 'no-target' };
    const foreground = await this.#foreground(target.client);
    if (!foreground.ok) return foreground;
    if (target.client === 'codex') {
      const selection = await this.#codexSelection(target.title);
      if (!selection.ok) return selection;
    } else {
      const desktop = await this.#call(() => this.#adapter.claudeSessions([target.taskId, ...this.#otherClaudeIds(target.taskId)]));
      if (!desktop.ok || desktop.value.status !== 'known') return { ok: false, reason: 'selection-unknown' };
      const own = desktop.value.value.find(s => s.localId === target.taskId);
      if (!own || own.isArchived || own.lastFocusedAt === null) return { ok: false, reason: 'selection-mismatch' };
      if (desktop.value.value.some(s => s.localId !== target.taskId && s.lastFocusedAt !== null && s.lastFocusedAt > own.lastFocusedAt!)) {
        return { ok: false, reason: 'selection-mismatch' };
      }
    }
    return this.#composer(target.client);
  }

  /** Drops a target whose re-check failed, lighting its key. */
  #dropTarget(target: Target): void {
    if (this.#target !== target) return;
    this.#target = null;
    this.#flash(target.slot);
    this.#render();
  }

  // Record

  async #recordPress(): Promise<void> {
    this.#recordHeld = true;
    const token = ++this.#recordToken;
    const refuse = (reason: string) => { this.#log({ type: 'record-refused', reason }); this.#render(); };
    const target = this.#target;
    if (!target) return refuse('no-target');
    if (this.#sending) return refuse('send-in-progress');
    const generation = this.#generation;
    const check = await this.#recheck(target);
    const current = () => this.#recordHeld && token === this.#recordToken && generation === this.#generation && this.#target === target && !this.#closed;
    if (!current()) return;
    if (!check.ok) {
      this.#dropTarget(target);
      return refuse(check.reason);
    }
    this.#chordDown = true;
    this.#render();
    const down = await this.#call(() => this.#adapter.sendKeys({ action: 'down', keys: this.#profile.shortcuts.dictation }));
    if (!down.ok) {
      this.#chordDown = false;
      await this.#releaseAll();
      this.#dropTarget(target);
      return refuse('dictation-keys-failed');
    }
    if (this.#chordDown) this.#log({ type: 'dictation-started', slot: target.slot });
  }

  async #recordRelease(): Promise<void> {
    this.#recordHeld = false;
    this.#recordToken++;
    if (!this.#chordDown) return;
    this.#chordDown = false;
    this.#render();
    const up = await this.#call(() => this.#adapter.sendKeys({ action: 'up', keys: this.#profile.shortcuts.dictation }));
    if (!up.ok) await this.#releaseAll();
    this.#log({ type: 'dictation-ended' });
  }

  // Send

  #hubApprovalPending(target: Target): boolean {
    const record = this.#slots.get(target.slot);
    return !!record && sessionsForSlot(record, this.#feed.sessions).some(session => session.attention.includes('approval'));
  }

  #sendState(): RouterStatus['send'] {
    if (!this.#target) return 'none';
    return this.#feed.status !== 'current' || this.#hubApprovalPending(this.#target) ? 'blocked' : 'ready';
  }

  /** One Enter to the verified composer, or nothing. An uncertain keystroke is never retried. */
  async #send(): Promise<void> {
    const refuse = (reason: string) => { this.#log({ type: 'send-refused', reason }); this.#render(); };
    if (this.#sending) return refuse('send-in-progress');
    if (this.#clock.now() - this.#lastSendAt < this.#profile.timing.sendRepeatWindowMs) return refuse('repeat');
    const target = this.#target;
    if (!target) return refuse('no-target');
    if (this.#recordHeld || this.#chordDown) return refuse('dictating');
    if (this.#feed.status !== 'current') return refuse('feed-not-current');
    if (this.#hubApprovalPending(target)) return refuse('hub-approval-pending');
    this.#sending = true;
    try {
      const generation = this.#generation;
      const alive = () => generation === this.#generation && this.#target === target && !this.#closed && !this.#recordHeld;
      const check = await this.#recheck(target);
      if (!alive()) return refuse('superseded');
      if (!check.ok) {
        this.#dropTarget(target);
        return refuse(check.reason);
      }
      const approval = await this.#call(() => this.#adapter.approvalVisible(target.client));
      if (!alive()) return refuse('superseded');
      if (!approval.ok || approval.value.status !== 'known') return refuse('approval-unknown');
      if (approval.value.value) return refuse('approval-visible');
      if (this.#feed.status !== 'current') return refuse('feed-not-current');
      if (this.#hubApprovalPending(target)) return refuse('hub-approval-pending');
      this.#lastSendAt = this.#clock.now();
      const sent = await this.#call(() => this.#adapter.sendKeys({ action: 'tap', keys: this.#profile.shortcuts.send }));
      if (sent.ok) {
        this.#log({ type: 'sent', slot: target.slot, client: target.client });
        return;
      }
      this.#log({ type: 'send-uncertain', slot: target.slot, client: target.client, reason: sent.reason });
      if (this.#target === target) this.#target = null;
      this.#flash(target.slot);
    } finally {
      this.#sending = false;
      this.#render();
    }
  }

  // Back and release gesture

  #back(): void {
    const now = this.#clock.now();
    const slotsHeld = this.#profile.controls.slots.map((control, i) => ({ slot: i + 1, since: this.#held.get(control) })).filter(h => h.since !== undefined);
    if (slotsHeld.length === 0) return this.invalidate('back');
    if (slotsHeld.length > 1) return;
    const [{ slot, since }] = slotsHeld as [{ slot: number; since: number }];
    if (now - since < this.#profile.timing.releaseHoldMs) return;
    const record = this.#slots.get(slot);
    if (!record) return;
    if (record.client !== 'claude') {
      this.#flash(slot);
      this.#log({ type: 'release-refused', slot, reason: 'codex-gesture-not-enabled' });
      return;
    }
    this.invalidate('release-gesture');
    this.#releaseSlot(slot, 'release-gesture');
  }

  // Scroll

  /**
   * A big-wheel turn scrolls the client conversation through the adapter's mouse-wheel primitive: the target's client,
   * or without a target the foreground client when it is Codex or Claude. Clockwise scrolls down unless inverted.
   * Scroll never types, selects a task or changes the target, never runs during dictation and is never retried.
   */
  #scrollTurn(delta: number): void {
    if (delta === 0 || this.#recordHeld || this.#chordDown) return;
    const { notchesPerStep, invert } = this.#profile.scroll;
    const notches = -delta * notchesPerStep * (invert ? -1 : 1);
    this.#scrollPending = Math.max(-MAX_PENDING_NOTCHES, Math.min(MAX_PENDING_NOTCHES, this.#scrollPending + notches));
    if (!this.#scrolling) this.#track(this.#drainScroll());
  }

  async #drainScroll(): Promise<void> {
    this.#scrolling = true;
    try {
      while (this.#scrollPending !== 0 && !this.#closed) {
        const notches = Math.max(-MAX_NOTCHES_PER_CALL, Math.min(MAX_NOTCHES_PER_CALL, this.#scrollPending));
        this.#scrollPending -= notches;
        if (this.#recordHeld || this.#chordDown) { this.#scrollPending = 0; return; }
        const client = this.#target?.client ?? await this.#foregroundClient();
        if (!client || this.#recordHeld || this.#chordDown || this.#closed) { this.#scrollPending = 0; return; }
        const scrolled = await this.#call(() => this.#adapter.scrollClient(client, notches));
        if (!scrolled.ok || scrolled.value.status !== 'known') {
          // Unknown: drop what is pending rather than retry; the next turn tries again.
          this.#scrollPending = 0;
          this.#log({ type: 'scroll-unknown', client, reason: scrolled.ok && scrolled.value.status === 'unknown' ? scrolled.value.reason : scrolled.ok ? 'unknown' : scrolled.reason });
          return;
        }
        if (!scrolled.value.value) { this.#scrollPending = 0; return; }
      }
    } finally {
      this.#scrolling = false;
    }
  }

  /** The foreground Desktop client by package identity, or null for any other app or an unknown answer. */
  async #foregroundClient(): Promise<Client | null> {
    const window = await this.#call(() => this.#adapter.foregroundWindow());
    if (!window.ok || window.value.status !== 'known' || window.value.value === null) return null;
    const identity = window.value.value.packageIdentity;
    return (Object.keys(CLIENT_PACKAGES) as Client[]).find(client => CLIENT_PACKAGES[client] === identity) ?? null;
  }

  // Lights

  #flash(slot: number): void {
    this.#errors.set(slot, this.#clock.now() + this.#profile.timing.errorFlashMs);
    this.#render();
  }

  #slotLights(now: number): SlotLight[] {
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const slot = i + 1;
      const record = this.#slots.get(slot);
      const until = this.#errors.get(slot);
      if (until !== undefined && until <= now) this.#errors.delete(slot);
      return {
        state: slotState(record, record ? sessionsForSlot(record, this.#feed.sessions) : [], this.#feed.status),
        error: until !== undefined && until > now,
        selected: this.#target?.slot === slot,
      };
    });
  }

  #render(force = false): void {
    if (this.#closed) return;
    const now = this.#clock.now();
    const half = Math.max(1, Math.floor(this.#profile.timing.attentionPulseMs / 2));
    const frame = renderFrame({
      profile: this.#profile, slots: this.#slotLights(now), recording: this.#chordDown, send: this.#sendState(),
      pulseOn: Math.floor((now - this.#startedAt) / half) % 2 === 0,
    });
    const signature = JSON.stringify(frame);
    if (!force && signature === this.#lastFrame) return;
    this.#lastFrame = signature;
    try {
      this.#lights.setLeds(frame);
    } catch (error) {
      this.#log({ type: 'lights-failed', message: (error as Error).message });
    }
  }

  // Adapter calls

  /** Runs one adapter call under the profile's timeout. A rejection or timeout is a failed (unknown) result. */
  #call<T>(operation: () => Promise<T>): Promise<Call<T>> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: Call<T>) => {
        if (settled) return;
        settled = true;
        this.#clock.clearTimeout(timer);
        this.#callTimers.delete(timer);
        resolve(result);
      };
      const timer = this.#clock.setTimeout(() => finish({ ok: false, reason: 'timeout' }), this.#profile.timing.adapterTimeoutMs);
      this.#callTimers.set(timer, () => finish({ ok: false, reason: 'timeout' }));
      let pending: Promise<T>;
      try {
        pending = operation();
      } catch {
        return finish({ ok: false, reason: 'rejected' });
      }
      pending.then(value => finish({ ok: true, value }), () => finish({ ok: false, reason: 'rejected' }));
    });
  }

  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = this.#clock.setTimeout(() => { this.#callTimers.delete(timer); resolve(); }, ms);
      this.#callTimers.set(timer, resolve);
    });
  }

  async #releaseAll(): Promise<void> {
    try {
      await this.#adapter.releaseAll();
    } catch {
      // The adapter contract says releaseAll never throws; a broken adapter must not stop invalidation.
    }
  }

  #track(task: Promise<unknown>): void {
    task.catch(error => this.#log({ type: 'router-error', message: (error as Error).message }));
  }
}
