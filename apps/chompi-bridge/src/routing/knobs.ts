import type { Clock } from '../clock.js';
import type { ClaudeSettings, Client, KeyName, OsAdapter, PickerMenu, PickerState } from '../os-adapter.js';
import { Detent } from './detent.js';
import type { KnobLight, SettingKnob } from './lights.js';
import type { RoutingProfile } from './profile.js';

/**
 * Knob 1 sets the model and knob 2 the reasoning effort of the Codex or Claude task in front (#906), through each
 * client's own controls as the 2026-10-06 qualification on #906 recorded them:
 *
 * - Claude model: `LeftControl`+`LeftShift`+`I` opens the `Model: <current>` menu; Up and Down move its focus; Enter on a
 *   focused model option applies it. Readback: the composer's `Model: <name>` button and the session record's `model`.
 * - Claude effort: `LeftControl`+`LeftShift`+`E` opens the `Effort` slider; Right and Left apply one level at once.
 *   Readback: the composer's `Effort: <level>` button and the session record's `effort`. No Effort button (Haiku) is
 *   unsupported.
 * - Codex: `LeftControl`+`LeftShift`+`M` opens the `Select effort` picker with "Select model" focused. Model: Enter there
 *   opens the model list; Up and Down move; Enter applies the focused model and the picker stays open, so the bridge
 *   closes it. Effort: Down to "Power", then Right or Left. Readback: the picker's announcement
 *   (`<model> <level>, <n> of <count>.`), whose count is read each time. Without the picker, the owner's effort chords
 *   from the profile are a fallback that cannot be confirmed.
 *
 * Every keystroke goes through `tapInClient`, so it reaches only the expected client in front. Enter is pressed only on
 * a focused entry of the menu this flow opened, and Escape only into an open menu or slider this flow opened, each
 * confirmed by a fresh read just before. One flow runs at a time; the router closes it before any other control acts.
 * Applied, mismatch, unverified and unsupported outcomes are logged apart, and nothing is retried.
 */

export type Call<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'rejected' };
type Check = { ok: true } | { ok: false; reason: string };

/** What the knobs need from the router. */
export interface KnobHost {
  readonly adapter: OsAdapter;
  readonly clock: Clock;
  profile(): RoutingProfile;
  log(event: { type: string; [field: string]: unknown }): void;
  /** One adapter call under the profile's timeout. */
  call<T>(operation: () => Promise<T>): Promise<Call<T>>;
  /** One keystroke call that a Record press waits for. */
  tap<T>(operation: () => Promise<T>): Promise<Call<T>>;
  sleep(ms: number): Promise<void>;
  /** The Codex or Claude window in front, or why there is none. */
  frontClient(): Promise<{ ok: true; client: Client } | { ok: false; reason: string }>;
  versionGate(client: Client): Promise<{ ok: true } | { ok: false; reason: string; observed: string | null }>;
  /** Whether the client's window shows an approval or question card. */
  card(client: Client): Promise<'none' | 'card' | 'unknown'>;
  composer(client: Client): Promise<Check>;
  /** The Claude Desktop session in front, when the router can tell it from the sessions it knows; null otherwise. */
  claudeFront(): Promise<string | null>;
  /** Why knob input must not run now (Record held, a Send or a task focus in progress), or null. */
  blocked(): string | null;
  closed(): boolean;
  render(): void;
  /** Asks the router to close the open flow when it may, after the knob's timeout. */
  requestClose(reason: string): void;
}

const CLAUDE_MODEL_SHORTCUT: readonly KeyName[] = ['LeftControl', 'LeftShift', 'I'];
const CLAUDE_EFFORT_SHORTCUT: readonly KeyName[] = ['LeftControl', 'LeftShift', 'E'];
const CODEX_PICKER_SHORTCUT: readonly KeyName[] = ['LeftControl', 'LeftShift', 'M'];
const CLAUDE_MODEL_MENU = 'Model: ';
const CLAUDE_EFFORT_SLIDER = 'Effort';
const CODEX_PICKER = 'Select effort';
const CODEX_SELECT_MODEL = 'Select model';
const CODEX_POWER = 'Power';
/** Bound on knob steps waiting while a step runs. */
const MAX_PENDING_STEPS = 16;
/** How long a step waits to see menu focus move before it reads the menu as it is. */
const FOCUS_READBACK_MS = 400;
/** Escapes per close: the Codex model list closes to the picker, which then closes. */
const MAX_ESCAPES = 2;

type Surface = 'claude-model' | 'claude-effort' | 'codex-main' | 'codex-list' | 'codex-chord';
interface Flow {
  knob: SettingKnob;
  client: Client;
  surface: Surface;
  /** The Codex model list's label and options, read when it opened. */
  list?: { label: string; options: string[] };
  /** Claude: the session in front, for the record readback; null when not identified. */
  session: string | null;
}
type Outcome = 'applied' | 'mismatch' | 'unverified';
type Pressed = 'sent' | 'not-front' | 'uncertain';

const LIGHT_OF: Readonly<Record<Outcome | 'unsupported' | 'at-limit', KnobLight>> = { applied: 'applied', unverified: 'unverified', mismatch: 'error', unsupported: 'error', 'at-limit': 'error' };

const focusedItem = (menu: PickerMenu) => menu.focused === null ? undefined : menu.items[menu.focused];

/** The longest option label the announcement starts with: `GPT-6 Astra` in `GPT-6 Astra Extended`. */
function announcedOption(announcement: string, options: readonly string[]): string | undefined {
  return [...options].sort((a, b) => b.length - a.length).find(option => announcement === option || announcement.startsWith(`${option} `));
}

export class SettingKnobs {
  readonly #host: KnobHost;
  readonly #detents: Record<SettingKnob, Detent> = { model: new Detent(), effort: new Detent() };
  #pending = 0;
  #pendingKnob: SettingKnob | null = null;
  #worker: Promise<void> | null = null;
  #workerKnob: SettingKnob | null = null;
  #flow: Flow | null = null;
  #cancel = false;
  #closing: Promise<void> | null = null;
  readonly #lastTurnAt: Record<SettingKnob, number> = { model: Number.NEGATIVE_INFINITY, effort: Number.NEGATIVE_INFINITY };
  readonly #flash: Partial<Record<SettingKnob, { light: KnobLight; until: number }>> = {};
  #timer: unknown = undefined;

  constructor(host: KnobHost) { this.#host = host; }

  /** A flow is open, running or closing: another control must wait for `close`. */
  get busy(): boolean { return this.#flow !== null || this.#worker !== null || this.#closing !== null; }

  /** Whether `knob`'s own turns and clicks belong to the running flow, so they need no close first. */
  owns(knob: SettingKnob | null): boolean {
    return knob !== null && this.#closing === null && (this.#flow?.knob === knob || this.#workerKnob === knob);
  }

  /** What knob 1's and knob 2's LEDs show now. */
  lights(now: number): Partial<Record<SettingKnob, KnobLight>> {
    const lights: Partial<Record<SettingKnob, KnobLight>> = {};
    for (const knob of ['model', 'effort'] as const) {
      const flash = this.#flash[knob];
      if (flash && flash.until > now) lights[knob] = flash.light;
      else if (this.#flow?.knob === knob && this.#flow.surface !== 'codex-chord') lights[knob] = 'open';
    }
    return lights;
  }

  /** A knob turn: one step per `stepCounts` counts, with the reversal rule of the other knobs. */
  turn(knob: SettingKnob, delta: number): void {
    const settings = this.#host.profile()[knob];
    if (!settings || delta === 0) return;
    this.#lastTurnAt[knob] = this.#host.clock.now();
    const steps = this.#detents[knob].turn(delta, settings.stepCounts);
    if (steps === 0) return;
    const blocked = this.#host.blocked();
    if (blocked) {
      this.#detents[knob].reset();
      return this.#refuse(knob, blocked);
    }
    if (this.#pendingKnob !== knob) this.#pending = 0;
    this.#pendingKnob = knob;
    this.#pending = Math.max(-MAX_PENDING_STEPS, Math.min(MAX_PENDING_STEPS, this.#pending + (settings.invert ? -steps : steps)));
    this.#clearTimer();
    if (!this.#worker) this.#startWorker(knob, () => this.#drain(knob));
  }

  /** Knob 1's still click picks the focused model; knob 2's click closes its effort control. */
  click(knob: SettingKnob, pressedAt: number): void {
    if (knob === 'effort') {
      if (this.#flow?.knob === 'effort' || this.#workerKnob === 'effort') void this.close('click');
      return;
    }
    const settings = this.#host.profile().model;
    if (!settings) return;
    if (this.#worker) return this.#refuse('model', 'knob-busy');
    const flow = this.#flow;
    if (!flow || flow.knob !== 'model' || (flow.surface !== 'claude-model' && flow.surface !== 'codex-list')) return this.#refuse('model', 'menu-not-open');
    if (pressedAt - this.#lastTurnAt.model < settings.clickStillMs) return this.#refuse('model', 'knob-moving', { client: flow.client });
    this.#clearTimer();
    this.#startWorker('model', () => this.#pick(flow));
  }

  /**
   * Stops the running flow and closes what it opened, with Escape only into a menu or slider confirmed open. Concurrent
   * calls share one close.
   */
  close(reason: string): Promise<void> {
    if (this.#closing) return this.#closing;
    if (!this.#flow && !this.#worker) return Promise.resolve();
    this.#clearTimer();
    this.#closing = (async () => {
      this.#cancel = true;
      try {
        await this.#worker;
      } finally {
        this.#cancel = false;
      }
      this.#pending = 0;
      await this.#closeFlow(reason);
    })().finally(() => {
      this.#closing = null;
      this.#host.render();
    });
    return this.#closing;
  }

  /** Drops partial rotation and waiting steps; an open flow stays until it is closed. */
  reset(): void {
    this.#detents.model.reset();
    this.#detents.effort.reset();
    this.#pending = 0;
  }

  dispose(): void {
    this.#clearTimer();
    this.#cancel = true;
  }

  // Workers

  #startWorker(knob: SettingKnob, work: () => Promise<void>): void {
    this.#workerKnob = knob;
    this.#worker = (async () => {
      // Start after this call returns, so the worker is registered before any of its work runs.
      await Promise.resolve();
      try {
        await work();
      } catch (error) {
        this.#host.log({ type: 'router-error', message: (error as Error).message });
      } finally {
        this.#worker = null;
        this.#workerKnob = null;
        this.#armTimer();
        this.#host.render();
      }
    })();
  }

  /** The single knob worker: turns that arrive while it waits for the client coalesce. */
  async #drain(knob: SettingKnob): Promise<void> {
    while (this.#pending !== 0 && this.#pendingKnob === knob && this.#live()) {
      const blocked = this.#host.blocked();
      if (blocked) {
        this.#pending = 0;
        return this.#refuse(knob, blocked);
      }
      const direction = Math.sign(this.#pending);
      this.#pending -= direction;
      if (!this.#flow) {
        if (!(await this.#open(knob))) { this.#pending = 0; return; }
        // The first model detent only opens the menu (its first Down focuses the first entry); an effort detent opens
        // the control and applies its step.
        if (knob === 'model' || !this.#live() || !this.#flow) continue;
      }
      if (knob === 'model') await this.#modelStep(direction);
      else await this.#effortStep(direction);
    }
  }

  #live(): boolean { return !this.#cancel && !this.#host.closed(); }

  // Opening

  /** The client in front when knob input may open its control: qualified, no card, no open menu; Claude's composer focused. */
  async #precheck(knob: SettingKnob): Promise<{ client: Client; state: PickerState } | null> {
    const front = await this.#host.frontClient();
    if (!this.#live()) return null;
    if (!front.ok) { this.#refuse(knob, front.reason); return null; }
    const { client } = front;
    const gate = await this.#host.versionGate(client);
    if (!this.#live()) return null;
    if (!gate.ok) { this.#refuse(knob, gate.reason, { client, observedVersion: gate.observed }); return null; }
    const card = await this.#host.card(client);
    if (!this.#live()) return null;
    if (card !== 'none') { this.#refuse(knob, card === 'card' ? 'card-open' : 'card-unknown', { client }); return null; }
    const state = await this.#state(client);
    if (!this.#live()) return null;
    if (!state) { this.#refuse(knob, 'picker-unknown', { client }); return null; }
    if (state.menu || state.slider) { this.#refuse(knob, 'menu-open', { client }); return null; }
    if (client === 'claude') {
      const composer = await this.#host.composer(client);
      if (!this.#live()) return null;
      if (!composer.ok) { this.#refuse(knob, composer.reason, { client }); return null; }
    }
    return { client, state };
  }

  async #open(knob: SettingKnob): Promise<boolean> {
    const checked = await this.#precheck(knob);
    if (!checked) return false;
    const { client, state } = checked;
    if (knob === 'effort' && client === 'claude' && state.effort === null) {
      // Claude shows no Effort button for a model without an effort setting, such as Haiku.
      this.#host.log({ type: 'effort', client, route: 'slider', outcome: 'unsupported', reason: 'no-effort-control' });
      this.#show(knob, LIGHT_OF.unsupported);
      return false;
    }
    if (client === 'claude') {
      const session = await this.#host.claudeFront();
      if (!this.#live()) return false;
      return knob === 'model' ? this.#openClaude('model', session) : this.#openClaude('effort', session);
    }
    return knob === 'model' ? this.#openCodexList() : this.#openCodexPower();
  }

  async #openClaude(knob: SettingKnob, session: string | null): Promise<boolean> {
    this.#flow = { knob, client: 'claude', surface: knob === 'model' ? 'claude-model' : 'claude-effort', session };
    if (!(await this.#pressOpening(knob, 'claude', knob === 'model' ? CLAUDE_MODEL_SHORTCUT : CLAUDE_EFFORT_SHORTCUT))) return false;
    const flow = this.#flow;
    const opened = await this.#waitFor('claude', s => (knob === 'model' ? this.#flowMenu(flow, s) : s.slider === CLAUDE_EFFORT_SLIDER) ? s : null, this.#verifyMs());
    if (!this.#live()) return false;
    if (!opened) { await this.#abort(knob, knob === 'model' ? 'menu-not-open' : 'slider-not-open'); return false; }
    this.#opened(flow, knob === 'model' ? { count: opened.menu!.items.length } : {});
    return true;
  }

  /** Opens Codex's picker and waits for it with "Select model" focused; false (and logged) when it does not open. */
  async #openCodexPicker(knob: SettingKnob): Promise<PickerMenu | null> {
    this.#flow = { knob, client: 'codex', surface: 'codex-main', session: null };
    if (!(await this.#pressOpening(knob, 'codex', CODEX_PICKER_SHORTCUT))) return null;
    const flow = this.#flow;
    const main = await this.#waitFor('codex', s => {
      const menu = this.#flowMenu(flow, s);
      const item = menu && focusedItem(menu);
      return item?.kind === 'action' && item.label === CODEX_SELECT_MODEL ? menu : null;
    }, this.#verifyMs());
    return this.#live() ? main : null;
  }

  async #openCodexList(): Promise<boolean> {
    const main = await this.#openCodexPicker('model');
    if (!this.#live() || !this.#flow) return false;
    if (!main) { await this.#abort('model', 'menu-not-open'); return false; }
    // Enter only on the picker's focused "Select model", confirmed by the read just above.
    const pressed = await this.#press('codex', ['Enter']);
    if (pressed !== 'sent') { await this.#abort('model', pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain'); return false; }
    const flow = this.#flow;
    const list = await this.#waitFor('codex', s => {
      const menu = s.menu;
      const item = menu && focusedItem(menu);
      return menu && menu.label !== CODEX_PICKER && item?.kind === 'option' ? menu : null;
    }, this.#verifyMs());
    if (!this.#live()) return false;
    if (!list) { await this.#abort('model', 'list-not-open'); return false; }
    flow.surface = 'codex-list';
    flow.list = { label: list.label, options: list.items.filter(item => item.kind === 'option').map(item => item.label) };
    this.#opened(flow, { count: list.items.length });
    return true;
  }

  async #openCodexPower(): Promise<boolean> {
    const main = await this.#openCodexPicker('effort');
    if (!this.#live() || !this.#flow) return false;
    let menu = main;
    const flow = this.#flow;
    // Down from "Select model" to "Power", one entry at a time, each move read back; never Enter.
    for (let moves = 0; menu && moves < menu.items.length && focusedItem(menu)?.label !== CODEX_POWER; moves++) {
      const from = menu.focused;
      const pressed = await this.#press('codex', ['Down']);
      if (!this.#live()) return false;
      if (pressed !== 'sent') { await this.#abort('effort', pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain'); return false; }
      menu = await this.#waitFor('codex', s => { const m = this.#flowMenu(flow, s); return m && m.focused !== from ? m : null; }, FOCUS_READBACK_MS);
      if (!this.#live()) return false;
    }
    const power = menu && focusedItem(menu);
    if (power?.kind === 'action' && power.label === CODEX_POWER) {
      this.#opened(flow, { count: menu!.items.length });
      return true;
    }
    // No picker or no Power entry: close what opened, then use the owner's chords, or report unsupported.
    await this.#closeFlow(main ? 'power-unavailable' : 'menu-not-open');
    if (!this.#live()) return false;
    const { codexEffortIncrease, codexEffortDecrease } = this.#host.profile().shortcuts;
    if (codexEffortIncrease && codexEffortDecrease) {
      this.#flow = { knob: 'effort', client: 'codex', surface: 'codex-chord', session: null };
      this.#host.log({ type: 'knob-menu', knob: 'effort', client: 'codex', action: 'opened', route: 'chord' });
      return true;
    }
    this.#host.log({ type: 'effort', client: 'codex', route: 'picker', outcome: 'unsupported', reason: main ? 'power-unavailable' : 'menu-not-open' });
    this.#show('effort', LIGHT_OF.unsupported);
    return false;
  }

  /** Types an opening shortcut; on failure ends the flow (closing anything that opened) and refuses. */
  async #pressOpening(knob: SettingKnob, client: Client, keys: readonly KeyName[]): Promise<boolean> {
    const pressed = await this.#press(client, keys);
    if (!this.#live()) return false;
    if (pressed === 'sent') return true;
    if (pressed === 'not-front') {
      this.#flow = null;
      this.#refuse(knob, 'foreground-changed', { client });
    } else await this.#abort(knob, 'key-uncertain');
    return false;
  }

  #opened(flow: Flow, extra: Record<string, unknown>): void {
    this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'opened', ...extra });
    this.#host.render();
  }

  // Steps

  async #modelStep(direction: number): Promise<void> {
    const flow = this.#flow!;
    const state = await this.#state(flow.client);
    if (!this.#live()) return;
    const menu = state && this.#flowMenu(flow, state);
    if (!menu) return this.#lost(state ? 'menu-gone' : 'picker-unknown');
    const count = menu.items.length;
    let key: KeyName;
    if (menu.focused === null) key = 'Down'; // Claude opens with no entry focused; the first Down focuses the first entry.
    else {
      const target = Math.max(0, Math.min(count - 1, menu.focused + direction));
      if (target === menu.focused) {
        this.#host.log({ type: 'model-step', client: flow.client, index: menu.focused, count, clamped: true });
        return;
      }
      key = direction > 0 ? 'Down' : 'Up';
    }
    const pressed = await this.#press(flow.client, [key]);
    if (!this.#live()) return;
    if (pressed !== 'sent') return this.#lost(pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain', true);
    const after = await this.#waitFor(flow.client, s => { const m = this.#flowMenu(flow, s); return m && m.focused !== menu.focused ? m : null; }, FOCUS_READBACK_MS)
      ?? (await this.#menuNow(flow));
    if (!this.#live()) return;
    if (!after) return this.#lost('menu-gone');
    this.#host.log({ type: 'model-step', client: flow.client, index: after.focused, count: after.items.length });
  }

  /** Knob 1's still click: Enter on the focused model option of the open model menu or list, then the readback. */
  async #pick(flow: Flow): Promise<void> {
    const state = await this.#state(flow.client);
    if (!this.#live()) return;
    const menu = state && this.#flowMenu(flow, state);
    if (!menu) return this.#lost(state ? 'menu-gone' : 'picker-unknown', true);
    const item = focusedItem(menu);
    if (!item || item.kind !== 'option') return this.#refuse('model', 'nothing-chosen', { client: flow.client });
    const index = menu.focused!;
    const count = menu.items.length;
    const previous = menu.items.find(entry => entry.selected)?.label ?? null;
    const before = flow.client === 'claude' && flow.session ? await this.#settings(flow.session) : null;
    if (!this.#live()) return;
    const pressed = await this.#press(flow.client, ['Enter']);
    if (pressed === 'not-front') return this.#lost('foreground-changed', true);
    const log = (outcome: Outcome, extra: Record<string, unknown> = {}) => {
      this.#host.log({ type: 'model', client: flow.client, outcome, index, count, ...extra });
      this.#show('model', LIGHT_OF[outcome]);
    };
    if (pressed === 'uncertain') {
      log('unverified', { reason: 'key-uncertain' });
      return this.#closeFlow('picked');
    }
    if (flow.client === 'claude') {
      // Applied: the composer's Model button names the pick, and the session record's `model` changed when the pick did.
      const recordBefore = before?.model ?? null;
      const needRecord = recordBefore !== null && item.label !== previous;
      // Assigned inside the poll; the casts keep TypeScript from narrowing them to their first value.
      let button = null as string | null, record = 'unknown' as 'unchanged' | 'unknown';
      const applied = await this.#waitFor('claude', async s => {
        if (s.menu) return null;
        button = s.model;
        if (button !== item.label) return null;
        if (!needRecord) return true;
        const now = await this.#settings(flow.session!);
        record = now ? 'unchanged' : 'unknown';
        return now && now.model !== recordBefore ? true : null;
      }, this.#verifyMs());
      // Enter closed Claude's menu: nothing is left to close.
      this.#flow = null;
      this.#host.render();
      if (!this.#live()) return log('unverified', { reason: 'interrupted' });
      if (applied) return log('applied', { evidence: needRecord ? 'button-and-record' : 'button' });
      if (button === null) return log('unverified', { reason: 'readback-unknown' });
      if (button !== item.label) return log('mismatch', { reason: 'model-differs' });
      return record === 'unknown' ? log('unverified', { reason: 'record-unknown' }) : log('mismatch', { reason: 'record-unchanged' });
    }
    // Codex returns to its picker, which stays open, and announces the model and level.
    const options = flow.list?.options ?? [];
    let announced = undefined as string | undefined, heard = false as boolean;
    const applied = await this.#waitFor('codex', s => {
      if (s.menu?.label !== CODEX_PICKER || !s.announcement) return null;
      heard = true;
      announced = announcedOption(s.announcement.label, options);
      return announced === item.label ? true : null;
    }, this.#verifyMs());
    // The picker stays open after a pick: the flow now closes it.
    flow.surface = 'codex-main';
    if (!this.#live()) return log('unverified', { reason: 'interrupted' });
    if (applied) log('applied', { evidence: 'announcement' });
    else if (!heard) log('unverified', { reason: 'readback-unknown' });
    else if (announced) log('mismatch', { reason: 'model-differs' });
    else log('unverified', { reason: 'announcement-unmatched' });
    await this.#closeFlow('picked');
  }

  async #effortStep(direction: number): Promise<void> {
    const flow = this.#flow!;
    if (flow.surface === 'codex-chord') return this.#chordStep(direction);
    const route = flow.client === 'claude' ? 'slider' : 'picker';
    const log = (outcome: Outcome | 'at-limit', extra: Record<string, unknown> = {}) => {
      this.#host.log({ type: 'effort', client: flow.client, route, direction: direction > 0 ? 'up' : 'down', outcome, ...extra });
      this.#show('effort', LIGHT_OF[outcome]);
    };
    const state = await this.#state(flow.client);
    if (!this.#live()) return;
    const key: KeyName = direction > 0 ? 'Right' : 'Left';
    if (flow.client === 'claude') {
      if (state?.slider !== CLAUDE_EFFORT_SLIDER) return this.#lost(state ? 'slider-gone' : 'picker-unknown');
      const button = state.effort;
      const recordBefore = flow.session ? (await this.#settings(flow.session))?.effort ?? null : null;
      if (!this.#live()) return;
      const pressed = await this.#press('claude', [key]);
      if (pressed !== 'sent') return this.#lost(pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain', true);
      // Applied: the Effort button shows another level, and the session record's `effort` changed with it.
      let seen = null as string | null, record = 'unknown' as 'unchanged' | 'unknown';
      const applied = await this.#waitFor('claude', async s => {
        if (s.effort === null) return null;
        seen = s.effort;
        if (button === null || seen === button) return null;
        if (recordBefore === null) return true;
        const now = await this.#settings(flow.session!);
        record = now ? 'unchanged' : 'unknown';
        return now && now.effort !== recordBefore ? true : null;
      }, this.#verifyMs());
      if (!this.#live()) return log('unverified', { reason: 'interrupted' });
      if (applied) return log('applied', { evidence: recordBefore === null ? 'button' : 'button-and-record' });
      if (seen === null || button === null) return log('unverified', { reason: 'readback-unknown' });
      if (seen === button) return log('mismatch', { reason: 'unchanged' });
      return record === 'unknown' ? log('unverified', { reason: 'record-unknown' }) : log('mismatch', { reason: 'record-unchanged' });
    }
    const menu = state && this.#flowMenu(flow, state);
    if (!menu || focusedItem(menu)?.label !== CODEX_POWER) return this.#lost(state ? 'power-gone' : 'picker-unknown');
    const before = state.announcement;
    // The level count comes from the announcement each time: it differs by model.
    if (before && ((direction > 0 && before.position >= before.count) || (direction < 0 && before.position <= 1))) {
      return log('at-limit', { position: before.position, count: before.count });
    }
    const pressed = await this.#press('codex', [key]);
    if (pressed !== 'sent') return this.#lost(pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain', true);
    let after = null as PickerState['announcement'];
    const moved = await this.#waitFor('codex', s => {
      if (s.menu?.label !== CODEX_PICKER || !s.announcement) return null;
      after = s.announcement;
      return before && (after.position !== before.position || after.count !== before.count) ? after : null;
    }, this.#verifyMs());
    if (!this.#live()) return log('unverified', { reason: 'interrupted' });
    const heard = after;
    if (!before || !heard) return log('unverified', { reason: before ? 'readback-unknown' : 'no-baseline', ...(heard ? { position: heard.position, count: heard.count } : {}) });
    if (moved && moved.count === before.count && moved.position === before.position + direction) return log('applied', { position: moved.position, count: moved.count });
    return log('mismatch', { reason: moved ? 'level-differs' : 'unchanged', position: heard.position, count: heard.count });
  }

  /** The owner's Codex effort chord, only with Codex qualified and confirmed in front and no card. It cannot be confirmed. */
  async #chordStep(direction: number): Promise<void> {
    const front = await this.#host.frontClient();
    if (!this.#live()) return;
    if (!front.ok || front.client !== 'codex') return this.#lost(front.ok ? 'not-codex' : front.reason, true);
    const gate = await this.#host.versionGate('codex');
    if (!this.#live()) return;
    if (!gate.ok) return this.#lost(gate.reason, true);
    const card = await this.#host.card('codex');
    if (!this.#live()) return;
    if (card !== 'none') return this.#lost(card === 'card' ? 'card-open' : 'card-unknown', true);
    const { codexEffortIncrease, codexEffortDecrease } = this.#host.profile().shortcuts;
    const keys = direction > 0 ? codexEffortIncrease : codexEffortDecrease;
    if (!keys) return this.#lost('chords-removed', true);
    const pressed = await this.#press('codex', keys);
    if (!this.#live()) return;
    if (pressed === 'not-front') return this.#lost('foreground-changed', true);
    this.#host.log({ type: 'effort', client: 'codex', route: 'chord', direction: direction > 0 ? 'up' : 'down', outcome: 'unverified', reason: pressed === 'sent' ? 'no-readback' : 'key-uncertain' });
    this.#show('effort', LIGHT_OF.unverified);
  }

  // Closing

  /** Ends the flow after a failure while opening: closes anything that opened, then refuses. */
  async #abort(knob: SettingKnob, reason: string): Promise<void> {
    const client = this.#flow?.client;
    await this.#closeFlow(reason);
    this.#refuse(knob, reason, client ? { client } : {});
  }

  /** The flow ended without the bridge closing anything: the control is gone, unreadable or no longer in front. */
  #lost(reason: string, flash = false): void {
    const flow = this.#flow;
    this.#flow = null;
    this.#pending = 0;
    this.#clearTimer();
    if (flow) this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'closed', reason, escapes: 0 });
    if (flash && flow) this.#show(flow.knob, 'error');
    this.#host.render();
  }

  /** Escape, at most twice, each only into this flow's menu or slider confirmed open in the client in front. */
  async #closeFlow(reason: string): Promise<void> {
    const flow = this.#flow;
    this.#flow = null;
    this.#clearTimer();
    if (!flow) return;
    let escapes = 0;
    if (flow.surface !== 'codex-chord') {
      while (escapes < MAX_ESCAPES && !this.#host.closed()) {
        const state = await this.#state(flow.client);
        if (!state || !this.#closable(flow, state)) break;
        const pressed = await this.#press(flow.client, ['Escape']);
        if (pressed !== 'sent') break;
        escapes += 1;
      }
    }
    this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'closed', reason, escapes });
    this.#host.render();
  }

  /** Whether this flow's own control is open with focus in it, so Escape closes it and nothing else. */
  #closable(flow: Flow, state: PickerState): boolean {
    if (flow.surface === 'claude-effort') return state.slider === CLAUDE_EFFORT_SLIDER;
    if (flow.surface === 'claude-model') return this.#flowMenu(flow, state) !== null;
    // Codex: the picker, or a model list opened from it (its label is known once it was confirmed).
    const menu = state.menu;
    if (!menu) return false;
    return menu.label === CODEX_PICKER || (flow.list ? menu.label === flow.list.label : menu.items.some(item => item.kind === 'option'));
  }

  // Reads and keys

  /** The flow's own menu when it holds focus: Claude's `Model: ...` menu, Codex's picker or the model list it opened. */
  #flowMenu(flow: Flow, state: PickerState): PickerMenu | null {
    const menu = state.menu;
    if (!menu) return null;
    if (flow.surface === 'claude-model') return menu.label.startsWith(CLAUDE_MODEL_MENU) && menu.items.some(item => item.kind === 'option') ? menu : null;
    if (flow.surface === 'codex-main') return menu.label === CODEX_PICKER ? menu : null;
    if (flow.surface === 'codex-list') return flow.list && menu.label === flow.list.label ? menu : null;
    return null;
  }

  async #menuNow(flow: Flow): Promise<PickerMenu | null> {
    const state = await this.#state(flow.client);
    return state && this.#flowMenu(flow, state);
  }

  async #state(client: Client): Promise<PickerState | null> {
    const answer = await this.#host.call(() => this.#host.adapter.pickerState(client));
    return answer.ok && answer.value.status === 'known' ? answer.value.value : null;
  }

  async #settings(localId: string): Promise<ClaudeSettings | null> {
    const answer = await this.#host.call(() => this.#host.adapter.claudeSettings(localId));
    return answer.ok && answer.value.status === 'known' ? answer.value.value : null;
  }

  async #press(client: Client, keys: readonly KeyName[]): Promise<Pressed> {
    const sent = await this.#host.tap(() => this.#host.adapter.tapInClient(client, keys, 1));
    if (!sent.ok || sent.value.status !== 'known') return 'uncertain';
    return sent.value.value ? 'sent' : 'not-front';
  }

  /** Polls the client's controls every `verifyPollMs` until `test` answers, within `withinMs`; null on timeout or cancel. */
  async #waitFor<T>(client: Client, test: (state: PickerState) => T | null | Promise<T | null>, withinMs: number): Promise<T | null> {
    const { verifyPollMs } = this.#host.profile().timing;
    const start = this.#host.clock.now();
    for (;;) {
      const state = await this.#state(client);
      if (!this.#live()) return null;
      const found = state ? await test(state) : null;
      if (!this.#live()) return null;
      if (found !== null) return found;
      if (this.#host.clock.now() - start + verifyPollMs > withinMs) return null;
      await this.#host.sleep(verifyPollMs);
      if (!this.#live()) return null;
    }
  }

  #verifyMs(): number { return this.#host.profile().timing.verifyTimeoutMs; }

  // Feedback and the timeout

  #refuse(knob: SettingKnob, reason: string, extra: Record<string, unknown> = {}): void {
    this.#host.log({ type: 'knob-refused', knob, reason, ...extra });
    this.#show(knob, 'error');
  }

  #show(knob: SettingKnob, light: KnobLight): void {
    this.#flash[knob] = { light, until: this.#host.clock.now() + this.#host.profile().timing.errorFlashMs };
    this.#host.render();
  }

  #armTimer(): void {
    this.#clearTimer();
    if (!this.#flow || this.#host.closed()) return;
    const timer = this.#host.clock.setTimeout(() => {
      if (this.#timer !== timer) return;
      this.#timer = undefined;
      this.#host.requestClose('timeout');
    }, this.#host.profile().timing.menuTimeoutMs);
    this.#timer = timer;
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) this.#host.clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
