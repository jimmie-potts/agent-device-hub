// The task-light renderer: pulse, wave, comet and zone colors, the display payload and its send (the rendering half of
// bridge.py). The worker that decides what to send, and when, moves with the worker slice (PORTING.md).
import type {DeviceConfig} from './devices.js';
import type {Display, Rgb} from './effects.js';
import type {Indication} from './line-projection.js';
import {DEFAULT_PALETTE, paletteRgb, type Role} from './project-map.js';
import type {SqlValue} from './sqlite.js';
import type {LightRequest} from './transport.js';

export type Palette = Readonly<Record<Role, Rgb>>;
/** An element's project color, or null for the base color, and the half (0 or 1) that shows it. */
export type Signature = readonly [Rgb | null, number];

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

const notPorted = (): never => {
  throw new Error('Not ported yet (Hub #26, slice 2).');
};

export function pulseAmplitude(_age: number): number {
  return notPorted();
}

/** Seconds the outward wave takes from `source` to each element, by distance. */
export function travelDelays(_config: {line_positions?: readonly (readonly number[])[]}, _source: number): number[] {
  return notPorted();
}

export function pixelColor(_snapshot: readonly Indication[], _target: number, _instant: number, _delays: Delays, _waveCutoff = -Infinity,
  _palette: Palette | null = null): Rgb {
  return notPorted();
}

export function cometColor(_config: RenderConfig, _snapshot: readonly Indication[], _target: number, _instant: number, _delays: Delays,
  _base: Rgb): Rgb {
  return notPorted();
}

export function zoneColor(_config: RenderConfig, _snapshot: readonly Indication[], _index: number, _half: number, _instant: number,
  _delays: Delays): Rgb {
  return notPorted();
}

export function effectPayload(_config: RenderConfig, _snapshot: readonly Indication[], _instant: number, _loop: boolean): Display {
  return notPorted();
}

/** Send the frames and the indicator brightness; the receipt of what the device accepted. */
export function render(_config: RenderConfig, _snapshot: readonly Indication[], _instant: number, _loop: boolean): Promise<RenderingReceipt> {
  return Promise.resolve(notPorted());
}

/** A native brightness override governs every worker write until the next explicit mode command. */
export function indicatorBrightness(_config: RenderConfig): number {
  return notPorted();
}
