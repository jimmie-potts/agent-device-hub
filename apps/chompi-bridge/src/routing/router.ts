import type { BridgeEvent } from '../bridge.js';
import { systemClock, type Clock } from '../clock.js';
import { MAX_VOLUME_PRESSES, type CardButtons, type ClaudeDesktopSession, type Client, type ForegroundWindow, type Observation, type OsAdapter, type VolumeKey } from '../os-adapter.js';
import type { Rgb } from '../protocol.js';
import type { FeedStatus, FeedView } from './feed.js';
import { renderFrame, slotState, type SettingKnob, type SlotLight, type SlotState } from './lights.js';
import { EFFORT_CLICK, EFFORT_TURN, MODEL_CLICK, MODEL_TURN, PAGE_CLICK, PAGE_TURN, VOLUME_CLICK, VOLUME_TURN, type RoutingProfile } from './profile.js';
import { Detent } from './detent.js';
import { SettingKnobs } from './knobs.js';
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
  focusing: number | null;
  dictating: boolean;
  feed: FeedStatus;
  overflow: number;
  /** The visible task page (1-based) and the page count (#822). */
  page: number;
  pages: number;
  /** Assigned slots beyond the profile's pages: kept, but without visible keys until the pages return. */
  beyondPages: number;
  /** The visible page's 15 slots, key 1 first. */
  slots: { slot: number; client: Client | null; state: SlotState; error: boolean }[];
}

type Call<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'rejected' };
type InputEvent = Extract<BridgeEvent, { type: 'input' }>;
/** Controller input waiting for an open knob flow to close, or a close the router asked for (#906). */
type Queued = { event: InputEvent } | { close: string };
type Check = { ok: true } | { ok: false; reason: string; observedVersion?: string | null };
/** Which Claude evidence verified the selection; logged on `focused` as a reason code. Codex verification has none. */
type ClaudeEvidence = 'advanced' | 'already-newest';
type Verified = { ok: true; evidence?: ClaudeEvidence } | { ok: false; reason: string };

/** A card observation of the window in front, as the wheel last read it. */
type CardState = { kind: 'none' } | { kind: 'card'; card: CardButtons } | { kind: 'unknown'; reason: string };
type WheelMode = { kind: 'none' } | { kind: 'inert' } | { kind: 'scroll'; client: Client } | { kind: 'card'; client: Client; card: CardButtons };

const RENDER_TICK_MS = 100;
/** Desktop IDs per `claudeSessions` call; more are read in several calls, never truncated. */
const CLAUDE_IDS_PER_CALL = 64;
/** Bounds on wheel notches: per adapter call, and waiting while a call runs. */
const MAX_NOTCHES_PER_CALL = 10;
const MAX_PENDING_NOTCHES = 50;
/** Bound on card steps waiting while a focus call runs. */
const MAX_PENDING_STEPS = 64;
/** How long wheel turns reuse a card observation; a click always reads afresh. Nothing polls in between. */
const CARD_REUSE_MS = 500;
/** Protocol turn IDs 41-46 pair with click IDs 29-34: the big wheel's click is its turn ID minus 12. */
const TURN_TO_CLICK = 12;
/** Bound on volume presses waiting while a volume key is being sent. */
const MAX_PENDING_VOLUME = 50;
/** Bound on controller input waiting for a knob flow to close (#906). */
const MAX_QUEUED_INPUT = 64;

/** The reason code of an adapter call that failed, timed out or answered unknown. */
function reasonOf<T>(call: Call<Observation<T>>): string {
  if (!call.ok) return call.reason;
  return call.value.status === 'unknown' ? call.value.reason : 'unknown';
}

/** The Desktop client a foreground window belongs to by package identity, or null for any other app or no window. */
function clientOf(window: ForegroundWindow | null): Client | null {
  if (!window) return null;
  return (Object.keys(CLIENT_PACKAGES) as Client[]).find(client => CLIENT_PACKAGES[client] === window.packageIdentity) ?? null;
}

/** Whether `localId`'s `lastFocusedAt` is known and greater than every other record's; a tie is not newest. */
function strictlyNewest(desktop: readonly ClaudeDesktopSession[], localId: string): boolean {
  const own = desktop.find(s => s.localId === localId);
  if (!own || own.isArchived || own.lastFocusedAt === null) return false;
  const focusedAt = own.lastFocusedAt;
  return desktop.every(s => s.localId === localId || s.lastFocusedAt === null || s.lastFocusedAt < focusedAt);
}

/**
 * Turns bridge events and Hub feed views into slot lights, fail-closed task focus, dictation, Send and big-wheel card
 * answers. A slot press opens and verifies its task; it arms nothing. Send and card answers are evaluated against the
 * window in front when they are pressed, and Record holds the dictation chord like a keyboard shortcut (#821). Knob 1
 * sets the model and knob 2 the effort of the client in front (#906, `SettingKnobs`). Any doubt refuses and types
 * nothing. It has no Hub write path.
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
  #focusing: number | null = null;
  /** Physically held controls and when they were pressed, from bridge events. */
  readonly #held = new Map<number, number>();
  /** The absolute slot each held slot key showed when it went down, so paging during a hold cannot change it (#822). */
  readonly #heldSlots = new Map<number, number>();
  #recordHeld = false;
  /** Incremented by every Record press and release; a press waiting for an Enter tap checks it is still current. */
  #recordToken = 0;
  #chordDown = false;
  /** Keystrokes being typed (a Send's Enter, a volume key); Record presses its chord right after them. */
  readonly #taps = new Set<Promise<unknown>>();
  /** A Send or card press is being checked or typed. */
  #sending = false;
  /** The last Send keystroke or card press, for the shared repeat window. */
  #lastSendAt = Number.NEGATIVE_INFINITY;
  /** Big wheel: partial rotation toward the next card step, and work waiting for the single wheel worker. */
  readonly #wheelDetent = new Detent();
  #scrollPending = 0;
  #stepsPending = 0;
  #wheelBusy = false;
  #stepping = false;
  #lastTurnAt = Number.NEGATIVE_INFINITY;
  #card: { client: Client; at: number; state: CardState } | null = null;
  /** The visible task page (1-based); not persisted, so the bridge starts on page 1 (#822). */
  #page = 1;
  readonly #pageDetent = new Detent();
  /** The card button the wheel's own step focused, on which card; a card press needs it (owner decision on #821). */
  #chosen: { client: Client; cardId: string; index: number } | null = null;
  /** Until when the big-wheel LEDs show a refused or uncertain Send or card press. */
  #wheelErrorUntil = Number.NEGATIVE_INFINITY;
  /**
   * The Attention click on knob 4 (#865): when the bridge first saw each assigned task waiting, as a sequence number by slot key.
   * The Hub's attention entries carry no time, so this order lives in memory only and restarts with the bridge.
   */
  readonly #attentionSeen = new Map<string, number>();
  #attentionSequence = 0;
  /** The last Attention press and the task it opened, for the repeat window. */
  #lastAttention: { at: number; sequence: number } | null = null;
  /** Black-key controls flashing the error color for a refused press, and until when. */
  readonly #keyErrors = new Map<number, number>();
  /** Until when knob 4's LED shows a refused Attention click. */
  #pageErrorUntil = Number.NEGATIVE_INFINITY;
  /**
   * The volume knob (#865): partial rotation and presses waiting for the single volume worker, and whether a mute toggle
   * waits. Clicks that arrive while a volume key is being sent collapse to their parity, so an even number cancels out.
   */
  readonly #volumeDetent = new Detent();
  #volumePending = 0;
  #mutePending = false;
  #volumeBusy = false;
  #volumeErrorUntil = Number.NEGATIVE_INFINITY;
  readonly #errors = new Map<number, number>();
  /** Knob 1 (model) and knob 2 (effort), #906. */
  readonly #knobs: SettingKnobs;
  /** Input that waits while a knob flow closes; it then runs in order. */
  readonly #queue: Queued[] = [];
  #draining = false;
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
    this.#slots.setPages(this.#profile.pages.count);
    this.#knobs = new SettingKnobs({
      adapter: this.#adapter,
      clock: this.#clock,
      profile: () => this.#profile,
      log: event => this.#log(event),
      call: operation => this.#call(operation),
      tap: operation => this.#tap(operation),
      sleep: ms => this.#sleep(ms),
      frontClient: () => this.#frontClient(),
      versionGate: client => this.#versionGate(client),
      card: async client => (await this.#observeCard(client)).kind,
      composer: client => this.#composer(client),
      claudeFront: () => this.#claudeFront(),
      blocked: () => this.#recordHeld || this.#chordDown ? 'dictating' : this.#sending ? 'send-in-progress' : this.#focusing !== null ? 'focus-in-progress' : null,
      closed: () => this.#closed,
      render: () => this.#render(),
      requestClose: reason => this.#requestClose(reason),
    });
  }

  start(): void {
    this.#startedAt = this.#clock.now();
    this.#lights.setBrightness(this.#profile.brightnessPercent);
    this.#render(true);
    this.#renderTimer = this.#clock.setInterval(() => this.#render(), RENDER_TICK_MS);
    this.#startArchiveTimer();
    this.#reportBeyondPages();
  }

  /** Releases held keys, stops timers and flushes slot state. Nothing pending runs afterwards. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation++;
    this.#chordDown = false;
    this.#queue.length = 0;
    this.#knobs.dispose();
    for (const timer of [this.#renderTimer, this.#archiveTimer]) if (timer !== undefined) this.#clock.clearInterval(timer);
    for (const [timer, settle] of this.#callTimers) { this.#clock.clearTimeout(timer); settle(); }
    this.#callTimers.clear();
    await this.#releaseAll();
    await this.#slots.flush().catch(error => this.#log({ type: 'slot-state-write-failed', message: (error as Error).message }));
  }

  status(): RouterStatus {
    const now = this.#clock.now();
    return {
      focusing: this.#focusing,
      dictating: this.#chordDown,
      feed: this.#feed.status,
      overflow: this.#overflow,
      page: this.#page,
      pages: this.#profile.pages.count,
      beyondPages: this.#slots.beyondPages().length,
      slots: this.#slotLights(now).map((light, i) => {
        const slot = this.#slotOnPage(i + 1);
        return { slot, client: this.#slots.get(slot)?.client ?? null, ...light };
      }),
    };
  }

  /**
   * Applies a validated profile whole: cancels pending actions, releases keys and replays nothing. An open model menu,
   * effort slider or picker closes with Escape before any later input acts.
   */
  setProfile(profile: RoutingProfile): void {
    const archiveChanged = profile.timing.archiveCheckMs !== this.#profile.timing.archiveCheckMs;
    this.#profile = profile;
    // Fewer pages never drop or move a task: the store keeps slots beyond them, and the visible page is clamped.
    this.#slots.setPages(profile.pages.count);
    this.#page = Math.min(this.#page, profile.pages.count);
    this.#pageDetent.reset();
    if (this.#feed.status !== 'unavailable') this.#reconcile();
    this.#reportBeyondPages();
    this.invalidate('profile-reload');
    this.#requestClose('profile-reload');
    this.#lights.setBrightness(profile.brightnessPercent);
    if (archiveChanged && !this.#closed) this.#startArchiveTimer();
    this.#log({ type: 'profile-applied', profileVersion: profile.profileVersion });
    this.#render(true);
  }

  /** Cancels a focus in progress, pending wheel work and any dictation, and releases every key the adapter holds. */
  invalidate(reason: string): void {
    this.#generation++;
    const had = this.#focusing !== null || this.#chordDown || this.#recordHeld || this.#scrollPending !== 0 || this.#stepsPending !== 0;
    this.#focusing = null;
    this.#wheelDetent.reset();
    this.#scrollPending = 0;
    this.#stepsPending = 0;
    this.#clearVolume();
    this.#knobs.reset();
    this.#card = null;
    this.#chosen = null;
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
        // Input waiting for a knob flow to close is dropped with the rest: nothing pressed before a loss is replayed.
        this.#queue.length = 0;
        this.#held.clear();
        this.#heldSlots.clear();
        this.invalidate(event.type);
        this.#requestClose(event.type);
        return;
      case 'recovered':
        return;
      case 'input':
        break;
    }
    this.#input(event);
  }

  // Knob flows and other input (#906)

  /** Knob 1's or knob 2's turn or click, when the profile has that knob. */
  #knobOf(event: InputEvent): SettingKnob | null {
    if (event.kind === 'release') return null;
    const { model, effort } = this.#profile;
    if (event.kind === 'turn') return model && event.control === MODEL_TURN ? 'model' : effort && event.control === EFFORT_TURN ? 'effort' : null;
    return model && event.control === MODEL_CLICK ? 'model' : effort && event.control === EFFORT_CLICK ? 'effort' : null;
  }

  /**
   * Any control other than the open flow's own knob closes the flow first: its menu, slider or picker gets Escape, and
   * only then does the control act. Input that arrives meanwhile waits in order, so two flows never send at once.
   * Releases never close a flow.
   */
  #input(event: InputEvent): void {
    const passes = event.kind === 'release' || !this.#knobs.busy || this.#knobs.owns(this.#knobOf(event));
    if (passes && this.#queue.length === 0 && !this.#draining) return this.#dispatch(event);
    if (this.#queue.length >= MAX_QUEUED_INPUT) return this.#log({ type: 'input-dropped', reason: 'queue-full' });
    this.#queue.push({ event });
    this.#track(this.#drainQueue());
  }

  /** Closes the open knob flow, in turn with waiting input; with no flow there is nothing to wait for. */
  #requestClose(reason: string): void {
    if (this.#closed || !this.#knobs.busy) return;
    this.#queue.push({ close: reason });
    this.#track(this.#drainQueue());
  }

  async #drainQueue(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0 && !this.#closed) {
        const next = this.#queue[0];
        if ('close' in next) {
          this.#queue.shift();
          await this.#knobs.close(next.close);
          continue;
        }
        const { event } = next;
        if (event.kind !== 'release' && this.#knobs.busy && !this.#knobs.owns(this.#knobOf(event))) {
          await this.#knobs.close('other-control');
          continue;
        }
        this.#queue.shift();
        this.#dispatch(event);
      }
    } finally {
      this.#draining = false;
    }
  }

  #dispatch(event: InputEvent): void {
    if (this.#closed) return;
    const { controls } = this.#profile;
    if (event.kind === 'turn') {
      // Knob 4 pages tasks (#822); the big wheel scrolls or answers a card; the volume knob steps the system volume
      // (#865); knob 1 steps the model and knob 2 the effort (#906); knob 3's turn is inert.
      if (event.control === PAGE_TURN) this.#pageTurn(event.delta);
      else if (event.control === controls.scroll) this.#wheelTurn(event.delta);
      else if (this.#profile.volume && event.control === VOLUME_TURN) this.#volumeTurn(event.delta);
      else if (this.#knobOf(event)) this.#knobs.turn(this.#knobOf(event)!, event.delta);
      return;
    }
    if (event.kind === 'release') {
      this.#held.delete(event.control);
      this.#heldSlots.delete(event.control);
      if (event.control === controls.record) this.#track(this.#recordRelease());
      return;
    }
    this.#held.set(event.control, this.#clock.now());
    if (event.control === this.#wheelClick()) {
      // A wheel press clears partial rotation and steps not yet sent, so a light touch while clicking moves nothing.
      this.#wheelDetent.reset();
      this.#stepsPending = 0;
    }
    const key = controls.slots.indexOf(event.control) + 1;
    if (key > 0) {
      const slot = this.#slotOnPage(key);
      this.#heldSlots.set(event.control, slot);
      this.#slotPress(slot);
    }
    else if (event.control === controls.record) this.#track(this.#recordPress());
    else if (controls.send.includes(event.control)) this.#track(this.#send(event.control));
    else if (event.control === controls.back) this.#back();
    else if (this.#profile.volume && event.control === VOLUME_CLICK) this.#volumeMute();
    else if (this.#knobOf(event)) this.#knobs.click(this.#knobOf(event)!, this.#held.get(event.control)!);
    else if (event.control === PAGE_CLICK) {
      // Knob 4's click is the Attention click (#865) unless the profile turns it off.
      if (this.#profile.pages.attentionClick) this.#attentionPress(event.control);
    } else {
      // Black keys act as the profile maps them (#865); other controls, such as knob 3's click, are inert.
      const action = this.#profile.keys[String(event.control)];
      if (action === 'attention') this.#attentionPress(event.control);
      else if (action === 'back') this.#back();
    }
  }

  // Slots and feed

  #reconcile(): void {
    const { assigned, overflow } = this.#slots.reconcile(candidatesFromSessions(this.#feed.sessions));
    for (const record of assigned) this.#log({ type: 'slot-assigned', slot: record.slot, client: record.client });
    if (overflow.length !== this.#overflow) {
      this.#overflow = overflow.length;
      this.#log({ type: 'overflow', count: overflow.length });
    }
    this.#noteAttention();
  }

  /**
   * Records when each assigned task was first seen waiting, and forgets tasks that no longer wait or hold a slot.
   * Waiting changes only on a current feed; a stale feed keeps the order until the feed is current again.
   */
  #noteAttention(): void {
    const records = this.#slots.entries();
    const keys = new Set(records.map(slotKey));
    for (const key of this.#attentionSeen.keys()) if (!keys.has(key)) this.#attentionSeen.delete(key);
    if (this.#feed.status !== 'current') return;
    for (const record of records) {
      const key = slotKey(record);
      if (slotState(record, sessionsForSlot(record, this.#feed.sessions), this.#feed.status) !== 'attention') this.#attentionSeen.delete(key);
      else if (!this.#attentionSeen.has(key)) this.#attentionSeen.set(key, ++this.#attentionSequence);
    }
  }

  #releaseSlot(slot: number, reason: SlotReleaseReason): void {
    const record = this.#slots.release(slot, reason);
    if (!record) return;
    this.#log({ type: 'slot-released', slot, client: record.client, reason });
    if (this.#focusing === slot) this.invalidate('slot-released');
    if (this.#feed.status !== 'unavailable') this.#reconcile();
    else this.#noteAttention();
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
        const sessions = await this.#claudeRecords(claude.map(r => r.taskId));
        if (this.#closed || !sessions) return;
        for (const desktop of sessions) {
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
    const fail = (step: string, reason: string, extra: Record<string, unknown> = {}) => {
      if (!alive()) return;
      this.#focusing = null;
      this.#flash(slot);
      this.#log({ type: 'focus-failed', slot, step, reason, ...extra });
    };
    const record = this.#slots.get(slot);
    if (!record) return fail('target', 'empty-slot');
    const { client } = record;
    let alreadyNewest = false;

    // 1. Target check
    const gate = await this.#versionGate(client);
    if (!alive()) return;
    // The observed version is logged so the owner can qualify a client update (see the README).
    if (!gate.ok) return fail('target', gate.reason, { client, observedVersion: gate.observed });
    if (client === 'codex') {
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
      alreadyNewest = await this.#claudeAlreadyNewest(record.taskId);
      if (!alive()) return;
    }

    // 2. Open
    const opened = await this.#call(() => this.#adapter.openUri(taskLink(client, record.taskId)));
    if (!alive()) return;
    if (!opened.ok) return fail('open', 'open-failed');

    // 3. Verify, polling observations only
    const { verifyTimeoutMs, verifyPollMs } = this.#profile.timing;
    const verifyStart = this.#clock.now();
    let verified: Verified = { ok: false, reason: 'not-verified' };
    for (;;) {
      verified = await this.#verifySelection(record, pressedAt, alreadyNewest);
      if (!alive()) return;
      if (verified.ok || this.#clock.now() - verifyStart + verifyPollMs > verifyTimeoutMs) break;
      await this.#sleep(verifyPollMs);
      if (!alive()) return;
    }
    if (!verified.ok) return fail('verify', verified.reason);
    const { evidence } = verified;

    // The first gate may have used a cached version: an updated client can be the one the link just raised. Gate
    // again before any input; the adapter re-reads when the client's foreground process changed.
    const regate = await this.#versionGate(client);
    if (!alive()) return;
    if (!regate.ok) return fail('target', regate.reason, { client, observedVersion: regate.observed });

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
    // The task is in front with its composer focused. Nothing is armed: Send and Record act on whatever is in front.
    this.#focusing = null;
    this.#log({ type: 'focused', slot, client, ...(evidence ? { evidence } : {}) });
    this.#render();
  }

  async #versionGate(client: Client): Promise<{ ok: true } | { ok: false; reason: string; observed: string | null }> {
    const qualified = this.#profile.qualifiedVersions[client];
    const versions = await this.#call(() => this.#adapter.clientVersions());
    if (!versions.ok) return { ok: false, reason: 'client-version-unknown', observed: null };
    const version = versions.value[client];
    if (version.status !== 'known') return { ok: false, reason: 'client-version-unknown', observed: null };
    return qualified.includes(version.value) ? { ok: true } : { ok: false, reason: 'client-unqualified', observed: version.value };
  }

  /** Other Claude Desktop IDs the router knows, for the "no other session became visible" check. */
  #otherClaudeIds(except: string): string[] {
    const ids = new Set<string>();
    for (const record of this.#slots.entries()) if (record.client === 'claude') ids.add(record.taskId);
    for (const session of this.#feed.sessions) if (session.hostSessionId) ids.add(session.hostSessionId);
    ids.delete(except);
    return [...ids].sort();
  }

  /** Reads the named Claude Desktop records in bounded calls. Any unknown or failed call makes the whole answer unknown. */
  async #claudeRecords(ids: readonly string[]): Promise<ClaudeDesktopSession[] | null> {
    const records: ClaudeDesktopSession[] = [];
    for (let i = 0; i < ids.length; i += CLAUDE_IDS_PER_CALL) {
      const chunk = ids.slice(i, i + CLAUDE_IDS_PER_CALL);
      const answer = await this.#call(() => this.#adapter.claudeSessions(chunk));
      if (!answer.ok || answer.value.status !== 'known') return null;
      records.push(...answer.value.value);
    }
    return records;
  }

  /**
   * Before the link: Claude is in front and the target's `lastFocusedAt` is strictly the newest of every known Desktop
   * session. Claude stamps `lastFocusedAt` only when the selection changes, so a link to the session it already shows
   * moves nothing; this is the evidence verification accepts instead. Any unknown or failed read gives none.
   */
  async #claudeAlreadyNewest(taskId: string): Promise<boolean> {
    if (!(await this.#foreground('claude')).ok) return false;
    const desktop = await this.#claudeRecords([taskId, ...this.#otherClaudeIds(taskId)]);
    return !!desktop && strictlyNewest(desktop, taskId);
  }

  /** The Codex or Claude window in front, for the knobs (#906). */
  async #frontClient(): Promise<{ ok: true; client: Client } | { ok: false; reason: string }> {
    const window = await this.#call(() => this.#adapter.foregroundWindow());
    if (!window.ok || window.value.status !== 'known') return { ok: false, reason: 'foreground-unknown' };
    const client = clientOf(window.value.value);
    return client ? { ok: true, client } : { ok: false, reason: 'not-agent-client' };
  }

  /**
   * The Claude Desktop session in front, for the knobs' record readback (#906): among the sessions the router knows
   * (slot records and Hub `hostSessionId`s), the one whose `lastFocusedAt` is strictly the newest. Null when none is, or
   * any read fails.
   */
  async #claudeFront(): Promise<string | null> {
    const ids = this.#otherClaudeIds('');
    if (ids.length === 0) return null;
    const records = await this.#claudeRecords(ids);
    return records?.find(record => strictlyNewest(records, record.localId))?.localId ?? null;
  }

  async #foreground(client: Client): Promise<Check> {
    const window = await this.#call(() => this.#adapter.foregroundWindow());
    if (!window.ok || window.value.status !== 'known' || window.value.value === null) return { ok: false, reason: 'foreground-unknown' };
    return window.value.value.packageIdentity === CLIENT_PACKAGES[client] ? { ok: true } : { ok: false, reason: 'foreground-mismatch' };
  }

  /** The adapter compares the thread's Codex name, or the slot's Hub title when Codex has never named the thread. */
  async #codexSelection(taskId: string, title: string | null): Promise<Check> {
    const selection = await this.#call(() => this.#adapter.codexSelectedThread(taskId, title));
    if (selection.ok && selection.value.status === 'unknown') {
      if (selection.value.reason === 'codex-title-missing') return { ok: false, reason: 'title-missing' };
      if (selection.value.reason === 'codex-name-not-unique') return { ok: false, reason: 'title-not-unique' };
    }
    if (!selection.ok || selection.value.status !== 'known') return { ok: false, reason: 'selection-unknown' };
    if (!selection.value.value.matches) return { ok: false, reason: 'selection-mismatch' };
    return selection.value.value.sameTitleRows === 1 ? { ok: true } : { ok: false, reason: 'title-not-unique' };
  }

  /**
   * After the link: the foreground package matches, and the exact task is selected. Codex: the selected row shows the
   * thread's name and no other row shares it. Claude: only the target's `lastFocusedAt` moved past the press, or, when
   * it was already strictly the newest before the link, it still is and no other session's moved past the press.
   */
  async #verifySelection(record: SlotRecord, pressedAt: number, alreadyNewest: boolean): Promise<Verified> {
    const foreground = await this.#foreground(record.client);
    if (!foreground.ok) return foreground;
    if (record.client === 'codex') return this.#codexSelection(record.taskId, record.title);
    const desktop = await this.#claudeRecords([record.taskId, ...this.#otherClaudeIds(record.taskId)]);
    if (!desktop) return { ok: false, reason: 'selection-unknown' };
    const target = desktop.find(s => s.localId === record.taskId);
    if (!target || target.isArchived || target.lastFocusedAt === null) return { ok: false, reason: 'selection-mismatch' };
    const moved = desktop.some(s => s.localId !== record.taskId && s.lastFocusedAt !== null && s.lastFocusedAt > pressedAt);
    if (target.lastFocusedAt > pressedAt) return moved ? { ok: false, reason: 'selection-ambiguous' } : { ok: true, evidence: 'advanced' };
    // `!moved` is implied by strictlyNewest here; it states the owner's rule directly.
    return alreadyNewest && !moved && strictlyNewest(desktop, record.taskId) ? { ok: true, evidence: 'already-newest' } : { ok: false, reason: 'selection-mismatch' };
  }

  async #composer(client: Client): Promise<Check> {
    const focused = await this.#call(() => this.#adapter.composerFocused(client));
    if (!focused.ok || focused.value.status !== 'known') return { ok: false, reason: 'composer-unknown' };
    return focused.value.value ? { ok: true } : { ok: false, reason: 'composer-unfocused' };
  }

  // Record

  /**
   * Holds the dictation chord like a keyboard shortcut: no foreground, card or composer check (#821). A press abandons a
   * Send still being checked; during a Send's Enter keystroke, the chord goes down right after it, so its modifiers can
   * never join that Enter.
   */
  async #recordPress(): Promise<void> {
    this.#recordHeld = true;
    const token = ++this.#recordToken;
    if (this.#taps.size > 0) {
      await Promise.all([...this.#taps]);
      if (token !== this.#recordToken || this.#closed) return;
    }
    this.#chordDown = true;
    this.#render();
    const down = await this.#call(() => this.#adapter.sendKeys({ action: 'down', keys: this.#profile.shortcuts.dictation }));
    if (!down.ok) {
      this.#chordDown = false;
      await this.#releaseAll();
      this.#log({ type: 'record-refused', reason: 'dictation-keys-failed' });
      this.#render();
      return;
    }
    if (this.#chordDown) this.#log({ type: 'dictation-started' });
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

  // Send and card presses

  /**
   * One Enter to the composer of the Codex or Claude window in front, or nothing (#821). Evaluated at the press: the
   * foreground client, its version, composer focus and the adapter's card check. The Hub is not consulted. The big
   * wheel's click answers an open card instead. An uncertain keystroke is never retried.
   */
  async #send(control: number): Promise<void> {
    const pressedAt = this.#held.get(control) ?? this.#clock.now();
    const refuse = (reason: string, extra: Record<string, unknown> = {}) => {
      this.#log({ type: 'send-refused', reason, ...extra });
      // No red flash for a bounce right after a Send (`repeat`) or a deliberate Record press (`superseded`).
      if (reason !== 'repeat' && reason !== 'superseded') this.#flashWheel();
    };
    if (this.#sending) return refuse('send-in-progress');
    if (this.#clock.now() - this.#lastSendAt < this.#profile.timing.sendRepeatWindowMs) return refuse('repeat');
    if (this.#recordHeld || this.#chordDown) return refuse('dictating');
    this.#sending = true;
    try {
      const generation = this.#generation;
      // Any Record press or release since this Send began abandons it, even a quick tap already released.
      const recordToken = this.#recordToken;
      const alive = () => generation === this.#generation && !this.#closed && !this.#recordHeld && recordToken === this.#recordToken;
      const window = await this.#call(() => this.#adapter.foregroundWindow());
      if (!alive()) return refuse('superseded');
      if (!window.ok || window.value.status !== 'known') return refuse('foreground-unknown');
      const client = clientOf(window.value.value);
      if (!client) return refuse('not-agent-client');
      const gate = await this.#versionGate(client);
      if (!alive()) return refuse('superseded');
      // The observed version is logged so the owner can qualify a client update (see the README).
      if (!gate.ok) return refuse(gate.reason, { client, observedVersion: gate.observed });
      if (control === this.#wheelClick()) {
        const card = await this.#observeCard(client);
        if (!alive()) return refuse('superseded');
        if (card.kind === 'unknown') return refuse('card-unknown', { client });
        if (card.kind === 'card') return await this.#cardPress(client, card.card, pressedAt);
      }
      const composer = await this.#composer(client);
      if (!alive()) return refuse('superseded');
      if (!composer.ok) return refuse(composer.reason, { client });
      const approval = await this.#call(() => this.#adapter.approvalVisible(client));
      if (!alive()) return refuse('superseded');
      if (!approval.ok || approval.value.status !== 'known') return refuse('approval-unknown', { client });
      if (approval.value.value) return refuse('approval-visible', { client });
      this.#lastSendAt = this.#clock.now();
      const sent = await this.#tap(() => this.#adapter.sendKeys({ action: 'tap', keys: this.#profile.shortcuts.send }));
      if (sent.ok) this.#log({ type: 'sent', client });
      else {
        this.#log({ type: 'send-uncertain', client, reason: sent.reason });
        this.#flashWheel();
      }
    } finally {
      this.#sending = false;
      this.#render();
    }
  }

  /**
   * A still big-wheel click on an open card presses its focused button through the adapter, which presses only a
   * button that still has keyboard focus in an unchanged card. This is the one controller gesture that may approve a
   * permission request (owner decision on #821); it is a client UI action, never a Hub acknowledgement.
   */
  async #cardPress(client: Client, card: CardButtons, pressedAt: number): Promise<void> {
    const refuse = (reason: string) => { this.#log({ type: 'card-refused', client, reason }); this.#flashWheel(); };
    if (pressedAt - this.#lastTurnAt < this.#profile.cards.clickStillMs) return refuse('card-wheel-moving');
    if (this.#stepping) return refuse('card-busy');
    if (card.focused === null) return refuse('card-nothing-focused');
    // Only a button the wheel itself moved to on this card: a Codex card opens with its approve button focused.
    const chosen = this.#chosen;
    if (!chosen || chosen.client !== client || chosen.cardId !== card.id || chosen.index !== card.focused) return refuse('card-nothing-chosen');
    this.#lastSendAt = this.#clock.now();
    this.#card = null;
    this.#chosen = null;
    const pressed = await this.#call(() => this.#adapter.invokeCardButton(client, card.id, card.focused!, card.count));
    if (!pressed.ok || pressed.value.status !== 'known') {
      this.#log({ type: 'card-press-uncertain', client, reason: reasonOf(pressed) });
      this.#flashWheel();
      return;
    }
    if (!pressed.value.value) return refuse('card-focus-moved');
    this.#log({ type: 'card-pressed', client, index: card.focused, count: card.count });
  }

  // Back and release gesture

  #back(): void {
    const now = this.#clock.now();
    // The slot each held key showed when it went down, whatever page is visible now.
    const slotsHeld = this.#profile.controls.slots
      .map(control => ({ slot: this.#heldSlots.get(control), since: this.#held.get(control) }))
      .filter((h): h is { slot: number; since: number } => h.slot !== undefined && h.since !== undefined);
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

  // Big wheel

  #wheelClick(): number { return this.#profile.controls.scroll - TURN_TO_CLICK; }

  /**
   * A big-wheel turn. Outside a card it scrolls the foreground client's conversation through the adapter's mouse-wheel
   * primitive (clockwise scrolls down unless inverted). On a card it moves focus one actionable button per
   * `cards.stepCounts` encoder counts, counted in one accumulator that restarts on a direction reversal. Rotation while
   * the wheel's click is held is discarded. The wheel never types, selects a task or runs during dictation.
   */
  #wheelTurn(delta: number): void {
    if (delta === 0) return;
    this.#lastTurnAt = this.#clock.now();
    if (this.#recordHeld || this.#chordDown || this.#held.has(this.#wheelClick())) return;
    const steps = this.#wheelDetent.turn(delta, this.#profile.cards.stepCounts);
    this.#stepsPending = Math.max(-MAX_PENDING_STEPS, Math.min(MAX_PENDING_STEPS, this.#stepsPending + steps));
    const { notchesPerStep, invert } = this.#profile.scroll;
    const notches = -delta * notchesPerStep * (invert ? -1 : 1);
    this.#scrollPending = Math.max(-MAX_PENDING_NOTCHES, Math.min(MAX_PENDING_NOTCHES, this.#scrollPending + notches));
    if (!this.#wheelBusy) this.#track(this.#drainWheel());
  }

  /** Drops pending wheel work, and partial rotation with it, so no earlier turn shortens a later card step. */
  #clearWheel(): void {
    this.#wheelDetent.reset();
    this.#scrollPending = 0;
    this.#stepsPending = 0;
  }

  /** The single wheel worker: turns that arrive while it waits coalesce. Nothing is retried. */
  async #drainWheel(): Promise<void> {
    this.#wheelBusy = true;
    try {
      while ((this.#scrollPending !== 0 || this.#stepsPending !== 0) && !this.#closed) {
        if (this.#recordHeld || this.#chordDown) return this.#clearWheel();
        const generation = this.#generation;
        const mode = await this.#wheelMode();
        // An invalidation cleared what was pending; re-read whatever arrived since.
        if (generation !== this.#generation) continue;
        if (this.#closed || this.#recordHeld || this.#chordDown) return this.#clearWheel();
        if (mode.kind === 'card') {
          this.#scrollPending = 0;
          const steps = this.#stepsPending;
          this.#stepsPending = 0;
          if (steps !== 0) await this.#cardStep(mode.client, mode.card, steps);
          continue;
        }
        if (mode.kind !== 'scroll') return this.#clearWheel();
        // Outside a card, rotation only scrolls: partial rotation never carries into the first step of a later card.
        this.#stepsPending = 0;
        this.#wheelDetent.reset();
        if (this.#scrollPending === 0) continue;
        const notches = Math.max(-MAX_NOTCHES_PER_CALL, Math.min(MAX_NOTCHES_PER_CALL, this.#scrollPending));
        this.#scrollPending -= notches;
        const { client } = mode;
        const scrolled = await this.#call(() => this.#adapter.scrollClient(client, notches));
        if (!scrolled.ok || scrolled.value.status !== 'known') {
          // Unknown: drop what is pending rather than retry; the next turn tries again.
          this.#scrollPending = 0;
          this.#log({ type: 'scroll-unknown', client, reason: reasonOf(scrolled) });
          return;
        }
        if (!scrolled.value.value) { this.#scrollPending = 0; return; }
      }
    } finally {
      this.#wheelBusy = false;
    }
  }

  /**
   * What the wheel does in the window in front: nothing for another app; scroll for a client at an unqualified
   * version (card selectors are version-dependent) or without a card; card steps on a card; and nothing at all
   * while the card state is unknown. A card observation is reused for `CARD_REUSE_MS`.
   */
  async #wheelMode(): Promise<WheelMode> {
    const window = await this.#call(() => this.#adapter.foregroundWindow());
    const client = window.ok && window.value.status === 'known' ? clientOf(window.value.value) : null;
    if (!client) { this.#card = null; this.#chosen = null; return { kind: 'none' }; }
    const cached = this.#card;
    let state: CardState;
    if (cached && cached.client === client && this.#clock.now() - cached.at < CARD_REUSE_MS) state = cached.state;
    else {
      const gate = await this.#versionGate(client);
      if (!gate.ok) { this.#card = null; return { kind: 'scroll', client }; }
      state = await this.#observeCard(client);
    }
    if (state.kind === 'card') return { kind: 'card', client, card: state.card };
    return state.kind === 'none' ? { kind: 'scroll', client } : { kind: 'inert' };
  }

  /** Reads the card in the client's window afresh and keeps it for the wheel. Unknown is logged with its reason. */
  async #observeCard(client: Client): Promise<CardState> {
    const answer = await this.#call(() => this.#adapter.cardButtons(client));
    let state: CardState;
    if (!answer.ok || answer.value.status !== 'known') {
      const reason = reasonOf(answer);
      state = { kind: 'unknown', reason };
      this.#log({ type: 'card-unknown', client, reason });
    } else state = answer.value.value ? { kind: 'card', card: { ...answer.value.value } } : { kind: 'none' };
    if (state.kind !== 'card' || this.#chosen?.client !== client || this.#chosen.cardId !== state.card.id) this.#chosen = null;
    this.#card = { client, at: this.#clock.now(), state };
    return state;
  }

  /**
   * Moves card focus by `steps`, stopping at the first and last button; the first step from no focus enters at an end.
   * A step that moved focus onto the requested stop, as the adapter's read-back confirms, makes it the wheel's choice
   * for the next click. A clamped step that could not move focus chooses nothing.
   */
  async #cardStep(client: Client, card: CardButtons, steps: number): Promise<void> {
    if (card.count === 0) return;
    const from = card.focused ?? (steps > 0 ? -1 : card.count);
    const index = Math.max(0, Math.min(card.count - 1, from + steps));
    if (index === card.focused) {
      // A step clamped at an end cannot move focus, so it chooses nothing and leaves any earlier choice from a real move
      // (owner decision on #821: approval comes from a click on a stop the wheel visibly moved to, never from a turn).
      this.#log({ type: 'card-step', client, index, count: card.count });
      return;
    }
    this.#stepping = true;
    try {
      const moved = await this.#call(() => this.#adapter.focusCardButton(client, card.id, index, card.count));
      if (!moved.ok || moved.value.status !== 'known') {
        this.#card = null;
        this.#chosen = null;
        this.#log({ type: 'card-step-failed', client, reason: reasonOf(moved) });
        return;
      }
      const focused = moved.value.value;
      this.#chosen = focused === index ? { client, cardId: card.id, index } : null;
      if (this.#card?.client === client && this.#card.state.kind === 'card') {
        this.#card = { client, at: this.#clock.now(), state: { kind: 'card', card: { id: card.id, count: card.count, focused } } };
      }
      this.#log({ type: 'card-step', client, index: focused, count: card.count });
    } finally {
      this.#stepping = false;
    }
  }

  // The Attention click on knob 4, or a black key mapped to `attention` (#865)

  /** Tasks on the profile's pages that wait for the owner, first seen first; none unless the feed is current. */
  #waiting(): { slot: number; sequence: number }[] {
    if (this.#feed.status !== 'current') return [];
    const capacity = this.#profile.pages.count * SLOT_COUNT;
    return this.#slots.entries()
      .filter(record => record.slot <= capacity && slotState(record, sessionsForSlot(record, this.#feed.sessions), this.#feed.status) === 'attention')
      .map(record => ({ slot: record.slot, sequence: this.#attentionSeen.get(slotKey(record)) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.sequence - b.sequence || a.slot - b.slot);
  }

  /**
   * Opens the task the bridge first saw waiting, through the slot key's open and verify path, and shows its page. A
   * press within `timing.attentionRepeatMs` of the last one moves on to the next waiting task, around to the first.
   * With nothing waiting, or a feed that is not current, it refuses with the error flash. It is navigation only: it
   * acknowledges nothing and changes no Hub state.
   */
  #attentionPress(control: number): void {
    const now = this.#clock.now();
    const waiting = this.#waiting();
    if (waiting.length === 0) {
      this.#log({ type: 'attention-refused', reason: this.#feed.status === 'current' ? 'none-waiting' : `feed-${this.#feed.status}` });
      const until = now + this.#profile.timing.errorFlashMs;
      if (control === PAGE_CLICK) this.#pageErrorUntil = until;
      else this.#keyErrors.set(control, until);
      this.#render();
      return;
    }
    const last = this.#lastAttention;
    const repeat = last !== null && now - last.at < this.#profile.timing.attentionRepeatMs;
    const target = (repeat ? waiting.find(w => w.sequence > last.sequence) : undefined) ?? waiting[0];
    this.#lastAttention = { at: now, sequence: target.sequence };
    const page = Math.ceil(target.slot / SLOT_COUNT);
    if (page !== this.#page) {
      this.#page = page;
      this.#pageDetent.reset();
      this.#log({ type: 'page', page, pages: this.#profile.pages.count });
    }
    this.#log({ type: 'attention-open', slot: target.slot, waiting: waiting.length });
    this.#slotPress(target.slot);
  }

  // The volume knob (#865)

  /**
   * A volume knob turn sends one volume key per `volume.stepCounts` encoder counts (clockwise raises the volume unless
   * inverted), with the reversal rule of the other detents. Volume keys target no window, so no window is checked.
   * While Record holds the dictation chord the knob is ignored, so a volume key never joins the chord.
   */
  #volumeTurn(delta: number): void {
    const { stepCounts, invert } = this.#profile.volume!;
    const steps = this.#volumeDetent.turn(delta, stepCounts);
    if (steps === 0) return;
    if (this.#recordHeld || this.#chordDown) return this.#volumeIgnored();
    const presses = invert ? -steps : steps;
    this.#volumePending = Math.max(-MAX_PENDING_VOLUME, Math.min(MAX_PENDING_VOLUME, this.#volumePending + presses));
    if (!this.#volumeBusy) this.#track(this.#drainVolume());
  }

  /** A volume knob click toggles mute, unless Record holds the dictation chord. */
  #volumeMute(): void {
    if (this.#recordHeld || this.#chordDown) return this.#volumeIgnored();
    this.#mutePending = !this.#mutePending;
    if (!this.#volumeBusy) this.#track(this.#drainVolume());
  }

  #volumeIgnored(): void {
    this.#log({ type: 'volume-ignored', reason: 'dictating' });
    this.#flashVolume();
  }

  #clearVolume(): void {
    this.#volumeDetent.reset();
    this.#volumePending = 0;
    this.#mutePending = false;
  }

  /** The single volume worker: turns that arrive while it waits coalesce. A failed volume key is never retried. */
  async #drainVolume(): Promise<void> {
    this.#volumeBusy = true;
    try {
      while ((this.#volumePending !== 0 || this.#mutePending) && !this.#closed) {
        if (this.#recordHeld || this.#chordDown) return this.#clearVolume();
        let key: VolumeKey;
        let presses = 1;
        if (this.#mutePending) {
          this.#mutePending = false;
          key = 'VolumeMute';
        } else {
          presses = Math.min(MAX_VOLUME_PRESSES, Math.abs(this.#volumePending));
          key = this.#volumePending > 0 ? 'VolumeUp' : 'VolumeDown';
          this.#volumePending -= Math.sign(this.#volumePending) * presses;
        }
        const sent = await this.#tap(() => this.#adapter.sendVolumeKey(key, presses));
        if (!sent.ok) {
          this.#log({ type: 'volume-failed', key, reason: sent.reason });
          this.#flashVolume();
          return this.#clearVolume();
        }
        this.#log({ type: 'volume', key, presses });
      }
    } finally {
      this.#volumeBusy = false;
    }
  }

  // Lights

  #flashVolume(): void {
    this.#volumeErrorUntil = this.#clock.now() + this.#profile.timing.errorFlashMs;
    this.#render();
  }

  /** The big-wheel LEDs show the error color briefly for a refused or uncertain Send or card press (owner, #821). */
  #flashWheel(): void {
    this.#wheelErrorUntil = this.#clock.now() + this.#profile.timing.errorFlashMs;
    this.#render();
  }

  #flash(slot: number): void {
    this.#errors.set(slot, this.#clock.now() + this.#profile.timing.errorFlashMs);
    this.#render();
  }

  // Pages (#822)

  /** The slot a key (1-15) shows on the visible page. */
  #slotOnPage(key: number): number { return (this.#page - 1) * SLOT_COUNT + key; }

  /**
   * A knob 4 turn pages the slot keys, one page per `pages.stepCounts` counts with the card steps' reversal rule,
   * stopping at the first and last page. Paging is never input: it calls no adapter, types, focuses or acknowledges
   * nothing, and only changes which slots the keys show.
   */
  #pageTurn(delta: number): void {
    const steps = this.#pageDetent.turn(delta, this.#profile.pages.stepCounts);
    if (steps === 0) return;
    const page = Math.max(1, Math.min(this.#profile.pages.count, this.#page + steps));
    if (page === this.#page) return;
    this.#page = page;
    this.#log({ type: 'page', page, pages: this.#profile.pages.count });
    this.#render();
  }

  /** Whether a slot outside the visible page, beyond the pages included, holds a task with attention. */
  #hiddenAttention(): boolean {
    const first = this.#slotOnPage(1);
    return this.#slots.entries().some(record => (record.slot < first || record.slot >= first + SLOT_COUNT)
      && slotState(record, sessionsForSlot(record, this.#feed.sessions), this.#feed.status) === 'attention');
  }

  #reportBeyondPages(): void {
    const count = this.#slots.beyondPages().length;
    if (count > 0) this.#log({ type: 'slots-beyond-pages', count, pages: this.#profile.pages.count });
  }

  #slotLights(now: number): SlotLight[] {
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const slot = this.#slotOnPage(i + 1);
      const record = this.#slots.get(slot);
      const until = this.#errors.get(slot);
      if (until !== undefined && until <= now) this.#errors.delete(slot);
      return {
        state: slotState(record, record ? sessionsForSlot(record, this.#feed.sessions) : [], this.#feed.status),
        error: until !== undefined && until > now,
      };
    });
  }

  #flashingKeys(now: number): Set<number> {
    for (const [control, until] of this.#keyErrors) if (until <= now) this.#keyErrors.delete(control);
    return new Set(this.#keyErrors.keys());
  }

  #render(force = false): void {
    if (this.#closed) return;
    const now = this.#clock.now();
    const half = Math.max(1, Math.floor(this.#profile.timing.attentionPulseMs / 2));
    const frame = renderFrame({
      profile: this.#profile, slots: this.#slotLights(now), recording: this.#chordDown, wheelError: now < this.#wheelErrorUntil,
      page: { number: this.#page, hiddenAttention: this.#hiddenAttention(), error: now < this.#pageErrorUntil },
      attentionWaiting: this.#waiting().length > 0, keyErrors: this.#flashingKeys(now), volumeError: now < this.#volumeErrorUntil,
      knobs: this.#knobs.lights(now),
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

  /** Runs one keystroke call that a Record press waits for, so the dictation chord never joins it. */
  async #tap<T>(operation: () => Promise<T>): Promise<Call<T>> {
    const call = this.#call(operation);
    this.#taps.add(call);
    try {
      return await call;
    } finally {
      this.#taps.delete(call);
    }
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
