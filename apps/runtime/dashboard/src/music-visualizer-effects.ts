/**
 * The visualizer's effects (#1619, owner decision 2026-11-10: spectrum bars and bass pulse). Each effect is one entry in
 * `visualizerEffects`; a later effect is appended there and needs no change to these two or to the engine.
 */
import type {EffectInstance, Shape, Size, VisualizerEffect, VisualizerLevels} from './music-visualizer-model.ts';

const BACKGROUND = '#05070d';
const RESTING = 'hsl(220 10% 34%)';
const background = (size: Size): Shape => ({kind: 'rect', role: 'background', x: 0, y: 0, width: size.width, height: size.height, fill: BACKGROUND, alpha: 1});
/** A perceptual display curve, so quiet music still moves visibly. */
const shown = (value: number): number => Math.sqrt(Math.max(0, Math.min(1, value)));
const ease = (t: number): number => (1 - Math.cos(Math.PI * t)) / 2;

const BAR_COUNT = 12;
const CAP_FALL_PER_MS = 0.0009;
/** Bars spread bass (left) through mid to treble (right), eased between the three band centres. */
const barValue = (levels: VisualizerLevels, index: number): number => {
  const t = index / (BAR_COUNT - 1);
  return t <= 0.5 ? levels.bass + (levels.mid - levels.bass) * ease(t / 0.5) : levels.mid + (levels.treble - levels.mid) * ease((t - 0.5) / 0.5);
};
const barLayout = (size: Size, index: number): {x: number; width: number; bottom: number; span: number; floor: number} => {
  const margin = Math.max(4, size.width * 0.04), gap = Math.max(2, size.width * 0.012);
  const width = Math.max(1, (size.width - margin * 2 - gap * (BAR_COUNT - 1)) / BAR_COUNT);
  const bottom = size.height - Math.max(4, size.height * 0.08), span = bottom - Math.max(4, size.height * 0.08);
  return {x: margin + index * (width + gap), width, bottom, span, floor: Math.max(2, span * 0.02)};
};
const barHue = (index: number): number => 330 - (index / (BAR_COUNT - 1)) * 150;

export const spectrumBars: VisualizerEffect = {
  id: 'spectrum-bars', name: 'Spectrum bars',
  create(): EffectInstance {
    let heights: number[] = Array.from({length: BAR_COUNT}, () => 0);
    let caps: number[] | undefined;
    return {
      step(levels, elapsedMs) {
        heights = heights.map((_, index) => shown(barValue(levels, index)));
        caps = (caps ?? heights).map((cap, index) => Math.max(heights[index] ?? 0, cap - CAP_FALL_PER_MS * elapsedMs));
      },
      scene(size) {
        const shapes: Shape[] = [background(size)];
        heights.forEach((value, index) => {
          const {x, width, bottom, span, floor} = barLayout(size, index), height = floor + value * (span - floor);
          shapes.push({kind: 'rect', role: 'bar', x, y: bottom - height, width, height, fill: `hsl(${String(barHue(index))} 85% 60%)`, alpha: 0.95});
          const cap = caps?.[index] ?? value, top = bottom - (floor + cap * (span - floor));
          shapes.push({kind: 'rect', role: 'cap', x, y: top - Math.max(2, floor), width, height: Math.max(2, floor), fill: '#f4f7ff', alpha: 0.85});
        });
        return shapes;
      },
    };
  },
  resting(size) {
    return [background(size), ...Array.from({length: BAR_COUNT}, (_, index): Shape => {
      const {x, width, bottom, floor} = barLayout(size, index);
      return {kind: 'rect', role: 'bar', x, y: bottom - floor, width, height: floor, fill: RESTING, alpha: 0.8};
    })];
  },
};

const PULSE_DECAY_MS = 240;
const FLASH_DECAY_MS = 110;
const FLOOR_FOLLOW_MS = 300;
/** A bass rise this far above the recent bass floor fires a flash. */
const FLASH_RISE = 0.25;
const centre = (size: Size): {x: number; y: number; radius: number} => ({x: size.width / 2, y: size.height / 2, radius: Math.min(size.width, size.height) * 0.22});

export const bassPulse: VisualizerEffect = {
  id: 'bass-pulse', name: 'Bass pulse',
  create(): EffectInstance {
    let pulse = 0, flash = 0, floor: number | undefined, current: VisualizerLevels = {level: 0, bass: 0, mid: 0, treble: 0};
    return {
      step(levels, elapsedMs) {
        current = levels;
        const bass = shown(levels.bass);
        pulse = Math.max(bass, pulse * Math.exp(-elapsedMs / PULSE_DECAY_MS));
        flash *= Math.exp(-elapsedMs / FLASH_DECAY_MS);
        floor = floor === undefined ? bass : floor + (bass - floor) * -Math.expm1(-elapsedMs / FLOOR_FOLLOW_MS);
        if (bass - floor > FLASH_RISE) flash = Math.max(flash, Math.min(1, (bass - floor) * 2));
        if (flash < 0.02) flash = 0;
      },
      scene(size) {
        const {x, y, radius} = centre(size), hue = 300 - shown(current.treble) * 120 + shown(current.mid) * 30;
        const shapes: Shape[] = [background(size),
          {kind: 'circle', role: 'glow', x, y, radius: radius * (1.2 + 1.1 * pulse), fill: `hsl(${String(hue)} 90% 55%)`, alpha: 0.12 + 0.3 * pulse},
          {kind: 'circle', role: 'pulse', x, y, radius: radius * (1 + 0.9 * pulse), fill: `hsl(${String(hue)} 90% 58%)`, alpha: 0.55 + 0.4 * pulse},
          {kind: 'circle', role: 'core', x, y, radius: radius * (0.35 + 0.35 * shown(current.level)), fill: '#fff4fb', alpha: 0.85}];
        if (flash > 0) shapes.push({kind: 'ring', role: 'flash', x, y, radius: radius * (1.3 + 0.9 * (1 - flash)), lineWidth: Math.max(2, radius * 0.08), stroke: '#ffffff', alpha: 0.8 * flash});
        return shapes;
      },
    };
  },
  resting(size) {
    const {x, y, radius} = centre(size);
    return [background(size), {kind: 'ring', role: 'pulse', x, y, radius: radius * 0.6, lineWidth: Math.max(2, radius * 0.04), stroke: RESTING, alpha: 0.9}];
  },
};

/** The effect choice, in the order it is offered. Append a new effect here. */
export const visualizerEffects: readonly VisualizerEffect[] = [spectrumBars, bassPulse];
export const defaultEffect: VisualizerEffect = spectrumBars;
export const effectById = (id: string): VisualizerEffect => visualizerEffects.find(effect => effect.id === id) ?? defaultEffect;
