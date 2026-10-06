import type { Client } from '../os-adapter.js';
import type { Rgb } from '../protocol.js';
import type { Activity, AttentionKind } from '../routing/feed.js';
import { DEFAULT_PAGE_COLORS, DEFAULT_PAGE_SETTINGS } from '../routing/profile.js';
import { SLOT_COUNT } from '../routing/slots.js';
import type { ChompiSimulator } from '../simulator.js';
import type { CardSeed, SimulatedDesktop, WindowId } from './desktop.js';
import type { SyntheticHub } from './hub.js';
import { CONTROL, PAGE_LED, WHEEL_LEDS } from './panel.js';

/**
 * The CHOMPI bridge scenario catalog (#853): data plus small step functions, shared by the in-memory runner in CI
 * (Tier 1) and the disposable verification run (Tier 2). A step either acts on the simulated controller, desktop or
 * Hub, or expects an observation within a time bound, or expects one to hold for a while. The same steps run in
 * virtual time in memory and in real time in a run; only the harness differs.
 */

/** What a scenario can touch. Both tiers implement it over the real bridge CLI (`run --simulate --desktop sim`). */
export interface Harness {
  readonly tier: 'memory' | 'run';
  readonly simulator: ChompiSimulator;
  readonly desktop: SimulatedDesktop;
  readonly hub: SyntheticHub;
  /** The bridge's JSON log lines so far, parsed. */
  logs(): readonly BridgeLogLine[];
  /** The run's current routing profile, as written to its file. */
  profile(): Record<string, any>;
  /** Rewrites the run's profile file; the bridge's watcher picks it up. */
  writeProfile(edit: (profile: Record<string, any>) => Record<string, any>): Promise<void>;
  /** Lets `ms` pass: virtual time in memory, real time in a run. */
  wait(ms: number): Promise<void>;
}

export interface BridgeLogLine { type: string; [field: string]: unknown }

// Seeds

export interface TaskSeed { client: Client; n: number; activity?: Activity; attention?: AttentionKind[] }
export interface DesktopSeed {
  foreground?: WindowId | null;
  /** The task (by `n`) each client shows. */
  selected?: Partial<Record<Client, number>>;
  composers?: Partial<Record<Client, { focused?: boolean; text?: string }>>;
  cards?: Partial<Record<Client, CardSeed>>;
}
export interface RunSeed { tasks: readonly TaskSeed[]; desktop?: DesktopSeed }

const pad = (n: number) => String(n).padStart(12, '0');

/** Synthetic IDs in the real shapes (a UUID for Codex, `local_<uuid>` for Claude Desktop) and synthetic titles. */
export function taskIds(client: Client, n: number): { sessionId: string; desktopId: string; title: string } {
  if (client === 'codex') {
    const id = `019a0000-0000-7000-8000-${pad(n)}`;
    return { sessionId: id, desktopId: id, title: `Synthetic Codex task ${n}` };
  }
  return { sessionId: `claude-session-${n}`, desktopId: `local_00000000-0000-4000-8000-${pad(n)}`, title: `Synthetic Claude task ${n}` };
}

export function seedHub(hub: SyntheticHub, seed: RunSeed): void {
  for (const task of seed.tasks) {
    const ids = taskIds(task.client, task.n);
    hub.addSession({
      provider: task.client, sessionId: ids.sessionId, title: ids.title, activity: task.activity ?? 'idle', attention: [...(task.attention ?? [])],
      ...(task.client === 'claude' ? { hostSessionId: ids.desktopId } : {}),
    });
  }
}

export function seedDesktop(desktop: SimulatedDesktop, seed: RunSeed): void {
  for (const task of seed.tasks) {
    const ids = taskIds(task.client, task.n);
    if (task.client === 'codex') desktop.addCodexThread(ids.desktopId, ids.title);
    else desktop.addClaudeSession(ids.desktopId, ids.title);
  }
  const d = seed.desktop ?? {};
  for (const [client, n] of Object.entries(d.selected ?? {}) as [Client, number][]) desktop.select(client, taskIds(client, n).desktopId);
  for (const [client, composer] of Object.entries(d.composers ?? {}) as [Client, { focused?: boolean; text?: string }][]) {
    if (composer.text) desktop.typeText(client, composer.text);
    desktop.focusComposer(client, composer.focused ?? false);
  }
  for (const [client, card] of Object.entries(d.cards ?? {}) as [Client, CardSeed][]) desktop.openCard(client, card);
  desktop.bringToFront(d.foreground === undefined ? 'other' : d.foreground);
}

/** One Codex and one Claude task, idle, with another app in front. */
export const DESK_BASIC: RunSeed = Object.freeze({ tasks: [{ client: 'codex', n: 1 }, { client: 'claude', n: 2 }] } satisfies RunSeed);

/**
 * 18 idle tasks, more than one page of 15 slot keys, with another app in front. Slots are assigned in task order
 * (provider, then task ID), so Claude task 1 takes slot 1 (page 1, key 1) and Codex tasks 2-18 take slots 2-18:
 * page 2 shows Codex tasks 16, 17 and 18 on keys 1, 2 and 3.
 */
export const TWO_PAGES: RunSeed = Object.freeze({
  tasks: [{ client: 'claude', n: 1 }, ...Array.from({ length: 17 }, (_, i) => ({ client: 'codex' as const, n: i + 2 }))],
} satisfies RunSeed);

// Steps

export type Check = (h: Harness) => true | string;
export type Step =
  | { kind: 'act'; name: string; run: (h: Harness) => unknown }
  | { kind: 'expect'; name: string; check: Check; withinMs: number }
  | { kind: 'holds'; name: string; check: Check; forMs: number };

export const act = (name: string, run: (h: Harness) => unknown): Step => ({ kind: 'act', name, run });
/** Passes as soon as `check` answers true, within `withinMs`. */
export const expect = (name: string, check: Check, withinMs = 3000): Step => ({ kind: 'expect', name, check, withinMs });
/** Passes when `check` answers true throughout `forMs`. */
export const holds = (name: string, check: Check, forMs = 1000): Step => ({ kind: 'holds', name, check, forMs });

export interface Scenario {
  id: string;
  title: string;
  seed: RunSeed;
  steps: readonly Step[];
}

// Observations scenarios share

const same = (a: Rgb | readonly number[] | undefined, b: readonly number[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
const show = (value: unknown) => JSON.stringify(value);

/** The slot the bridge assigned to a client's task, from its own `slot-assigned` log line. */
export function slotOf(h: Harness, client: Client): number {
  const line = h.logs().find(l => l.type === 'slot-assigned' && l.client === client);
  if (!line || typeof line.slot !== 'number') throw new Error(`no slot assigned to a ${client} task`);
  return line.slot;
}

const logged = (h: Harness, type: string, fields: Record<string, unknown> = {}) =>
  h.logs().filter(l => l.type === type && Object.entries(fields).every(([key, value]) => l[key] === value));
const enters = (h: Harness) => h.desktop.log.filter(e => e.kind === 'key' && e.keys.includes('Enter')).length;
const wheelColor = (h: Harness) => WHEEL_LEDS.map(i => h.simulator.leds[i]!);
const wheelFlashing = (h: Harness): true | string => wheelColor(h).every(c => same(c, h.profile().colors.error)) || `wheel LEDs ${show(wheelColor(h))}`;
const wheelDark = (h: Harness): true | string => wheelColor(h).every(c => same(c, [0, 0, 0])) || `wheel LEDs ${show(wheelColor(h))}`;
const chordHeld = (h: Harness): true | string => (h.desktop.dictating && show(h.desktop.held) === show(['LeftControl', 'LeftWindows'])) || `held ${show(h.desktop.held)}`;
const nothingHeld = (h: Harness): true | string => (h.desktop.held.length === 0 && !h.desktop.dictating) || `held ${show(h.desktop.held)}`;
const card = (h: Harness, client: Client) => h.desktop.snapshot().windows[client].card;
const pressedStops = (h: Harness) => h.desktop.log.flatMap(e => e.kind === 'card-press' ? [e.stop] : []);
const focusedOn = (h: Harness, client: Client, n: number): true | string => {
  const s = h.desktop.snapshot();
  const id = taskIds(client, n).desktopId;
  return (s.foreground === client && s.windows[client].selected === id && s.windows[client].composer.focused)
    || `foreground ${s.foreground}, selected ${s.windows[client].selected === id ? 'the task' : 'another task'}, composer ${s.windows[client].composer.focused ? 'focused' : 'unfocused'}`;
};
const submitted = (h: Harness, client: Client) => h.desktop.snapshot().windows[client].composer.submitted;

/** The visible task page (#822), from the bridge's own `page` log lines; the bridge starts on page 1. */
export function visiblePage(h: Harness): number {
  const line = logged(h, 'page').at(-1);
  return typeof line?.page === 'number' ? line.page : 1;
}
const pageColor = (h: Harness, page: number): readonly number[] => (h.profile().colors?.pages ?? DEFAULT_PAGE_COLORS)[page - 1]!;
const pageStep = (h: Harness): number => h.profile().pages?.stepCounts ?? DEFAULT_PAGE_SETTINGS.stepCounts;
/** Knob 4's LED shows page `page`'s color and the bridge logged that page as visible. */
const pageShown = (h: Harness, page: number): true | string =>
  (visiblePage(h) === page && same(h.simulator.leds[PAGE_LED], pageColor(h, page))) || `page ${visiblePage(h)}, knob 4 LED ${show(h.simulator.leds[PAGE_LED])}`;
const keyLed = (h: Harness, key: number) => h.simulator.leds[key - 1];
/** What the desktop received as input (keys, links, card presses, scrolls, dictation), not the harness's own setup. */
const inputs = (h: Harness) => h.desktop.log.filter(e => e.kind !== 'operator');
const marks = new WeakMap<Harness, { inputs: number; foreground: string | null }>();
const markDesktop = (h: Harness) => { marks.set(h, { inputs: inputs(h).length, foreground: h.desktop.snapshot().foreground }); };
/** Since the last mark, no input reached any client and the window in front is the same. */
const desktopUntouched = (h: Harness): true | string => {
  const mark = marks.get(h);
  if (!mark) return 'the desktop was never marked';
  const now = inputs(h), front = h.desktop.snapshot().foreground;
  return (now.length === mark.inputs && front === mark.foreground) || `foreground ${front} (was ${mark.foreground}), new input ${show(now.slice(mark.inputs).map(e => e.kind))}`;
};

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  {
    id: 'send-front-window',
    title: 'Send types Enter in the window in front; in another app it is refused with a red wheel flash',
    seed: DESK_BASIC,
    steps: [
      act('press the Codex task\'s slot key', h => h.simulator.click(slotOf(h, 'codex'))),
      expect('Codex comes to the front on that task with its composer focused', h => focusedOn(h, 'codex', 1)),
      expect('the bridge logs the focus', h => logged(h, 'focused', { client: 'codex' }).length === 1 || 'no focused line'),
      act('type a synthetic draft into the Codex composer', h => h.desktop.typeText('codex', 'synthetic draft')),
      act('press Play', h => h.simulator.click(CONTROL.play)),
      expect('one Enter submits the draft in Codex', h => (show(submitted(h, 'codex')) === show(['synthetic draft']) && enters(h) === 1) || `submitted ${show(submitted(h, 'codex'))}, ${enters(h)} Enter`),
      expect('the bridge logs `sent`', h => logged(h, 'sent', { client: 'codex' }).length === 1 || 'no sent line'),
      act('bring another app to the front and wait out the repeat window', async h => { h.desktop.bringToFront('other'); await h.wait(1100); }),
      act('press Play', h => h.simulator.click(CONTROL.play)),
      expect('Send is refused with `not-agent-client`', h => logged(h, 'send-refused', { reason: 'not-agent-client' }).length === 1 || 'no refusal'),
      expect('both big-wheel LEDs flash the error color', wheelFlashing, 1000),
      holds('no Enter reaches the other app', h => enters(h) === 1 || `${enters(h)} Enter`, 500),
      expect('the flash ends', wheelDark, 3000),
    ],
  },
  {
    id: 'record-dictation',
    title: 'Record holds the dictation chord while the CHOMPI key is down and never sends',
    seed: DESK_BASIC,
    steps: [
      act('press the Claude task\'s slot key', h => h.simulator.click(slotOf(h, 'claude'))),
      expect('Claude comes to the front on that task with its composer focused', h => focusedOn(h, 'claude', 2)),
      act('hold the CHOMPI key (Record)', h => h.simulator.press(CONTROL.record)),
      expect('the desktop holds the dictation chord', chordHeld),
      expect('the Record LED shows the record color', h => same(h.simulator.leds[25], h.profile().colors.record) || `LED ${show(h.simulator.leds[25])}`),
      act('release the CHOMPI key', h => h.simulator.release(CONTROL.record)),
      expect('the chord comes up', nothingHeld),
      expect('the synthetic dictation lands in the Claude composer', h => h.desktop.snapshot().windows.claude.composer.text === 'synthetic dictation' || 'no dictated text'),
      expect('the Record LED goes off', h => same(h.simulator.leds[25], [0, 0, 0]) || `LED ${show(h.simulator.leds[25])}`),
      holds('releasing Record sends nothing', h => (enters(h) === 0 && submitted(h, 'claude').length === 0) || `${enters(h)} Enter`, 1000),
    ],
  },
  {
    id: 'claude-question-wheel',
    title: 'A Claude question card is answered with the wheel; a click without a turn is refused',
    seed: {
      ...DESK_BASIC,
      desktop: {
        foreground: 'claude', selected: { claude: 2 }, composers: { claude: { focused: true } },
        cards: { claude: { kind: 'question', stops: ['Synthetic answer A', 'Synthetic answer B', 'Synthetic answer C', 'Other'] } },
      },
    },
    steps: [
      act('click the big wheel without turning it', h => h.simulator.click(CONTROL.wheelClick)),
      expect('the click is refused with `card-nothing-focused`', h => logged(h, 'card-refused', { client: 'claude', reason: 'card-nothing-focused' }).length === 1 || 'no refusal'),
      expect('both big-wheel LEDs flash the error color', wheelFlashing, 1000),
      holds('nothing is pressed and the card stays open', h => (pressedStops(h).length === 0 && card(h, 'claude') !== null) || `pressed ${show(pressedStops(h))}`, 500),
      act('turn the big wheel one card step clockwise', h => h.simulator.turn(CONTROL.wheelTurn, h.profile().cards?.stepCounts ?? 6)),
      expect('focus moves to the first answer', h => card(h, 'claude')?.focused === 0 || `focused ${show(card(h, 'claude')?.focused)}`),
      act('turn one more card step clockwise', h => h.simulator.turn(CONTROL.wheelTurn, h.profile().cards?.stepCounts ?? 6)),
      expect('focus moves to the second answer', h => card(h, 'claude')?.focused === 1 || `focused ${show(card(h, 'claude')?.focused)}`),
      act('hold the wheel still for 300 ms, then click it', async h => { await h.wait(300); h.simulator.click(CONTROL.wheelClick); }),
      expect('the second answer is pressed and the card closes', h => (show(pressedStops(h)) === show(['Synthetic answer B']) && card(h, 'claude') === null) || `pressed ${show(pressedStops(h))}`),
      expect('the bridge logs `card-pressed` with index 1 of 4', h => logged(h, 'card-pressed', { client: 'claude', index: 1, count: 4 }).length === 1 || 'no card-pressed line'),
      holds('no Enter was typed', h => enters(h) === 0 || `${enters(h)} Enter`, 500),
    ],
  },
  {
    id: 'codex-card-structure',
    title: 'A Codex card with no focused stop is answered by structure: one wheel step, then a still click',
    seed: {
      ...DESK_BASIC,
      desktop: {
        foreground: 'codex', selected: { codex: 1 }, composers: { codex: { focused: true } },
        cards: { codex: { kind: 'approval', stops: ['Deny', 'Approve'], focused: null } },
      },
    },
    steps: [
      act('press Play', h => h.simulator.click(CONTROL.play)),
      expect('Play is refused while the card replaces the composer', h => logged(h, 'send-refused', { client: 'codex', reason: 'composer-unfocused' }).length === 1 || 'no refusal'),
      act('turn the big wheel one card step clockwise', h => h.simulator.turn(CONTROL.wheelTurn, h.profile().cards?.stepCounts ?? 6)),
      expect('the first stop (Deny) gets focus', h => card(h, 'codex')?.focused === 0 || `focused ${show(card(h, 'codex')?.focused)}`),
      act('hold the wheel still for 300 ms, then click it', async h => { await h.wait(300); h.simulator.click(CONTROL.wheelClick); }),
      expect('Deny is pressed and the card closes', h => (show(pressedStops(h)) === show(['Deny']) && card(h, 'codex') === null) || `pressed ${show(pressedStops(h))}`),
      expect('the Codex composer is back with focus', h => h.desktop.snapshot().windows.codex.composer.focused || 'composer unfocused'),
      holds('no Enter was typed', h => enters(h) === 0 || `${enters(h)} Enter`, 500),
    ],
  },
  {
    id: 'reconnect-no-replay',
    title: 'Unplugging the controller releases the held chord; neither its reconnect nor a Hub stream restart replays anything; only a fresh press acts',
    seed: { ...DESK_BASIC, desktop: { foreground: 'codex', selected: { codex: 1 }, composers: { codex: { focused: true, text: 'synthetic draft' } } } },
    steps: [
      act('hold the CHOMPI key', h => h.simulator.press(CONTROL.record)),
      expect('the desktop holds the dictation chord', chordHeld),
      act('unplug the controller', h => h.simulator.unplug()),
      expect('the bridge disconnects and releases the chord', h => (logged(h, 'disconnected').length === 1 && nothingHeld(h) === true) || `held ${show(h.desktop.held)}`),
      act('plug it back in with the CHOMPI key still held', h => h.simulator.plug()),
      expect('the bridge reconnects', h => (logged(h, 'connected').length === 2 && h.simulator.display === 'host') || 'not reconnected', 8000),
      holds('nothing is replayed: no chord and no Enter', h => (nothingHeld(h) === true && enters(h) === 0) || `held ${show(h.desktop.held)}, ${enters(h)} Enter`, 1500),
      act('release the CHOMPI key', h => h.simulator.release(CONTROL.record)),
      holds('the release starts nothing', h => nothingHeld(h), 500),
      act('the Hub restarts its event stream', h => h.hub.dropStreams()),
      expect('the feed goes stale', h => logged(h, 'feed', { status: 'stale' }).length >= 1 || 'feed never stale'),
      expect('the feed is current again', h => logged(h, 'feed').at(-1)?.status === 'current' || 'feed not current', 6000),
      act('press Play once, fresh', h => h.simulator.click(CONTROL.play)),
      // Releasing the chord on the disconnect ended the dictation, so the composer also holds the synthetic dictation.
      expect('Send acts on the fresh press exactly once', h => (submitted(h, 'codex').length === 1 && submitted(h, 'codex')[0]!.startsWith('synthetic draft') && enters(h) === 1) || `submitted ${show(submitted(h, 'codex'))}, ${enters(h)} Enter`),
    ],
  },
  {
    id: 'profile-reload',
    title: 'A saved profile is applied without a restart; the reload releases held keys and replays nothing',
    seed: { ...DESK_BASIC, desktop: { foreground: 'codex', selected: { codex: 1 }, composers: { codex: { focused: true } } } },
    steps: [
      expect('the Codex slot key shows the idle color', h => same(h.simulator.leds[slotOf(h, 'codex') - 1], h.profile().colors.idle) || `LED ${show(h.simulator.leds[slotOf(h, 'codex') - 1])}`),
      act('hold the CHOMPI key', h => h.simulator.press(CONTROL.record)),
      expect('the desktop holds the dictation chord', chordHeld),
      act('save profile version 2 with another idle color', h => h.writeProfile(p => ({ ...p, profileVersion: 2, colors: { ...p.colors, idle: [120, 0, 120] } }))),
      expect('the bridge applies it and the controller hears version 2', h => (logged(h, 'profile-applied', { profileVersion: 2 }).length === 1 && h.simulator.profileVersion === 2) || `controller at ${h.simulator.profileVersion}`, 6000),
      expect('the reload released the chord', h => (nothingHeld(h) === true && logged(h, 'invalidated', { reason: 'profile-reload' }).length === 1) || `held ${show(h.desktop.held)}`),
      expect('the slot key shows the new idle color', h => same(h.simulator.leds[slotOf(h, 'codex') - 1], [120, 0, 120]) || `LED ${show(h.simulator.leds[slotOf(h, 'codex') - 1])}`),
      act('release the CHOMPI key', h => h.simulator.release(CONTROL.record)),
      holds('the release starts nothing and nothing is sent', h => (nothingHeld(h) === true && enters(h) === 0) || `held ${show(h.desktop.held)}`, 1000),
    ],
  },
  {
    id: 'task-pages',
    title: 'Knob 4 pages the slot keys through task pages on a deliberate turn, without input; a hidden page\'s attention shows on knob 4\'s LED; a held key releases the slot it showed',
    seed: TWO_PAGES,
    steps: [
      expect('page 1 is visible: knob 4\'s LED shows page 1\'s color', h => pageShown(h, 1)),
      expect('all 18 tasks hold slots; keys 1-15 show slots 1-15', h => (logged(h, 'slot-assigned').length === 18
        && Array.from({ length: SLOT_COUNT }, (_, i) => keyLed(h, i + 1)).every(c => same(c, h.profile().colors.idle))) || `${logged(h, 'slot-assigned').length} slots assigned`),
      act('note the desktop: another app in front, no input yet', markDesktop),
      act('touch knob 4 lightly: half a page step clockwise', h => h.simulator.turn(CONTROL.pageTurn, Math.floor(pageStep(h) / 2))),
      holds('a light touch does not page', h => (pageShown(h, 1) === true && logged(h, 'page').length === 0) || `page ${visiblePage(h)}`, 1000),
      act('turn knob 4 one deliberate page step clockwise', h => h.simulator.turn(CONTROL.pageTurn, pageStep(h))),
      expect('page 2 is visible: the bridge logs it and knob 4\'s LED shows page 2\'s color', h => pageShown(h, 2)),
      expect('keys 1-3 show slots 16-18; keys 4-15 are dark', h => ([1, 2, 3].every(k => same(keyLed(h, k), h.profile().colors.idle))
        && Array.from({ length: 12 }, (_, i) => keyLed(h, i + 4)).every(c => same(c, [0, 0, 0]))) || `keys ${show([1, 2, 3, 4].map(k => keyLed(h, k)))}`),
      holds('paging sent no input to any client and left another app in front', desktopUntouched, 500),
      act('press slot key 2 on page 2', h => h.simulator.click(2)),
      expect('Codex comes to the front on task 17 (slot 17) with its composer focused', h => focusedOn(h, 'codex', 17)),
      expect('the bridge logs the focus for slot 17', h => logged(h, 'focused', { client: 'codex', slot: 17 }).length === 1 || `focused ${show(logged(h, 'focused'))}`),
      act('note the desktop: Codex in front', markDesktop),
      act('turn knob 4 one page step counter-clockwise', h => h.simulator.turn(CONTROL.pageTurn, -pageStep(h))),
      expect('page 1 is visible again', h => pageShown(h, 1)),
      holds('paging back sent no input and left Codex in front', desktopUntouched, 500),
      act('a task on hidden page 2 (Codex task 18, slot 18) needs approval', h => h.hub.update(taskIds('codex', 18).sessionId, { attention: ['approval'] })),
      expect('knob 4\'s LED shows the attention color', h => same(h.simulator.leds[PAGE_LED], h.profile().colors.attention) || `knob 4 LED ${show(h.simulator.leds[PAGE_LED])}`, 3000),
      expect('knob 4\'s LED alternates back to page 1\'s color', h => pageShown(h, 1), 3000),
      holds('the page does not switch and no visible slot key shows attention', h => (visiblePage(h) === 1 && logged(h, 'page').at(-1)?.page === 1
        && Array.from({ length: SLOT_COUNT }, (_, i) => keyLed(h, i + 1)).every(c => same(c, h.profile().colors.idle))) || `page ${visiblePage(h)}, keys ${show(Array.from({ length: SLOT_COUNT }, (_, i) => keyLed(h, i + 1)))}`, 1500),
      act('hold slot key 1 on page 1 (Claude task 1, slot 1)', h => h.simulator.press(1)),
      expect('Claude comes to the front on task 1', h => focusedOn(h, 'claude', 1)),
      act('turn knob 4 one page step clockwise with the key still held', h => h.simulator.turn(CONTROL.pageTurn, pageStep(h))),
      expect('page 2 is visible; key 1 now shows slot 16', h => pageShown(h, 2)),
      act('wait out the release hold, then press Loop (the release gesture)', async h => {
        await h.wait((h.profile().timing?.releaseHoldMs ?? 800) + 200);
        h.simulator.press(CONTROL.loop);
      }),
      expect('the gesture releases slot 1, the slot the key showed when it went down', h => logged(h, 'slot-released', { slot: 1, client: 'claude', reason: 'release-gesture' }).length === 1 || `released ${show(logged(h, 'slot-released'))}`),
      act('let go of Loop and slot key 1', h => { h.simulator.release(CONTROL.loop); h.simulator.release(1); }),
      holds('slot 16 keeps its Codex task: nothing refused, key 1 still lit', h => (logged(h, 'release-refused').length === 0 && logged(h, 'slot-released').length === 1
        && same(keyLed(h, 1), h.profile().colors.idle)) || `refused ${show(logged(h, 'release-refused'))}, key 1 ${show(keyLed(h, 1))}`, 1000),
    ],
  },
] satisfies Scenario[]);

export function scenario(id: string): Scenario | undefined { return SCENARIOS.find(s => s.id === id); }

// Runner

export interface StepResult { name: string; kind: Step['kind']; outcome: 'passed' | 'failed'; detail?: string }
export interface ScenarioResult { id: string; title: string; tier: Harness['tier']; outcome: 'passed' | 'failed'; steps: StepResult[] }

const POLL_MS = 50;

/** The name of the step a run records when it never became ready, so the failure is not a lost press. */
export const READY_STEP = 'the run is ready: controller connected, feed current, every seeded task on a slot, the visible page\'s slot keys lit';

/**
 * Whether the controller is connected, the feed is current, every seeded task holds a slot and every one on the
 * visible page has a lit key, or why not.
 */
export function readiness(h: Harness, seed: RunSeed): true | string {
  if (!h.simulator) return 'no simulated controller';
  if (h.simulator.display !== 'host') return 'controller not connected';
  if (logged(h, 'feed').at(-1)?.status !== 'current') return 'feed not current';
  const assigned = logged(h, 'slot-assigned');
  if (assigned.length < seed.tasks.length) return `${assigned.length} of ${seed.tasks.length} tasks have a slot`;
  // Every assigned slot on the visible page has a lit key: the controller applied a frame that shows the task states.
  // Slots on other pages (#822) have no key until their page is visible.
  const first = (visiblePage(h) - 1) * SLOT_COUNT;
  const dark = assigned.filter(line => {
    const key = (line.slot as number) - first;
    return key >= 1 && key <= SLOT_COUNT && same(h.simulator.leds[key - 1], [0, 0, 0]);
  });
  return dark.length === 0 || `slot ${dark.map(line => line.slot).join(', ')} not lit yet`;
}

/** Waits until `readiness` holds, within `withinMs`. Both tiers wait before a scenario's first step. */
export async function ready(h: Harness, seed: RunSeed, withinMs = 15_000): Promise<true | string> {
  return poll(h, () => readiness(h, seed), withinMs);
}

async function poll(h: Harness, check: Check | (() => true | string), withinMs: number): Promise<true | string> {
  let last: true | string = 'not checked';
  for (let waited = 0; ; waited += POLL_MS) {
    last = attempt(() => (check as Check)(h));
    if (last === true || waited >= withinMs) return last;
    await h.wait(POLL_MS);
  }
}

function attempt(check: () => true | string): true | string {
  try {
    const result = check();
    return result === true ? true : String(result || 'false');
  } catch (error) {
    return (error as Error).message;
  }
}

/** Runs one scenario's steps in order and stops at the first failure. The harness must already be seeded and ready. */
export async function runScenario(scenario: Scenario, h: Harness, onStep?: (result: StepResult) => void): Promise<ScenarioResult> {
  const steps: StepResult[] = [];
  const record = (result: StepResult) => { steps.push(result); onStep?.(result); return result.outcome === 'passed'; };
  for (const step of scenario.steps) {
    let outcome: true | string;
    if (step.kind === 'act') {
      try {
        await step.run(h);
        outcome = true;
      } catch (error) {
        outcome = (error as Error).message;
      }
    } else if (step.kind === 'expect') outcome = await poll(h, step.check, step.withinMs);
    else {
      outcome = true;
      for (let waited = 0; outcome === true && waited <= step.forMs; waited += POLL_MS) {
        outcome = attempt(() => step.check(h));
        if (outcome === true && waited < step.forMs) await h.wait(POLL_MS);
      }
    }
    const passed = record({ name: step.name, kind: step.kind, outcome: outcome === true ? 'passed' : 'failed', ...(outcome === true ? {} : { detail: outcome }) });
    if (!passed) return { id: scenario.id, title: scenario.title, tier: h.tier, outcome: 'failed', steps };
  }
  return { id: scenario.id, title: scenario.title, tier: h.tier, outcome: 'passed', steps };
}
