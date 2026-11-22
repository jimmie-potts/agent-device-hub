import React, {useLayoutEffect, useRef} from 'react';
import {easeTarget, moveScene, readScene, sameScene, visibleScene, type GlassScene} from './glass-scene.ts';
import {lightFrame, RESTING, type EasedLight, type LightClock} from './glass-light.ts';
import {createGlassRenderer, lightColor, luminance, parseColor, type GlassColor, type GlassPicture, type GlassRenderer, type GlassTokens} from './glass-renderer.ts';
import {advanceThumb, type GlassThumb, type ThumbBox} from './glass-thumb.ts';
import {liquidFrame, SETTLED, type LiquidClock} from './glass-liquid.ts';
import './glass.css';

/**
 * The glass layer (#1929): WebGL 2 under a page that draws a backdrop and flat, transparent liquid glass for every
 * element marked `data-glass-panel` inside `root` (see glass-scene.ts). It draws two canvases with one program (#2023):
 * the backdrop on a canvas fixed to the window and as tall as the largest viewport, so a phone's toolbar neither
 * stretches nor rescales it; and the glass on a transparent canvas that scrolls with the page, over the window and a
 * margin above and below it, so the browser moves the glass with the cards instead of a frame later. Any page can use it:
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
 * A panel with a lamp (`data-glass-lamp`, see glass-scene.ts) lights the room (#1931). Its level and press ease toward
 * the page's marks on a time base (glass-light.ts), so a light that switches on or off or a panel that is pressed
 * draws frames until it settles, and none after.
 *
 * A panel that moves or changes size turns liquid (#1932, glass-liquid.ts): its corners round off, its edge wobbles
 * and its join to neighbors widens, by how fast its box changes, then it settles in about a second. A panel element
 * with a running animation (such as the unfold's FLIP) is read every frame while it runs. A window resize, a scroll or
 * reduced motion stirs nothing.
 *
 * The canvases take no pointer input and the layer sends nothing. It draws only while something changes or eases: a box
 * moved or resized, the page scrolled (the backdrop's wash or veil, or the artwork seen through the glass, moved; or
 * the glass canvas's margin ran out), the window resized, the skin or appearance changed, the backdrop changed, a
 * switch's thumb is still travelling (glass-thumb.ts), a panel animating or settling, or the first appearance (700 ms)
 * is still running. Boxes are read at most once per frame. Leaving the page releases the
 * context, the observers and the listeners.
 */
export type GlassState = 'webgl' | 'quiet';
export type GlassBackdrop = GlassPicture & {id: string};
export type GlassLayerProps = {
  onState: (state: GlassState) => void;
  backdrop?: GlassBackdrop | null;
  onBackdrop?: (id: string | null) => void;
  fuse?: boolean;
  /** Whether the glass eases in over its first 700 ms; without it the first frame is the settled one. */
  appear?: boolean;
};

/** How long the first appearance takes. */
const APPEAR_MS = 700;
/**
 * Without a GPU the browser renders WebGL in software and reads every frame back for its compositor, which holds the
 * page's main thread for the whole draw: about 110 ms for a million pixels on a desktop processor, several times that
 * on a shared build host, where the dashboard's journeys spent most of their time waiting for glass frames (#1965).
 * There the layer draws at most 250,000 pixels and the browser scales them up, and it skips the 700 ms first
 * appearance, which would otherwise be a run of such frames on every page load. With a GPU it draws every pixel and
 * eases in.
 */
const SOFTWARE_PIXELS = 250_000;
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software/i;
/**
 * How far the glass canvas reaches above and below the window (#2023). The browser scrolls the canvas with the page at
 * once and the layer redraws it a frame or more later; until then this margin is what scrolls into view, so it holds
 * the glass of the cards just outside the window.
 */
const OVERSCAN = 200;
/**
 * How much of that margin is kept: the canvas is placed again once less is left above or below the window, and it is
 * centred again whenever the glass is redrawn anyway, so a scroll of up to this much between two frames stays covered.
 */
const KEEP = 150;
/** How far from a fixed veil a lamp's spill still shows under it (at 800 px it adds under 1% of white, #2023). */
const SPILL_REACH = 800;
/** The join between neighboring panels when they fuse (the reference's k). */
const MERGE = 20;
/** Every skin value the shader reads, by its --glass-* token or shell role. */
const TOKENS = ['veil', 'veil-deep', 'tone', 'rim', 'shadow', 'edge', 'ink', 'bg', 'wash-start', 'wash-end', 'lamp'] as const;
type Token = (typeof TOKENS)[number];

function readTokens(probe: HTMLElement): GlassTokens {
  const value = (name: Token): GlassColor => {const element = probe.querySelector(`[data-glass-token="${name}"]`);return parseColor(element === null ? '' : getComputedStyle(element).color);};
  const bg = value('bg');
  return {dark: luminance(bg) < 0.2, ink: luminance(value('ink')), veil: value('veil'), veilDeep: value('veil-deep'), tone: value('tone'), rim: value('rim'),
    shadow: value('shadow'), edge: value('edge'), bg, washStart: value('wash-start'), washEnd: value('wash-end'), lamp: value('lamp')};
}
const sameTokens = (a: GlassTokens, b: GlassTokens): boolean => JSON.stringify(a) === JSON.stringify(b);
const thumbOf = (thumb: GlassThumb | null): string => thumb === null ? '' : [...thumb.lead, ...thumb.lag].map(value => value.toFixed(1)).join(',');
/**
 * The light each lit panel was last drawn with, as `id:r,g,b,level,press,x,y` (sRGB channels, then the lamp's center),
 * for checks and diagnosis. Empty when no light is drawn.
 */
const lightsOf = (scene: GlassScene, lights: ReadonlyMap<string, EasedLight>, tokens: GlassTokens): string => scene.panels.flatMap(panel => {
  const eased = lights.get(panel.id);if (panel.light === undefined || eased === undefined || eased.level + eased.press <= 0) return [];
  return [`${panel.id}:${[...lightColor(panel.light.color, tokens), eased.level, eased.press].map(value => value.toFixed(3)).join(',')},${panel.light.lamp.x.toFixed(1)},${panel.light.lamp.y.toFixed(1)}`];
}).join('|');
/** The liquid panels last drawn, as `id:wob`, for checks and diagnosis. Empty when every panel is at rest. */
const liquidOf = (wobs: ReadonlyMap<string, number>): string => [...wobs].map(([id, value]) => `${id}:${value.toFixed(3)}`).join('|');
const veilsOf = (scene: GlassScene): string => scene.veils.map(veil => `${veil.edge ? 'edge' : 'soft'}:${[veil.rect.x, veil.rect.y, veil.rect.width, veil.rect.height].map(value => value.toFixed(1)).join(',')}`).join('|');
const moveBox = (box: ThumbBox, dx: number, dy: number): ThumbBox => [box[0] + dx, box[1] + dy, box[2], box[3]];
const moveThumb = (thumb: GlassThumb, dx: number, dy: number): GlassThumb => ({...thumb, lead: moveBox(thumb.lead, dx, dy), lag: moveBox(thumb.lag, dx, dy), target: moveBox(thumb.target, dx, dy)});
const boxesOf = (scene: GlassScene): string => scene.panels.map(panel => `${panel.id}:${[panel.rect.x, panel.rect.y, panel.rect.width, panel.rect.height].map(value => value.toFixed(1)).join(',')}`).join('|');


type Glass = {backdrop: (picture: GlassBackdrop | null) => void; fuse: (value: boolean) => void; dispose: () => void};
/** Where the glass canvas is, in the window's CSS pixels. */
type Placement = {x: number; y: number; width: number; height: number};

/** Starts drawing on the two canvases, or reports quiet and does nothing when WebGL 2 is unavailable. */
function startGlass(canvas: HTMLCanvasElement, back: HTMLCanvasElement, root: HTMLElement, probe: HTMLElement, callbacks: {state: (state: GlassState) => void; backdrop: (id: string | null) => void},
  options: {appear: boolean}): Glass {
  const view = canvas.ownerDocument.defaultView ?? window, doc = canvas.ownerDocument;
  const open = (element: HTMLCanvasElement, alpha: boolean): WebGL2RenderingContext | null => {
    try {return element.getContext('webgl2', {alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'});} catch {return null;}
  };
  const gl = open(canvas, true), bgl = gl === null ? null : open(back, false);
  let renderer: GlassRenderer | null = null, backRenderer: GlassRenderer | null = null, picture: GlassBackdrop | null = null, merge = 0, disposed = false;
  let raf = 0, born = -1, frames = 0, scene: GlassScene | undefined, tokens: GlassTokens | undefined, drawnBackdrop: string | null | undefined;
  // What each canvas last drew, so a frame that would draw the same picture draws nothing: the backdrop's inputs as a
  // key; the glass's scene in its own coordinates, where it was and its other inputs as a key.
  let backKey = '', glassKey = '', glassDrawn: GlassScene | undefined, placed: Placement | undefined, placedTop = 0;
  // Whether the glass canvas has been placed again since it last drew, so its picture no longer matches the page.
  let replaced = false;
  // The switch thumb and when it last moved; -1 while it rests, so its next step is one frame long, not the idle time.
  let thumb: GlassThumb | null = null, thumbAt = -1;
  // The lights' eased values and when they last stepped (glass-light.ts), and whether the first appearance's final,
  // settled picture has been drawn.
  let clock: LightClock = RESTING, appeared = false;
  // The panels' liquid state on its own frame clock with the same rules (glass-liquid.ts). A rebased read (after a
  // window resize) stirs nothing.
  let liquid: LiquidClock = SETTLED, wobs: ReadonlyMap<string, number> = new Map(), rebase = false;
  // The drop target's light (#1933): which panel and how far it has eased in or out, and when it last stepped.
  let target: {id: string; glow: number} | undefined, targetEasing = false, targetTick = 0;
  // What the next frame must look at. A frame that finds nothing new draws nothing.
  let readBoxes = true, readSkin = true, force = true, resizing = false, settling: GlassScene | undefined, settleFrames = 0, state: GlassState = 'quiet';
  const setState = (next: GlassState): void => {if (next !== state) {state = next;callbacks.state(next);}};
  const report = (id: string | null): void => {if (id !== drawnBackdrop) {drawnBackdrop = id;callbacks.backdrop(id);}};
  const build = (): void => {
    if (gl === null || bgl === null) return;
    try {
      renderer = createGlassRenderer(gl);backRenderer = createGlassRenderer(bgl);renderer.backdrop(picture);backRenderer.backdrop(picture);delete canvas.dataset['glassFallback'];
    } catch {renderer?.dispose();renderer = null;backRenderer?.dispose();backRenderer = null;canvas.dataset['glassFallback'] = 'program';}
  };
  // Why the page shows Quiet glass, for diagnosis: no WebGL 2, a program that would not build, or a lost context.
  if (gl === null || bgl === null) canvas.dataset['glassFallback'] = 'no-webgl2';
  // Whether the context renders in software (see SOFTWARE_PIXELS). The renderer's name is the only sign browsers give.
  const debug = gl?.getExtension('WEBGL_debug_renderer_info'), software = gl !== null && debug !== null && debug !== undefined && SOFTWARE.test(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)));
  if (software) canvas.dataset['glassSoftware'] = '';
  build();
  if (gl === null || bgl === null || renderer === null || backRenderer === null) {
    // A context that did open is released at once, so a page that falls back holds none.
    for (const context of [gl, bgl]) context?.getExtension('WEBGL_lose_context')?.loseContext();
    setState('quiet');report(null);return {backdrop: () => {}, fuse: () => {}, dispose: () => {}};
  }
  const still = view.matchMedia('(prefers-reduced-motion: reduce)');
  const ratio = (): number => Math.min(view.devicePixelRatio > 0 ? view.devicePixelRatio : 1, 2);
  const dprOf = (width: number, height: number): number => software ? Math.min(ratio(), Math.sqrt(SOFTWARE_PIXELS / (width * height))) : ratio();
  /** Sizes a canvas's backing store; true when it changed, which clears it. */
  const backing = (element: HTMLCanvasElement, width: number, height: number, dpr: number): boolean => {
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (element.width === w && element.height === h) return false;
    element.width = w;element.height = h;return true;
  };
  /**
   * Places the glass canvas over the window and OVERSCAN pixels above and below it, inside the document so that it
   * never makes the page scroll further. The canvas is positioned absolutely, so the browser scrolls it with the page;
   * its top is corrected by measuring, whatever its containing block is. Its width is its containing block's (the
   * window's, when no ancestor is positioned) in CSS, so a narrower window never leaves it wider than the page.
   */
  /** Where the document's top and end are in the window, and how tall the glass canvas is: the window and its margins. */
  const extent = (height: number): {top: number; bottom: number; tall: number} => {
    const top = -(doc.scrollingElement ?? doc.documentElement).scrollTop, bottom = Math.max(doc.body.getBoundingClientRect().bottom, top + 1);
    return {top, bottom, tall: Math.max(1, Math.min(height + 2 * OVERSCAN, Math.floor(bottom - top)))};
  };
  const place = (tall: number, top: number, bottom: number): Placement => {
    const y = Math.round(Math.min(Math.max(-OVERSCAN, top), bottom - tall));
    canvas.style.height = `${String(tall)}px`;
    let box = canvas.getBoundingClientRect();
    if (Math.abs(box.top - y) > 0.25) {placedTop += y - box.top;canvas.style.top = `${String(placedTop)}px`;box = canvas.getBoundingClientRect();}
    return {x: box.left, y: box.top, width: canvas.clientWidth, height: tall};
  };

  const frame = (now: number): void => {
    raf = 0;
    if (disposed || renderer === null || backRenderer === null || gl.isContextLost() || bgl.isContextLost()) return;
    if (doc.hidden) return;
    // The window: the backdrop canvas is as tall as the largest viewport (100lvh), so a phone's toolbar that shows or
    // hides neither stretches it nor rescales the artwork (#2023).
    const width = back.clientWidth, height = back.clientHeight;
    if (width === 0 || height === 0) return;
    // The glass scrolls with the page. It is placed again when it no longer covers the window and KEEP of its margin, or
    // reaches past the end of the page, which it would lengthen; a page that only grows below it keeps it where it is.
    // It is placed before anything is read, since a canvas left over from before a resize can still lengthen the page
    // and so move the sticky rail and every box.
    const {top, bottom, tall} = extent(height);
    let at: DOMRect | undefined = placed === undefined ? undefined : canvas.getBoundingClientRect();
    const covers = at !== undefined && placed !== undefined && placed.width === canvas.clientWidth && placed.height <= height + 2 * OVERSCAN
      && at.top <= Math.max(top, -KEEP) + 1 && at.bottom >= Math.min(bottom, height + KEEP) - 1 && at.top >= top - 1 && at.bottom <= bottom + 1;
    if (!covers) {placed = place(tall, top, bottom);at = canvas.getBoundingClientRect();replaced = true;}
    if (placed === undefined || at === undefined) return;
    // A window resize moves the boxes twice: the browser reflows at once and the page repacks its grid in the tasks
    // after. Drawing each would cost two frames; the layer waits until two reads agree, for up to ten frames, and
    // draws once. The canvases keep their last pictures until then.
    if (resizing) {
      const next = readScene(root, doc, {width, height}, OVERSCAN);
      if ((settling === undefined || !sameScene(settling, next)) && (settleFrames += 1) < 10) {settling = next;schedule();return;}
      resizing = false;settling = undefined;settleFrames = 0;readBoxes = true;rebase = true;
    }
    let drawBack = force, drawGlass = force || replaced;force = false;
    if (readSkin) {readSkin = false;const next = readTokens(probe);if (tokens === undefined || !sameTokens(tokens, next)) {tokens = next;drawBack = true;drawGlass = true;}}
    if (readBoxes) {readBoxes = false;scene = readScene(root, doc, {width, height}, OVERSCAN);canvas.dataset['glassBoxes'] = boxesOf(scene);}
    if (born < 0) born = still.matches || !options.appear || software ? -APPEAR_MS : now;
    // The thumb travels in the root's coordinates, so a scroll does not move it (#2023).
    const origin = root.getBoundingClientRect(), goal = scene?.thumb ?? null;
    const appearing = now - born < APPEAR_MS, step = advanceThumb(thumb, thumbAt, goal === null ? null : {...goal, rect: {...goal.rect, x: goal.rect.x - origin.left, y: goal.rect.y - origin.top}}, now, still.matches);
    thumb = step.thumb;thumbAt = step.at;if (step.moved) drawGlass = true;
    const travelling = step.travelling;
    if (tokens === undefined || scene === undefined) return;
    // The appearance ends with one frame drawn at its settled value, not the last eased one before it.
    if (!appearing && !appeared) {appeared = true;drawGlass = true;}
    const lit = lightFrame(clock, scene.panels, now, still.matches);clock = lit.clock;if (lit.changed) drawGlass = true;
    // The drop target's light eases on the same kind of time base; a step after a rest counts as one frame.
    const seconds = targetEasing ? Math.min(0.1, Math.max(0, (now - targetTick) / 1000)) : 1 / 60;targetTick = now;
    const marked = scene.panels.find(panel => panel.target === true)?.id, nextTarget = easeTarget(target, marked, seconds, still.matches);
    if (nextTarget?.id !== target?.id || nextTarget?.glow !== target?.glow) drawGlass = true;
    target = nextTarget;targetEasing = target !== undefined && (marked === undefined || target.glow < 1);
    // A panel that is animating moves without a resize or a mutation; it is read again next frame until it stops.
    const animating = panelAnimating();
    // A liquid panel's change counts on its own (fluid.changed), not through visibleScene. The scene's 64 px reach still
    // covers it: the edge moves at most 17 px, so a panel beyond the reach casts at most a pixel of a fading shadow.
    const fluid = liquidFrame(liquid, scene.panels, {x: origin.left, y: origin.top}, now, {still: still.matches, rebase, animating});
    liquid = fluid.clock;wobs = fluid.wobs;rebase = false;if (fluid.changed) drawGlass = true;if (animating) readBoxes = true;
    const moving = travelling || lit.again || fluid.again || targetEasing;

    const scroll = doc.scrollingElement ?? doc.documentElement;
    const page = Math.max(scroll.scrollHeight, height), depth = picture === null ? 0 : Math.min(1, scroll.scrollTop / (height * 0.4)), id = picture?.id ?? '';
    // The backdrop stays with the window: it changes with the skin, the picture, its size, the veil's depth, the
    // wash's place on the scrolling page when there is no picture, the fixed veils and, under them, the lit panels'
    // light, which it draws there (the glass draws it everywhere else).
    const veils = scene.veils.filter(veil => veil.fixed);
    const reaching = scene.panels.filter(panel => panel.light !== undefined && veils.some(veil => {
      const {x, y} = panel.light?.lamp ?? {x: 0, y: 0}, dx = Math.max(veil.rect.x - x, 0, x - veil.rect.x - veil.rect.width), dy = Math.max(veil.rect.y - y, 0, y - veil.rect.y - veil.rect.height);
      return Math.hypot(dx, dy) < SPILL_REACH;
    }));
    const fixed: GlassScene = {panels: reaching, veils, thumb: null}, glowing = lightsOf(fixed, clock.lights, tokens) !== '', backDpr = dprOf(width, height);
    if (backing(back, width, height, backDpr)) drawBack = true;
    // The wash's length follows the page whenever a frame is drawn, but a page that only grows draws none for it.
    const nextBack = [id, depth.toFixed(4), picture === null ? `${scroll.scrollLeft.toFixed(1)},${scroll.scrollTop.toFixed(1)},${String(scroll.clientWidth)}` : '', veilsOf(fixed),
      lightsOf(fixed, clock.lights, tokens)].join('/');
    if (nextBack !== backKey) drawBack = true;
    // The glass is redrawn when what it shows changes in its own coordinates; with a picture also while the page
    // scrolls, since the glass shows the artwork, which stays with the window, and with a light whose spill reaches a
    // fixed veil, since it leaves out that light under the veil, which stays with the window too.
    const scrolls = (scene_: GlassScene): GlassScene => ({...scene_, veils: scene_.veils.filter(veil => !veil.fixed)});
    const read = scene;
    const glassAt = (box: DOMRect, size: Placement): {where: Placement; local: GlassScene; shown: GlassScene; key: string; stale: boolean} => {
      const where: Placement = {x: box.left, y: box.top, width: size.width, height: size.height}, local = moveScene(read, -where.x, -where.y);
      // What can be seen is compared, cut to the window: a scroll moves nothing in the glass's coordinates, and a page
      // that grows below the window (into the canvas's margin) draws no frame (#1950); the margin is drawn again when
      // the page scrolls there.
      const stale = glassDrawn === undefined || !sameScene(visibleScene(moveScene(scrolls(glassDrawn), where.x, where.y), {width, height}), visibleScene(moveScene(scrolls(local), where.x, where.y), {width, height}));
      const key = [id, depth.toFixed(4), picture === null && !glowing ? '' : `${where.x.toFixed(2)},${where.y.toFixed(2)}`, `${String(-scroll.scrollLeft - where.x)},${String(-scroll.scrollTop - where.y)},${String(scroll.clientWidth)}`].join('/');
      // The boxes as far as the canvas paints them, for checks: a card past its edge has no glass there.
      return {where, local, shown: visibleScene(local, {width: where.width, height: where.height}, 0), key, stale};
    };
    let glass = glassAt(at, placed);
    if (glass.stale || glass.key !== glassKey) drawGlass = true;
    // A glass that is redrawn anyway is centred on the window again, which costs no frame of its own.
    if ((drawGlass || appearing) && Math.abs(at.top - Math.round(Math.min(Math.max(-OVERSCAN, top), bottom - tall))) > 16) {placed = place(tall, top, bottom);glass = glassAt(canvas.getBoundingClientRect(), placed);}
    const {where, local, shown} = glass, nextGlass = glass.key, glassDpr = dprOf(where.width, where.height);
    if (backing(canvas, where.width, where.height, glassDpr)) drawGlass = true;

    if (!drawBack && !drawGlass && !appearing) {if (moving) schedule();return;}
    const lights = clock.lights, t = Math.min(1, Math.max(0, (now - born) / APPEAR_MS)), appear = 1 - (1 - t) ** 3;
    const common = {tokens, appear, depth, merge, window: [width, height] as const, clock: now / 1000 % 1000};
    if (drawBack) {
      backKey = nextBack;
      backRenderer.draw({...common, layer: 'backdrop', scene: fixed, width, height, dpr: backDpr, view: [0, 0], thumb: null, lights: clock.lights, liquid: wobs,
        washBox: [-scroll.scrollLeft, -scroll.scrollTop, scroll.clientWidth, page]});
    }
    if (drawGlass || appearing) {
      glassKey = nextGlass;glassDrawn = local;replaced = false;
      renderer.draw({...common, layer: 'glass', scene: local, width: where.width, height: where.height, dpr: glassDpr, view: [where.x, where.y], thumb: thumb === null ? null : moveThumb(thumb, origin.left - where.x, origin.top - where.y),
        lights, liquid: wobs, ...(target === undefined ? {} : {target}), washBox: [-scroll.scrollLeft - where.x, -scroll.scrollTop - where.y, scroll.clientWidth, page]});
      // The boxes this frame drew, in the glass canvas's coordinates and as far as they can be seen there, for checks:
      // the boxes last read are in glassBoxes, in the window's.
      canvas.dataset['glassDrawn'] = boxesOf(shown);
      canvas.dataset['glassCapsules'] = thumbOf(thumb === null ? null : moveThumb(thumb, origin.left, origin.top));canvas.dataset['glassLights'] = lightsOf(scene, lights, tokens);canvas.dataset['glassLiquid'] = liquidOf(wobs);
      canvas.dataset['glassTarget'] = target === undefined ? '' : `${target.id}:${target.glow.toFixed(3)}`;
    }
    frames += 1;canvas.dataset['glassFrames'] = String(frames);canvas.dataset['glassBoxes'] = boxesOf(scene);canvas.dataset['glassBackdrop'] = id;
    setState('webgl');report(picture?.id ?? null);
    if (appearing || moving) schedule();
  };
  function schedule(): void {if (raf === 0 && !disposed) raf = view.requestAnimationFrame(frame);}
  /**
   * Whether a panel element itself is running an animation, such as the unfold's FLIP (#1932), or is being dragged by its
   * handle or easing home after a drop (#1933, marked `data-glass-dragged`): it moves by a transform, frame by frame.
   */
  function panelAnimating(): boolean {
    if (root.querySelector('[data-glass-panel][data-glass-dragged]') !== null) return true;
    return doc.getAnimations().some(animation => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return animation.playState === 'running' && target !== null && target.hasAttribute('data-glass-panel') && root.contains(target);
    });
  }
  const boxes = (): void => {readBoxes = true;schedule();};
  const skin = (): void => {readSkin = true;readBoxes = true;schedule();};

  const events = new AbortController(), signal = events.signal;
  // A canvas placed for the old size can reach past the end of a page that a resize made shorter, and would lengthen
  // it until the next frame; it is placed again at once.
  view.addEventListener('resize', () => {
    resizing = true;settleFrames = 0;
    if (placed !== undefined) {const {top, bottom, tall} = extent(back.clientHeight), box = canvas.getBoundingClientRect();if (box.bottom > bottom + 1 || box.top < top - 1) {placed = place(tall, top, bottom);replaced = true;}}
    boxes();
  }, {signal});
  view.addEventListener('scroll', boxes, {signal, passive: true, capture: true});
  doc.addEventListener('visibilitychange', () => {if (!doc.hidden) {force = true;skin();}}, {signal});
  doc.fonts.addEventListener('loadingdone', boxes, {signal});
  // A transition or an animation can move a mark without resizing anything the layer observes, such as the phone
  // drawer, a veil, sliding shut and then hiding (#1950). When one ends on a mark, or on an element that holds one,
  // the scene is read again; a read that finds nothing new draws nothing.
  const MARKS = '[data-glass-veil],[data-glass-panel]';
  const settled = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && (target.matches(MARKS) || target.querySelector(MARKS) !== null)) boxes();
  };
  for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) doc.addEventListener(type, settled, {signal, capture: true});
  view.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', skin, {signal});
  // Each panel's size is observed; the set is renewed only when the marked elements change.
  const sizes = new ResizeObserver(boxes);let observed: readonly Element[] = [];
  // Whatever comes before the root or one of its ancestors can move it without resizing it, such as a notice that
  // appears above the page, so those elements' sizes are observed too.
  const before = (): Element[] => {
    const found: Element[] = [];
    for (let node: Element | null = root; node !== null && node !== doc.body; node = node.parentElement) for (let sibling = node.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) found.push(sibling);
    return found;
  };
  const observePanels = (): void => {
    const next = [root, ...root.querySelectorAll('[data-glass-panel]'), ...before()];
    if (next.length === observed.length && next.every((element, index) => element === observed[index])) return;
    sizes.disconnect();for (const element of next) sizes.observe(element);observed = next;
  };
  observePanels();
  // Cards added, removed, reordered or reshaped (Edit Home, paging, a new record), and marks that change.
  const page = new MutationObserver(records => {if (records.some(record => record.type === 'childList')) observePanels();boxes();});
  page.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass-panel', 'data-glass-veil', 'data-glass-thumb', 'data-glass-lamp', 'data-glass-lamp-color', 'data-glass-pressed', 'data-glass-target', 'data-glass-dragged', 'style', 'class', 'hidden']});
  // An element added or removed before the root, or beside one of its ancestors.
  const around = new MutationObserver(() => {observePanels();boxes();});
  for (let node = root.parentElement; node !== null && node !== doc.documentElement; node = node.parentElement) around.observe(node, {childList: true});
  // The art theme and the appearance change the skin's values on the document element.
  const theme = new MutationObserver(skin);
  theme.observe(doc.documentElement, {attributes: true, attributeFilter: ['style', 'class', 'data-art-theme']});
  // Either canvas losing its context shows Quiet glass until both are restored.
  for (const element of [canvas, back]) {
    element.addEventListener('webglcontextlost', event => {
      event.preventDefault();view.cancelAnimationFrame(raf);raf = 0;renderer?.dispose();backRenderer?.dispose();renderer = null;backRenderer = null;canvas.dataset['glassFallback'] = 'lost';setState('quiet');report(null);
    }, {signal});
    element.addEventListener('webglcontextrestored', () => {
      if (gl.isContextLost() || bgl.isContextLost()) return;
      build();if (renderer === null) return;born = -1;appeared = false;backKey = '';glassKey = '';glassDrawn = undefined;force = true;skin();
    }, {signal});
  }
  schedule();

  return {
    backdrop: next => {picture = next;renderer?.backdrop(next);backRenderer?.backdrop(next);force = true;schedule();},
    fuse: value => {const next = value ? MERGE : 0;if (next !== merge) {merge = next;force = true;schedule();}},
    dispose: () => {
      disposed = true;view.cancelAnimationFrame(raf);events.abort();sizes.disconnect();page.disconnect();around.disconnect();theme.disconnect();
      renderer?.dispose();renderer = null;backRenderer?.dispose();backRenderer = null;
      for (const context of [gl, bgl]) context.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export function GlassLayer({onState, backdrop = null, onBackdrop, fuse = false, appear = true}: GlassLayerProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null), back = useRef<HTMLCanvasElement>(null), probe = useRef<HTMLDivElement>(null), glass = useRef<Glass | null>(null);
  const callbacks = useRef({state: onState, backdrop: onBackdrop});
  // Whether the glass eases in is read once, when the layer starts.
  const start = useRef({appear});
  callbacks.current = {state: onState, backdrop: onBackdrop};
  useLayoutEffect(() => {
    const element = canvas.current, backdrop = back.current, owner = element?.parentElement?.closest<HTMLElement>('[data-glass]') ?? null, tokens = probe.current;
    if (element === null || backdrop === null || owner === null || tokens === null) return;
    const started = startGlass(element, backdrop, owner, tokens, {state: value => {callbacks.current.state(value);}, backdrop: id => {callbacks.current.backdrop?.(id);}}, start.current);
    glass.current = started;
    return () => {glass.current = null;started.dispose();callbacks.current.state('quiet');callbacks.current.backdrop?.(null);};
  }, []);
  // A new picture is uploaded before paint, while the caller still holds its bitmap open.
  useLayoutEffect(() => {glass.current?.backdrop(backdrop);}, [backdrop]);
  useLayoutEffect(() => {glass.current?.fuse(fuse);}, [fuse]);
  return <>
    <canvas ref={back} className="glass-backdrop" aria-hidden="true"/>
    <canvas ref={canvas} className="glass-layer" aria-hidden="true"/>
    <div ref={probe} className="glass-tokens" hidden>{TOKENS.map(name => <i key={name} data-glass-token={name}/>)}</div>
  </>;
}
