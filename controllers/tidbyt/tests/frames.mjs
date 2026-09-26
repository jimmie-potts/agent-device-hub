// Deterministic 64×32 RGB frames shared by the renderer tests and golden fixtures.
import { readFileSync } from 'node:fs';
import { nowPlayingFrame, nowPlayingView, statusFrame, statusView } from '../dist/index.js';

export const WIDTH = 64;
export const HEIGHT = 32;

function frame(pixel) {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) rgb.set(pixel(x, y), (y * WIDTH + x) * 3);
  }
  return rgb;
}

// A small linear congruential generator keeps the noise case reproducible.
function noise(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 24;
}

export const titleSnapshot = JSON.parse(readFileSync(new URL('../fixtures/status-titles.json', import.meta.url), 'utf8'));

export const goldenFrames = {
  'status-titles': () => statusFrame(statusView(titleSnapshot)).rgb,
  black: () => frame(() => [0, 0, 0]),
  'two-tone': () => frame((x, y) => ((x + y) % 2 ? [255, 0, 12] : [0, 0, 200])),
  'red-gradient': () => frame((x, y) => [(x * 4 + y) & 255, 7, 7]),
  'status-bar': () => frame((x, y) => (y < 8 ? [0, 160, 255] : x < 32 ? [255, 200, 0] : [30, 30, 30])),
  noise: () => { const next = noise(16); return frame(() => [next(), next(), next()]); },
  // The drawn now-playing card, so a drawing change shows up as a golden diff.
  'now-playing': () => nowPlayingFrame(nowPlayingView({
    apiVersion: '1.0', sourceId: 'golden', availability: 'available', observedAtMs: 0, ageMs: 0,
    playback: { status: 'playing', title: "Don't Stop Me Now", artist: 'Queen & Beyoncé', controls: [] },
  }, { readOk: true, ageMs: 0 })).rgb,
};
