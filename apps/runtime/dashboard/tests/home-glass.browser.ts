// Home's glass layer (#1929) on a disposable synthetic runtime: no installed service or device. Headless Chromium draws
// WebGL 2 with SwiftShader. The journey checks that the backdrop is drawn, that every card's glass follows its box
// through scrolling (moving with the page before any frame, #2023), resizing, Edit Home and paging, that nothing draws at rest, that WebGL 2 missing or a lost
// context leaves the Quiet glass panels with working controls, and that panel text keeps 4.5:1 over a dark and a bright
// artwork in light and dark appearance. It also checks the lit room (#1931): a LIFX light glows in its observed color,
// a light without color and a plug in warm white, from the ring's center; a press brightens a panel; the layer rests
// once the lights have eased; with every light off nothing is drawn; and the dial and the plug work in Quiet glass.
// And the unfold (#1932): a light opens in place to Large square by pointer, touch and keyboard with focus moving in
// and back, one at a time, never saved and sending nothing; the cards that move ease and turn liquid, then the layer
// rests; a window resize and reduced motion stir nothing; no sideways scroll at any width; it works in Quiet glass; and
// a stale lighting layout's notice sits inside the card instead of pushing its face down.
// With DASHBOARD_RECEIPTS set it writes private screenshots.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {chromium, expect, type BrowserContext, type Locator, type Page} from 'playwright/test';
import {drawnMismatches} from './glass-boxes.ts';
import {changes, feed, recordsLoaded, holdDashboardStream, startWorld} from './harness.ts';
import {cardOptions} from './home-editor.ts';
import {artworkOf, browserArt} from '../../../../modules/art/dist/src/frontend/model.js';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({lighting: true, nanoleaf: true, wemo: true, inbox: true, art: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing']});
type Sample = 'dark' | 'bright';

/**
 * A synthetic artwork: a dark night scene or a bright day scene in flat, unsmoothed shapes, as PNG bytes of the given
 * size. Flat shapes keep it smaller than the provider's own picture, so it can stand in for it byte for byte.
 */
async function sampleBytes(kind: Sample, width: number, height: number, length: number): Promise<Buffer> {
  const bright = kind === 'bright', scale = (value: number, of: number): string => String(Math.round(value * of / 1000));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" shape-rendering="crispEdges">
    <rect width="100%" height="100%" fill="${bright ? '#fff3d6' : '#0d1533'}"/>
    <rect y="${scale(450, height)}" width="100%" height="${scale(250, height)}" fill="${bright ? '#bfe6ff' : '#1d2a5c'}"/>
    <circle cx="${scale(700, width)}" cy="${scale(300, height)}" r="${scale(160, height)}" fill="${bright ? '#ffffff' : '#f4c25a'}"/>
    <rect y="${scale(760, height)}" width="100%" height="${scale(240, height)}" fill="${bright ? '#ff9a3c' : '#7b3fa0'}"/>
    <rect x="${scale(130, width)}" y="${scale(200, height)}" width="${scale(90, width)}" height="${scale(370, height)}" fill="${bright ? '#2a9d8f' : '#e76f51'}"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png({compressionLevel: 9, palette: true, colors: 8, effort: 10}).toBuffer();
  assert.ok(png.length <= length, `the ${kind} sample (${String(png.length)} bytes) fits the rendition's ${String(length)} bytes`);
  // The art module checks the byte count; a PNG decoder ignores the padding after its end.
  return Buffer.concat([png, Buffer.alloc(length - png.length)]);
}
/** Which sample replaces each rendition's bytes, by content path, and which one the next new rendition gets. */
const samples = new Map<string, Sample>();let nextSample: Sample = 'dark';
/** Serves the art module's real content route with the samples' pixels in place of the synthetic provider's. */
async function substitute(context: BrowserContext): Promise<void> {
  await context.route('**/modules/art/content/**', async route => {
    // A page closed while its request was in flight has nothing left to answer.
    const answer = await route.fetch().catch(() => undefined);if (answer === undefined) return;
    if (!(answer.headers()['content-type'] ?? '').startsWith('image/')) {await route.fulfill({response: answer}).catch(() => undefined);return;}
    const path = new URL(route.request().url()).pathname, original = await answer.body().catch(() => undefined);if (original === undefined) return;
    const {width = 1, height = 1} = await sharp(original).metadata();
    const kind = samples.get(path) ?? nextSample;samples.set(path, kind);
    await route.fulfill({response: answer, body: await sampleBytes(kind, width, height, original.length)}).catch(() => undefined);
  });
}
/** Creates one artwork through the Gallery, as the art backdrop journey does, and returns its backdrop still. */
async function generate(creator: Page, kind: Sample): Promise<{artworkId: string; compositionId: string; renditionId: string}> {
  // Different provider colors give each artwork its own renditions, so each can carry its own sample.
  nextSample = kind;world.art.act(kind === 'dark' ? 'warm-colors' : 'cool-colors');
  for (const target of ['Tidbyt', 'Pixoo']) {const box = creator.getByRole('checkbox', {name: target, exact: true});if (await box.count() > 0) await box.uncheck();}
  const calls = world.art.state().imageCalls, tiles = creator.locator('[data-gallery-art]');
  const previous = await tiles.count() === 0 ? null : await tiles.first().getAttribute('data-gallery-art');
  await creator.getByLabel('What would you like to see?', {exact: true}).fill(`Synthetic ${kind} glass backdrop`);
  await creator.getByRole('button', {name: 'Create art', exact: true}).click();
  await expect.poll(() => world.art.state().imageCalls).toBe(calls + 1);
  await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');
  if (previous !== null) await expect(tiles.first()).not.toHaveAttribute('data-gallery-art', previous);
  const id = await tiles.first().getAttribute('data-gallery-art');assert.ok(id !== null);
  // The record can trail the job's success by a moment; read it until it is complete.
  let body: unknown;
  await expect.poll(async () => {
    const read = await fetch(`${world.url}/modules/art/content/artwork.${id}`, {headers: {authorization: `Bearer ${world.readerToken}`}});
    body = read.status === 200 ? await read.json() : read.status;return artworkOf(body) !== undefined;
  }, {timeout: 15_000}).toBe(true);
  const artwork = artworkOf(body);assert.ok(artwork !== undefined, JSON.stringify(body));
  const still = browserArt(artwork, false);assert.ok(still !== undefined);
  for (const composition of artwork.compositions) for (const rendition of composition.renditions) {
    const path = `/modules/art/content/${rendition.ref}`;assert.notEqual(samples.get(path) ?? kind, kind === 'dark' ? 'bright' : 'dark', `${path} carries one sample`);samples.set(path, kind);
  }
  return {artworkId: artwork.artworkId, compositionId: still.compositionId, renditionId: still.rendition.renditionId};
}
type Artwork = Awaited<ReturnType<typeof generate>>;
/** Presents an artwork and waits until the layer has drawn its backdrop and reported it to the art source. */
async function present(page: Page, artwork: Artwork): Promise<void> {
  await world.presentArt(artwork.artworkId, artwork.compositionId);
  await expect(page.locator('[data-art-backdrop]')).toHaveAttribute('data-rendition', artwork.renditionId, {timeout: 30_000});
  await expect(layer(page)).toHaveAttribute('data-glass-backdrop', artwork.renditionId, {timeout: 30_000});
}

/** Saves Home's arrangement through the existing command, as Edit Home would, and waits for its shapes. */
async function arrange(page: Page, desktop: HomePlacement[]): Promise<void> {
  assert.equal(await page.evaluate(async desktop => {
    const record = (await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}}).records['home-layout'][0];
    return (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record?.revision ?? 0, layouts: {desktop, phone: desktop}}})})).status;
  }, desktop), 200);
  for (const entry of desktop.filter(item => !item.hidden)) await expect(page.locator(`[data-home-card="${entry.widget}"]`)).toHaveAttribute('data-home-shape', entry.shape ?? '');
}
/** The lights the layer drew last by panel: sRGB color, eased level and press, and the lamp's center. */
async function lightsDrawn(page: Page): Promise<Map<string, number[]>> {
  const text = await layer(page).getAttribute('data-glass-lights') ?? '';
  return new Map(text.split('|').filter(entry => entry !== '').map(entry => {const at = entry.lastIndexOf(':');return [entry.slice(0, at), entry.slice(at + 1).split(',').map(Number)];}));
}
/** Hides WebGL 2 from the page, as a browser without it would. */
function noWebgl2(): void {
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {configurable: true, writable: true,
    value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {return kind === 'webgl2' ? null : original.call(this, kind, ...rest);}});
}
const layer = (page: Page): Locator => page.locator('.home-layout .glass-layer');
const glassState = async (page: Page): Promise<string | null> => page.locator('.home-layout').getAttribute('data-glass');
const frames = async (page: Page): Promise<number> => Number(await layer(page).getAttribute('data-glass-frames') ?? 0);

/** Waits until the layer has stopped drawing: the frame count holds still over half a second. */
async function rest(page: Page): Promise<number> {
  let before = await frames(page);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await page.waitForTimeout(500);
    const after = await frames(page);if (after === before) return after;before = after;
  }
  throw new Error('the glass layer never came to rest');
}
/**
 * The panels the layer drew last, against the boxes of the marked elements now in or near the window. With `scroll`,
 * the page is first scrolled by that much in the same task, so no frame can be drawn in between: the glass on screen
 * then follows the cards only because the browser scrolls the glass canvas with the page (#2023).
 */
async function followsBoxes(page: Page, label: string, scroll = 0): Promise<number> {
  await rest(page);
  // The boxes the last frame drew (data-glass-drawn), against the live boxes, both cut to what can be seen: a visible
  // change that no frame followed leaves stale glass and fails here (glass-boxes.ts, #1965).
  const {drawn, boxes, viewport, origin} = await page.evaluate(by => {
    if (by !== 0) {const before = document.documentElement.scrollTop;scrollBy({top: by, behavior: 'instant'});if (Math.abs(document.documentElement.scrollTop - before - by) > 0.5) throw new Error(`the page did not scroll by ${String(by)}`);}
    const canvas = document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer');
    const boxes = [...document.querySelectorAll<HTMLElement>('.home-layout [data-glass-panel]')].flatMap(element => {
      const box = element.getBoundingClientRect();
      const near = box.width > 0 && box.height > 0 && box.left < innerWidth + 64 && box.top < innerHeight + 64 && box.right > -64 && box.bottom > -64;
      return near ? [{id: element.dataset['glassPanel'] ?? '', x: box.left, y: box.top, width: box.width, height: box.height}] : [];
    });
    const at = canvas?.getBoundingClientRect();
    return {drawn: canvas?.dataset['glassDrawn'] ?? '', boxes, viewport: {width: innerWidth, height: innerHeight}, origin: {x: at?.left ?? 0, y: at?.top ?? 0}};
  }, scroll);
  assert.deepEqual(drawnMismatches(drawn, boxes, viewport, origin), [], `${label}: the glass on screen follows every card in view`);
  return boxes.length;
}
/** Whether the outermost card surface in each panel is see-through, so the glass shows. */
async function surfaces(page: Page): Promise<{clear: string[]; filled: string[]}> {
  const found = await page.locator('.home-layout [data-glass-panel]').evaluateAll(panels => panels.flatMap(panel => {
    const surface = panel.querySelector(':is(.card,.widget,.light-card,.wemo-card,.music-card)');
    return surface === null ? [] : [{id: (panel as HTMLElement).dataset['glassPanel'] ?? '', clear: getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)'}];
  }));
  return {clear: found.filter(item => item.clear).map(item => item.id), filled: found.filter(item => !item.clear).map(item => item.id)};
}
/** A light's power control still works: Off, then On again, each one guarded command. */
async function controlsWork(page: Page, sent: string[], label: string): Promise<void> {
  const card = page.locator('[data-home-card="light:device:lamp-a"]'), before = sent.length;
  for (const power of ['Off', 'On']) {
    await card.getByRole('button', {name: power, exact: true}).click();
    await card.locator(`.light-power button[aria-pressed=true]:text-is("${power}")`).waitFor();
  }
  assert.equal(sent.length, before + 2, `${label}: each press sends one command`);
}
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});await page.screenshot({path: join(receipts, `glass-${name}.png`)});
}

/**
 * The lowest contrast between any text drawn over the layer and the pixels behind it: panel text, the heading, notices,
 * status lines and empty cells in Home's section, and the footer. Text on a fill of its own (a button, an inset, the
 * edit toolbar) is not over the layer and is skipped, except the hero's switch and chips (#1930): their fills are
 * translucent, so their text is measured against the fill as the screenshot draws it over the layer's pixels. The text is made transparent for the screenshot so only what is
 * behind it is measured; that changes no box, so the layer draws nothing new.
 */
async function contrast(page: Page): Promise<{min: number; runs: number; worst: string; texts: string[]}> {
  const runs = await page.evaluate(() => {
    const main = document.getElementById('main');if (main === null) throw new Error('contrast: no main');
    const clear = (element: Element): boolean => {const style = getComputedStyle(element);return style.backgroundImage === 'none' && (style.backgroundColor === 'transparent' || /rgba\(.*, 0\)$/.test(style.backgroundColor));};
    // A translucent fill in the hero lets the layer through; the screenshot composites it, so it counts as ground.
    const seeThrough = (element: Element): boolean => {
      const style = getComputedStyle(element), alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(style.backgroundColor)?.[1];
      return element.closest('[data-hub-mode]') !== null && style.backgroundImage === 'none' && alpha !== undefined && Number(alpha) < 1;
    };
    const found: {x: number; y: number; width: number; height: number; color: string; text: string}[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;if (parent === null || (node.textContent ?? '').trim() === '' || !parent.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
      let ground = true;for (let at: Element | null = parent; at !== null && at !== main; at = at.parentElement) if (!clear(at) && !seeThrough(at) || Number(getComputedStyle(at).opacity) < 1) {ground = false;break;}
      if (!ground) continue;
      const range = document.createRange();range.selectNodeContents(node);const limit = parent.getBoundingClientRect(), color = getComputedStyle(parent).color;
      for (const rect of range.getClientRects()) {
        const x = Math.max(rect.left, limit.left, 0), y = Math.max(rect.top, limit.top, 0);
        const right = Math.min(rect.right, limit.right, innerWidth), bottom = Math.min(rect.bottom, limit.bottom, innerHeight);
        if (right - x >= 2 && bottom - y >= 2) found.push({x, y, width: right - x, height: bottom - y, color, text: (node.textContent ?? '').trim().slice(0, 32)});
      }
      parent.dataset['glassMeasured'] = '';
    }
    for (const element of main.querySelectorAll<HTMLElement>('[data-glass-measured]')) element.style.setProperty('color', 'transparent', 'important');
    return found;
  });
  const image = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject: true});
  await page.evaluate(() => {for (const element of document.querySelectorAll<HTMLElement>('[data-glass-measured]')) {element.style.removeProperty('color');delete element.dataset['glassMeasured'];}});
  const linear = (value: number): number => {const channel = value / 255;return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;};
  const luminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const {data, info} = image;let min = Infinity, worst = '';
  for (const run of runs) {
    const [r = 0, g = 0, b = 0, a = 1] = [...run.color.matchAll(/\d+(\.\d+)?/g)].map(match => Number(match[0]));
    for (let y = Math.ceil(run.y); y < Math.floor(run.y + run.height); y += 1) for (let x = Math.ceil(run.x); x < Math.floor(run.x + run.width); x += 1) {
      const at = (y * info.width + x) * info.channels, [br = 0, bg = 0, bb = 0] = [data[at], data[at + 1], data[at + 2]];
      // Translucent ink is drawn over the same pixel it is measured against.
      const ink = luminance(br + (r - br) * a, bg + (g - bg) * a, bb + (b - bb) * a), ground = luminance(br, bg, bb);
      const ratio = (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
      if (ratio < min) {min = ratio;worst = `"${run.text}" at ${String(x)},${String(y)} in ${run.color}`;}
    }
  }
  return {min, runs: runs.length, worst, texts: runs.map(run => run.text)};
}

type Opened = {page: Page; sent: string[]; errors: string[]; consoleErrors: string[]};
async function open(context: BrowserContext, width = 1440, height = 900): Promise<Opened> {
  await substitute(context);const page = await context.newPage();page.setDefaultTimeout(30_000);await page.setViewportSize({width, height});
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  // Console errors are kept for the lit room's failure diagnostics only.
  const consoleErrors: string[] = [];page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
  const sent = changes(page);
  await page.goto(world.url);await recordsLoaded(page);
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  return {page, sent, errors, consoleErrors};
}

/*
 * The lit room's eased values (#1931) and which run asserts what (owner decision 2026-11-19, "Check state, not
 * pixels"). The full browser suite (through `home-layout.browser.ts`, and `runtime-browser.mjs run <group>` on main) and a
 * focused run of this journey assert that every eased value reaches its exact target on a live layer. The hosted smoke chain (`smoke.ts`,
 * App verification) runs this journey late in one long process, where headless SwiftShader has been seen to stop
 * delivering the layer's frames. There each eased-value check first reads the layer's state: while the layer is live it
 * asserts the eased value as everywhere else; when the layer has fallen back to Quiet glass or lost its context it
 * asserts that the Quiet glass panels are shown and the lit room's controls are usable instead. The exact easing is
 * also covered by glass-light.test.ts. Any failed eased-value check prints the layer's state and a short timeline.
 */
const smoke = /smoke\.ts$/.test(process.argv[1] ?? '');
type LayerState = {glass: string | null; fallback: string | null; contextLost: boolean; hidden: boolean; frames: number};
async function layerState(page: Page): Promise<LayerState> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer');
    return {glass: document.querySelector('.home-layout')?.getAttribute('data-glass') ?? null, fallback: canvas?.dataset['glassFallback'] ?? null,
      contextLost: canvas?.getContext('webgl2')?.isContextLost() ?? true, hidden: document.hidden, frames: Number(canvas?.dataset['glassFrames'] ?? 0)};
  });
}
const live = (state: LayerState): boolean => state.glass === 'webgl' && state.fallback === null && !state.contextLost && !state.hidden;
/** Prints why a lit-room check failed: the layer's state, a one-second timeline of its frames and lights, and errors. */
async function diagnose(opened: Opened, label: string): Promise<void> {
  const timeline: {at: number; frames: string | null; lights: string | null}[] = [];
  for (let at = 0; at < 1000; at += 100) {
    timeline.push({at, ...await opened.page.locator('.home-layout .glass-layer').evaluate(node => ({frames: node.getAttribute('data-glass-frames'), lights: node.getAttribute('data-glass-lights')})).catch(() => ({frames: null, lights: null}))});
    await opened.page.waitForTimeout(100).catch(() => undefined);
  }
  const state = await layerState(opened.page).catch((error: unknown) => String(error));
  console.error(`home-glass lit room diagnostics (${label}): ${JSON.stringify({smoke, state, timeline, pageErrors: opened.errors, consoleErrors: opened.consoleErrors})}`);
}
/** In the smoke chain, once the layer has fallen back: the Quiet glass panels are shown and the lit room's controls are usable. */
async function quietShown(opened: Opened, label: string): Promise<void> {
  const {page} = opened;
  await expect(page.locator('.home-layout'), `${label}: a layer that fell back says so`).toHaveAttribute('data-glass', 'quiet');
  assert.deepEqual((await surfaces(page)).clear, [], `${label}: every card shows its Quiet glass panel`);
  for (const control of [page.getByRole('switch', {name: 'lamp-a power', exact: true}), page.getByRole('switch', {name: 'lamp-b power', exact: true}), page.locator('[data-plug-panel="shelf-lamp"] .plug-press')]) {
    await expect(control).toBeEnabled();
    const box = await control.boundingBox();assert.ok(box !== null);
    assert.equal(await control.evaluate((node, point) => {const hit = document.elementFromPoint(point.x, point.y);return hit !== null && (hit === node || node.contains(hit));}, {x: box.x + box.width / 2, y: box.y + box.height / 2}), true, `${label}: the control takes the pointer`);
  }
  console.log(`home-glass lit room: ${label}: the layer fell back to Quiet glass in the smoke chain; its Quiet panels and controls were checked instead`);
}
/**
 * Waits until `read()` gives `target` on a live layer. In the smoke chain a layer that has fallen back or lost its
 * context is checked for its Quiet glass instead ('quiet'); anywhere else that, or a timeout, fails with diagnostics.
 */
async function eases(opened: Opened, read: () => Promise<unknown>, target: unknown, label: string): Promise<'eased' | 'quiet'> {
  let value: unknown;
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await opened.page.waitForTimeout(100)) {
    const state = await layerState(opened.page);
    if (!live(state)) {
      if (smoke) {await quietShown(opened, label);return 'quiet';}
      await diagnose(opened, label);assert.fail(`${label}: the layer is not live (${JSON.stringify(state)})`);
    }
    value = await read();
    if (JSON.stringify(value) === JSON.stringify(target)) return 'eased';
  }
  await diagnose(opened, label);
  assert.fail(`${label}: reached ${JSON.stringify(value)}, not ${JSON.stringify(target)}`);
}
/** Whether the canvas-based checks that follow apply: always outside the smoke chain, and there while the layer is live. */
async function drawing(opened: Opened, label: string): Promise<boolean> {
  if (!smoke || live(await layerState(opened.page))) return true;
  await quietShown(opened, label);return false;
}

const report: Record<string, unknown> = {journey: 'home-glass', physical: false};
try {
  // Make the Inbox long enough to page.
  for (let index = 0; index < 13; index += 1) await world.failCommand();

  // AC1: the backdrop is drawn and the glass follows each card's box.
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference'});
  const {page, sent, errors} = await open(context);
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  // With a GPU the first appearance eases over several frames; rendering in software it is one settled frame, since
  // each software frame holds the page's main thread (#1965). Either way it then stops.
  const appeared = await rest(page), software = await layer(page).evaluate(node => (node as HTMLElement).dataset['glassSoftware'] !== undefined);
  assert.ok(software ? appeared >= 1 : appeared > 1, `the first appearance draws and then stops (${String(appeared)} frames, software ${String(software)})`);
  await expect(page.locator('[data-art-backdrop]')).toHaveAttribute('data-art-backdrop', /^(none|stale)$/);
  assert.equal(await layer(page).getAttribute('data-glass-backdrop'), '', 'with no artwork the layer draws the Quiet glass wash');
  assert.deepEqual((await surfaces(page)).filled, ['inbox'], 'the card surfaces are see-through over the glass, except the Inbox that needs attention');
  assert.equal(await layer(page).evaluate(node => getComputedStyle(node).pointerEvents), 'none', 'the canvas takes no pointer input');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'none', 'the page does not bounce past its ends while the glass is drawn (#2023)');
  assert.notEqual(await page.locator('#rail').evaluate(node => getComputedStyle(node).backdropFilter), 'none', 'the rail is frosted over the backdrop');
  await shot(page, '1440-wash');
  const empty = await page.screenshot({clip: {x: 1200, y: 10, width: 40, height: 30}});
  // Two artworks through the real art module and its backdrop source, drawn from the samples' pixels.
  const creator = await context.newPage();await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
  const dark = await generate(creator, 'dark'), bright = await generate(creator, 'bright');await creator.close();
  assert.notEqual(dark.renditionId, bright.renditionId, 'the two artworks have their own backdrop renditions');
  await present(page, dark);
  assert.notDeepEqual(await page.screenshot({clip: {x: 1200, y: 10, width: 40, height: 30}}), empty, 'the artwork replaces the wash behind the page');
  report['panels'] = await followsBoxes(page, 'loaded');
  await shot(page, '1440-dark-sample');

  // At rest: no frame while nothing changes.
  const still = await rest(page);await page.waitForTimeout(2000);
  assert.equal(await frames(page), still, 'nothing draws at rest');report['restFrames'] = 0;

  // Scrolling and resizing move the glass with the cards, then it rests again.
  await page.mouse.wheel(0, 420);await followsBoxes(page, 'scrolled');
  // The glass moves with the cards as the page scrolls, not a frame later (#2023): straight after a scroll either way,
  // before any frame, it is still on every card.
  await followsBoxes(page, 'scrolled down, before a frame', 80);await followsBoxes(page, 'scrolled up, before a frame', -80);
  // A short scroll that leaves the canvas where it is uses up some of its margin; the next one, as long as the margin
  // kept (150 px), is still covered. A short window among the cards leaves room to scroll both ways.
  await page.setViewportSize({width: 1440, height: 500});await page.evaluate(() => {scrollTo({top: 500, behavior: 'instant'});});
  await followsBoxes(page, 'a short scroll, before a frame', 95);await followsBoxes(page, 'then a longer one, before a frame', 150);
  await followsBoxes(page, 'a short scroll up, before a frame', -95);await followsBoxes(page, 'then a longer one up, before a frame', -150);
  await page.setViewportSize({width: 1440, height: 900});await page.evaluate(() => {scrollTo({top: 420, behavior: 'instant'});});await followsBoxes(page, 'back in the full window');
  // A page that gets shorter at its end moves the scroll; in every frame after that the glass stays on the cards
  // (#2023 review: centring the canvas with the scroll from before the page got shorter drew one frame off them).
  await page.evaluate(() => {scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'});});await rest(page);
  const shrink = await page.evaluate(() => new Promise<{drawn: string; boxes: {id: string; x: number; y: number; width: number; height: number}[]; origin: {x: number; y: number}; viewport: {width: number; height: number}}[]>(resolve => {
    const samples: {drawn: string; boxes: {id: string; x: number; y: number; width: number; height: number}[]; origin: {x: number; y: number}; viewport: {width: number; height: number}}[] = [];
    const cards = [...document.querySelectorAll<HTMLElement>('.home-layout [data-home-card]')].slice(-2);
    for (const card of cards) card.style.setProperty('display', 'none');
    const sample = (): void => {
      const canvas = document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer'), at = canvas?.getBoundingClientRect();
      const boxes = [...document.querySelectorAll<HTMLElement>('.home-layout [data-glass-panel]')].map(element => {const box = element.getBoundingClientRect();return {id: element.dataset['glassPanel'] ?? '', x: box.left, y: box.top, width: box.width, height: box.height};});
      samples.push({drawn: canvas?.dataset['glassDrawn'] ?? '', boxes, origin: {x: at?.left ?? 0, y: at?.top ?? 0}, viewport: {width: innerWidth, height: innerHeight}});
      if (samples.length < 12) requestAnimationFrame(sample);else {for (const card of cards) card.style.removeProperty('display');resolve(samples);}
    };
    // After the layer's own observers have asked for their frame, so each sample sees what that frame drew.
    setTimeout(() => {requestAnimationFrame(sample);}, 0);
  }));
  for (const [index, sample] of shrink.entries()) assert.deepEqual(drawnMismatches(sample.drawn, sample.boxes, sample.viewport, sample.origin), [], `frame ${String(index)} after the page got shorter at its end: the glass is on every card`);
  await page.evaluate(() => {scrollTo({top: 420, behavior: 'instant'});});await followsBoxes(page, 'back after the shorter page');
  await page.setViewportSize({width: 1100, height: 800});await followsBoxes(page, 'resized');
  // A window resize draws one frame, after the page has repacked, and a context that renders in software draws at most
  // 250,000 pixels: the page's main thread waits for every software frame, so a wide window must not cost more (the
  // full browser suite's Home shapes journey timed out waiting for a repack at 2560 px, #1929, and the suite's time
  // tripled with the glass, #1965).
  const settled = await rest(page);await page.setViewportSize({width: 2560, height: 1000});await followsBoxes(page, 'wide');
  assert.equal(await frames(page) - settled, 1, 'one window resize draws one frame');
  const backing = await layer(page).evaluate(node => ({software: (node as HTMLCanvasElement).dataset['glassSoftware'] !== undefined, pixels: (node as HTMLCanvasElement).width * (node as HTMLCanvasElement).height}));
  if (backing.software) assert.ok(backing.pixels <= 252_000, `software rendering draws at most 250,000 pixels (${String(backing.pixels)})`);
  report['software'] = backing.software;
  await page.setViewportSize({width: 1440, height: 900});await page.evaluate(() => {scrollTo(0, 0);});await followsBoxes(page, 'restored');

  // Edit Home: reordering and reshaping cards moves their glass; the draft is discarded.
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await cardOptions(page, 'Agent status');await page.getByRole('button', {name: 'Move Agent status later', exact: true}).click();
  await followsBoxes(page, 'edit: moved');
  await cardOptions(page, 'Inbox');await page.getByRole('button', {name: 'Large square', exact: true}).click();
  await followsBoxes(page, 'edit: reshaped');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();await followsBoxes(page, 'edit: cancelled');

  // The controls work through the layer.
  await controlsWork(page, sent, 'webgl');

  // A forced context loss leaves Quiet glass panels that work, and the restored context draws again.
  // The extension is kept from before the loss: a lost context hands out none.
  const lose = await page.evaluateHandle(() => document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer')?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null);
  await lose.evaluate(extension => {extension?.loseContext();});
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'quiet');
  assert.equal(await layer(page).getAttribute('data-glass-fallback'), 'lost');
  assert.deepEqual((await surfaces(page)).clear, [], 'after a lost context every card shows its Quiet glass panel');
  await shot(page, '1440-lost-context');
  await controlsWork(page, sent, 'lost context');
  await lose.evaluate(extension => {extension?.restoreContext();});
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});await followsBoxes(page, 'restored context');
  report['contextLoss'] = true;

  // Paging in one column changes the Inbox card's height; its glass follows.
  await page.setViewportSize({width: 390, height: 844});
  const inbox = page.locator('[data-inbox-panel]');await inbox.scrollIntoViewIfNeeded();
  await followsBoxes(page, 'narrow');
  const tall = (await page.locator('[data-home-card="inbox"]').boundingBox())?.height ?? 0;
  for (const label of ['Page 2 of 3', 'Page 3 of 3']) {await inbox.getByRole('button', {name: 'Next', exact: true}).click();await inbox.getByText(label, {exact: true}).waitFor();}
  await inbox.scrollIntoViewIfNeeded();
  assert.notEqual((await page.locator('[data-home-card="inbox"]').boundingBox())?.height ?? 0, tall, 'the last page has fewer rows');
  await followsBoxes(page, 'paged');report['paging'] = true;
  await shot(page, '390-dark-sample');

  // Leaving Home releases the context and stops drawing.
  const canvas = await layer(page).elementHandle();assert.ok(canvas !== null);
  await page.goto(`${world.url}#/settings`);await page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  assert.equal(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext('webgl2')?.isContextLost() ?? true), true, 'leaving Home releases the context');
  assert.deepEqual(sent.filter(path => !path.includes('/commands/') && path !== '/api/sdk/v1/request'), []);
  assert.deepEqual(errors, []);
  await context.close();

  // AC3: panel and heading text keep 4.5:1 over a dark and a bright artwork, light and dark.
  const contrasts: Record<string, number> = {};
  for (const scheme of ['light', 'dark'] as const) {
    const themed = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: scheme});
    const opened = await open(themed);
    await expect(opened.page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
    for (const sample of ['dark', 'bright'] as const) {
      await present(opened.page, sample === 'dark' ? dark : bright);await rest(opened.page);
      await shot(opened.page, `1440-${scheme}-${sample}`);
      const measure = async (state: string): Promise<void> => {
        const measured = await contrast(opened.page), label = `${scheme}/${sample}${state === '' ? '' : `/${state}`}`;
        if (state === '') for (const text of ['Hub mode', 'Free', 'Work', 'Quiet', 'Open Gallery', 'Dismiss art']) assert.ok(measured.texts.includes(text), `${label}: the hero's ${text} is measured`);
        assert.ok(measured.runs > 20, `${label}: text runs were measured (${String(measured.runs)})`);
        contrasts[label] = Math.round(measured.min * 100) / 100;
        assert.ok(measured.min >= 4.5, `${label}: text over the glass layer keeps 4.5:1 (lowest ${measured.min.toFixed(2)}: ${measured.worst})`);
      };
      await measure('');
      // Reconnecting: the live notice above Home moves the page down and sits on the backdrop.
      const release = await holdDashboardStream(opened.page);world.dropDashboardStreams();await feed(opened.page, 'reconnecting');
      await expect(opened.page.locator('section[aria-label="Home"] > p[role=alert]')).toBeVisible();
      await followsBoxes(opened.page, `${scheme}/${sample} reconnecting`);await shot(opened.page, `1440-${scheme}-${sample}-reconnecting`);
      await measure('reconnecting');
      release();await feed(opened.page, 'connected');await followsBoxes(opened.page, `${scheme}/${sample} reconnected`);
      // Edit Home: the toolbar, the cards' edit bars and the empty cells.
      // The hero (#1930) fills the top of the window, so the toolbar is scrolled to the top to bring the cards into view.
      await opened.page.getByRole('button', {name: 'Edit Home', exact: true}).click();
      await opened.page.locator('.home-edit-toolbar').evaluate(node => {node.scrollIntoView({block: 'start'});});await rest(opened.page);
      await shot(opened.page, `1440-${scheme}-${sample}-edit`);await measure('edit');
      await opened.page.getByRole('button', {name: 'Cancel', exact: true}).click();await opened.page.evaluate(() => {scrollTo(0, 0);});await rest(opened.page);
      // Phone widths for the private visual review only.
      if (receipts !== undefined) {
        for (const width of [390, 320]) {await opened.page.setViewportSize({width, height: 844});await rest(opened.page);await shot(opened.page, `${String(width)}-${scheme}-${sample}`);}
        await opened.page.setViewportSize({width: 1440, height: 900});
      }
    }
    assert.deepEqual(opened.errors, []);await themed.close();
  }
  report['contrast'] = contrasts;

  // AC4: without WebGL 2 the cards keep their Quiet glass panels and work.
  const plain = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  await plain.addInitScript(noWebgl2);
  const fallback = await open(plain);
  await expect(layer(fallback.page)).toHaveAttribute('data-glass-fallback', 'no-webgl2');
  assert.equal(await glassState(fallback.page), 'quiet');
  assert.deepEqual((await surfaces(fallback.page)).clear, [], 'without WebGL 2 every card shows its Quiet glass panel');
  assert.equal(await fallback.page.locator('.shell').evaluate(node => getComputedStyle(node).backgroundImage === 'none'), false, 'the shell keeps its wash');
  assert.equal(await fallback.page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'auto', 'without the glass the page bounces as before');
  await controlsWork(fallback.page, fallback.sent, 'no WebGL 2');
  await shot(fallback.page, '1440-no-webgl2');
  assert.deepEqual(fallback.errors, []);await plain.close();report['noWebgl2'] = true;

  // #1931: the lit room. Two LIFX lights and the Nanoleaf light as ring dials and a plug as a press panel; lamp-a red.
  // A simulated LIFX bulb reports its state when the module reads it, which a runtime restart does at once.
  const room = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark'});
  const lit = await open(room);
  await expect(lit.page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  const square = (widget: string): HomePlacement => ({widget, size: 'small', hidden: false, shape: 'square'});
  const roomCards = ['light:device:lamp-a', 'light:device:lamp-b', 'light:device:wall', 'device:bunny/modules/wemo:shelf-lamp'];
  await arrange(lit.page, [{widget: 'light:device:lamp-a', size: 'small', hidden: false, shape: 'tall'}]);
  const tallLamp = lit.page.locator('[data-light-card="lamp-a"]');
  await tallLamp.getByRole('tab', {name: 'Color', exact: true}).click();
  await tallLamp.getByLabel('Hue', {exact: true}).fill('0');await tallLamp.getByLabel('Saturation', {exact: true}).fill('100');
  await tallLamp.getByRole('button', {name: 'Apply color', exact: true}).click();
  await expect.poll(() => lit.sent.filter(path => path.endsWith('/lifx-color-set')).length).toBe(1);
  await arrange(lit.page, roomCards.map(square));
  const plug = lit.page.locator('[data-plug-panel="shelf-lamp"] .plug-press');
  await expect(plug).toBeEnabled();if (await plug.getAttribute('aria-pressed') !== 'true') {await plug.click();await expect(plug).toHaveAttribute('aria-pressed', 'true');}
  await world.restart();await lit.page.reload();await feed(lit.page, 'connected');
  await expect(lit.page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  await present(lit.page, bright);
  const ring = (id: string): Locator => lit.page.locator(`[data-home-card="light:device:${id}"] .light-dial`);
  await expect(ring('lamp-a')).toHaveAttribute('data-glass-lamp-color', /^1 0 0$/);
  await expect(ring('wall')).toHaveAttribute('data-glass-lamp', /^0\.\d+|1$/);
  const litLevel = (id: string) => async (): Promise<number | undefined> => (await lightsDrawn(lit.page)).get(`light:device:${id}`)?.[3];
  const litFirst = await eases(lit, litLevel('lamp-a'), Number(await ring('lamp-a').getAttribute('data-glass-lamp')), 'lamp-a eases up to its observed level');
  const settledLit = await rest(lit.page);
  // The layer eases each light up from nothing, then draws nothing at rest.
  await lit.page.waitForTimeout(2000);assert.equal(await frames(lit.page), settledLit, 'nothing draws at rest once the lights have eased');
  let onShot: Buffer | undefined;let lampBox = await ring('lamp-a').boundingBox();
  if (litFirst === 'eased' && await drawing(lit, 'the lit room as drawn')) {
    const drawn = await lightsDrawn(lit.page), warm = await lit.page.locator('.glass-tokens [data-glass-token=lamp]').evaluate(node => getComputedStyle(node).color);
    const warmColor = [...warm.matchAll(/\d+(\.\d+)?/g)].slice(0, 3).map(match => Number(match[0]) / 255);
    const lampA = drawn.get('light:device:lamp-a'), wall = drawn.get('light:device:wall'), shelf = drawn.get('device:bunny/modules/wemo:shelf-lamp');
    assert.ok(lampA !== undefined && wall !== undefined && shelf !== undefined, `every lit panel is drawn: ${[...drawn.keys()].join(', ')}`);
    assert.deepEqual(lampA.slice(0, 3), [1, 0, 0], 'a LIFX light glows in its observed color');
    assert.equal(lampA[3], Number(await ring('lamp-a').getAttribute('data-glass-lamp')), 'at its observed level');
    warmColor.forEach((value, index) => {assert.ok(Math.abs((wall[index] ?? 0) - value) < 0.003, `a light without color glows in the skin's warm white: ${wall.join(',')} vs ${warm}`);});
    assert.deepEqual(shelf.slice(0, 4), [...shelf.slice(0, 3), 0.8], 'a plug that is on glows at 0.8');
    lampBox = await ring('lamp-a').boundingBox();assert.ok(lampBox !== null);
    assert.ok(Math.abs((lampA[5] ?? 0) - (lampBox.x + lampBox.width / 2)) <= 1 && Math.abs((lampA[6] ?? 0) - (lampBox.y + lampBox.height / 2)) <= 1, 'the lamp is the ring\'s center');
    onShot = await lit.page.screenshot();await shot(lit.page, '1931-lit-1440-dark');
  }
  // A press brightens the panel while it is held; then it eases back and the layer rests.
  const bRing = await ring('lamp-b').boundingBox();assert.ok(bRing !== null);
  const powerSent = (): number => lit.sent.filter(path => path === '/api/v2/commands/power-set').length, beforePress = powerSent();
  await lit.page.mouse.move(bRing.x + bRing.width / 2, bRing.y + 5);await lit.page.mouse.down();
  const litPress = async (): Promise<number> => (await lightsDrawn(lit.page)).get('light:device:lamp-b')?.[4] ?? 0;
  await eases(lit, litPress, 1, 'a held press on lamp-b eases to 1');
  await lit.page.mouse.up();
  await eases(lit, litPress, 0, 'the released press eases back to 0');
  const pressed = await rest(lit.page);await lit.page.waitForTimeout(1000);assert.equal(await frames(lit.page), pressed, 'nothing draws at rest after a press');
  // #1933: a card dragged by its handle is drawn at its moved box and the card it would group with lights up; Escape
  // returns it, the target's light eases out and the layer rests. Nothing is saved.
  const boxOf = async (widget: string): Promise<number[] | undefined> => (await layer(lit.page).getAttribute('data-glass-boxes') ?? '').split('|')
    .find(entry => entry.startsWith(`${widget}:`))?.slice(widget.length + 1).split(',').map(Number);
  const homeB = await boxOf('light:device:lamp-b'), grip = await lit.page.locator('[data-home-card="light:device:lamp-b"] [data-fuse-handle]').boundingBox();
  const ontoA = await lit.page.locator('[data-home-card="light:device:lamp-a"]').boundingBox();assert.ok(homeB !== undefined && grip !== null && ontoA !== null);
  const layoutSaves = lit.sent.length;
  await lit.page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);await lit.page.mouse.down();
  const liquidB = (): Promise<boolean> => layer(lit.page).getAttribute('data-glass-liquid').then(value => (value ?? '').split('|').some(entry => entry.startsWith('light:device:lamp-b:')));
  await lit.page.mouse.move(ontoA.x + ontoA.width / 2, ontoA.y + ontoA.height / 2, {steps: 8});
  // The dragged card counts as animating (#1932's gate), so it turns liquid as it moves.
  assert.equal(await liquidB() || await (async () => {await lit.page.mouse.move(ontoA.x + ontoA.width / 2 + 30, ontoA.y + ontoA.height / 2, {steps: 4});return liquidB();})(), true, 'the dragged panel turns liquid');
  await lit.page.mouse.move(ontoA.x + ontoA.width / 2, ontoA.y + ontoA.height / 2, {steps: 2});
  await expect(layer(lit.page)).toHaveAttribute('data-glass-target', 'light:device:lamp-a:1.000');
  const movedB = await boxOf('light:device:lamp-b');assert.ok(movedB !== undefined && Math.abs((movedB[0] ?? 0) - (homeB[0] ?? 0)) > 50, 'the dragged panel is drawn where the card is');
  await lit.page.keyboard.press('Escape');await lit.page.mouse.up();
  await expect(layer(lit.page)).toHaveAttribute('data-glass-target', '');
  await expect.poll(() => boxOf('light:device:lamp-b')).toEqual(homeB);
  const dropped = await rest(lit.page);await lit.page.waitForTimeout(1000);assert.equal(await frames(lit.page), dropped, 'nothing draws at rest after a drag');
  assert.equal(await liquidB(), false, 'the panel is still again once home');
  assert.equal(lit.sent.length, layoutSaves, 'a cancelled drag sends nothing');
  // Frames that repeat the last timestamp (a zero-length easing step, seen on hosted runners) must not stall the
  // easing short of its target (#1966 review, F8): every other animation frame here repeats the one before it.
  const stutter = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark'});
  await stutter.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);let last = 0, repeat = false;
    window.requestAnimationFrame = callback => original(time => {const now = repeat ? last : time;repeat = !repeat;last = now;callback(now);});
  });
  const stuttering = await open(stutter);
  await expect(stuttering.page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  const targets = async (): Promise<Record<string, number>> => Object.fromEntries(await stuttering.page.locator('.home-layout [data-glass-panel]').evaluateAll(panels => panels.flatMap(panel => {
    const level = panel.querySelector('[data-glass-lamp]')?.getAttribute('data-glass-lamp');
    return level === undefined || level === null || Number(level) === 0 ? [] : [[(panel as HTMLElement).dataset['glassPanel'] ?? '', Number(level)]];
  })));
  const wanted = await targets();assert.ok(Object.keys(wanted).length >= 3, `lit panels to ease: ${JSON.stringify(wanted)}`);
  await eases(stuttering, async () => Object.fromEntries([...await lightsDrawn(stuttering.page)].map(([id, values]): [string, number | undefined] => [id, values[3]]).sort(([a], [b]) => a.localeCompare(b))),
    Object.fromEntries(Object.entries(wanted).sort(([a], [b]) => a.localeCompare(b))), 'with repeated frame times every lit panel eases to its level');
  const stutterRing = await stuttering.page.locator('[data-home-card="light:device:lamp-b"] .light-dial').boundingBox();assert.ok(stutterRing !== null);
  const commandsSent = (): number => stuttering.sent.filter(path => path.includes('/commands/')).length, powerBefore = commandsSent();
  await stuttering.page.mouse.move(stutterRing.x + stutterRing.width / 2, stutterRing.y + 5);await stuttering.page.mouse.down();
  const stutterPress = async (): Promise<number> => (await lightsDrawn(stuttering.page)).get('light:device:lamp-b')?.[4] ?? 0;
  await eases(stuttering, stutterPress, 1, 'with repeated frame times a held press eases to 1');
  // Out past the press slop and back: no command, no switch.
  await stuttering.page.mouse.move(stutterRing.x + stutterRing.width / 2, stutterRing.y - 15);await stuttering.page.mouse.move(stutterRing.x + stutterRing.width / 2, stutterRing.y + 5);
  await stuttering.page.mouse.up();
  await eases(stuttering, stutterPress, 0, 'with repeated frame times the released press eases back to 0');
  const stutterRest = await rest(stuttering.page);await stuttering.page.waitForTimeout(1000);
  assert.equal(await frames(stuttering.page), stutterRest, 'nothing draws at rest once the easing has finished');
  assert.equal(commandsSent(), powerBefore, 'a press dragged back to its start sends nothing');
  assert.deepEqual(stuttering.errors, []);await stutter.close();
  // Text on the lit panels keeps 4.5:1 over a bright and a dark artwork, dark and light.
  for (const scheme of ['dark', 'light'] as const) for (const sample of [bright, dark]) {
    await lit.page.emulateMedia({colorScheme: scheme});await present(lit.page, sample);await rest(lit.page);
    const measured = await contrast(lit.page);
    contrasts[`lit/${scheme}/${sample === bright ? 'bright' : 'dark'}`] = Math.round(measured.min * 100) / 100;
    assert.ok(measured.min >= 4.5, `lit ${scheme}: text keeps 4.5:1 (lowest ${measured.min.toFixed(2)}: ${measured.worst})`);
    await shot(lit.page, `1931-lit-1440-${scheme}-${sample === bright ? 'bright' : 'dark'}`);
  }
  await lit.page.emulateMedia({colorScheme: 'dark'});await present(lit.page, bright);await rest(lit.page);

  // Quiet glass: without WebGL 2 the dial and the plug show their state in plain CSS and still switch.
  const quiet = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  await quiet.addInitScript(noWebgl2);
  const plainRoom = await open(quiet);
  await expect(layer(plainRoom.page)).toHaveAttribute('data-glass-fallback', 'no-webgl2');
  const plainDial = plainRoom.page.locator('[data-home-card="light:device:lamp-a"] .light-dial');
  await expect(plainDial.locator('.light-dial-arc')).toHaveCount(1);
  assert.notEqual(await plainDial.locator('.light-dial-arc').evaluate(node => getComputedStyle(node).stroke), 'none', 'the arc is drawn in CSS');
  const plainPlug = plainRoom.page.locator('[data-plug-panel="shelf-lamp"] .plug-press');
  await expect(plainPlug).toHaveAttribute('aria-pressed', 'true');
  await shot(plainRoom.page, '1931-quiet-1440');
  const quietBox = await plainDial.boundingBox();assert.ok(quietBox !== null);
  await plainRoom.page.mouse.click(quietBox.x + quietBox.width / 2, quietBox.y + 5);
  await plainPlug.click();await expect(plainPlug).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => plainRoom.sent.filter(path => path === '/api/v2/commands/power-set').length).toBe(2);
  // #1932: in Quiet glass the arrow opens the light in place with its controls, which work, and Escape closes it.
  const plainCard = plainRoom.page.locator('[data-home-card="light:device:lamp-b"]'), plainArrow = plainCard.getByRole('button', {name: 'lamp-b controls', exact: true});
  await plainArrow.click();await expect(plainCard).toHaveAttribute('data-home-unfolded', '');
  await expect(plainCard.getByRole('tab', {name: 'Power', exact: true})).toBeFocused();
  const plainOff = plainCard.getByRole('button', {name: 'Off', exact: true});await expect(plainOff).toBeEnabled();await plainOff.click();
  await expect.poll(() => plainRoom.sent.filter(path => path === '/api/v2/commands/power-set').length).toBe(3);
  await shot(plainRoom.page, '1932-quiet-open-1440');
  await plainRoom.page.keyboard.press('Escape');await expect(plainCard).not.toHaveAttribute('data-home-unfolded');await expect(plainArrow).toBeFocused();
  assert.deepEqual(plainRoom.errors, []);await quiet.close();

  // Every light off: once the module reports it, no light is drawn, pixel for pixel as if no panel had a lamp.
  await expect.poll(powerSent, {message: 'the press switched lamp-b'}).toBe(beforePress + 1);
  await world.restart();await lit.page.reload();await feed(lit.page, 'connected');
  await expect(lit.page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});await present(lit.page, bright);
  // The Nanoleaf light reports its own state at once; a restart would repaint it, so it is switched off after.
  const wallRing = await ring('wall').boundingBox();assert.ok(wallRing !== null);
  await expect(lit.page.getByRole('switch', {name: 'wall power', exact: true})).toBeEnabled();
  await lit.page.mouse.click(wallRing.x + wallRing.width / 2, wallRing.y + 5);
  for (const id of ['lamp-a', 'lamp-b', 'wall']) await expect(ring(id)).toHaveAttribute('data-glass-lamp', '0');
  await expect(lit.page.locator('[data-plug-panel="shelf-lamp"] .plug-icon')).toHaveAttribute('data-glass-lamp', '0');
  await rest(lit.page);
  if (await drawing(lit, 'every light off')) {
    assert.equal(await layer(lit.page).getAttribute('data-glass-lights'), '', 'with every light off no light is drawn');
    const offShot = await lit.page.screenshot();
    await lit.page.evaluate(() => {for (const element of document.querySelectorAll('[data-glass-lamp]')) element.removeAttribute('data-glass-lamp');});
    await rest(lit.page);
    assert.ok((await lit.page.screenshot()).equals(offShot), 'all lights off draws exactly what no lamps draw');
    if (!smoke) assert.ok(onShot !== undefined, 'outside the smoke chain the lit room was drawn before the lights went off');
    if (onShot !== undefined && lampBox !== null) {
      // The light seen on the wall above each lamp was its own color: red above lamp-a, warm white above the wall.
      const [on, off] = await Promise.all([onShot, offShot].map(image => sharp(image).raw().toBuffer({resolveWithObject: true})));
      const spillAt = (x: number, y: number): number[] => [0, 1, 2].map(channel => {
        let sum = 0;for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
          const at = ((Math.round(y) + dy) * (on?.info.width ?? 0) + Math.round(x) + dx) * (on?.info.channels ?? 3) + channel;sum += (on?.data[at] ?? 0) - (off?.data[at] ?? 0);
        }
        return sum / 25;
      });
      const lampCard = await lit.page.locator('[data-home-card="light:device:lamp-a"]').boundingBox(), wallCard = await lit.page.locator('[data-home-card="light:device:wall"]').boundingBox();
      assert.ok(lampCard !== null && wallCard !== null);
      const red = spillAt(lampBox.x + lampBox.width / 2, lampCard.y - 10), white = spillAt(wallRing.x + wallRing.width / 2, wallCard.y - 10);
      assert.ok((red[0] ?? 0) > 4 && (red[0] ?? 0) > 3 * Math.max(red[1] ?? 0, red[2] ?? 0, 0.5), `the wall above lamp-a takes its red: ${red.map(value => value.toFixed(1)).join(',')}`);
      assert.ok((white[0] ?? 0) > 4 && (white[0] ?? 0) >= (white[1] ?? 0) && (white[1] ?? 0) >= (white[2] ?? 0), `the wall above the Nanoleaf light takes warm white: ${white.map(value => value.toFixed(1)).join(',')}`);
    }
  }
  assert.deepEqual(lit.errors, []);await room.close();
  report['litRoom'] = {lifxColor: true, warmWhite: true, plug: true, lamp: 'ring center', press: true, dragTarget: true, restAfterEasing: true, allOffDrawsNothing: true, quiet: true};

  // #1932: unfold a light in place. A touch-capable window, so the same page is used by pointer, touch and keyboard.
  const unfoldContext = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark', hasTouch: true});
  const unfolding = await open(unfoldContext), up = unfolding.page;
  await expect(up.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  await present(up, dark);await rest(up);
  // Every liquid panel the layer draws is logged, so a check can tell whether the motion turned anything liquid.
  await layer(up).evaluate(canvas => {
    const seen: string[] = [];(window as unknown as {liquidSeen: string[]}).liquidSeen = seen;
    new MutationObserver(() => {const value = canvas.getAttribute('data-glass-liquid') ?? '';if (value !== '') seen.push(value);}).observe(canvas, {attributes: true, attributeFilter: ['data-glass-liquid']});
  });
  const liquidSeen = async (clear = true): Promise<string[]> => up.evaluate(clearing => {const holder = window as unknown as {liquidSeen: string[]};const seen = [...holder.liquidSeen];if (clearing) holder.liquidSeen.length = 0;return seen;}, clear);
  // Settled: no frame for half a second and no panel liquid, so a slow software frame cannot leave a tail in the log.
  const calm = async (): Promise<void> => {await rest(up);await expect(layer(up)).toHaveAttribute('data-glass-liquid', '');await rest(up);};
  const savedLayout = async (): Promise<string> => up.evaluate(async () => JSON.stringify((await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}}).records['home-layout'][0]));
  const savedBefore = await savedLayout(), commandsBefore = unfolding.sent.filter(path => path.startsWith('/api/v2/commands/')).length;
  const lightCard = (id: string): Locator => up.locator(`[data-home-card="light:device:${id}"]`);
  const arrowOf = (id: string): Locator => lightCard(id).getByRole('button', {name: `${id} controls`, exact: true});
  const powerTab = (id: string): Locator => lightCard(id).getByRole('tab', {name: 'Power', exact: true});
  const isOpen = async (id: string): Promise<void> => {
    await expect(lightCard(id)).toHaveAttribute('data-home-unfolded', '');await expect(lightCard(id)).toHaveAttribute('data-home-shape', 'large-square');
    await expect(arrowOf(id)).toHaveAttribute('aria-expanded', 'true');await expect(up.locator('[data-home-unfolded]')).toHaveCount(1);
  };
  const isClosed = async (id: string): Promise<void> => {
    await expect(lightCard(id)).not.toHaveAttribute('data-home-unfolded');await expect(lightCard(id)).toHaveAttribute('data-home-shape', 'square');
    await expect(arrowOf(id)).toHaveAttribute('aria-expanded', 'false');
  };
  const sideways = async (label: string): Promise<void> => {
    const [scroll, inner] = await up.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok((scroll ?? 0) <= (inner ?? 0), `${label}: no sideways scroll (${String(scroll)} > ${String(inner)})`);
  };
  // Pointer: the arrow opens lamp-a in place; the cards that move ease and turn liquid, then the layer rests.
  await isClosed('lamp-a');
  await arrowOf('lamp-a').click();await isOpen('lamp-a');await expect(powerTab('lamp-a')).toBeFocused();
  await expect.poll(async () => (await liquidSeen(false)).join('|')).toContain('light:device:lamp-a:');
  await expect(layer(up), 'every panel settles').toHaveAttribute('data-glass-liquid', '', {timeout: 30_000});await followsBoxes(up, 'unfolded');
  const settledOpen = await frames(up);await up.waitForTimeout(1500);assert.equal(await frames(up), settledOpen, 'the canvas stops drawing after the motion ends');
  const moved = new Set((await liquidSeen()).flatMap(entry => entry.split('|').map(item => item.slice(0, item.lastIndexOf(':')))));
  assert.ok(moved.size > 1, `the opened light and the cards it moved turned liquid: ${[...moved].join(', ')}`);
  report['unfoldLiquid'] = [...moved];
  const fits = await lightCard('lamp-a').locator('.light-card').evaluate(node => [node.scrollHeight - node.clientHeight, node.scrollWidth - node.clientWidth]);
  assert.deepEqual(fits, [0, 0], 'the opened controls fit the panel with nothing scrolled');
  for (const name of ['Power', 'Color', 'Scenes', 'Timer']) await expect(lightCard('lamp-a').getByRole('tab', {name, exact: true})).toBeVisible();
  await expect(lightCard('lamp-a').getByRole('link', {name: 'Open page', exact: true})).toHaveAttribute('href', '#/component/lamp-a');
  await sideways('1440 open');await shot(up, '1932-open-1440-dark');
  // The opened panel's text keeps 4.5:1, dark and light, over both artworks.
  for (const scheme of ['dark', 'light'] as const) for (const sample of [dark, bright]) {
    await up.emulateMedia({colorScheme: scheme});await present(up, sample);await rest(up);
    const measured = await contrast(up), label = `unfolded/${scheme}/${sample === dark ? 'dark' : 'bright'}`;
    contrasts[label] = Math.round(measured.min * 100) / 100;
    assert.ok(measured.min >= 4.5, `${label}: text keeps 4.5:1 (lowest ${measured.min.toFixed(2)}: ${measured.worst})`);
    await shot(up, `1932-open-1440-${scheme}-${sample === dark ? 'dark' : 'bright'}`);
  }
  await up.emulateMedia({colorScheme: 'dark'});await present(up, dark);await calm();await liquidSeen();
  // A window resize repacks the grid but stirs nothing.
  await up.setViewportSize({width: 1100, height: 900});await followsBoxes(up, 'unfolded resized');
  assert.deepEqual(await liquidSeen(), [], 'a window resize does not turn panels liquid');
  await up.setViewportSize({width: 1440, height: 900});await followsBoxes(up, 'unfolded restored');await liquidSeen();
  // The arrow closes it again and keeps focus.
  await arrowOf('lamp-a').click();await isClosed('lamp-a');await expect(arrowOf('lamp-a')).toBeFocused();await rest(up);
  // Keyboard: Enter on the arrow opens it with focus in its controls; Escape closes it and focus returns to the arrow.
  await arrowOf('lamp-a').focus();await up.keyboard.press('Enter');await isOpen('lamp-a');await expect(powerTab('lamp-a')).toBeFocused();
  await up.keyboard.press('Tab');await expect(lightCard('lamp-a').locator('.light-face')).toBeFocused();
  await up.keyboard.press('Escape');await isClosed('lamp-a');await expect(arrowOf('lamp-a')).toBeFocused();await rest(up);
  // Touch: a tap opens lamp-b; opening lamp-a then closes lamp-b, one panel at a time.
  await arrowOf('lamp-b').tap();await isOpen('lamp-b');await expect(powerTab('lamp-b')).toBeFocused();await rest(up);
  await arrowOf('lamp-a').tap();await isOpen('lamp-a');await isClosed('lamp-b');await expect(powerTab('lamp-a')).toBeFocused();await rest(up);
  // Wider and narrower windows: the open panel keeps to the grid; one column stacks every card with its full controls
  // and closes the panel, so it does not open again later.
  await up.setViewportSize({width: 1024, height: 800});await rest(up);await isOpen('lamp-a');await sideways('1024 open');await shot(up, '1932-open-1024-dark');
  // At 620 px the grid has two columns: every dial's options menu, and the open one's, stays inside the window.
  await up.setViewportSize({width: 620, height: 800});await rest(up);await isOpen('lamp-a');await sideways('620 open');
  for (const id of ['lamp-a', 'lamp-b', 'wall']) {
    const menu = lightCard(id).locator('details.light-options');await menu.locator('summary').scrollIntoViewIfNeeded();await menu.locator('summary').click();
    const box = await menu.locator('.light-options-body').boundingBox(), inner = await up.evaluate(() => innerWidth);assert.ok(box !== null);
    assert.ok(box.x >= 0 && box.x + box.width <= inner, `620: ${id}'s options menu stays in the window (${String(box.x)} to ${String(box.x + box.width)} of ${String(inner)})`);
    await shot(up, `1932-620-${id}-menu`);await menu.locator('summary').click();
  }
  for (const width of [390, 320]) {
    await up.setViewportSize({width, height: 844});await rest(up);await sideways(`${String(width)} after open`);
    await expect(up.locator('[data-home-unfolded]')).toHaveCount(0);await expect(lightCard('lamp-a').getByRole('tab', {name: 'Power', exact: true})).toBeVisible();
    await shot(up, `1932-${String(width)}-dark`);
  }
  await up.setViewportSize({width: 1440, height: 900});await rest(up);await expect(up.locator('[data-home-unfolded]')).toHaveCount(0);
  // Edit Home closes the open panel and keeps every card's saved shape.
  await arrowOf('lamp-a').click();await isOpen('lamp-a');await rest(up);
  await up.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await expect(up.locator('[data-home-unfolded]')).toHaveCount(0);await expect(lightCard('lamp-a')).toHaveAttribute('data-home-shape', 'square');
  await up.getByRole('button', {name: 'Cancel', exact: true}).click();await rest(up);
  // A reload shows no open panel; opening and closing sent nothing and the saved layout is unchanged.
  await arrowOf('lamp-a').click();await isOpen('lamp-a');await rest(up);
  await up.reload();await feed(up, 'connected');await expect(up.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  await isClosed('lamp-a');await expect(up.locator('[data-home-unfolded]')).toHaveCount(0);
  assert.equal(await savedLayout(), savedBefore, 'opening and closing never change the saved layout');
  assert.equal(unfolding.sent.filter(path => path.startsWith('/api/v2/commands/')).length, commandsBefore, 'opening and closing send nothing');
  // Reduced motion: the panel opens at once, with no eased move and nothing liquid.
  await layer(up).evaluate(canvas => {
    const seen: string[] = [];(window as unknown as {liquidSeen: string[]}).liquidSeen = seen;
    new MutationObserver(() => {const value = canvas.getAttribute('data-glass-liquid') ?? '';if (value !== '') seen.push(value);}).observe(canvas, {attributes: true, attributeFilter: ['data-glass-liquid']});
  });
  await present(up, dark);await up.emulateMedia({reducedMotion: 'reduce'});await calm();await liquidSeen();
  await arrowOf('lamp-b').click();await isOpen('lamp-b');
  assert.equal(await up.evaluate(() => document.getAnimations().filter(animation => animation.id === 'home-unfold').length), 0, 'reduced motion moves the cards at once');
  await followsBoxes(up, 'reduced motion');assert.deepEqual(await liquidSeen(), [], 'reduced motion turns nothing liquid');
  await up.keyboard.press('Escape');await isClosed('lamp-b');await rest(up);await up.emulateMedia({reducedMotion: 'no-preference'});
  // A stale lighting layout: its notice sits inside each light card, below the state, and leaves the dial in place.
  // The page itself moves down under the reconnecting notices, so the dial is measured from its card's top.
  const ringTop = async (id: string): Promise<number> => ((await lightCard(id).locator('.light-dial').boundingBox())?.y ?? Number.NaN) - ((await lightCard(id).boundingBox())?.y ?? Number.NaN);
  await arrowOf('lamp-a').click();await isOpen('lamp-a');await rest(up);
  const ringBefore = await ringTop('lamp-b'), openRingBefore = await ringTop('lamp-a');
  const releaseStream = await holdDashboardStream(up);world.dropDashboardStreams();await feed(up, 'reconnecting');
  await expect(lightCard('lamp-b').locator('.light-dial-card > .light-card-notice')).toHaveText('Layout records are unavailable or stale. Arrangement is read-only.');
  await expect(lightCard('lamp-a').locator('.light-unfolded > .light-card-notice')).toBeVisible();
  await expect(up.locator('.home-layout .lighting-workspace > p[role=status]')).toHaveCount(0);
  await rest(up);
  assert.ok(Math.abs(await ringTop('lamp-b') - ringBefore) <= 1 && Math.abs(await ringTop('lamp-a') - openRingBefore) <= 1, 'the notice does not push the dial down');
  await shot(up, '1932-stale-1440-dark');
  releaseStream();await feed(up, 'connected');
  assert.deepEqual(unfolding.errors.filter(message => !/Failed to load resource/.test(message)), []);await unfoldContext.close();
  report['unfold'] = {pointer: true, touch: true, keyboard: true, oneAtATime: true, reloadClosed: true, layoutUnchanged: true, restsAfterMotion: true, resizeStirsNothing: true, reducedMotion: true, widths: [1440, 1024, 390, 320], staleNotice: true};

  console.log(JSON.stringify(report));
} finally {await browser.close();await world.close();}
