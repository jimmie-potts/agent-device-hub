import React, {useEffect, useLayoutEffect, useRef} from 'react';
import {readScene, sameScene, type GlassScene} from './glass-scene.ts';
import {createGlassRenderer, type GlassColor, type GlassPicture, type GlassRenderer, type GlassTokens} from './glass-renderer.ts';
import './glass.css';

/**
 * The glass layer (#1929): one WebGL 2 canvas fixed under a page that draws a backdrop and flat, transparent liquid
 * glass for every element marked `data-glass-panel` inside `root` (see glass-scene.ts). Any page can use it:
 *
 * - The page sets `data-glass={glass}` on its root and renders `<GlassLayer onState={setGlass}/>` inside it; the layer's
 *   root is the nearest ancestor with that attribute. `glass.css` keys everything on that attribute: under `data-glass="webgl"` the card surfaces inside each
 *   panel turn transparent, the shell's own background steps aside and the rail and phone bar are frosted. Under
 *   `data-glass="quiet"` (the initial state, no WebGL 2, a lost context or a shader that will not build) nothing
 *   changes and the page shows its ordinary Quiet glass panels.
 * - `backdrop` is the picture behind the page, or null for the Quiet glass wash. The caller owns the bitmap and keeps
 *   it open while it is the current value; the layer uploads it when it changes and keeps no reference.
 *   `onBackdrop` reports which picture is actually on screen, or null when none is.
 * - `fuse` joins neighboring panels with a smooth minimum so they lean together; without it panels stay apart.
 *
 * The canvas takes no pointer input and the layer sends nothing. It draws only while something changes or eases: a box
 * moved or resized, the page scrolled, the window resized, the skin or appearance changed, the backdrop changed, or
 * the first appearance (700 ms) is still running. Boxes are read at most once per frame. Leaving the page releases the
 * context, the observers and the listeners.
 */
export type GlassState = 'webgl' | 'quiet';
export type GlassBackdrop = GlassPicture & {id: string};
export type GlassLayerProps = {
  onState: (state: GlassState) => void;
  backdrop?: GlassBackdrop | null;
  onBackdrop?: (id: string | null) => void;
  fuse?: boolean;
};

/** How long the first appearance takes. */
const APPEAR_MS = 700;
/** The join between neighboring panels when they fuse (the reference's k). */
const MERGE = 20;
/** Every skin value the shader reads, by its --glass-* token or shell role. */
const TOKENS = ['veil', 'veil-deep', 'tone', 'rim', 'shadow', 'edge', 'ink', 'bg', 'wash-start', 'wash-end'] as const;
type Token = (typeof TOKENS)[number];

/** Parses a computed color, which browsers serialize as rgb() or rgba() with 0-255 channels. */
export function parseColor(value: string): GlassColor {
  const numbers = /rgba?\(([^)]*)\)/.exec(value)?.[1]?.split(/[\s,/]+/).filter(part => part !== '').map(Number) ?? [];
  const [r = 0, g = 0, b = 0, a = 1] = numbers;
  return [r / 255, g / 255, b / 255, a];
}
/** WCAG relative luminance of a color's channels. */
export function luminance([r, g, b]: GlassColor): number {
  const linear = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function readTokens(probe: HTMLElement): GlassTokens {
  const value = (name: Token): GlassColor => {const element = probe.querySelector(`[data-glass-token="${name}"]`);return parseColor(element === null ? '' : getComputedStyle(element).color);};
  const bg = value('bg');
  return {dark: luminance(bg) < 0.2, ink: luminance(value('ink')), veil: value('veil'), veilDeep: value('veil-deep'), tone: value('tone'), rim: value('rim'),
    shadow: value('shadow'), edge: value('edge'), bg, washStart: value('wash-start'), washEnd: value('wash-end')};
}
const sameTokens = (a: GlassTokens, b: GlassTokens): boolean => JSON.stringify(a) === JSON.stringify(b);
const boxesOf = (scene: GlassScene): string => scene.panels.map(panel => `${panel.id}:${[panel.rect.x, panel.rect.y, panel.rect.width, panel.rect.height].map(value => value.toFixed(1)).join(',')}`).join('|');

type Glass = {backdrop: (picture: GlassBackdrop | null) => void; fuse: (value: boolean) => void; dispose: () => void};

/** Starts drawing on the canvas, or reports quiet and does nothing when WebGL 2 is unavailable. */
function startGlass(canvas: HTMLCanvasElement, root: HTMLElement, probe: HTMLElement, callbacks: {state: (state: GlassState) => void; backdrop: (id: string | null) => void}): Glass {
  const view = canvas.ownerDocument.defaultView ?? window, doc = canvas.ownerDocument;
  let gl: WebGL2RenderingContext | null = null;
  try {gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'});} catch {gl = null;}
  let renderer: GlassRenderer | null = null, picture: GlassBackdrop | null = null, merge = 0, disposed = false;
  let raf = 0, born = -1, frames = 0, scene: GlassScene | undefined, tokens: GlassTokens | undefined, size = '', drawnBackdrop: string | null | undefined;
  // What the next frame must look at. A frame that finds nothing new draws nothing.
  let readBoxes = true, readSkin = true, force = true, state: GlassState = 'quiet';
  const setState = (next: GlassState): void => {if (next !== state) {state = next;callbacks.state(next);}};
  const report = (id: string | null): void => {if (id !== drawnBackdrop) {drawnBackdrop = id;callbacks.backdrop(id);}};
  const build = (): void => {
    if (gl === null) return;
    try {renderer = createGlassRenderer(gl);renderer.backdrop(picture);delete canvas.dataset['glassFallback'];} catch {renderer = null;canvas.dataset['glassFallback'] = 'program';}
  };
  // Why the page shows Quiet glass, for diagnosis: no WebGL 2, a program that would not build, or a lost context.
  if (gl === null) canvas.dataset['glassFallback'] = 'no-webgl2';
  build();
  if (gl === null || renderer === null) {setState('quiet');report(null);return {backdrop: () => {}, fuse: () => {}, dispose: () => {}};}
  const still = view.matchMedia('(prefers-reduced-motion: reduce)');

  const frame = (now: number): void => {
    raf = 0;
    if (disposed || renderer === null || gl === null || gl.isContextLost()) return;
    if (doc.hidden) return;
    const dpr = Math.min(view.devicePixelRatio > 0 ? view.devicePixelRatio : 1, 2), width = canvas.clientWidth, height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const backing = `${String(Math.round(width * dpr))}x${String(Math.round(height * dpr))}`;
    let changed = force;force = false;
    if (backing !== size) {size = backing;canvas.width = Math.round(width * dpr);canvas.height = Math.round(height * dpr);changed = true;}
    if (readSkin) {readSkin = false;const next = readTokens(probe);if (tokens === undefined || !sameTokens(tokens, next)) {tokens = next;changed = true;}}
    if (readBoxes) {readBoxes = false;const next = readScene(root, doc, {width, height});if (scene === undefined || !sameScene(scene, next)) {scene = next;changed = true;}}
    if (born < 0) born = still.matches ? -APPEAR_MS : now;
    const appearing = now - born < APPEAR_MS;
    if (!changed && !appearing) return;
    if (tokens === undefined || scene === undefined) return;
    const t = Math.min(1, Math.max(0, (now - born) / APPEAR_MS)), scroll = doc.scrollingElement ?? doc.documentElement;
    renderer.draw({scene, tokens, width, height, dpr, appear: 1 - (1 - t) ** 3, depth: Math.min(1, scroll.scrollTop / (height * 0.4)), merge,
      washBox: [-scroll.scrollLeft, -scroll.scrollTop, scroll.clientWidth, Math.max(scroll.scrollHeight, height)]});
    frames += 1;canvas.dataset['glassFrames'] = String(frames);canvas.dataset['glassBoxes'] = boxesOf(scene);canvas.dataset['glassBackdrop'] = picture?.id ?? '';
    setState('webgl');report(picture?.id ?? null);
    if (appearing) schedule();
  };
  function schedule(): void {if (raf === 0 && !disposed) raf = view.requestAnimationFrame(frame);}
  const boxes = (): void => {readBoxes = true;schedule();};
  const skin = (): void => {readSkin = true;readBoxes = true;schedule();};

  const events = new AbortController(), signal = events.signal;
  view.addEventListener('resize', boxes, {signal});
  view.addEventListener('scroll', boxes, {signal, passive: true, capture: true});
  doc.addEventListener('visibilitychange', () => {if (!doc.hidden) {force = true;skin();}}, {signal});
  doc.fonts.addEventListener('loadingdone', boxes, {signal});
  view.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', skin, {signal});
  // Each panel's size is observed; the set is renewed only when the marked elements change.
  const sizes = new ResizeObserver(boxes);let observed: readonly Element[] = [];
  const observePanels = (): void => {
    const next = [root, ...root.querySelectorAll('[data-glass-panel]')];
    if (next.length === observed.length && next.every((element, index) => element === observed[index])) return;
    sizes.disconnect();for (const element of next) sizes.observe(element);observed = next;
  };
  observePanels();
  // Cards added, removed, reordered or reshaped (Edit Home, paging, a new record), and marks that change.
  const page = new MutationObserver(records => {if (records.some(record => record.type === 'childList')) observePanels();boxes();});
  page.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass-panel', 'data-glass-veil', 'style', 'class', 'hidden']});
  // The art theme and the appearance change the skin's values on the document element.
  const theme = new MutationObserver(skin);
  theme.observe(doc.documentElement, {attributes: true, attributeFilter: ['style', 'class', 'data-art-theme']});
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();view.cancelAnimationFrame(raf);raf = 0;renderer = null;canvas.dataset['glassFallback'] = 'lost';setState('quiet');report(null);
  }, {signal});
  canvas.addEventListener('webglcontextrestored', () => {
    build();if (renderer === null) return;born = -1;size = '';force = true;skin();
  }, {signal});
  schedule();

  return {
    backdrop: next => {picture = next;renderer?.backdrop(next);force = true;schedule();},
    fuse: value => {const next = value ? MERGE : 0;if (next !== merge) {merge = next;force = true;schedule();}},
    dispose: () => {
      disposed = true;view.cancelAnimationFrame(raf);events.abort();sizes.disconnect();page.disconnect();theme.disconnect();
      renderer?.dispose();renderer = null;gl?.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export function GlassLayer({onState, backdrop = null, onBackdrop, fuse = false}: GlassLayerProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null), probe = useRef<HTMLDivElement>(null), glass = useRef<Glass | null>(null);
  const callbacks = useRef({state: onState, backdrop: onBackdrop});
  callbacks.current = {state: onState, backdrop: onBackdrop};
  useLayoutEffect(() => {
    const element = canvas.current, owner = element?.parentElement?.closest<HTMLElement>('[data-glass]') ?? null, tokens = probe.current;
    if (element === null || owner === null || tokens === null) return;
    const started = startGlass(element, owner, tokens, {state: value => {callbacks.current.state(value);}, backdrop: id => {callbacks.current.backdrop?.(id);}});
    glass.current = started;
    return () => {glass.current = null;started.dispose();callbacks.current.state('quiet');callbacks.current.backdrop?.(null);};
  }, []);
  // A new picture is uploaded before paint, while the caller still holds its bitmap open.
  useLayoutEffect(() => {glass.current?.backdrop(backdrop);}, [backdrop]);
  useEffect(() => {glass.current?.fuse(fuse);}, [fuse]);
  return <>
    <canvas ref={canvas} className="glass-layer" aria-hidden="true"/>
    <div ref={probe} className="glass-tokens" hidden>{TOKENS.map(name => <i key={name} data-glass-token={name}/>)}</div>
  </>;
}
