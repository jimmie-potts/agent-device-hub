import type { Clock } from '../clock.js';
import type { ClaudeSettings, Client, KeyName, MenuKind, Observation, OsAdapter, PickerMenu, PickerState, SettingControl } from '../os-adapter.js';
import { Detent } from './detent.js';
import type { KnobLight, SettingKnob } from './lights.js';
import type { RoutingProfile } from './profile.js';

/**
 * Knob 1 sets the model and knob 2 the reasoning effort of the Codex or Claude task in front (#906), through each
 * client's own controls as the 2026-10-06 keystroke-free qualification on #906 recorded them. UI Automation actions do
 * the work wherever the client allows it; each re-reads its target before acting and refuses on any difference.
 *
 * - Claude model: expand the `Model: <name>` button, move focus over the model options (`SetFocus`, read back), and on
 *   knob 1's still click `Select` the focused option, which applies it and closes the menu. Without a pick, `Collapse`.
 *   Either way the composer gets focus back, so Play still works. Readback: the button and the session record's `model`.
 * - Claude effort: expand the `Effort: <level>` button and set the slider one `SmallChange` per detent within its range;
 *   at an end nothing is set (`at-limit`). Readback: the button and the record's `effort`. Then `Collapse`.
 * - Codex model: expand the picker button, invoke "Select model", move focus over the model list and `Select` the
 *   focused option; Codex returns to its picker. Readback: the closed picker button's `<model> <effort>` name.
 * - Codex effort: the owner's chords, sent only with Codex in front, no card and the picker closed, confirmed by the
 *   picker button's name. Without chords, the picker's Power entry with Right and Left, read from its announcement.
 * - Codex's picker does not close on `Collapse`: the bridge sends exactly one Escape, only after a fresh read shows its
 *   picker holding focus, then waits a bounded time for the button to read collapsed and never sends a second one. A
 *   model list left without a pick first gets `Select` on the current model, which returns to the picker unchanged.
 *
 * The knobs never press Enter. Their only keys are that one Escape, the owner's chords and, without chords, Right and
 * Left on a focused Power entry, all through `tapInClient`. One flow runs at a time; the router closes it before any
 * other control acts. Applied, mismatch, unverified, unsupported and at-limit outcomes are logged apart; nothing is
 * retried, and an end of range, a mismatch or a lost control drops the detents still waiting.
 */

export type Call<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'rejected' };

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
  /** The Claude Desktop session in front, when the router can tell it from the sessions it knows; null otherwise. */
  claudeFront(): Promise<string | null>;
  /** Why knob input must not run now (Record held, a Send or a task focus in progress), or null. */
  blocked(): string | null;
  closed(): boolean;
  render(): void;
  /** Asks the router to close the open flow when it may, after the knob's timeout. */
  requestClose(reason: string): void;
}

const CODEX_POWER = 'Power';
/** Bound on knob steps waiting while a step runs. */
const MAX_PENDING_STEPS = 16;
/** Floating-point slack for slider bounds. */
const EPSILON = 1e-9;
/**
 * How long a read that gates an action waits for its condition. UI Automation can lag a change (F1 on #915): one stale
 * read must neither trigger a second action nor make the bridge skip closing what it opened, so these reads poll briefly.
 */
const SETTLE_MS = 400;

type Surface = 'claude-model' | 'claude-effort' | 'codex-picker' | 'codex-models' | 'codex-power';
interface Flow {
  knob: SettingKnob;
  client: Client;
  surface: Surface;
  /** Claude: the session in front, for the record readback; null when not identified. */
  session: string | null;
  /** The menu entry the knob last moved focus to, confirmed by read-back; null when none is confirmed. */
  candidate: number | null;
  /** The Codex model list's option labels when it opened, for the readback. */
  options: string[];
}
type Outcome = 'applied' | 'mismatch' | 'unverified';
type Pressed = 'sent' | 'not-front' | 'uncertain';

const LIGHT_OF: Readonly<Record<Outcome | 'unsupported' | 'at-limit', KnobLight>> = { applied: 'applied', unverified: 'unverified', mismatch: 'error', unsupported: 'error', 'at-limit': 'error' };
const MENU_OF: Partial<Record<Surface, MenuKind>> = { 'claude-model': 'claude-model', 'codex-picker': 'codex-picker', 'codex-models': 'codex-models', 'codex-power': 'codex-picker' };

const optionIndexes = (menu: PickerMenu) => menu.items.flatMap((item, i) => item.kind === 'option' ? [i] : []);

/** The longest option label a Codex picker name starts with: `GPT-6 Astra` in `GPT-6 Astra Extra High`. */
function namedOption(name: string, options: readonly string[]): string | undefined {
  return [...options].sort((a, b) => b.length - a.length).find(option => name === option || name.startsWith(`${option} `));
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
      else if (this.#flow?.knob === knob) lights[knob] = 'open';
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
    if (!flow || flow.knob !== 'model' || (flow.surface !== 'claude-model' && flow.surface !== 'codex-models')) return this.#refuse('model', 'menu-not-open');
    if (pressedAt - this.#lastTurnAt.model < settings.clickStillMs) return this.#refuse('model', 'knob-moving', { client: flow.client });
    this.#clearTimer();
    this.#startWorker('model', () => this.#pick(flow));
  }

  /** Stops the running flow and closes what it opened (see the class comment). Concurrent calls share one close. */
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

  /**
   * The single knob worker: turns that arrive while it waits for the client coalesce. A step that cannot go on (the end
   * of the range, a mismatch, a lost control) drops the detents still waiting, so nothing queues at an end.
   */
  async #drain(knob: SettingKnob): Promise<void> {
    while (this.#pending !== 0 && this.#pendingKnob === knob && this.#live()) {
      const blocked = this.#host.blocked();
      if (blocked) {
        this.#pending = 0;
        return this.#refuse(knob, blocked);
      }
      const direction = Math.sign(this.#pending);
      this.#pending -= direction;
      let goOn: boolean;
      if (!this.#flow) {
        const checked = await this.#precheck(knob);
        if (!checked) { this.#pending = 0; return; }
        const { codexEffortIncrease, codexEffortDecrease } = this.#host.profile().shortcuts;
        if (knob === 'effort' && checked.client === 'codex' && codexEffortIncrease && codexEffortDecrease) goOn = await this.#chordStep(direction, checked.state);
        else {
          if (!(await this.#open(knob, checked.client, checked.state))) { this.#pending = 0; return; }
          // The first knob 1 detent opens the menu on the current model; a knob 2 detent opens the control and steps.
          goOn = knob === 'model' || !this.#flow ? true : await this.#effortStep(direction);
        }
      } else goOn = knob === 'model' ? await this.#modelStep(direction) : await this.#effortStep(direction);
      if (!goOn) this.#pending = 0;
    }
  }

  #live(): boolean { return !this.#cancel && !this.#host.closed(); }

  // Opening

  /** The client in front when knob input may act: qualified, no card, its controls readable and none of them open. */
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
    const nothingOpen = (s: PickerState) => !s.menu && !s.slider && !s.model?.expanded && !s.effort?.expanded;
    let last = null as PickerState | null;
    const state = await this.#waitFor(client, s => { last = s; return nothingOpen(s) ? s : null; }, SETTLE_MS);
    if (!this.#live()) return null;
    if (!last) { this.#refuse(knob, 'picker-unknown', { client }); return null; }
    if (!state) { this.#refuse(knob, 'menu-open', { client }); return null; }
    return { client, state };
  }

  async #open(knob: SettingKnob, client: Client, state: PickerState): Promise<boolean> {
    if (client === 'claude') {
      const button = knob === 'model' ? state.model : state.effort;
      if (!button) {
        if (knob === 'model') this.#refuse(knob, 'model-control-missing', { client });
        else {
          // Claude shows no Effort button for a model without an effort setting, such as Haiku.
          this.#host.log({ type: 'effort', client, route: 'slider', outcome: 'unsupported', reason: 'no-effort-control' });
          this.#show(knob, LIGHT_OF.unsupported);
        }
        return false;
      }
      const session = await this.#host.claudeFront();
      if (!this.#live()) return false;
      this.#flow = { knob, client, surface: knob === 'model' ? 'claude-model' : 'claude-effort', session, candidate: null, options: [] };
      if (!(await this.#expand(knob, client, knob === 'model' ? 'claude-model' : 'claude-effort'))) return false;
      if (knob === 'effort') {
        const slider = await this.#waitFor('claude', s => s.slider, this.#verifyMs());
        if (!this.#live()) return false;
        if (!slider) return this.#abort(knob, 'slider-not-open');
        this.#opened({ position: slider.value - slider.min + 1, count: Math.round((slider.max - slider.min) / slider.step) + 1 });
        return true;
      }
      return this.#openList(knob, 'claude-model');
    }
    if (!state.model) {
      this.#refuse(knob, 'picker-button-missing', { client });
      return false;
    }
    this.#flow = { knob, client, surface: 'codex-picker', session: null, candidate: null, options: [] };
    if (!(await this.#expand(knob, client, 'codex-picker'))) return false;
    const main = await this.#waitFor('codex', s => s.menu?.kind === 'codex-picker' ? s.menu : null, this.#verifyMs());
    if (!this.#live()) return false;
    if (!main) return this.#abort(knob, 'menu-not-open');
    if (knob === 'model') {
      const invoked = await this.#act(() => this.#host.adapter.invokeSelectModel('codex'));
      if (!this.#live()) return false;
      if (invoked !== true) return this.#abort(knob, 'select-model-failed');
      return this.#openList(knob, 'codex-models');
    }
    // No chords: the picker's Power entry, focused by UI Automation, then Right and Left.
    const power = main.items.findIndex(item => item.kind === 'action' && item.label === CODEX_POWER);
    if (power < 0) {
      await this.#closeFlow('power-unavailable');
      this.#host.log({ type: 'effort', client, route: 'picker', outcome: 'unsupported', reason: 'power-unavailable' });
      this.#show(knob, LIGHT_OF.unsupported);
      return false;
    }
    const focused = await this.#act(() => this.#host.adapter.focusMenuEntry('codex', 'codex-picker', power, main.items.length));
    if (!this.#live()) return false;
    if (focused !== power) return this.#abort(knob, 'power-not-focused');
    this.#flow.surface = 'codex-power';
    this.#flow.candidate = power;
    this.#opened({ count: main.items.length });
    return true;
  }

  /** Expands a setting button; on failure closes anything that opened and refuses. */
  async #expand(knob: SettingKnob, client: Client, control: SettingControl): Promise<boolean> {
    const expanded = await this.#call(() => this.#host.adapter.expandSetting(client, control));
    if (!this.#live()) return false;
    if (expanded.status === 'known' && expanded.value) return true;
    return this.#abort(knob, expanded.status === 'known' ? 'menu-not-open' : expanded.reason);
  }

  /** Waits for the flow's model menu, then focuses its current model: the knob's first candidate. */
  async #openList(knob: SettingKnob, kind: 'claude-model' | 'codex-models'): Promise<boolean> {
    const flow = this.#flow!;
    const menu = await this.#waitFor(flow.client, s => s.menu?.kind === kind && optionIndexes(s.menu).length > 0 ? s.menu : null, this.#verifyMs());
    if (!this.#live()) return false;
    if (!menu) return this.#abort(knob, kind === 'claude-model' ? 'menu-not-open' : 'list-not-open');
    flow.surface = kind;
    const options = optionIndexes(menu);
    flow.options = options.map(i => menu.items[i].label);
    const current = options.find(i => menu.items[i].selected) ?? options[0];
    await this.#focusEntry(flow, kind, current, menu.items.length);
    if (!this.#live()) return false;
    this.#opened({ count: options.length });
    return true;
  }

  #opened(extra: Record<string, unknown>): void {
    const flow = this.#flow!;
    this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'opened', ...extra });
    this.#host.render();
  }

  // Steps

  /** Moves focus one model option, stopping at the first and last option ("More models" is never a stop). */
  async #modelStep(direction: number): Promise<boolean> {
    const flow = this.#flow!;
    const kind = MENU_OF[flow.surface]!;
    const menu = await this.#waitFor(flow.client, s => s.menu?.kind === kind ? s.menu : null, SETTLE_MS);
    if (!this.#live()) return false;
    if (!menu) return this.#lost('menu-gone');
    const options = optionIndexes(menu);
    const from = flow.candidate ?? options.find(i => menu.items[i].selected) ?? options[0];
    const position = Math.max(0, options.indexOf(from));
    const target = options[Math.max(0, Math.min(options.length - 1, position + direction))];
    if (target === from) {
      this.#host.log({ type: 'model-step', client: flow.client, index: position, count: options.length, clamped: true });
      return true;
    }
    const focused = await this.#focusEntry(flow, kind, target, menu.items.length);
    if (!this.#live()) return false;
    if (focused === undefined) return this.#lost('menu-gone', true);
    this.#host.log({ type: 'model-step', client: flow.client, index: focused === null ? null : options.indexOf(focused), count: options.length });
    return true;
  }

  /** Focuses a menu entry and records it as the candidate only when the read-back confirms it; undefined when unknown. */
  async #focusEntry(flow: Flow, kind: MenuKind, index: number, count: number): Promise<number | null | undefined> {
    const answer = await this.#call(() => this.#host.adapter.focusMenuEntry(flow.client, kind, index, count));
    const focused = answer.status === 'known' ? answer.value : undefined;
    flow.candidate = focused === index ? index : null;
    return focused;
  }

  /** Knob 1's still click: `Select` on the confirmed focused model option, the readback, then closing. */
  async #pick(flow: Flow): Promise<void> {
    const kind = MENU_OF[flow.surface]! as 'claude-model' | 'codex-models';
    const index = flow.candidate;
    let last = null as PickerMenu | null;
    const menu = await this.#waitFor(flow.client, s => {
      last = s.menu?.kind === kind ? s.menu : null;
      return last && index !== null && last.focused === index && last.items[index]?.kind === 'option' ? last : null;
    }, SETTLE_MS);
    if (!this.#live()) return;
    if (!last) return void this.#lost('menu-gone', true);
    if (index === null || !menu) return this.#refuse('model', 'nothing-chosen', { client: flow.client });
    const options = optionIndexes(menu);
    const picked = menu.items[index].label;
    const previous = menu.items.find(entry => entry.selected)?.label ?? null;
    const before = flow.client === 'claude' && flow.session ? await this.#settings(flow.session) : null;
    if (!this.#live()) return;
    const log = (outcome: Outcome, extra: Record<string, unknown> = {}) => {
      this.#host.log({ type: 'model', client: flow.client, outcome, index: options.indexOf(index), count: options.length, ...extra });
      this.#show('model', LIGHT_OF[outcome]);
    };
    const selected = await this.#call(() => this.#host.adapter.selectMenuOption(flow.client, kind, index, menu.items.length));
    if (selected.status === 'known' && !selected.value) return this.#refuse('model', 'focus-moved', { client: flow.client });
    if (selected.status !== 'known') {
      log('unverified', { reason: 'select-uncertain' });
      return this.#closeFlow('picked');
    }
    if (flow.client === 'claude') {
      // Applied: the Model button names the pick, and the session record's `model` changed when the pick did.
      const recordBefore = before?.model ?? null;
      const needRecord = recordBefore !== null && picked !== previous;
      // Assigned inside the poll; the casts keep TypeScript from narrowing them to their first value.
      let button = null as string | null, record = 'unknown' as 'unchanged' | 'unknown';
      const applied = await this.#waitFor('claude', async s => {
        if (s.menu) return null;
        button = s.model?.label ?? null;
        if (button !== picked) return null;
        if (!needRecord) return true;
        const now = await this.#settings(flow.session!);
        record = now ? 'unchanged' : 'unknown';
        return now && now.model !== recordBefore ? true : null;
      }, this.#verifyMs());
      // Select closed Claude's menu: the composer gets focus back, so Play still works.
      this.#flow = null;
      if (!this.#host.closed()) await this.#focusComposer(flow);
      this.#host.render();
      if (!this.#live()) return log('unverified', { reason: 'interrupted' });
      if (applied) return log('applied', { evidence: needRecord ? 'button-and-record' : 'button' });
      if (button === null) return log('unverified', { reason: 'readback-unknown' });
      if (button !== picked) return log('mismatch', { reason: 'model-differs' });
      return record === 'unknown' ? log('unverified', { reason: 'record-unknown' }) : log('mismatch', { reason: 'record-unchanged' });
    }
    // Codex returns to its picker, which stays open: close it, then read the model from the closed button's name.
    const main = await this.#waitFor('codex', s => s.menu?.kind === 'codex-picker' ? s.menu : null, this.#verifyMs());
    flow.surface = 'codex-picker';
    if (!this.#live()) return log('unverified', { reason: 'interrupted' });
    if (!main) {
      log('unverified', { reason: 'picker-not-back' });
      return this.#closeFlow('picked');
    }
    this.#flow = null;
    const closed = await this.#codexEscape(flow, 'picked');
    const name = closed?.model?.label;
    const named = name ? namedOption(name, flow.options) : undefined;
    if (!closed || !name) log('unverified', { reason: 'picker-open' });
    else if (named === picked) log('applied', { evidence: 'picker-name' });
    else if (named) log('mismatch', { reason: 'model-differs' });
    else log('unverified', { reason: 'name-unmatched' });
  }

  async #effortStep(direction: number): Promise<boolean> {
    const flow = this.#flow!;
    const route = flow.client === 'claude' ? 'slider' : 'picker';
    const log = (outcome: Outcome | 'at-limit', extra: Record<string, unknown> = {}) => {
      this.#host.log({ type: 'effort', client: flow.client, route, direction: direction > 0 ? 'up' : 'down', outcome, ...extra });
      this.#show('effort', LIGHT_OF[outcome]);
      return outcome === 'applied';
    };
    if (flow.client === 'claude') {
      const state = await this.#waitFor('claude', s => s.slider ? s : null, SETTLE_MS);
      if (!this.#live()) return false;
      const slider = state?.slider;
      if (!state || !slider) return this.#lost('slider-gone');
      const count = Math.round((slider.max - slider.min) / slider.step) + 1;
      const position = Math.round((slider.value - slider.min) / slider.step) + 1;
      const to = slider.value + direction * slider.step;
      // The range comes from the slider: at an end nothing is set and the waiting detents are dropped.
      if (to < slider.min - EPSILON || to > slider.max + EPSILON) return log('at-limit', { position, count });
      const button = state.effort?.label ?? null;
      const recordBefore = flow.session ? (await this.#settings(flow.session))?.effort ?? null : null;
      if (!this.#live()) return false;
      const set = await this.#call(() => this.#host.adapter.setSliderValue('claude', slider.value, to));
      if (set.status !== 'known') return log('unverified', { reason: 'set-uncertain' });
      // Applied: the Effort button shows another level, and the session record's `effort` changed with it.
      let seen = null as string | null, record = 'unknown' as 'unchanged' | 'unknown';
      const applied = await this.#waitFor('claude', async s => {
        seen = s.effort?.label ?? null;
        if (seen === null || button === null || seen === button) return null;
        if (recordBefore === null) return true;
        const now = await this.#settings(flow.session!);
        record = now ? 'unchanged' : 'unknown';
        return now && now.effort !== recordBefore ? true : null;
      }, this.#verifyMs());
      if (!this.#live()) return log('unverified', { reason: 'interrupted' });
      const at = { position: position + direction, count };
      if (applied) return log('applied', { evidence: recordBefore === null ? 'button' : 'button-and-record', ...at });
      if (seen === null || button === null) return log('unverified', { reason: 'readback-unknown' });
      if (seen === button) return log('mismatch', { reason: 'unchanged' });
      return record === 'unknown' ? log('unverified', { reason: 'record-unknown' }) : log('mismatch', { reason: 'record-unchanged' });
    }
    // Codex without chords: Right or Left only while a fresh read shows its picker holding focus on Power.
    const state = await this.#waitFor('codex', s => {
      const menu = s.menu?.kind === 'codex-picker' ? s.menu : null;
      return menu?.hasFocus && menu.focused !== null && menu.items[menu.focused].label === CODEX_POWER ? s : null;
    }, SETTLE_MS);
    if (!this.#live()) return false;
    if (!state) return this.#lost('power-gone', true);
    const before = state.announcement;
    // The level count comes from the announcement each time: it differs by model.
    if (before && ((direction > 0 && before.position >= before.count) || (direction < 0 && before.position <= 1))) {
      return log('at-limit', { position: before.position, count: before.count });
    }
    const pressed = await this.#press('codex', [direction > 0 ? 'Right' : 'Left']);
    if (pressed !== 'sent') return this.#lost(pressed === 'not-front' ? 'foreground-changed' : 'key-uncertain', true);
    let after = null as PickerState['announcement'];
    const moved = await this.#waitFor('codex', s => {
      if (s.menu?.kind !== 'codex-picker' || !s.announcement) return null;
      after = s.announcement;
      return before && (after.position !== before.position || after.count !== before.count) ? after : null;
    }, this.#verifyMs());
    if (!this.#live()) return log('unverified', { reason: 'interrupted' });
    const heard = after;
    if (!before || !heard) return log('unverified', { reason: before ? 'readback-unknown' : 'no-baseline', ...(heard ? { position: heard.position, count: heard.count } : {}) });
    if (moved && moved.count === before.count && moved.position === before.position + direction) return log('applied', { position: moved.position, count: moved.count });
    return log('mismatch', { reason: moved ? 'level-differs' : 'unchanged', position: heard.position, count: heard.count });
  }

  /**
   * Codex effort with the owner's chords: one chord per detent, only with Codex qualified and in front, no card and the
   * picker closed (checked just before), confirmed by the picker button's name changing within the readback bound.
   */
  async #chordStep(direction: number, state: PickerState): Promise<boolean> {
    const { codexEffortIncrease, codexEffortDecrease } = this.#host.profile().shortcuts;
    const keys = direction > 0 ? codexEffortIncrease : codexEffortDecrease;
    const log = (outcome: Outcome, extra: Record<string, unknown> = {}) => {
      this.#host.log({ type: 'effort', client: 'codex', route: 'chord', direction: direction > 0 ? 'up' : 'down', outcome, ...extra });
      this.#show('effort', LIGHT_OF[outcome]);
      return outcome === 'applied';
    };
    if (!keys) return false;
    const before = state.model?.label ?? null;
    const pressed = await this.#press('codex', keys);
    if (pressed === 'not-front') { this.#refuse('effort', 'foreground-changed', { client: 'codex' }); return false; }
    if (pressed === 'uncertain') return log('unverified', { reason: 'key-uncertain' });
    if (!this.#live()) return false;
    if (before === null) return log('unverified', { reason: 'no-readback' });
    const name = await this.#waitFor('codex', s => s.model && !s.model.expanded && s.model.label !== before ? s.model.label : null, this.#verifyMs());
    if (!this.#live()) return log('unverified', { reason: 'interrupted' });
    // An unchanged name is usually the end of the range; Codex gives no range to tell it from an unbound chord.
    return name ? log('applied', { evidence: 'picker-name' }) : log('mismatch', { reason: 'unchanged' });
  }

  // Closing

  /** Ends the flow after a failure while opening: closes anything that opened, then refuses. */
  async #abort(knob: SettingKnob, reason: string): Promise<false> {
    const client = this.#flow?.client;
    await this.#closeFlow(reason);
    this.#refuse(knob, reason, client ? { client } : {});
    return false;
  }

  /** The flow ended without the bridge closing anything: the control is gone, unreadable or no longer in front. */
  #lost(reason: string, flash = false): false {
    const flow = this.#flow;
    this.#flow = null;
    this.#pending = 0;
    this.#clearTimer();
    if (flow) this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'closed', reason, method: 'none' });
    if (flash && flow) this.#show(flow.knob, 'error');
    this.#host.render();
    return false;
  }

  /**
   * Closes the flow's control: Claude by `Collapse` and then composer focus; Codex by its model list's current option
   * (`Select`) and then exactly one Escape into its confirmed-focused picker. A control already closed gets nothing.
   */
  async #closeFlow(reason: string): Promise<void> {
    const flow = this.#flow;
    this.#flow = null;
    this.#clearTimer();
    if (!flow || this.#host.closed()) return;
    if (flow.client === 'claude') {
      const control: SettingControl = flow.surface === 'claude-effort' ? 'claude-effort' : 'claude-model';
      const button = await this.#waitFor('claude', s => {
        const own = control === 'claude-model' ? s.model : s.effort;
        return own?.expanded ? own : null;
      }, SETTLE_MS);
      let method = 'none', verified = false;
      if (button) {
        const collapsed = await this.#call(() => this.#host.adapter.collapseSetting('claude', control));
        method = 'collapse';
        verified = collapsed.status === 'known' && collapsed.value;
        await this.#focusComposer(flow);
      }
      this.#host.log({ type: 'knob-menu', knob: flow.knob, client: flow.client, action: 'closed', reason, method, verified });
      this.#host.render();
      return;
    }
    if (flow.surface === 'codex-models') {
      // Leaving the model list: Select its current model, which returns to the picker with nothing changed. Escape is
      // never sent from the list.
      const menu = await this.#waitFor('codex', s => s.menu?.kind === 'codex-models' ? s.menu : null, SETTLE_MS);
      const current = menu ? menu.items.findIndex(item => item.kind === 'option' && item.selected) : -1;
      if (menu && current >= 0) {
        const focused = await this.#act(() => this.#host.adapter.focusMenuEntry('codex', 'codex-models', current, menu.items.length));
        if (focused === current) await this.#act(() => this.#host.adapter.selectMenuOption('codex', 'codex-models', current, menu.items.length));
        await this.#waitFor('codex', s => s.menu?.kind === 'codex-picker' ? true : null, this.#verifyMs());
      }
    }
    await this.#codexEscape(flow, reason);
  }

  /**
   * Codex's single closing Escape: only when a fresh read shows its picker open and holding focus (focus is first moved
   * into it when it is open without focus), then a bounded wait for the picker button to read collapsed. Never a second
   * Escape: a picker still open after the wait is logged as closed unverified. Answers the closed state, or null.
   */
  async #codexEscape(flow: Flow, reason: string): Promise<PickerState | null> {
    const done = (method: string, verified: boolean, state: PickerState | null) => {
      this.#host.log({ type: 'knob-menu', knob: flow.knob, client: 'codex', action: 'closed', reason, method, verified });
      this.#host.render();
      return verified ? state : null;
    };
    let state = await this.#waitFor('codex', s => s.menu?.kind === 'codex-picker' ? s : null, SETTLE_MS);
    if (!state) {
      const now = await this.#state('codex');
      return done('none', !!now && !now.menu && !now.model?.expanded, now);
    }
    if (!state.menu!.hasFocus) {
      const count = state.menu!.items.length;
      await this.#act(() => this.#host.adapter.focusMenuEntry('codex', 'codex-picker', 0, count));
      state = await this.#waitFor('codex', s => s.menu?.kind === 'codex-picker' && s.menu.hasFocus ? s : null, SETTLE_MS);
      if (!state) return done('none', false, null);
    }
    const pressed = await this.#press('codex', ['Escape']);
    if (pressed !== 'sent') return done('none', false, null);
    const closed = await this.#waitForEnd('codex', s => s.model && !s.model.expanded && !s.menu ? s : null);
    return done('escape', closed !== null, closed);
  }

  async #focusComposer(flow: Flow): Promise<void> {
    const focused = await this.#call(() => this.#host.adapter.focusComposer(flow.client));
    if (focused.status !== 'known' || !focused.value) this.#host.log({ type: 'knob-composer-unfocused', client: flow.client });
  }

  // Reads, actions and keys

  async #state(client: Client): Promise<PickerState | null> {
    const answer = await this.#host.call(() => this.#host.adapter.pickerState(client));
    return answer.ok && answer.value.status === 'known' ? answer.value.value : null;
  }

  async #settings(localId: string): Promise<ClaudeSettings | null> {
    const answer = await this.#host.call(() => this.#host.adapter.claudeSettings(localId));
    return answer.ok && answer.value.status === 'known' ? answer.value.value : null;
  }

  /** One adapter action: its observation, unknown on a failed call. */
  async #call<T>(operation: () => Promise<Observation<T>>): Promise<Observation<T>> {
    const answer = await this.#host.call(operation);
    return answer.ok ? answer.value : { status: 'unknown', reason: answer.reason };
  }

  /** One adapter action's known value, or undefined. */
  async #act<T>(operation: () => Promise<Observation<T>>): Promise<T | undefined> {
    const answer = await this.#call(operation);
    return answer.status === 'known' ? answer.value : undefined;
  }

  async #press(client: Client, keys: readonly KeyName[]): Promise<Pressed> {
    const sent = await this.#host.tap(() => this.#host.adapter.tapInClient(client, keys, 1));
    if (!sent.ok || sent.value.status !== 'known') return 'uncertain';
    return sent.value.value ? 'sent' : 'not-front';
  }

  /** Polls the client's controls every `verifyPollMs` until `test` answers, within `withinMs`; null on timeout or cancel. */
  async #waitFor<T>(client: Client, test: (state: PickerState) => T | null | undefined | Promise<T | null | undefined>, withinMs: number): Promise<T | null> {
    return this.#poll(client, test, withinMs, () => this.#live());
  }

  /** As `#waitFor`, but a close in progress does not cut it short: only the router's shutdown does. */
  async #waitForEnd<T>(client: Client, test: (state: PickerState) => T | null | undefined): Promise<T | null> {
    return this.#poll(client, test, this.#verifyMs(), () => !this.#host.closed());
  }

  async #poll<T>(client: Client, test: (state: PickerState) => T | null | undefined | Promise<T | null | undefined>, withinMs: number, live: () => boolean): Promise<T | null> {
    const { verifyPollMs } = this.#host.profile().timing;
    const start = this.#host.clock.now();
    for (;;) {
      const state = await this.#state(client);
      if (!live()) return null;
      const found = state ? await test(state) : null;
      if (!live()) return null;
      if (found !== null && found !== undefined) return found;
      if (this.#host.clock.now() - start + verifyPollMs > withinMs) return null;
      await this.#host.sleep(verifyPollMs);
      if (!live()) return null;
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
