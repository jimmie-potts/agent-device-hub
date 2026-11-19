// Home's glass layer (#1929) on a disposable synthetic runtime: no installed service or device. Headless Chromium draws
// WebGL 2 with SwiftShader. The journey checks that the backdrop is drawn, that every card's glass follows its box
// through scrolling, resizing, Edit Home and paging, that nothing draws at rest, that WebGL 2 missing or a lost
// context leaves the Quiet glass panels with working controls, and that panel text keeps 4.5:1 over a dark and a bright
// artwork in light and dark appearance. With DASHBOARD_RECEIPTS set it writes private screenshots.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {chromium, expect, type BrowserContext, type Locator, type Page} from 'playwright/test';
import {changes, feed, holdDashboardStream, startWorld} from './harness.ts';
import {cardOptions} from './home-editor.ts';
import {artworkOf, browserArt} from '../../../../modules/art/dist/src/frontend/model.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({lighting: true, inbox: true, art: true});
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
/** The panels the layer drew last, against the boxes of the marked elements now in or near the window. */
async function followsBoxes(page: Page, label: string): Promise<number> {
  await rest(page);
  const {drawn, boxes} = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer');
    const boxes = [...document.querySelectorAll<HTMLElement>('.home-layout [data-glass-panel]')].flatMap(element => {
      const box = element.getBoundingClientRect();
      const near = box.width > 0 && box.height > 0 && box.left < innerWidth + 64 && box.top < innerHeight + 64 && box.right > -64 && box.bottom > -64;
      return near ? [`${element.dataset['glassPanel'] ?? ''}:${[box.left, box.top, box.width, box.height].map(value => value.toFixed(1)).join(',')}`] : [];
    });
    return {drawn: canvas?.dataset['glassBoxes'] ?? '', boxes};
  });
  const parse = (entry: string): [string, number[]] => {const at = entry.lastIndexOf(':');return [entry.slice(0, at), entry.slice(at + 1).split(',').map(Number)];};
  const shown = new Map(drawn.split('|').filter(entry => entry !== '').map(parse));
  assert.equal(shown.size, boxes.length, `${label}: the layer draws every card in view (${drawn} vs ${boxes.join('|')})`);
  for (const [id, box] of boxes.map(parse)) {
    const glass = shown.get(id);assert.ok(glass !== undefined, `${label}: ${id} has glass`);
    glass.forEach((value, index) => {assert.ok(Math.abs(value - (box[index] ?? 0)) <= 0.6, `${label}: ${id} glass ${glass.join(',')} follows its box ${box.join(',')}`);});
  }
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
 * edit toolbar) is not over the layer and is skipped. The text is made transparent for the screenshot so only what is
 * behind it is measured; that changes no box, so the layer draws nothing new.
 */
async function contrast(page: Page): Promise<{min: number; runs: number; worst: string}> {
  const runs = await page.evaluate(() => {
    const main = document.getElementById('main');if (main === null) throw new Error('contrast: no main');
    const clear = (element: Element): boolean => {const style = getComputedStyle(element);return style.backgroundImage === 'none' && (style.backgroundColor === 'transparent' || /rgba\(.*, 0\)$/.test(style.backgroundColor));};
    const found: {x: number; y: number; width: number; height: number; color: string; text: string}[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;if (parent === null || (node.textContent ?? '').trim() === '' || !parent.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
      let ground = true;for (let at: Element | null = parent; at !== null && at !== main; at = at.parentElement) if (!clear(at) || Number(getComputedStyle(at).opacity) < 1) {ground = false;break;}
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
  return {min, runs: runs.length, worst};
}

async function open(context: BrowserContext, width = 1440, height = 900): Promise<{page: Page; sent: string[]; errors: string[]}> {
  await substitute(context);const page = await context.newPage();page.setDefaultTimeout(30_000);await page.setViewportSize({width, height});
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent = changes(page);
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  return {page, sent, errors};
}

const report: Record<string, unknown> = {journey: 'home-glass', physical: false};
try {
  // Make the Inbox long enough to page.
  for (let index = 0; index < 13; index += 1) await world.failCommand();

  // AC1: the backdrop is drawn and the glass follows each card's box.
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference'});
  const {page, sent, errors} = await open(context);
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  assert.ok(await rest(page) > 1, 'the first appearance eases over several frames, then stops');
  await expect(page.locator('[data-art-backdrop]')).toHaveAttribute('data-art-backdrop', /^(none|stale)$/);
  assert.equal(await layer(page).getAttribute('data-glass-backdrop'), '', 'with no artwork the layer draws the Quiet glass wash');
  assert.deepEqual((await surfaces(page)).filled, ['inbox'], 'the card surfaces are see-through over the glass, except the Inbox that needs attention');
  assert.equal(await layer(page).evaluate(node => getComputedStyle(node).pointerEvents), 'none', 'the canvas takes no pointer input');
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
  await page.setViewportSize({width: 1100, height: 800});await followsBoxes(page, 'resized');
  // A window resize draws one frame, after the page has repacked, and a context that renders in software draws at most
  // about a million pixels: the page's main thread waits for every software frame, so a wide window must not cost
  // more (the full browser suite's Home shapes journey timed out waiting for a repack at 2560 px, #1929).
  const settled = await rest(page);await page.setViewportSize({width: 2560, height: 1000});await followsBoxes(page, 'wide');
  assert.equal(await frames(page) - settled, 1, 'one window resize draws one frame');
  const backing = await layer(page).evaluate(node => ({software: (node as HTMLCanvasElement).dataset['glassSoftware'] !== undefined, pixels: (node as HTMLCanvasElement).width * (node as HTMLCanvasElement).height}));
  if (backing.software) assert.ok(backing.pixels <= 1_010_000, `software rendering draws at most a million pixels (${String(backing.pixels)})`);
  report['software'] = backing.software;
  await page.setViewportSize({width: 1440, height: 900});await page.evaluate(() => {scrollTo(0, 0);});await followsBoxes(page, 'restored');

  // Edit Home: reordering and reshaping cards moves their glass; the draft is discarded.
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await cardOptions(page, 'Hub mode');await page.getByRole('button', {name: 'Move Hub mode later', exact: true}).click();
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
        assert.ok(measured.runs > 20, `${label}: text runs were measured`);
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
      await opened.page.getByRole('button', {name: 'Edit Home', exact: true}).click();await rest(opened.page);
      await shot(opened.page, `1440-${scheme}-${sample}-edit`);await measure('edit');
      await opened.page.getByRole('button', {name: 'Cancel', exact: true}).click();await rest(opened.page);
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
  await plain.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {configurable: true, writable: true,
      value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {return kind === 'webgl2' ? null : original.call(this, kind, ...rest);}});
  });
  const fallback = await open(plain);
  await expect(layer(fallback.page)).toHaveAttribute('data-glass-fallback', 'no-webgl2');
  assert.equal(await glassState(fallback.page), 'quiet');
  assert.deepEqual((await surfaces(fallback.page)).clear, [], 'without WebGL 2 every card shows its Quiet glass panel');
  assert.equal(await fallback.page.locator('.shell').evaluate(node => getComputedStyle(node).backgroundImage === 'none'), false, 'the shell keeps its wash');
  await controlsWork(fallback.page, fallback.sent, 'no WebGL 2');
  await shot(fallback.page, '1440-no-webgl2');
  assert.deepEqual(fallback.errors, []);await plain.close();report['noWebgl2'] = true;

  console.log(JSON.stringify(report));
} finally {await browser.close();await world.close();}
