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
import {changes, feed, startWorld} from './harness.ts';
import {cardOptions} from './home-editor.ts';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({lighting: true, inbox: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing']});
type Sample = 'dark' | 'bright';

/**
 * Hands the page a synthetic artwork: a dark night scene or a bright day scene, drawn in the page and decoded to an
 * ImageBitmap. Until #1928 merges, the shell's temporary backdrop adapter takes it from the `bunny-synthetic-backdrop`
 * event; afterwards this journey serves these pixels through the art module's content route instead.
 */
async function showSample(page: Page, kind: Sample | null): Promise<void> {
  await page.evaluate(async value => {
    if (value === null) {window.dispatchEvent(new CustomEvent('bunny-synthetic-backdrop', {detail: null}));return;}
    const canvas = document.createElement('canvas');canvas.width = 1536;canvas.height = 1024;
    const context = canvas.getContext('2d');if (context === null) throw new Error('sample-2d');
    const bright = value === 'bright', sky = context.createLinearGradient(0, 0, 0, 1024);
    for (const [at, color] of (bright ? [[0, '#fff7e0'], [0.55, '#ffe2a8'], [1, '#bfe6ff']] : [[0, '#0b1230'], [0.6, '#1d2a5c'], [1, '#091018']]) as [number, string][]) sky.addColorStop(at, color);
    context.fillStyle = sky;context.fillRect(0, 0, 1536, 1024);
    context.fillStyle = bright ? '#ffffff' : '#f4c25a';context.beginPath();context.arc(1080, 300, 160, 0, 7);context.fill();
    context.fillStyle = bright ? '#ff9a3c' : '#7b3fa0';context.beginPath();context.moveTo(0, 760);context.lineTo(500, 520);context.lineTo(900, 820);context.lineTo(1536, 600);context.lineTo(1536, 1024);context.lineTo(0, 1024);context.fill();
    context.fillStyle = bright ? '#2a9d8f' : '#e76f51';context.fillRect(200, 200, 140, 380);
    for (let index = 0; index < 40; index += 1) {
      context.fillStyle = bright ? `hsl(${String(index * 9)},90%,${String(70 + index % 3 * 8)}%)` : `hsl(${String(200 + index * 4)},70%,${String(20 + index % 4 * 10)}%)`;
      context.fillRect((index * 97) % 1536, 860 + (index * 37) % 150, 60, 30);
    }
    const bitmap = await createImageBitmap(canvas);
    window.dispatchEvent(new CustomEvent('bunny-synthetic-backdrop', {detail: {bitmap, renditionId: `synthetic-${value}`}}));
  }, kind);
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
 * The lowest contrast between panel or heading text and the pixels drawn behind it. Text that sits on its own fill
 * (a button, an inset) is not over the glass and is skipped. The text is hidden for the screenshot so only what is
 * behind it is measured; hiding it changes no box, so the layer draws nothing new.
 */
async function contrast(page: Page): Promise<{min: number; runs: number; worst: string}> {
  const runs = await page.evaluate(() => {
    const clear = (element: Element): boolean => {const style = getComputedStyle(element);return style.backgroundImage === 'none' && (style.backgroundColor === 'transparent' || /rgba\(.*, 0\)$/.test(style.backgroundColor));};
    const found: {x: number; y: number; width: number; height: number; color: string; text: string}[] = [];
    const roots = [...document.querySelectorAll('.home-layout [data-glass-panel], .home-layout [data-glass-veil]')];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const parent = node.parentElement;if (parent === null || (node.textContent ?? '').trim() === '') continue;
        const style = getComputedStyle(parent);if (style.visibility !== 'visible' || Number(style.opacity) < 1) continue;
        let ground = true;for (let at: Element | null = parent; at !== null && at !== root; at = at.parentElement) if (!clear(at)) {ground = false;break;}
        if (!ground || !clear(root) && root.matches('[data-glass-veil]')) continue;
        const range = document.createRange();range.selectNodeContents(node);const limit = parent.getBoundingClientRect();
        for (const rect of range.getClientRects()) {
          const x = Math.max(rect.left, limit.left, 0), y = Math.max(rect.top, limit.top, 0);
          const right = Math.min(rect.right, limit.right, innerWidth), bottom = Math.min(rect.bottom, limit.bottom, innerHeight);
          if (right - x >= 2 && bottom - y >= 2) found.push({x, y, width: right - x, height: bottom - y, color: style.color, text: (node.textContent ?? '').trim().slice(0, 24)});
        }
      }
    }
    for (const root of roots) for (const child of root.matches('[data-glass-veil]') ? [root] : [...root.children]) if (child instanceof HTMLElement) child.style.visibility = 'hidden';
    return found;
  });
  const image = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject: true});
  await page.evaluate(() => {for (const element of document.querySelectorAll<HTMLElement>('.home-layout [data-glass-veil], .home-layout [data-glass-panel] > *')) element.style.visibility = '';});
  const linear = (value: number): number => {const channel = value / 255;return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;};
  const luminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const {data, info} = image;let min = Infinity, worst = '';
  for (const run of runs) {
    const [r = 0, g = 0, b = 0] = [...run.color.matchAll(/\d+(\.\d+)?/g)].map(match => Number(match[0]));
    const ink = luminance(r, g, b);
    for (let y = Math.ceil(run.y); y < Math.floor(run.y + run.height); y += 1) for (let x = Math.ceil(run.x); x < Math.floor(run.x + run.width); x += 1) {
      const at = (y * info.width + x) * info.channels, ground = luminance(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0);
      const ratio = (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
      if (ratio < min) {min = ratio;worst = `${run.text} at ${String(x)},${String(y)}`;}
    }
  }
  return {min, runs: runs.length, worst};
}

async function open(context: BrowserContext, width = 1440, height = 900): Promise<{page: Page; sent: string[]; errors: string[]}> {
  const page = await context.newPage();page.setDefaultTimeout(30_000);await page.setViewportSize({width, height});
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
  const requests: string[] = [];page.on('request', request => {requests.push(request.url());});
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  assert.ok(await rest(page) > 1, 'the first appearance eases over several frames, then stops');
  assert.equal(await layer(page).getAttribute('data-glass-backdrop'), '', 'with no artwork the layer draws the Quiet glass wash');
  assert.deepEqual((await surfaces(page)).filled, ['inbox'], 'the card surfaces are see-through over the glass, except the Inbox that needs attention');
  assert.equal(await layer(page).evaluate(node => getComputedStyle(node).pointerEvents), 'none', 'the canvas takes no pointer input');
  assert.notEqual(await page.locator('#rail').evaluate(node => getComputedStyle(node).backdropFilter), 'none', 'the rail is frosted over the backdrop');
  await shot(page, '1440-wash');
  const empty = await page.screenshot({clip: {x: 1200, y: 10, width: 40, height: 30}});
  await showSample(page, 'dark');
  await expect(layer(page)).toHaveAttribute('data-glass-backdrop', 'synthetic-dark');
  assert.notDeepEqual(await page.screenshot({clip: {x: 1200, y: 10, width: 40, height: 30}}), empty, 'the artwork replaces the wash behind the page');
  report['panels'] = await followsBoxes(page, 'loaded');
  await shot(page, '1440-dark-sample');

  // At rest: no frame while nothing changes.
  const still = await rest(page);await page.waitForTimeout(2000);
  assert.equal(await frames(page), still, 'nothing draws at rest');report['restFrames'] = 0;

  // Scrolling and resizing move the glass with the cards, then it rests again.
  await page.mouse.wheel(0, 420);await followsBoxes(page, 'scrolled');
  await page.setViewportSize({width: 1100, height: 800});await followsBoxes(page, 'resized');
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
  assert.ok(requests.every(url => !url.includes('/modules/art/')), 'the layer requests nothing');
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
      await showSample(opened.page, sample);await expect(layer(opened.page)).toHaveAttribute('data-glass-backdrop', `synthetic-${sample}`);await rest(opened.page);
      await shot(opened.page, `1440-${scheme}-${sample}`);
      const measured = await contrast(opened.page);
      assert.ok(measured.runs > 20, `${scheme}/${sample}: text runs were measured`);
      contrasts[`${scheme}/${sample}`] = Math.round(measured.min * 100) / 100;
      assert.ok(measured.min >= 4.5, `${scheme}/${sample}: panel text keeps 4.5:1 (lowest ${measured.min.toFixed(2)}: ${measured.worst})`);
    }
    assert.deepEqual(opened.errors, []);await themed.close();
  }
  report['contrast'] = contrasts;

  // AC4: without WebGL 2 the cards keep their Quiet glass panels and work.
  const plain = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  await plain.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {return kind === 'webgl2' ? null : Reflect.apply(original, this, [kind, ...rest]) as RenderingContext | null;} as typeof original;
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
