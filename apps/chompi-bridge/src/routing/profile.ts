import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { systemClock, type Clock } from '../clock.js';
import type { Rgb } from '../protocol.js';
import { readBoundedFile } from './files.js';

/**
 * The routing profile: one versioned JSON file mapping physical controls to the three core actions, the app
 * shortcuts they use, colors, timings and big-wheel card navigation. Fields added after the first release are
 * optional. It is data only: no URIs, paths, commands or package identities, and key names come from an
 * allowlist, so loading it can never run anything.
 */
export const PROFILE_SCHEMA_VERSION = 1;
export const MAX_PROFILE_BYTES = 64 * 1024;
export const DEFAULT_PROFILE_PATH = fileURLToPath(new URL('../../profiles/default.json', import.meta.url));

const MODIFIERS = ['LeftShift', 'LeftControl', 'LeftAlt', 'LeftWindows'] as const;
/**
 * Platform-neutral key names, exactly the set the Windows adapter can type (`VIRTUAL_KEYS`). Nothing else can appear
 * in a profile, so a profile can never ask the adapter for a key it would refuse at runtime.
 */
export const KEY_NAMES: readonly string[] = Object.freeze([
  'Enter', ...MODIFIERS,
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
]);

/** Click IDs of the four small top knobs (`ENC_1`-`ENC_4`) and the volume knob (`ENC_6`): never Send. */
export const SMALL_KNOB_CLICKS: readonly number[] = Object.freeze([29, 30, 31, 32]);
export const VOLUME_CLICK = 34;

export const COLOR_NAMES = ['empty', 'active', 'idle', 'unread', 'attention', 'ended', 'unknown', 'stale', 'error', 'record'] as const;
export type ColorName = typeof COLOR_NAMES[number];
/**
 * Colors the press-time model (#821) retired: the selected key and the Send-readiness wheel LEDs. A profile may still
 * list them, as the one installed for the #743 trial does; they must be valid colors and are otherwise ignored.
 */
export const RETIRED_COLOR_NAMES = ['selected', 'sendReady', 'sendBlocked'] as const;

/**
 * Big-wheel card navigation. The encoder turns smoothly and its counts per revolution are not established; the
 * defaults assume about 24, so a step is about a quarter turn. #745's physical acceptance tunes them.
 */
export interface CardSettings {
  /** Encoder counts per card step; the count restarts on a direction reversal. */
  readonly stepCounts: number;
  /** How long the wheel must be still before a click presses a card button. */
  readonly clickStillMs: number;
}
/**
 * Encoder counts per card step: about a quarter turn at an assumed 24 counts per revolution. This is the one place to
 * change the default once the big wheel's counts per revolution are measured; the shipped profile does not repeat it.
 */
export const DEFAULT_CARD_STEP_COUNTS = 6;
export const DEFAULT_CARD_SETTINGS: CardSettings = Object.freeze({ stepCounts: DEFAULT_CARD_STEP_COUNTS, clickStillMs: 250 });
const CARD_BOUNDS: Record<keyof CardSettings, [number, number, string]> = { stepCounts: [1, 96, ''], clickStillMs: [0, 2000, ' ms'] };

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
};

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
  };
  /** Big-wheel scrolling of the client conversation through the adapter's mouse-wheel primitive. */
  readonly scroll: { readonly notchesPerStep: number; readonly invert: boolean };
  /** Optional in the file; absent fields take `DEFAULT_CARD_SETTINGS`. */
  readonly cards: CardSettings;
  readonly colors: Readonly<Record<ColorName, Rgb>>;
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
      issues.push(`${path}[${i}]: ${JSON.stringify(key)} is not an allowed key name (Enter, ${MODIFIERS.join(', ')}, A-Z or 0-9)`);
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
  if (click(value.record, `${path}.record`)) claim(value.record as number, `${path}.record`);
  const send = value.send;
  if (!Array.isArray(send) || send.length < 1 || send.length > 3) issues.push(`${path}.send: must list 1-3 click controls`);
  else for (const [i, control] of send.entries()) {
    const where = `${path}.send[${i}]`;
    if (!click(control, where)) continue;
    if (SMALL_KNOB_CLICKS.includes(control)) issues.push(`${where}: ${control} is a small-knob click and can never send`);
    else if (control === VOLUME_CLICK) issues.push(`${where}: ${control} is the volume knob click and can never send`);
    else claim(control, where);
  }
  if (click(value.back, `${path}.back`)) claim(value.back as number, `${path}.back`);
  if (!isInt(value.scroll, 41, 46)) issues.push(`${path}.scroll: ${JSON.stringify(value.scroll)} is not a turn control 41-46`);
  if (issues.length > before) return undefined;
  return { slots: slots as number[], record: value.record as number, send: send as number[], back: value.back as number, scroll: value.scroll as number };
}

function shortcuts(value: unknown, issues: Issues): RoutingProfile['shortcuts'] | undefined {
  const path = 'profile.shortcuts';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, ['codexComposer', 'send', 'dictation'], [], issues)) return undefined;
  const before = issues.length;
  const noEnter = (key: string) => key === 'Enter' ? 'must not include Enter; only Send types Enter' : undefined;
  const codexComposer = keys(value.codexComposer, `${path}.codexComposer`, issues, noEnter);
  if (!Array.isArray(value.send) || value.send.length !== 1 || value.send[0] !== 'Enter') issues.push(`${path}.send: must be exactly ["Enter"]`);
  const holdable = new Set<string>(MODIFIERS);
  const dictation = keys(value.dictation, `${path}.dictation`, issues, key => holdable.has(key) ? undefined : `${key} is not a modifier; dictation holds modifiers only`);
  if (issues.length > before || !codexComposer || !dictation) return undefined;
  return { codexComposer, send: ['Enter'], dictation };
}

function colors(value: unknown, issues: Issues): RoutingProfile['colors'] | undefined {
  const path = 'profile.colors';
  if (!isObject(value)) { issues.push(`${path}: must be an object`); return undefined; }
  if (!fields(value, path, COLOR_NAMES, RETIRED_COLOR_NAMES, issues)) return undefined;
  const before = issues.length;
  for (const name of [...COLOR_NAMES, ...RETIRED_COLOR_NAMES]) {
    if (!(name in value)) continue;
    const color = value[name];
    if (!Array.isArray(color) || color.length !== 3 || !color.every(c => isInt(c, 0, 255))) issues.push(`${path}.${name}: must be [r, g, b] with integers 0-255`);
  }
  if (issues.length > before) return undefined;
  return Object.fromEntries(COLOR_NAMES.map(name => [name, value[name]])) as unknown as RoutingProfile['colors'];
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
  if (!fields(value, path, names, [], issues)) return undefined;
  const before = issues.length;
  for (const name of names) {
    const [min, max] = TIMING_BOUNDS[name];
    if (!isInt(value[name], min, max)) issues.push(`${path}.${name}: must be an integer ${min}-${max} ms`);
  }
  if (issues.length === before && (value.verifyPollMs as number) >= (value.verifyTimeoutMs as number)) issues.push(`${path}.verifyPollMs: must be shorter than verifyTimeoutMs`);
  return issues.length > before ? undefined : value as unknown as RoutingTiming;
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
  fields(value, 'profile', required, ['cards'], issues);
  if ('schemaVersion' in value && value.schemaVersion !== PROFILE_SCHEMA_VERSION) issues.push(`profile.schemaVersion: must be ${PROFILE_SCHEMA_VERSION}`);
  if ('profileVersion' in value && !isInt(value.profileVersion, 0, 0xffffffff)) issues.push('profile.profileVersion: must be an integer 0-4294967295');
  if ('brightnessPercent' in value && !isInt(value.brightnessPercent, 0, 100)) issues.push('profile.brightnessPercent: must be an integer 0-100');
  const parts = {
    controls: 'controls' in value ? controls(value.controls, issues) : undefined,
    shortcuts: 'shortcuts' in value ? shortcuts(value.shortcuts, issues) : undefined,
    scroll: 'scroll' in value ? scroll(value.scroll, issues) : undefined,
    cards: cards(value.cards, issues),
    colors: 'colors' in value ? colors(value.colors, issues) : undefined,
    timing: 'timing' in value ? timing(value.timing, issues) : undefined,
    qualifiedVersions: 'qualifiedVersions' in value ? versions(value.qualifiedVersions, issues) : undefined,
  };
  if (issues.length) throw new ProfileError(issues);
  return deepFreeze({
    schemaVersion: PROFILE_SCHEMA_VERSION, profileVersion: value.profileVersion as number, brightnessPercent: value.brightnessPercent as number,
    controls: parts.controls!, shortcuts: parts.shortcuts!, scroll: parts.scroll!, cards: { ...parts.cards! }, colors: parts.colors!, timing: parts.timing!,
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
