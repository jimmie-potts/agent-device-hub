// The lit room (#1931): what a light or a plug on Home gives the glass layer, and how the layer eases it.
//
// A panel's light comes from observed state only: the level from the observed brightness of members that are observed
// on, the color from the LIFX module's own `lifx-light` reading. A light whose module reports no color (Nanoleaf today)
// has no color here (null) and the layer draws it in the skin's warm white (--glass-lamp, owner decision 8 of #1927).
// Requested, stale and unknown state draw no light.
import type {GlassPanel, GlassRgb} from './glass-scene.ts';
import type {LightingDevice} from './lighting.ts';

export type Glow = {level: number; color: GlassRgb | null};
export const NO_GLOW: Glow = {level: 0, color: null};
/** How brightly a plug that is observed on lights the room: the reference's plug level. Its color is warm white. */
export const PLUG_LEVEL = 0.8;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
/** A color temperature as sRGB channels (Tanner Helland's fit to the blackbody curve). */
function kelvinColor(kelvin: number): GlassRgb {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r / 255), clamp(g / 255), clamp(b / 255)];
}
/** A hue at full saturation and value. */
function hueColor(hue: number): GlassRgb {
  const h = ((hue % 360) + 360) % 360 / 60, x = 1 - Math.abs(h % 2 - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r, g, b];
}
/**
 * The color a LIFX bulb shows for its reading: its hue mixed with the white of its color temperature by its saturation,
 * at full value (the level carries the brightness).
 */
export function lampColor({hue, saturation, kelvin}: {hue: number; saturation: number; kelvin: number}): GlassRgb {
  const white = kelvinColor(kelvin), tint = hueColor(hue), s = clamp(saturation / 100);
  const mixed = white.map((value, index) => value * (1 - s) + (tint[index] ?? 0) * s);
  const peak = Math.max(...mixed, 1e-6);
  return [(mixed[0] ?? 0) / peak, (mixed[1] ?? 0) / peak, (mixed[2] ?? 0) / peak];
}

/**
 * The glow of a light card's members: as bright as the brightest member that current records observe on, in the
 * average of their observed colors, or warm white (null) when any of them reports no current color.
 */
export function glowOf(ids: readonly string[], devices: readonly LightingDevice[]): Glow {
  const lit: Glow[] = [];
  for (const id of ids) {
    const matches = devices.filter(device => device.record.id === id), device = matches[0];
    if (matches.length !== 1 || device === undefined || !device.live || device.record.availability !== 'available') continue;
    const observed = device.record.observed;
    if (observed.status !== 'known' || observed.power.status !== 'known' || !observed.power.value) continue;
    const level = observed.brightness.status === 'known' ? clamp(observed.brightness.value / 100) : 1;
    const reading = device.colorLive === true && device.color?.observed.status === 'known' ? device.color.observed : undefined;
    lit.push({level, color: reading === undefined ? null : lampColor(reading)});
  }
  if (lit.length === 0) return NO_GLOW;
  const level = Math.max(...lit.map(glow => glow.level));
  const colors = lit.map(glow => glow.color);
  if (colors.some(color => color === null)) return {level, color: null};
  const sum = (channel: number): number => colors.reduce((total, color) => total + (color?.[channel] ?? 0), 0) / colors.length;
  return {level, color: [sum(0), sum(1), sum(2)]};
}

/**
 * At most this many lit or pressed panels light the room at once. The renderer passes their rows to the shader
 * (`uLightIndex`), so its light loops cost the lit panels, never every panel: in software WebGL the page waits for every
 * pixel of every frame (#1966 review).
 */
export const MAX_LIGHTS = 16;
/** The rows of the first `MAX_LIGHTS` panels among the first `count` that draw light now (eased level or press above 0). */
export function litRows(panels: readonly GlassPanel[], lights: ReadonlyMap<string, EasedLight>, count: number): number[] {
  const rows: number[] = [];
  for (const [index, panel] of panels.slice(0, count).entries()) {
    const eased = lights.get(panel.id);
    if (panel.light !== undefined && eased !== undefined && eased.level + eased.press > 0 && rows.length < MAX_LIGHTS) rows.push(index);
  }
  return rows;
}

/** The eased values the layer draws for one panel. */
export type EasedLight = {level: number; press: number};
/** Rates per second matching the reference's 16% (light) and 24% (press) of the remaining gap per frame at 60 fps. */
export const LIGHT_RATE = -60 * Math.log(0.84);
export const PRESS_RATE = -60 * Math.log(0.76);
const SNAP = 0.004;

/**
 * One step of easing toward each lit panel's target over `seconds`. With reduced motion the values jump to their
 * targets. `moving` says whether another frame is needed; a panel without a lamp keeps no value.
 */
export function easeLights(previous: ReadonlyMap<string, EasedLight>, panels: readonly GlassPanel[], seconds: number, still: boolean): {lights: Map<string, EasedLight>; moving: boolean} {
  const lights = new Map<string, EasedLight>();let moving = false;
  const step = (value: number, goal: number, rate: number): number => {
    if (still) return goal;
    const next = goal + (value - goal) * Math.exp(-rate * seconds);
    if (Math.abs(goal - next) < SNAP) return goal;
    moving = true;return next;
  };
  for (const panel of panels) {
    if (panel.light === undefined) continue;
    const from = previous.get(panel.id) ?? {level: 0, press: 0};
    lights.set(panel.id, {level: step(from.level, panel.light.level, LIGHT_RATE), press: step(from.press, panel.light.pressed ? 1 : 0, PRESS_RATE)});
  }
  return {lights, moving};
}

/** The marks that make an element a panel's lamp for the glass layer (see glass-scene.ts). */
export function lampAttributes(glow: Glow, pressed = false): {'data-glass-lamp': string; 'data-glass-lamp-color'?: string; 'data-glass-pressed'?: ''} {
  return {'data-glass-lamp': String(Math.round(glow.level * 1000) / 1000),
    ...(glow.color === null ? {} : {'data-glass-lamp-color': glow.color.map(value => String(Math.round(value * 1000) / 1000)).join(' ')}),
    ...(pressed ? {'data-glass-pressed': ''} : {})};
}

/** The lights' eased values, whether they are still easing, and the timestamp of the frame that last stepped them. */
export type LightClock = {lights: ReadonlyMap<string, EasedLight>; easing: boolean; tick: number};
export const RESTING: LightClock = {lights: new Map(), easing: false, tick: 0};
/** The longest step one frame takes, so a frame after a stall does not jump. */
const MAX_STEP = 0.1;
const sameLights = (a: ReadonlyMap<string, EasedLight>, b: ReadonlyMap<string, EasedLight>): boolean => a.size === b.size
  && [...a].every(([id, value]) => {const other = b.get(id);return other !== undefined && other.level === value.level && other.press === value.press;});

/**
 * One frame of the lights at timestamp `now` (milliseconds). A step after a rest counts as one 60 fps frame; while
 * easing, it is the time since the last frame, at most `MAX_STEP`. `changed` says whether this frame moved anything;
 * `again` whether the layer must draw another frame. They differ when a frame repeats the last timestamp (or goes
 * back): it moves nothing, yet the lights are still easing, so the layer asks for the next frame anyway rather than
 * stopping short of the target (#1966 review). Once every value reaches its target, `again` is false and frames stop.
 */
export function lightFrame(clock: LightClock, panels: readonly GlassPanel[], now: number, still: boolean): {clock: LightClock; changed: boolean; again: boolean} {
  const seconds = clock.easing ? Math.min(MAX_STEP, Math.max(0, (now - clock.tick) / 1000)) : 1 / 60;
  const eased = easeLights(clock.lights, panels, seconds, still), changed = !sameLights(clock.lights, eased.lights);
  return {clock: {lights: changed ? eased.lights : clock.lights, easing: eased.moving, tick: now}, changed, again: eased.moving};
}
