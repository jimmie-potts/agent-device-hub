import type {CaptureResponseSettings} from '@jimmie-potts/event-contracts/v2/music-capture-data';

type Levels = {rms: number; bands: {bass: number; mid: number; treble: number}};
export type MusicResponseValue = Readonly<{level: number; bass: number; mid: number; treble: number; gateOpen: boolean; alpha: number}>;
function object(value: unknown): value is Record<string, unknown> {return typeof value === 'object' && value !== null && !Array.isArray(value);}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid response fields.');
}
function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError('Invalid response value.');
  return value;
}
/** Closed, browser-safe validation for frozen renderer/preview settings. Wire schemas remain the ingress authority. */
export function freezeResponseSettings(input: unknown): CaptureResponseSettings {
  if (!object(input) || !object(input.emphasis) || !object(input.gate)) throw new TypeError('Invalid response settings.');
  keys(input, ['sensitivity', 'smoothingMs', 'emphasis', 'gate']);keys(input.emphasis, ['bass', 'mid', 'treble']);
  const gate = input.gate;
  let resolved: CaptureResponseSettings['gate'];
  if (gate.mode === 'off') {keys(gate, ['mode']);resolved = {mode: 'off'};}
  else if (gate.mode === 'manual') {keys(gate, ['mode', 'threshold']);resolved = {mode: 'manual', threshold: bounded(gate.threshold, 0, 16)};}
  else if (gate.mode === 'calibrated') {
    keys(gate, ['mode', 'threshold', 'calibrationId']);
    if (typeof gate.calibrationId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(gate.calibrationId)) throw new TypeError('Invalid calibration reference.');
    resolved = {mode: 'calibrated', threshold: bounded(gate.threshold, 0, 16), calibrationId: gate.calibrationId};
  } else throw new TypeError('Invalid response gate.');
  return Object.freeze({sensitivity: bounded(input.sensitivity, 0.1, 8), smoothingMs: bounded(input.smoothingMs, 0, 2000),
    emphasis: Object.freeze({bass: bounded(input.emphasis.bass, 0, 4), mid: bounded(input.emphasis.mid, 0, 4), treble: bounded(input.emphasis.treble, 0, 4)}),
    gate: Object.freeze(resolved)});
}
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
/** Pure response calculation. Callers commit the returned state only after accepting their output. */
export function musicResponse(input: unknown, frame: Levels, deltaMs: number, previous?: MusicResponseValue): MusicResponseValue {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new TypeError('Invalid response interval.');
  bounded(frame.rms, 0, 16);for (const value of [frame.bands.bass, frame.bands.mid, frame.bands.treble]) bounded(value, 0, 32);
  const settings = freezeResponseSettings(input);
  const gateOpen = settings.gate.mode === 'off' || frame.rms > settings.gate.threshold;
  const alpha = previous === undefined || settings.smoothingMs === 0 ? 1 : -Math.expm1(-deltaMs / settings.smoothingMs);
  const smooth = (before: number, value: number, emphasis = 1): number => {
    const target = gateOpen ? clamp(value * settings.sensitivity * emphasis) : 0;
    return before + (target - before) * alpha;
  };
  return Object.freeze({level: smooth(previous?.level ?? 0, frame.rms), bass: smooth(previous?.bass ?? 0, frame.bands.bass, settings.emphasis.bass),
    mid: smooth(previous?.mid ?? 0, frame.bands.mid, settings.emphasis.mid), treble: smooth(previous?.treble ?? 0, frame.bands.treble, settings.emphasis.treble), gateOpen, alpha});
}
