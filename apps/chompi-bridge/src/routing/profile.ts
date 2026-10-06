import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { systemClock, type Clock } from '../clock.js';
import type { Rgb } from '../protocol.js';
import { readBoundedFile } from './files.js';

/**
 * The routing profile: one versioned JSON file mapping physical controls to the three core actions, the app
 * shortcuts they use, colors, timings, big-wheel card navigation, task pages, black-key actions, the volume knob and
 * the model and effort knobs.
 * Fields added after the first release are optional. It is data only: no URIs, paths, commands or package
 * identities, and key names come from an allowlist, so loading it can never run anything.
 */
export const PROFILE_SCHEMA_VERSION = 1;
export const MAX_PROFILE_BYTES = 64 * 1024;
export const DEFAULT_PROFILE_PATH = fileURLToPath(new URL('../../profiles/default.json', import.meta.url));

const MODIFIERS = ['LeftShift', 'LeftControl', 'LeftAlt', 'LeftWindows'] as const;
/**
 * Platform-neutral key names, exactly the set the Windows adapter can type (`VIRTUAL_KEYS`). Nothing else can appear
 * in a profile, so a profile can never ask the adapter for a key it would refuse at runtime. `Equal` and `Minus` are
 * the `=` and `-` keys of the owner's Codex effort chords (#906). Menu navigation keys (`NAVIGATION_KEYS`) are typed
 * only by the router's model and effort knobs and are never profile key names.
 */
export const KEY_NAMES: readonly string[] = Object.freeze([
  'Enter', ...MODIFIERS,
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
  'Equal', 'Minus',
]);

/** Click IDs of the four small top knobs (`ENC_1`-`ENC_4`) and the volume knob (`ENC_6`): never Send. */
export const SMALL_KNOB_CLICKS: readonly number[] = Object.freeze([29, 30, 31, 32]);
/** Small knob 4's turn (`ENC_3`, the rightmost small knob): it pages tasks (#822) and is never mapped to anything else. */
export const PAGE_TURN = 43;
/**
 * Small knob 4's click: the Attention click (#865, owner decision of 2026-10-06), on by default and turned off with
 * `pages.attentionClick: false`. It carries nothing else, so no control may map it.
 */
export const PAGE_CLICK = 31;
/** The volume knob (`ENC_6`): its turn steps the system volume and its click toggles mute (#865). */
export const VOLUME_TURN = 46;
export const VOLUME_CLICK = 34;
/**
 * Small knob 1 (`ENC_4`, the leftmost) sets the model and small knob 2 (`ENC_1`) the effort (owner decision on #744,
 * 2026-10-06; #906). A turn steps through the client's own model menu or effort levels; knob 1's still click picks the
 * focused model, and knob 2's click closes its effort control.
 */
export const MODEL_TURN = 44;
export const MODEL_CLICK = 32;
export const EFFORT_TURN = 41;
export const EFFORT_CLICK = 29;

/** The ten second-row black keys (#865), which the optional `keys` map can give an action. */
export const BLACK_KEYS: readonly number[] = Object.freeze(Array.from({ length: 10 }, (_, i) => 16 + i));
/**
 * Black-key actions. `attention` does what knob 4's Attention click does: it opens the task that has waited longest for
 * the owner, across pages, without acknowledging it. `back` does what Loop (`controls.back`) does.
 */
export const KEY_ACTIONS = ['attention', 'back'] as const;
export type KeyAction = typeof KEY_ACTIONS[number];
/** Black-key actions by control ID, as a JSON object with string keys. A control without an entry does nothing. */
export type KeyMap = Readonly<Partial<Record<string, KeyAction>>>;
/**
 * The black-key map when a profile has no `keys` section: empty, so every black key does nothing. The Attention action
 * lives on knob 4's click (owner decision of 2026-10-06); the map stays for later #744 presets.
 */
export const DEFAULT_KEY_ACTIONS: KeyMap = Object.freeze({});

/** The volume knob: encoder counts per volume key and the direction. */
export interface VolumeSettings {
  /** Encoder counts per volume key press; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** False: clockwise raises the volume. */
  readonly invert: boolean;
}
/**
 * One volume key per encoder count until #745 measures the volume knob on the device. Windows moves the volume 2 points
 * per key.
 */
export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = Object.freeze({ stepCounts: 1, invert: false });
/** How soon a second Attention click moves on to the next waiting task instead of the earliest again. */
export const DEFAULT_ATTENTION_REPEAT_MS = 4000;
/** How long an open model menu, effort slider or picker stays open after the knob's last turn before the bridge closes it. */
export const DEFAULT_MENU_TIMEOUT_MS = 5000;

export const COLOR_NAMES = ['empty', 'active', 'idle', 'unread', 'attention', 'ended', 'unknown', 'stale', 'error', 'record'] as const;
export type ColorName = typeof COLOR_NAMES[number];
/** The knob LED's flash for a model or effort change the client confirmed (#906). Optional in the file. */
export const DEFAULT_APPLIED_COLOR: Rgb = Object.freeze([0, 255, 120]) as unknown as Rgb;
/**
 * Colors the press-time model (#821) retired: the selected key and the Send-readiness wheel LEDs. A profile may still
 * list them, as the one installed for the #743 trial does; they must be valid colors and are otherwise ignored.
 */
export const RETIRED_COLOR_NAMES = ['selected', 'sendReady', 'sendBlocked'] as const;

/**
 * Big-wheel card navigation. The encoder turns smoothly; one slow full turn each way on the trial device on
 * 2026-10-05 measured about 25 counts per revolution.
 */
export interface CardSettings {
  /** Encoder counts per card step; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** How long the wheel must be still before a click presses a card button. */
  readonly clickStillMs: number;
}
/**
 * Encoder counts per card step: about a quarter turn at the measured 25 counts per revolution. This is the one place
 * the default lives; the shipped profile does not repeat it, and a profile's `cards.stepCounts` overrides it.
 */
export const DEFAULT_CARD_STEP_COUNTS = 6;
export const DEFAULT_CARD_SETTINGS: CardSettings = Object.freeze({ stepCounts: DEFAULT_CARD_STEP_COUNTS, clickStillMs: 250 });
const CARD_BOUNDS: Record<keyof CardSettings, [number, number, string]> = { stepCounts: [1, 96, ''], clickStillMs: [0, 2000, ' ms'] };

/** Task pages (#822): pages of 15 slots, paged with small knob 4, whose click is the Attention click (#865). */
export interface PageSettings {
  /** How many pages of 15 slots (1-8). */
  readonly count: number;
  /** Knob 4 encoder counts per page step; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** Whether knob 4's click (control 31) is the Attention click. False leaves the click inert. */
  readonly attentionClick: boolean;
}
/** Knob 1, the model knob (#906). */
export interface ModelKnobSettings {
  /** Encoder counts per menu step; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** False: clockwise moves down the menu. */
  readonly invert: boolean;
  /** How long knob 1 must be still before its click picks the focused model. */
  readonly clickStillMs: number;
}
/** Knob 2, the effort knob (#906). */
export interface EffortKnobSettings {
  /** Encoder counts per effort level; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** False: clockwise raises the effort. */
  readonly invert: boolean;
}
/**
 * Knobs 1-3 have not been measured on the device, so both knobs step once per `DEFAULT_CARD_STEP_COUNTS` counts, the
 * conservative default knob 4 pages with: a light touch never changes a setting. #745 measures them.
 */
export const DEFAULT_MODEL_SETTINGS: ModelKnobSettings = Object.freeze({ stepCounts: DEFAULT_CARD_STEP_COUNTS, invert: false, clickStillMs: 250 });
export const DEFAULT_EFFORT_SETTINGS: EffortKnobSettings = Object.freeze({ stepCounts: DEFAULT_CARD_STEP_COUNTS, invert: false });

export const DEFAULT_PAGE_SETTINGS: PageSettings = Object.freeze({ count: 4, stepCounts: DEFAULT_CARD_STEP_COUNTS, attentionClick: true });
const PAGE_BOUNDS: Record<'count' | 'stepCounts', [number, number]> = { count: [1, 8], stepCounts: [1, 96] };
/**
 * Knob 4's LED color for each page, page 1 first. Distinct from each other and from the attention color, which the
 * LED alternates with while a hidden page has attention.
 */
export const DEFAULT_PAGE_COLORS: readonly Rgb[] = Object.freeze([
  [0, 180, 255], [220, 0, 255], [0, 220, 60], [200, 200, 200], [0, 40, 255], [255, 60, 140], [140, 255, 0], [0, 255, 180],
] as Rgb[]);

export interface RoutingTiming {
  verifyTimeoutMs: number;
  verifyPollMs: number;
  adapterTimeoutMs: number;
  sendRepeatWindowMs: number;
  releaseHoldMs: number;
  attentionPulseMs: number;
  errorFlashMs: number;
  archiveCheckMs: number;
  profilePollMs: number;
  /** Optional in the file (#865); absent, it is `DEFAULT_ATTENTION_REPEAT_MS`. */
  attentionRepeatMs: number;
  /** Optional in the file (#906); absent, it is `DEFAULT_MENU_TIMEOUT_MS`. */
  menuTimeoutMs: number;
}

const TIMING_BOUNDS: Record<keyof RoutingTiming, [number, number]> = {
  verifyTimeoutMs: [500, 10_000],
  verifyPollMs: [20, 1000],
  adapterTimeoutMs: [100, 10_000],
  sendRepeatWindowMs: [100, 10_000],
  releaseHoldMs: [200, 5000],
  attentionPulseMs: [200, 5000],
  errorFlashMs: [200, 10_000],
  archiveCheckMs: [1000, 600_000],
  profilePollMs: [500, 60_000],
  attentionRepeatMs: [500, 30_000],
  menuTimeoutMs: [1000, 30_000],
};
/** Timing fields added after the first release, with their defaults. */
const OPTIONAL_TIMING: Partial<RoutingTiming> = { attentionRepeatMs: DEFAULT_ATTENTION_REPEAT_MS, menuTimeoutMs: DEFAULT_MENU_TIMEOUT_MS };

export interface RoutingProfile {
  readonly schemaVersion: 1;
  /** u32 reported to the firmware in host heartbeats. */
  readonly profileVersion: number;
  readonly controls: {
    /** Slot n is `slots[n - 1]`; 15 key controls. */
    readonly slots: readonly number[];
    readonly record: number;
    readonly send: readonly number[];
    readonly back: number;
    readonly scroll: number;
  };
  readonly shortcuts: {
    readonly codexComposer: readonly string[];
    readonly send: readonly ['Enter'];
    readonly dictation: readonly string[];
    /**
     * The owner's Codex "Increase reasoning effort" and "Decrease reasoning effort" chords (#906), both or neither.
     * Optional in the file; null when absent, and Codex effort then uses only its picker.
     */
    readonly codexEffortIncrease: readonly string[] | null;
    readonly codexEffortDecrease: readonly string[] | null;
  };
  /** Big-wheel scrolling of the client conversation through the adapter's mouse-wheel primitive. */
  readonly scroll: { readonly notchesPerStep: number; readonly invert: boolean };
  /** Optional in the file; absent fields take `DEFAULT_CARD_SETTINGS`. */
  readonly cards: CardSettings;
  /** `pages` and `applied` are optional in the file. */
  readonly colors: Readonly<Record<ColorName, Rgb>> & { readonly pages: readonly Rgb[]; readonly applied: Rgb };
  /** Optional in the file; absent fields take `DEFAULT_PAGE_SETTINGS`. */
  readonly pages: PageSettings;
  /** Black-key actions (#865). Optional in the file; absent, `DEFAULT_KEY_ACTIONS` (none). */
  readonly keys: KeyMap;
  /**
   * The volume knob (#865). Optional in the file; absent fields take `DEFAULT_VOLUME_SETTINGS`. Null when an earlier
   * profile without a `volume` section maps the knob's turn or click to something else: that mapping stays and the
   * knob sends no volume key.
   */
  readonly volume: VolumeSettings | null;
  /**
   * Knob 1 sets the model and knob 2 the effort (#906). Optional in the file; absent fields take the defaults. Null when
   * an earlier profile without the section maps the knob's turn or click to something else: that mapping stays and the
   * knob is off.
   */
  readonly model: ModelKnobSettings | null;
  readonly effort: EffortKnobSettings | null;
  readonly brightnessPercent: number;
  readonly timing: Readonly<RoutingTiming>;
  /** Both clients' UI selectors and links depend on the client version; an unlisted or unknown version disables that client. */
  readonly qualifiedVersions: { readonly codex: readonly string[]; readonly claude: readonly string[] };
}

export class ProfileError extends Error {
  readonly code = 'invalid-profile';
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid-profile: ${issues.join('; ')}`);
    this.issues = Object.freeze([...issues]);
  }
}

type Issues = string[];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;

function fields(value: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[], issues: Issues): boolean {
  let ok = true;
  for (const key of required) if (!(key in value)) { issues.push(`${path}.${key}: required`); ok = false; }
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) { issues.push(`${path}.${key}: unknown field`); ok = false; }
  return ok;
}

function keys(value: unknown, path: string, issues: Issues, rule: (key: string) => string | undefined = () => undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) { issues.push(`${path}: must list 1-4 key names`); return undefined; }
  const seen = new Set<string>();
  for (const [i, key] of value.entries()) {
    if (typeof key !== 'string' || !KEY_NAMES.includes(key)) {
      issues.push(`${path}[${i}]: ${JSON.stringify(key)} is not an allowed key name (Enter, ${MODIFIERS.join(', ')}, A-Z, 0-9, Equal or Minus)`);
      return undefined;
    }
    if (seen.has(key)) { issues.push(`${path}[${i}]: ${key} is repeated`); return undefined; }
    seen.add(key);
    const problem = rule(key);
    if (problem) { issues.push(`${path}[${i}]: ${problem}`); return undefined; }
  }
  return value as string[];
}

function controls(value: unknown, issues: Issues): RoutingProfile['controls'] | undefined {
  const path = 'profile.controls';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, ['slots', 'record', 'send', 'back', 'scroll'], [], issues)) return undefined;
  const mapped = new Map<number, string>();
  const claim = (control: number, where: string): boolean => {
    const owner = mapped.get(control);
    if (owner) { issues.push(`${where}: ${control} is already mapped by ${owner}`); return false; }
    mapped.set(control, where);
    return true;
  };
  const before = issues.length;
  const slots = value.slots;
  if (!Array.isArray(slots) || slots.length !== 15) issues.push(`${path}.slots: must list exactly 15 key controls`);
  else for (const [i, control] of slots.entries()) {
    if (!isInt(control, 1, 25)) issues.push(`${path}.slots[${i}]: ${JSON.stringify(control)} is not a key control 1-25`);
    else claim(control, `${path}.slots[${i}]`);
  }
  const click = (control: unknown, where: string): boolean => {
    if (!isInt(control, 1, 34)) { issues.push(`${where}: ${JSON.stringify(control)} is not a click control 1-34`); return false; }
    return true;
  };
  // Knob 4's click carries only the Attention action (#865); Send already refuses every small-knob click.
  const assignable = (control: unknown, where: string): boolean => {
    if (!click(control, where)) return false;
    if (control === PAGE_CLICK) { issues.push(`${where}: ${PAGE_CLICK} is small knob 4's click, which carries only the Attention action`); return false; }
    return true;
  };
  if (assignable(value.record, `${path}.record`)) claim(value.record as number, `${path}.record`);
  const send = value.send;
  if (!Array.isArray(send) || send.length < 1 || send.length > 3) issues.push(`${path}.send: must list 1-3 click controls`);
  else for (const [i, control] of send.entries()) {
    const where = `${path}.send[${i}]`;
    if (!click(control, where)) continue;
    if (SMALL_KNOB_CLICKS.includes(control)) issues.push(`${where}: ${control} is a small-knob click and can never send`);
    else if (control === VOLUME_CLICK) issues.push(`${where}: ${control} is the volume knob click and can never send`);
    else claim(control, where);
  }
  if (assignable(value.back, `${path}.back`)) claim(value.back as number, `${path}.back`);
  if (!isInt(value.scroll, 41, 46)) issues.push(`${path}.scroll: ${JSON.stringify(value.scroll)} is not a turn control 41-46`);
  else if (value.scroll === PAGE_TURN) issues.push(`${path}.scroll: ${PAGE_TURN} is knob 4's turn, which pages tasks`);
  if (issues.length > before) return undefined;
  return { slots: slots as number[], record: value.record as number, send: send as number[], back: value.back as number, scroll: value.scroll as number };
}

function shortcuts(value: unknown, issues: Issues): RoutingProfile['shortcuts'] | undefined {
  const path = 'profile.shortcuts';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, ['codexComposer', 'send', 'dictation'], ['codexEffortIncrease', 'codexEffortDecrease'], issues)) return undefined;
  const before = issues.length;
  const noEnter = (key: string) => key === 'Enter' ? 'must not include Enter; only Send types Enter' : undefined;
  const codexComposer = keys(value.codexComposer, `${path}.codexComposer`, issues, noEnter);
  if (!Array.isArray(value.send) || value.send.length !== 1 || value.send[0] !== 'Enter') issues.push(`${path}.send: must be exactly ["Enter"]`);
  const holdable = new Set<string>(MODIFIERS);
  const dictation = keys(value.dictation, `${path}.dictation`, issues, key => holdable.has(key) ? undefined : `${key} is not a modifier; dictation holds modifiers only`);
  // The Codex effort chords are the owner's own bindings (#906): a chord with Control, Alt or Windows and one other key,
  // so a chord can never type a character into a composer.
  const chord = (name: 'codexEffortIncrease' | 'codexEffortDecrease'): string[] | null | undefined => {
    if (!(name in value)) return null;
    const found = keys(value[name], `${path}.${name}`, issues, noEnter);
    if (!found) return undefined;
    const chordModifiers = found.filter(key => key !== 'LeftShift' && holdable.has(key));
    if (chordModifiers.length === 0 || found.filter(key => !holdable.has(key)).length !== 1) {
      issues.push(`${path}.${name}: must hold LeftControl, LeftAlt or LeftWindows with exactly one other key`);
      return undefined;
    }
    return found;
  };
  const increase = chord('codexEffortIncrease');
  const decrease = chord('codexEffortDecrease');
  if ((increase === null) !== (decrease === null) && increase !== undefined && decrease !== undefined) {
    issues.push(`${path}: codexEffortIncrease and codexEffortDecrease go together; give both or neither`);
  } else if (increase && decrease && isDeepStrictEqual([...increase].sort(), [...decrease].sort())) {
    issues.push(`${path}.codexEffortDecrease: must differ from codexEffortIncrease`);
  }
  if (issues.length > before || !codexComposer || !dictation || increase === undefined || decrease === undefined) return undefined;
  return { codexComposer, send: ['Enter'], dictation, codexEffortIncrease: increase, codexEffortDecrease: decrease };
}

function colors(value: unknown, issues: Issues): RoutingProfile['colors'] | undefined {
  const path = 'profile.colors';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, COLOR_NAMES, [...RETIRED_COLOR_NAMES, 'pages', 'applied'], issues)) return undefined;
  const before = issues.length;
  const isColor = (color: unknown) => Array.isArray(color) && color.length === 3 && color.every(c => isInt(c, 0, 255));
  for (const name of [...COLOR_NAMES, ...RETIRED_COLOR_NAMES, 'applied']) {
    if (!(name in value)) continue;
    if (!isColor(value[name])) issues.push(`${path}.${name}: must be [r, g, b] with integers 0-255`);
  }
  const pages = value.pages ?? DEFAULT_PAGE_COLORS;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 8) issues.push(`${path}.pages: must list 1-8 colors, page 1 first`);
  else for (const [i, color] of pages.entries()) if (!isColor(color)) issues.push(`${path}.pages[${i}]: must be [r, g, b] with integers 0-255`);
  if (issues.length > before) return undefined;
  return {
    ...Object.fromEntries(COLOR_NAMES.map(name => [name, value[name]])), pages: (pages as Rgb[]).map(c => [...c]),
    applied: [...(value.applied as Rgb | undefined ?? DEFAULT_APPLIED_COLOR)],
  } as unknown as RoutingProfile['colors'];
}

function cards(value: unknown, issues: Issues): CardSettings | undefined {
  const path = 'profile.cards';
  if (value === undefined) return DEFAULT_CARD_SETTINGS;
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  const names = Object.keys(CARD_BOUNDS) as (keyof CardSettings)[];
  if (!fields(value, path, [], names, issues)) return undefined;
  const before = issues.length;
  for (const name of names) {
    const [min, max, unit] = CARD_BOUNDS[name];
    if (name in value && !isInt(value[name], min, max)) issues.push(`${path}.${name}: must be an integer ${min}-${max}${unit}`);
  }
  if (issues.length > before) return undefined;
  return { ...DEFAULT_CARD_SETTINGS, ...value as Partial<CardSettings> };
}

function pages(value: unknown, issues: Issues): PageSettings | undefined {
  const path = 'profile.pages';
  if (value === undefined) return DEFAULT_PAGE_SETTINGS;
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  const names = Object.keys(PAGE_BOUNDS) as (keyof typeof PAGE_BOUNDS)[];
  if (!fields(value, path, [], [...names, 'attentionClick'], issues)) return undefined;
  const before = issues.length;
  for (const name of names) {
    const [min, max] = PAGE_BOUNDS[name];
    if (name in value && !isInt(value[name], min, max)) issues.push(`${path}.${name}: must be an integer ${min}-${max}`);
  }
  if ('attentionClick' in value && typeof value.attentionClick !== 'boolean') issues.push(`${path}.attentionClick: must be true or false`);
  if (issues.length > before) return undefined;
  return { ...DEFAULT_PAGE_SETTINGS, ...value as Partial<PageSettings> };
}

/** The control IDs the `controls` section maps, with the path that maps each. */
function mappedControls(controls: RoutingProfile['controls']): Map<number, string> {
  const path = 'profile.controls';
  const mapped = new Map<number, string>();
  controls.slots.forEach((control, i) => mapped.set(control, `${path}.slots[${i}]`));
  mapped.set(controls.record, `${path}.record`);
  controls.send.forEach((control, i) => mapped.set(control, `${path}.send[${i}]`));
  mapped.set(controls.back, `${path}.back`);
  mapped.set(controls.scroll, `${path}.scroll`);
  return mapped;
}

function blackKeys(value: unknown, controls: RoutingProfile['controls'] | undefined, issues: Issues): KeyMap | undefined {
  const path = 'profile.keys';
  const mapped = controls ? mappedControls(controls) : new Map<number, string>();
  if (value === undefined) return DEFAULT_KEY_ACTIONS;
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  const before = issues.length;
  for (const [control, action] of Object.entries(value)) {
    const id = Number(control);
    if (!/^[1-9][0-9]$/.test(control) || !BLACK_KEYS.includes(id)) { issues.push(`${path}.${control}: not a black key control 16-25`); continue; }
    if (!KEY_ACTIONS.includes(action as KeyAction)) { issues.push(`${path}.${control}: must be "attention" or "back"`); continue; }
    const owner = mapped.get(id);
    if (owner) issues.push(`${path}.${control}: ${id} is already mapped by ${owner}`);
  }
  if (issues.length > before) return undefined;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => Number(a) - Number(b))) as KeyMap;
}

function volume(value: unknown, controls: RoutingProfile['controls'] | undefined, issues: Issues): VolumeSettings | null | undefined {
  const path = 'profile.volume';
  const turnTaken = controls?.scroll === VOLUME_TURN;
  const clickTaken = controls?.record === VOLUME_CLICK ? 'record' : controls?.back === VOLUME_CLICK ? 'back' : undefined;
  if (value === undefined) return turnTaken || clickTaken ? null : DEFAULT_VOLUME_SETTINGS;
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, [], ['stepCounts', 'invert'], issues)) return undefined;
  const before = issues.length;
  if ('stepCounts' in value && !isInt(value.stepCounts, 1, 96)) issues.push(`${path}.stepCounts: must be an integer 1-96`);
  if ('invert' in value && typeof value.invert !== 'boolean') issues.push(`${path}.invert: must be true or false`);
  if (turnTaken) issues.push(`profile.controls.scroll: ${VOLUME_TURN} is the volume knob's turn`);
  if (clickTaken) issues.push(`profile.controls.${clickTaken}: ${VOLUME_CLICK} is the volume knob's click`);
  if (issues.length > before) return undefined;
  return { ...DEFAULT_VOLUME_SETTINGS, ...value as Partial<VolumeSettings> };
}

/**
 * Knob 1 (model) or knob 2 (effort), #906. Like the volume knob, an earlier profile without the section that maps the
 * knob's turn (as `controls.scroll`) or click (as Record or Back) keeps that mapping and the knob is off (null).
 */
function knob<T extends ModelKnobSettings | EffortKnobSettings>(name: 'model' | 'effort', value: unknown, controls: RoutingProfile['controls'] | undefined,
  defaults: T, issues: Issues): T | null | undefined {
  const path = `profile.${name}`;
  const [turn, click] = name === 'model' ? [MODEL_TURN, MODEL_CLICK] : [EFFORT_TURN, EFFORT_CLICK];
  const turnTaken = controls?.scroll === turn;
  const clickTaken = controls?.record === click ? 'record' : controls?.back === click ? 'back' : undefined;
  if (value === undefined) return turnTaken || clickTaken ? null : defaults;
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, [], Object.keys(defaults), issues)) return undefined;
  const before = issues.length;
  if ('stepCounts' in value && !isInt(value.stepCounts, 1, 96)) issues.push(`${path}.stepCounts: must be an integer 1-96`);
  if ('invert' in value && typeof value.invert !== 'boolean') issues.push(`${path}.invert: must be true or false`);
  if ('clickStillMs' in value && !isInt(value.clickStillMs, 0, 2000)) issues.push(`${path}.clickStillMs: must be an integer 0-2000 ms`);
  if (turnTaken) issues.push(`profile.controls.scroll: ${turn} is knob ${name === 'model' ? 1 : 2}'s turn`);
  if (clickTaken) issues.push(`profile.controls.${clickTaken}: ${click} is knob ${name === 'model' ? 1 : 2}'s click`);
  if (issues.length > before) return undefined;
  return { ...defaults, ...value as Partial<T> };
}

function scroll(value: unknown, issues: Issues): RoutingProfile['scroll'] | undefined {
  const path = 'profile.scroll';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, ['notchesPerStep', 'invert'], [], issues)) return undefined;
  const before = issues.length;
  if (!isInt(value.notchesPerStep, 1, 10)) issues.push(`${path}.notchesPerStep: must be an integer 1-10`);
  if (typeof value.invert !== 'boolean') issues.push(`${path}.invert: must be true or false`);
  return issues.length > before ? undefined : { notchesPerStep: value.notchesPerStep as number, invert: value.invert as boolean };
}

function timing(value: unknown, issues: Issues): RoutingTiming | undefined {
  const path = 'profile.timing';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  const names = Object.keys(TIMING_BOUNDS) as (keyof RoutingTiming)[];
  const optional = Object.keys(OPTIONAL_TIMING) as (keyof RoutingTiming)[];
  if (!fields(value, path, names.filter(name => !optional.includes(name)), optional, issues)) return undefined;
  const before = issues.length;
  for (const name of names) {
    if (optional.includes(name) && !(name in value)) continue;
    const [min, max] = TIMING_BOUNDS[name];
    if (!isInt(value[name], min, max)) issues.push(`${path}.${name}: must be an integer ${min}-${max} ms`);
  }
  if (issues.length === before && (value.verifyPollMs as number) >= (value.verifyTimeoutMs as number)) issues.push(`${path}.verifyPollMs: must be shorter than verifyTimeoutMs`);
  return issues.length > before ? undefined : { ...OPTIONAL_TIMING, ...value } as unknown as RoutingTiming;
}

function versions(value: unknown, issues: Issues): RoutingProfile['qualifiedVersions'] | undefined {
  const path = 'profile.qualifiedVersions';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, ['codex', 'claude'], [], issues)) return undefined;
  const before = issues.length;
  const list = (name: 'claude' | 'codex') => {
    const entries = value[name];
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32) { issues.push(`${path}.${name}: must list 1-32 versions`); return; }
    for (const [i, version] of entries.entries()) if (typeof version !== 'string' || !VERSION.test(version)) issues.push(`${path}.${name}[${i}]: must be a version string`);
  };
  list('codex');
  list('claude');
  return issues.length > before ? undefined : value as unknown as RoutingProfile['qualifiedVersions'];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validates a parsed profile. Returns a deeply frozen copy, or throws `ProfileError` with path-qualified issues. */
export function validateProfile(input: unknown): RoutingProfile {
  const issues: Issues = [];
  if (!isObject(input)) throw new ProfileError(['profile: must be a JSON object']);
  const value = structuredClone(input) as Record<string, unknown>;
  const required = ['schemaVersion', 'profileVersion', 'controls', 'shortcuts', 'scroll', 'colors', 'brightnessPercent', 'timing', 'qualifiedVersions'];
  fields(value, 'profile', required, ['cards', 'pages', 'keys', 'volume', 'model', 'effort'], issues);
  if ('schemaVersion' in value && value.schemaVersion !== PROFILE_SCHEMA_VERSION) issues.push(`profile.schemaVersion: must be ${PROFILE_SCHEMA_VERSION}`);
  if ('profileVersion' in value && !isInt(value.profileVersion, 0, 0xffffffff)) issues.push('profile.profileVersion: must be an integer 0-4294967295');
  if ('brightnessPercent' in value && !isInt(value.brightnessPercent, 0, 100)) issues.push('profile.brightnessPercent: must be an integer 0-100');
  const parts = {
    controls: 'controls' in value ? controls(value.controls, issues) : undefined,
    shortcuts: 'shortcuts' in value ? shortcuts(value.shortcuts, issues) : undefined,
    scroll: 'scroll' in value ? scroll(value.scroll, issues) : undefined,
    cards: cards(value.cards, issues),
    pages: pages(value.pages, issues),
    keys: undefined as KeyMap | undefined,
    volume: undefined as VolumeSettings | null | undefined,
    model: undefined as ModelKnobSettings | null | undefined,
    effort: undefined as EffortKnobSettings | null | undefined,
    colors: 'colors' in value ? colors(value.colors, issues) : undefined,
    timing: 'timing' in value ? timing(value.timing, issues) : undefined,
    qualifiedVersions: 'qualifiedVersions' in value ? versions(value.qualifiedVersions, issues) : undefined,
  };
  // Both check their controls against the `controls` section, so they follow it.
  if (!('controls' in value) || parts.controls) {
    parts.keys = blackKeys(value.keys, parts.controls, issues);
    parts.volume = volume(value.volume, parts.controls, issues);
    parts.model = knob('model', value.model, parts.controls, DEFAULT_MODEL_SETTINGS, issues);
    parts.effort = knob('effort', value.effort, parts.controls, DEFAULT_EFFORT_SETTINGS, issues);
  }
  if (parts.pages && parts.colors && parts.colors.pages.length < parts.pages.count) {
    issues.push(`profile.colors.pages: must list a color for each of the ${parts.pages.count} pages`);
  }
  if (issues.length) throw new ProfileError(issues);
  return deepFreeze({
    schemaVersion: PROFILE_SCHEMA_VERSION, profileVersion: value.profileVersion as number, brightnessPercent: value.brightnessPercent as number,
    controls: parts.controls!, shortcuts: parts.shortcuts!, scroll: parts.scroll!, cards: { ...parts.cards! }, pages: { ...parts.pages! }, colors: parts.colors!,
    keys: { ...parts.keys! }, volume: parts.volume ? { ...parts.volume } : null,
    model: parts.model ? { ...parts.model } : null, effort: parts.effort ? { ...parts.effort } : null,
    timing: parts.timing!,
    qualifiedVersions: parts.qualifiedVersions!,
  });
}

export function parseProfile(text: string): RoutingProfile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ProfileError([`profile: invalid JSON (${(error as Error).message})`]);
  }
  return validateProfile(value);
}

async function readProfileText(path: string): Promise<string> {
  try {
    return (await readBoundedFile(path, MAX_PROFILE_BYTES)).text;
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'file-too-large') throw new ProfileError([`profile: larger than ${MAX_PROFILE_BYTES / 1024} KiB`]);
    throw new ProfileError([`profile: unreadable (${(error as NodeJS.ErrnoException).code ?? message})`]);
  }
}

/** Reads and validates a profile file of at most 64 KiB. */
export async function loadProfile(path: string): Promise<RoutingProfile> {
  return parseProfile(await readProfileText(path));
}

export interface ProfileWatcherOptions {
  path: string;
  initial: RoutingProfile;
  clock?: Clock;
  onReload: (profile: RoutingProfile) => void;
  onReject: (error: ProfileError) => void;
}

/**
 * Polls the profile file on `timing.profilePollMs`. A valid, changed profile is swapped in whole; anything else is
 * reported once and the last good profile stays.
 */
export class ProfileWatcher {
  #current: RoutingProfile;
  readonly #path: string;
  readonly #clock: Clock;
  readonly #onReload: (profile: RoutingProfile) => void;
  readonly #onReject: (error: ProfileError) => void;
  #lastRejected: string | undefined;
  #timer: unknown;
  #checking: Promise<unknown> | undefined;
  #running = false;

  constructor(options: ProfileWatcherOptions) {
    this.#path = options.path;
    this.#current = options.initial;
    this.#clock = options.clock ?? systemClock;
    this.#onReload = options.onReload;
    this.#onReject = options.onReject;
  }

  get current(): RoutingProfile { return this.#current; }

  async check(): Promise<'unchanged' | 'reloaded' | 'rejected'> {
    let text: string | undefined;
    try {
      text = await readProfileText(this.#path);
      const profile = parseProfile(text);
      this.#lastRejected = undefined;
      if (isDeepStrictEqual(profile, this.#current)) return 'unchanged';
      this.#current = profile;
      this.#onReload(profile);
      return 'reloaded';
    } catch (error) {
      if (!(error instanceof ProfileError)) throw error;
      const signature = `${error.issues.join('\n')}\n${text ?? ''}`;
      if (signature === this.#lastRejected) return 'unchanged';
      this.#lastRejected = signature;
      this.#onReject(error);
      return 'rejected';
    }
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#checking;
  }

  #schedule(): void {
    if (!this.#running) return;
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = undefined;
      this.#checking = this.check().catch(() => 'rejected').finally(() => { this.#checking = undefined; this.#schedule(); });
    }, this.#current.timing.profilePollMs);
  }
}
