// The task-light renderer: pulse, wave, comet and zone colors, the display payload and its send (the rendering half of
// bridge.py). The worker that decides what to send, and when, moves with the worker slice (PORTING.md).
import {compareText, pyDist, pyMod, pyRound} from './compat.js';
import {deviceOf, type DeviceConfig} from './devices.js';
import {display, type Display, type Frame, type Rgb, type Zone} from './effects.js';
import {ValueError} from './errors.js';
import type {Indication} from './line-projection.js';
import {DEFAULT_PALETTE, isRole, paletteRgb, type Role} from './project-map.js';
import type {SqlValue} from './sqlite.js';
import {lightRequest, type LightRequest} from './transport.js';

export type Palette = Readonly<Record<Role, Rgb>>;
/** An element's project color, or null for the base color, and the half (0 or 1) that shows it. */
export type Signature = readonly [Rgb | null, SqlValue];

export interface Flash {
  source: number;
  started: number;
}

/**
 * A device configuration with the state a worker pass adds for one send: the mode, the active comet and Locate flash,
 * the wave cutoff, the palette, the map's style, coverage and project halves, the steady and wave-suppressed slots, a
 * native brightness override, and the request and clock the send uses.
 */
export interface RenderConfig extends DeviceConfig {
  line_groups: number[][];
  ip?: string;
  token?: string;
  _mode?: string;
  _comet?: Flash | null;
  _locate?: Flash | null;
  _wave_cutoff?: number;
  _palette?: Palette;
  _style?: SqlValue;
  _coverage?: SqlValue;
  _signatures?: readonly Signature[];
  _steady_slots?: readonly number[];
  _wave_suppressed_slots?: readonly number[];
  _brightness?: number | null;
  _controller_request?: LightRequest;
  _now?: () => number;
}

/** What the device accepted for one send, saved as the rendering receipt. */
export interface RenderingReceipt {
  apiVersion: '1.0';
  deviceId: string;
  lineGroups: number[][];
  mode: string;
  brightness: number;
  loop: boolean;
  effect: Display;
  animationEpochMs: number;
  sendStartedAtMs: number;
  effectAcceptedAtMs: number;
  acceptedAtMs: number;
}

// The operator's palette replaces these defaults on every pass; priority stays keyed by status.
export const PALETTE: Palette = Object.freeze(paletteRgb(DEFAULT_PALETTE));
export const BASELINE: Rgb = PALETTE.base;
export const COLORS = Object.freeze({working: PALETTE.working, question: PALETTE.question, blocked: PALETTE.blocked, unread: PALETTE.unread});
export const PRIORITY: ReadonlyMap<SqlValue, number> = new Map([['working', 1], ['question', 2], ['blocked', 3], ['unread', 0]]);
// The controller uses decisecond frames, so 20 ticks gives a two-second cycle.
export const PULSE_TICKS = 20;
export const PULSE_SECONDS = PULSE_TICKS / 10;
export const TRAVEL_SECONDS = PULSE_SECONDS * 0.4;
export const MIN_BRIGHTNESS = 0.2;
export const RADIATING_PULSES = 1;
export const COMET_SECONDS = 2.0;
export const COMET_TRAVEL = 1.4;
export const COMET_TAIL = 0.6;

export type Delays = readonly (readonly number[])[];

type Activity = readonly [SqlValue, SqlValue];
type Candidate = readonly [number, number, SqlValue];

/** An indication's wave epoch; Python's arithmetic on anything else raised TypeError. */
function epochOf(activity: Activity): number {
  const epoch = activity[1];
  if (typeof epoch !== 'number') throw new TypeError('An indication needs a numeric epoch.');
  return epoch;
}

function delayOf(delays: Delays, source: number, target: number): number {
  const delay = delays[source]?.[target];
  if (delay === undefined) throw new RangeError('No travel delay between these elements.');
  return delay;
}

/** PRIORITY[status], which Python's zone_color indexed directly. */
function priorityOf(status: SqlValue): number {
  const priority = PRIORITY.get(status);
  if (priority === undefined) throw new RangeError(`No priority for status ${String(status)}.`);
  return priority;
}

/** palette.get(status, palette['base']). */
const roleColor = (palette: Palette, status: SqlValue): Rgb => (isRole(status) ? palette[status] : palette.base);

/** Python's max() of (priority, amplitude, status) tuples. */
function strongest(candidates: readonly Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const order = candidate[0] !== best[0] ? candidate[0] - best[0]
      : candidate[1] !== best[1] ? candidate[1] - best[1] : compareText(String(candidate[2]), String(best[2]));
    if (order > 0) best = candidate;
  }
  return best;
}

const blendInto = (from: Rgb, to: Rgb, amount: number): Rgb =>
  [pyRound(from[0] * (1 - amount) + to[0] * amount), pyRound(from[1] * (1 - amount) + to[1] * amount), pyRound(from[2] * (1 - amount) + to[2] * amount)];

function positionsOf(config: {line_positions?: readonly (readonly number[])[]}): readonly (readonly number[])[] {
  if (config.line_positions === undefined) throw new ValueError('Each Line needs a position for outward pulses.');
  return config.line_positions;
}

export function pulseAmplitude(age: number): number {
  if (age < 0) return 0.0;
  const phase = pyMod(age, PULSE_SECONDS) / PULSE_SECONDS;
  if (phase < 0.2) return phase / 0.2;
  if (phase < 0.3) return 1.0;
  if (phase < 0.5) return (0.5 - phase) / 0.2;
  return 0.0;
}

/** Seconds the outward wave takes from `source` to each element, by distance. */
export function travelDelays(config: {line_positions?: readonly (readonly number[])[]}, source: number): number[] {
  const positions = positionsOf(config);
  const origin = positions[source];
  if (origin === undefined) throw new RangeError('No position for the wave source.');
  const distances = positions.map(target => pyDist(origin, target));
  const maximum = Math.max(...distances);
  return distances.map(distance => distance / (maximum === 0 ? 1.0 : maximum) * TRAVEL_SECONDS);
}

export function pixelColor(snapshot: readonly Indication[], target: number, instant: number, delays: Delays, waveCutoff = -Infinity,
  palette: Palette | null = null): Rgb {
  const colors = palette ?? PALETTE;
  const candidates: Candidate[] = [];
  snapshot.forEach((activity, source) => {
    if (activity === null) return;
    const [status] = activity;
    const epoch = epochOf(activity);
    let age = instant - epoch;
    if (source !== target) {
      if (status === 'unread' || status === 'idle' || epoch <= waveCutoff) return;
      age -= delayOf(delays, source, target);
      if (!(age >= 0 && age < RADIATING_PULSES * PULSE_SECONDS)) return;
    }
    const amplitude = status === 'idle' ? 1 : pulseAmplitude(age);
    // An assigned Line keeps its status hue even between flashes. Other
    // Lines receive that hue only while the initial wave passes them.
    if (source === target || amplitude > 0.001) candidates.push([PRIORITY.get(status) ?? 0, amplitude, status]);
  });
  const best = strongest(candidates);
  if (best === undefined) return colors.base;
  const [, amount, status] = best;
  const brightness = MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * amount;
  const color = roleColor(colors, status);
  return [pyRound(color[0] * brightness), pyRound(color[1] * brightness), pyRound(color[2] * brightness)];
}

export function cometColor(config: RenderConfig, snapshot: readonly Indication[], target: number, instant: number, delays: Delays,
  base: Rgb): Rgb {
  const comet = config._comet;
  if (comet === undefined || comet === null || (config._mode ?? 'work') !== 'work') return base;
  const cutoff = config._wave_cutoff ?? -Infinity;
  for (const [source, activity] of snapshot.entries()) {
    if (activity === null || (activity[0] !== 'blocked' && activity[0] !== 'question')) continue;
    if (source === target) return base;
    const epoch = epochOf(activity);
    const age = instant - epoch - delayOf(delays, source, target);
    if (epoch > cutoff && age >= 0 && age < PULSE_SECONDS && pulseAmplitude(age) > 0.001) return base;
  }
  const positions = positionsOf(config);
  const origin = positions[comet.source];
  const point = positions[target];
  if (origin === undefined || point === undefined) throw new RangeError('No position for the comet.');
  const distances = positions.map(other => pyDist(origin, other));
  const maximum = Math.max(...distances);
  const arrival = COMET_TRAVEL * pyDist(origin, point) / (maximum === 0 ? 1.0 : maximum);
  const age = instant - comet.started - arrival;
  if (!(age >= 0 && age < COMET_TAIL)) return base;
  // A white head fades into the Unread color the Line settles into.
  const settle = Math.min(1.0, Math.max(0.0, (age - 0.1) / 0.1));
  const unread = (config._palette ?? PALETTE).unread;
  const color: Rgb = [255 + (unread[0] - 255) * settle, 255 + (unread[1] - 255) * settle, 255 + (unread[2] - 255) * settle];
  return blendInto(base, color, Math.min(1.0, (COMET_TAIL - age) / 0.4));
}

export function zoneColor(config: RenderConfig, snapshot: readonly Indication[], index: number, half: number, instant: number,
  delays: Delays): Rgb {
  const quiet = config._mode === 'quiet';
  const steadySlots = config._steady_slots ?? [];
  const suppressed = new Set([...steadySlots, ...(config._wave_suppressed_slots ?? [])]);
  const shown = snapshot.map((item, i) => (suppressed.has(i) && i !== index ? null : item));
  const activity = shown[index];
  if (activity === undefined) throw new RangeError('No such element.');
  const steady = steadySlots.includes(index);
  const palette = config._palette ?? PALETTE;
  const cutoff = config._wave_cutoff ?? -Infinity;
  let base = quiet || steady
    ? (activity === null ? palette.base : roleColor(palette, activity[0]))
    : pixelColor(shown, index, instant, delays, cutoff, palette);
  let signature: Rgb | null = null;
  // Project/status halves need a two-zone Line; one-zone triangles always show status.
  if (config._style === 'project' && config.line_groups[index]?.length === 2) {
    const value = config._signatures?.[index];
    if (value !== undefined && half === value[1]) signature = value[0] ?? palette.base;
  }
  if (signature !== null) {
    base = signature;
    if (!quiet && !steady && config._coverage === 'whole') {
      const candidates: Candidate[] = [];
      shown.forEach((item, source) => {
        if (item === null || item[0] === 'unread' || item[0] === 'idle' || epochOf(item) <= cutoff) return;
        const age = instant - epochOf(item) - (source !== index ? delayOf(delays, source, index) : 0);
        if (!(age >= 0 && age < PULSE_SECONDS)) return;
        const amount = pulseAmplitude(age);
        if (amount <= 0.001) return;
        if (activity !== null && (PRIORITY.get(activity[0]) ?? 0) > priorityOf(item[0])) return;
        candidates.push([priorityOf(item[0]), amount, item[0]]);
      });
      const best = strongest(candidates);
      if (best !== undefined) {
        const [, amount, status] = best;
        if (!isRole(status)) throw new RangeError(`No palette color for status ${String(status)}.`);
        base = blendInto(signature, palette[status], amount);
      }
    }
  }
  if (!quiet && !steady && (signature === null || config._coverage === 'whole')) base = cometColor(config, shown, index, instant, delays, base);
  const locate = config._locate;
  if (locate !== undefined && locate !== null && locate.source === index && instant - locate.started >= 0 && instant - locate.started < 1) {
    return [255, 255, 255];
  }
  return base;
}

export function effectPayload(config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean): Display {
  const groups = config.line_groups;
  if (snapshot.length !== groups.length) throw new ValueError('Task display does not match the physical Lines.');
  const quiet = config._mode === 'quiet';
  const comet = (config._mode ?? 'work') === 'work' ? config._comet ?? null : null;
  const locate = config._locate ?? null;
  const animated = (snapshot.some(item => item !== null) || comet !== null || locate !== null) && !quiet;
  const delays = groups.map((_, source) => travelDelays(config, source));
  const ticks = comet !== null ? Array.from({length: PULSE_TICKS}, (_, i) => i + 1)
    : animated ? [1, ...Array.from({length: PULSE_TICKS / 2 - 1}, (_, i) => 2 * (i + 1)), PULSE_TICKS] : [1];
  const zones: Zone[] = [];
  groups.forEach((pair, index) => {
    pair.forEach((panel, half) => {
      let previous = 0;
      const frames = ticks.map((tick): Frame => {
        const color = zoneColor(config, snapshot, index, half, instant + tick / 10, delays);
        const frame: Frame = [color[0], color[1], color[2], tick - previous];
        previous = tick;
        return frame;
      });
      zones.push([panel, frames]);
    });
  });
  return {write: display(zones, animated, loop && animated && comet === null && locate === null, (config.kind ?? 'lines') === 'lines')};
}

/** Send the frames and the indicator brightness; the receipt of what the device accepted. */
export async function render(config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean): Promise<RenderingReceipt> {
  const request = config._controller_request ?? lightRequest;
  const now = config._now ?? ((): number => Date.now() / 1000);
  const address = {ip: config.ip ?? '', token: config.token ?? ''};
  const effect = effectPayload(config, snapshot, instant, loop);
  const sendStarted = now();
  await request(address, 'PUT', '/effects', effect);
  const effectAccepted = now();
  const brightness = indicatorBrightness(config);
  await request(address, 'PUT', '/state', {on: {value: true}, brightness: {value: brightness, duration: 0}});
  return {apiVersion: '1.0', deviceId: deviceOf(config), lineGroups: config.line_groups.map(pair => [...pair]), mode: config._mode ?? 'work',
    brightness, loop: effect.write.loop, effect, animationEpochMs: pyRound(instant * 1000), sendStartedAtMs: pyRound(sendStarted * 1000),
    effectAcceptedAtMs: pyRound(effectAccepted * 1000), acceptedAtMs: pyRound(now() * 1000)};
}

/** A native brightness override governs every worker write until the next explicit mode command. */
export function indicatorBrightness(config: RenderConfig): number {
  const override = config._brightness;
  if (override !== undefined && override !== null) return override;
  return config._mode === 'quiet' ? 10 : 30;
}
