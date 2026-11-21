// The shared glass layer (#1929) on the Devices directory, the Companions overview and the display pages (Hub #1950),
// on a disposable synthetic runtime: no installed service or device. Headless Chromium draws WebGL 2 with SwiftShader.
// The pages draw the Quiet glass wash with no artwork and no fusing. The journey checks that every card's glass follows
// its box, that nothing draws at rest, that text on the wash and on the glass keeps 4.5:1 in light and dark at 1440,
// 390 and 320px, that a page opened from the phone drawer is drawn as it rests, that
// the veils stay few, and that WebGL 2 missing or a lost context leaves the Quiet glass panels with every control
// working. Nothing here sends a command. With DASHBOARD_RECEIPTS set it writes private screenshots.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {chromium, expect, type BrowserContext, type Locator, type Page} from 'playwright/test';
import {changes, feed, startWorld} from './harness.ts';
import {glyphContrast, type Capture} from './glyph-contrast.ts';
import {openDeviceMenu} from './navigation-helpers.ts';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({devices: true, pixooPages: true, tidbyt: true, companions: true, nanoleaf: true, nanoleafPanels: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing']});

/** The pages that draw on the layer, each with something on it that shows the page has loaded. */
const PAGES = [
  {hash: '#/devices', name: 'directory', ready: (page: Page): Locator => page.getByRole('link', {name: 'Nanoleaf overview', exact: true})},
  {hash: '#/companions', name: 'companions', ready: (page: Page): Locator => page.getByRole('link', {name: 'Open Habitat', exact: true})},
  {hash: '#/component/pixoo-1', name: 'pixoo', ready: (page: Page): Locator => page.getByRole('navigation', {name: 'Display links', exact: true})},
  {hash: '#/module/pixoo/playlists', name: 'pixoo-playlists', ready: (page: Page): Locator => page.getByRole('region', {name: 'Pixoo playlists', exact: true})},
  {hash: '#/component/tidbyt', name: 'tidbyt', ready: (page: Page): Locator => page.getByRole('tablist', {name: 'Tidbyt information', exact: true})},
] as const;

const main = (page: Page): Locator => page.locator('#main');
const layer = (page: Page): Locator => page.locator('#main > .glass-layer');
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
    const canvas = document.querySelector<HTMLCanvasElement>('#main > .glass-layer');
    const boxes = [...document.querySelectorAll<HTMLElement>('#main [data-glass-panel]')].flatMap(element => {
      const box = element.getBoundingClientRect();
      const near = box.width > 0 && box.height > 0 && box.left < innerWidth + 64 && box.top < innerHeight + 64 && box.right > -64 && box.bottom > -64;
      return near ? [`${element.dataset['glassPanel'] ?? ''}:${[box.left, box.top, box.width, box.height].map(value => value.toFixed(1)).join(',')}`] : [];
    });
    return {drawn: canvas?.dataset['glassBoxes'] ?? '', boxes};
  });
  const parse = (entry: string): [string, number[]] => {const at = entry.lastIndexOf(':');return [entry.slice(0, at), entry.slice(at + 1).split(',').map(Number)];};
  const shown = new Map(drawn.split('|').filter(entry => entry !== '').map(parse));
  assert.ok(boxes.length > 0, `${label}: the page marks its panels`);
  assert.equal(shown.size, boxes.length, `${label}: the layer draws every panel in view (${drawn} vs ${boxes.join('|')})`);
  for (const [id, box] of boxes.map(parse)) {
    const glass = shown.get(id);assert.ok(glass !== undefined, `${label}: ${id} has glass`);
    glass.forEach((value, index) => {assert.ok(Math.abs(value - (box[index] ?? 0)) <= 0.6, `${label}: ${id} glass ${glass.join(',')} follows its box ${box.join(',')}`);});
  }
  return boxes.length;
}
/** Whether the outermost card surface in each panel is see-through, so the glass shows. */
async function surfaces(page: Page): Promise<{clear: string[]; filled: string[]}> {
  const found = await page.locator('#main [data-glass-panel]').evaluateAll(panels => panels.flatMap(panel => {
    const surface = panel.querySelector(':is(.card,.widget,.light-card)');
    if (surface === null || surface.getBoundingClientRect().width === 0) return [];
    return [{id: (panel as HTMLElement).dataset['glassPanel'] ?? '', clear: getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)'}];
  }));
  return {clear: found.filter(item => item.clear).map(item => item.id), filled: found.filter(item => !item.clear).map(item => item.id)};
}
/** The veils the layer would draw now: visible, in the window, in document order. The layer reads at most 32. */
const veils = (page: Page): Promise<number> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-glass-veil]')].filter(element => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && element.checkVisibility({visibilityProperty: true});
}).length);
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});await page.screenshot({path: join(receipts, `devices-glass-${name}.png`)});
}

/**
 * The lowest contrast between any text drawn over the layer and the pixels behind its glyphs (glyph-contrast.ts). The
 * text runs are found as Home's glass journey finds them: every visible text node in the page whose ancestors up to
 * the page are all see-through; text on a fill of its own is skipped. The page is captured with the text and again
 * with the text made transparent, which changes no box. A run wholly in the window with no glyph pixel is reported.
 */
async function contrast(page: Page): Promise<{min: number; runs: number; glyphs: number; inkless: string[]; worst: string}> {
  const runs = await page.evaluate(() => {
    const main = document.getElementById('main');if (main === null) throw new Error('contrast: no main');
    const clear = (element: Element): boolean => {const style = getComputedStyle(element);return style.backgroundImage === 'none' && (style.backgroundColor === 'transparent' || /rgba\(.*, 0\)$/.test(style.backgroundColor));};
    const found: {x: number; y: number; width: number; height: number; color: string; text: string; whole: boolean}[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;if (parent === null || (node.textContent ?? '').trim() === '' || !parent.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
      let ground = true;for (let at: Element | null = parent; at !== null && at !== main; at = at.parentElement) if (!clear(at) || Number(getComputedStyle(at).opacity) < 1) {ground = false;break;}
      if (!ground) continue;
      const range = document.createRange();range.selectNodeContents(node);const limit = parent.getBoundingClientRect(), color = getComputedStyle(parent).color;
      for (const rect of range.getClientRects()) {
        const x = Math.max(rect.left, limit.left, 0), y = Math.max(rect.top, limit.top, 0);
        const right = Math.min(rect.right, limit.right, innerWidth), bottom = Math.min(rect.bottom, limit.bottom, innerHeight);
        const whole = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && rect.width >= 4 && rect.height >= 6;
        if (right - x >= 2 && bottom - y >= 2) found.push({x, y, width: right - x, height: bottom - y, color, text: (node.textContent ?? '').trim().slice(0, 32), whole});
      }
      parent.dataset['glassMeasured'] = '';
    }
    return found;
  });
  const shot = async (): Promise<Capture> => {const {data, info} = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject: true});return {data, info};};
  const inked = await shot();
  await page.evaluate(() => {for (const element of document.querySelectorAll<HTMLElement>('[data-glass-measured]')) element.style.setProperty('color', 'transparent', 'important');});
  const ground = await shot();
  await page.evaluate(() => {for (const element of document.querySelectorAll<HTMLElement>('[data-glass-measured]')) {element.style.removeProperty('color');delete element.dataset['glassMeasured'];}});
  return {...glyphContrast(inked, ground, runs), runs: runs.length};
}

async function open(context: BrowserContext, hash: string, ready: (page: Page) => Locator, width = 1440, height = 900): Promise<{page: Page; sent: string[]; errors: string[]}> {
  const page = await context.newPage();page.setDefaultTimeout(30_000);await page.setViewportSize({width, height});
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent = changes(page);
  await page.goto(`${world.url}/${hash}`);await feed(page, 'connected');await ready(page).waitFor();
  return {page, sent, errors};
}
/** The pages' controls work: a brand expands in the menu, a directory card opens its page, a view's tab and a card's tab change what is shown. */
async function controlsWork(page: Page, label: string): Promise<void> {
  const menu = await openDeviceMenu(page), brand = menu.getByRole('menuitem', {name: 'LIFX', exact: true});
  if (await brand.getAttribute('aria-expanded') !== 'true') await brand.click();
  await menu.getByRole('menuitem', {name: 'LIFX overview', exact: true}).waitFor();
  await menu.getByRole('menuitem', {name: 'All devices', exact: true}).click();
  await page.getByRole('region', {name: 'Displays', exact: true}).getByRole('link', {name: 'Pixoo', exact: true}).click();
  await page.getByRole('navigation', {name: 'pixoo pages', exact: true}).getByRole('link', {name: 'Media', exact: true}).click();
  await page.getByRole('region', {name: 'Pixoo library', exact: true}).waitFor();
  await page.goto(`${world.url}/#/component/tidbyt`);await feed(page, 'connected');
  await page.getByRole('tab', {name: 'Content', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Content', exact: true})).toHaveAttribute('aria-selected', 'true');
  await page.goto(`${world.url}/#/companions`);await feed(page, 'connected');
  await page.getByRole('link', {name: 'Open Habitat', exact: true}).click();
  await page.getByRole('heading', {name: 'Habitat', level: 1, exact: true}).waitFor();
  assert.equal(await main(page).getAttribute('data-glass'), null, `${label}: Habitat is not a glass page`);
}

const report: Record<string, unknown> = {journey: 'devices-glass', physical: false};
try {
  // Every page draws the wash and its panels, follows them and rests; text keeps 4.5:1 in light and dark.
  const contrasts: Record<string, number> = {};
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: scheme});
    const {page, sent, errors} = await open(context, PAGES[0].hash, PAGES[0].ready);
    for (const target of PAGES) {
      if (new URL(page.url()).hash !== target.hash) {await page.goto(`${world.url}/${target.hash}`);await feed(page, 'connected');await target.ready(page).waitFor();}
      await expect(main(page)).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
      const label = `${scheme}/${target.name}`;
      report[`${label}/panels`] = await followsBoxes(page, label);
      assert.equal(await layer(page).getAttribute('data-glass-backdrop'), '', `${label}: the layer draws the Quiet glass wash, with no artwork`);
      assert.deepEqual((await surfaces(page)).filled, [], `${label}: the card surfaces are see-through over the glass`);
      const still = await rest(page);await page.waitForTimeout(1500);
      assert.equal(await frames(page), still, `${label}: nothing draws at rest`);
      const visibleVeils = await veils(page);
      assert.ok(visibleVeils <= 12, `${label}: a few veils, well under the layer's 32 (${String(visibleVeils)})`);
      const measured = await contrast(page);
      assert.ok(measured.runs > 3 && measured.glyphs > 0, `${label}: text runs were measured`);
      assert.deepEqual(measured.inkless, [], `${label}: every text run in the window has visible ink`);
      contrasts[label] = Math.round(measured.min * 100) / 100;
      assert.ok(measured.min >= 4.5, `${label}: text over the glass layer keeps 4.5:1 (lowest ${measured.min.toFixed(2)}: ${measured.worst})`);
      await shot(page, `1440-${scheme}-${target.name}`);
      for (const width of [390, 320]) {
        await page.setViewportSize({width, height: 844});await followsBoxes(page, `${label} at ${String(width)}px`);
        const narrow = await contrast(page);
        assert.deepEqual(narrow.inkless, [], `${label} at ${String(width)}px: every text run in the window has visible ink`);
        contrasts[`${label}/${String(width)}`] = Math.round(narrow.min * 100) / 100;
        assert.ok(narrow.min >= 4.5, `${label} at ${String(width)}px: text over the glass layer keeps 4.5:1 (lowest ${narrow.min.toFixed(2)}: ${narrow.worst})`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} fits ${String(width)}px`);
        await shot(page, `${String(width)}-${scheme}-${target.name}`);
      }
      await page.setViewportSize({width: 1440, height: 900});
    }
    // A page that grows below the window draws no frame (#1950): a Pixoo page's content changes size as its records
    // arrive, and without a GPU each frame holds the main thread. Content added at the end of the page, out of view,
    // changes no glass that can be seen.
    await page.goto(`${world.url}/#/module/pixoo/playlists`);await feed(page, 'connected');await PAGES[3].ready(page).waitFor();
    await page.setViewportSize({width: 1440, height: 500});
    const grown = await rest(page);
    await page.locator('#main [data-glass-panel]').last().evaluate(panel => {const filler = document.createElement('div');filler.style.blockSize = '400px';filler.dataset['filler'] = '';panel.append(filler);});
    await page.waitForTimeout(1000);
    assert.equal(await rest(page), grown, `${scheme}: a page that grows below the window draws no frame`);
    await page.locator('[data-filler]').evaluate(node => {node.remove();});
    await page.setViewportSize({width: 1440, height: 900});
    // Scrolling the directory moves the glass with the cards, then it rests again.
    await page.goto(`${world.url}/#/devices`);await feed(page, 'connected');await PAGES[0].ready(page).waitFor();
    await page.setViewportSize({width: 1024, height: 600});await page.mouse.wheel(0, 300);await followsBoxes(page, `${scheme}: scrolled`);
    // A window resize draws one frame, after the page has settled, and software rendering draws at most about a million
    // pixels, as on Home (#1967).
    for (const [width, height] of [[2560, 1000], [1440, 900]] as const) {
      const settled = await rest(page);await page.setViewportSize({width, height});await followsBoxes(page, `${scheme}: ${String(width)}px`);
      assert.equal(await frames(page) - settled, 1, `${scheme}: one window resize to ${String(width)}px draws one frame`);
    }
    const backing = await layer(page).evaluate(node => ({software: (node as HTMLCanvasElement).dataset['glassSoftware'] !== undefined, pixels: (node as HTMLCanvasElement).width * (node as HTMLCanvasElement).height}));
    if (backing.software) assert.ok(backing.pixels <= 252_000, `software rendering draws at most 250,000 pixels (${String(backing.pixels)})`);
    report['software'] = backing.software;
    // The popout keeps its own fill over the glass; expanding a brand moves no panel.
    const menu = await openDeviceMenu(page);await menu.getByRole('menuitem', {name: 'Nanoleaf', exact: true}).click();
    assert.notEqual(await page.locator('.device-menu').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'the popout has its own fill');
    await followsBoxes(page, `${scheme}: menu open`);await shot(page, `1440-${scheme}-menu`);
    await page.keyboard.press('Escape');
    // Leaving the glass pages releases the layer.
    await page.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link', {name: 'Rooms', exact: true}).click();
    await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
    assert.deepEqual([await main(page).getAttribute('data-glass'), await layer(page).count()], [null, 0], 'a page without glass has no layer');
    assert.deepEqual(sent, [], `${scheme}: drawing, browsing and the menu send no command`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  report['contrast'] = contrasts;

  // A page opened from the phone drawer is drawn as it rests (#1950 review): the drawer, a veil, slides shut after the
  // page has been read, so the layer must read it again once it has. A redraw from scratch at rest, through a lost and
  // restored context, must change nothing. Home is checked the same way.
  const drawer = await browser.newContext({viewport: {width: 390, height: 760}, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'light'});
  const phone = await open(drawer, '#/rooms', ready => ready.getByRole('region', {name: 'Rooms', exact: true}), 390, 760);
  const redrawn = async (selector: string, root: string, label: string): Promise<void> => {
    const canvas = phone.page.locator(selector);
    await expect(phone.page.locator(root)).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
    const count = (): Promise<number> => canvas.evaluate(node => Number((node as HTMLElement).dataset['glassFrames'] ?? 0));
    let before = await count();
    for (let attempt = 0; attempt < 120; attempt += 1) {await phone.page.waitForTimeout(500);const after = await count();if (after === before) break;before = after;}
    const resting = await sharp(await phone.page.screenshot()).raw().toBuffer();
    const lose = await canvas.evaluateHandle(node => (node as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null);
    await lose.evaluate(extension => {extension?.loseContext();});
    await expect(phone.page.locator(root)).toHaveAttribute('data-glass', 'quiet');
    await lose.evaluate(extension => {extension?.restoreContext();});
    await expect(phone.page.locator(root)).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
    before = await count();
    for (let attempt = 0; attempt < 120; attempt += 1) {await phone.page.waitForTimeout(500);const after = await count();if (after === before) break;before = after;}
    const again = await sharp(await phone.page.screenshot()).raw().toBuffer();
    let differing = 0;
    for (let index = 0; index < resting.length; index += 3) if (Math.abs((resting[index] ?? 0) - (again[index] ?? 0)) + Math.abs((resting[index + 1] ?? 0) - (again[index + 1] ?? 0)) + Math.abs((resting[index + 2] ?? 0) - (again[index + 2] ?? 0)) > 20) differing += 1;
    report[`fromDrawer/${label}`] = differing;
    assert.ok(differing <= 20, `${label}: a redraw at rest changes nothing (${String(differing)} pixels changed)`);
    await shot(phone.page, `390-light-${label}`);
  };
  const viaDrawer = async (choose: () => Promise<void>): Promise<void> => {
    await phone.page.goto(`${world.url}/#/rooms`);await feed(phone.page, 'connected');await phone.page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
    await phone.page.getByRole('button', {name: 'Open navigation', exact: true}).click();await phone.page.locator('.shell>aside').waitFor();
    await choose();
  };
  const primary = phone.page.getByRole('navigation', {name: 'Main navigation', exact: true});
  await viaDrawer(async () => {
    await primary.getByRole('button', {name: 'Devices', exact: true}).click();
    await phone.page.getByRole('menuitem', {name: 'All devices', exact: true}).click();await PAGES[0].ready(phone.page).waitFor();
  });
  await redrawn('#main > .glass-layer', '#main', 'directory-from-drawer');
  await viaDrawer(async () => {await primary.getByRole('link', {name: 'Companions', exact: true}).click();await PAGES[1].ready(phone.page).waitFor();});
  await redrawn('#main > .glass-layer', '#main', 'companions-from-drawer');
  await phone.page.reload();await feed(phone.page, 'connected');await PAGES[1].ready(phone.page).waitFor();
  await redrawn('#main > .glass-layer', '#main', 'companions-reloaded');
  await viaDrawer(async () => {await primary.getByRole('link', {name: 'Home', exact: true}).click();await phone.page.getByRole('region', {name: 'Home', exact: true}).waitFor();});
  await redrawn('.home-layout .glass-layer', '.home-layout', 'home-from-drawer');
  assert.deepEqual(phone.sent, [], 'opening pages from the drawer and redrawing send no command');
  assert.deepEqual(phone.errors, []);await drawer.close();

  // A forced context loss leaves Quiet glass panels that work, and a restored context draws again.
  const lost = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  const losing = await open(lost, '#/devices', PAGES[0].ready);
  await expect(main(losing.page)).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  const lose = await losing.page.evaluateHandle(() => document.querySelector<HTMLCanvasElement>('#main > .glass-layer')?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null);
  await lose.evaluate(extension => {extension?.loseContext();});
  await expect(main(losing.page)).toHaveAttribute('data-glass', 'quiet');
  assert.equal(await layer(losing.page).getAttribute('data-glass-fallback'), 'lost');
  assert.deepEqual((await surfaces(losing.page)).clear, [], 'after a lost context every card shows its Quiet glass panel');
  await shot(losing.page, '1440-lost-context');
  await lose.evaluate(extension => {extension?.restoreContext();});
  await expect(main(losing.page)).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});await followsBoxes(losing.page, 'restored context');
  await lose.evaluate(extension => {extension?.loseContext();});
  await expect(main(losing.page)).toHaveAttribute('data-glass', 'quiet');
  await controlsWork(losing.page, 'lost context');
  assert.deepEqual(losing.sent, [], 'a lost context and the controls used after it send no command');
  assert.deepEqual(losing.errors, []);await lost.close();report['contextLoss'] = true;

  // Without WebGL 2 the pages keep their Quiet glass panels and work.
  const plain = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  await plain.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {configurable: true, writable: true,
      value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {return kind === 'webgl2' ? null : original.call(this, kind, ...rest);}});
  });
  const fallback = await open(plain, '#/devices', PAGES[0].ready);
  await expect(layer(fallback.page)).toHaveAttribute('data-glass-fallback', 'no-webgl2');
  assert.equal(await main(fallback.page).getAttribute('data-glass'), 'quiet');
  assert.deepEqual((await surfaces(fallback.page)).clear, [], 'without WebGL 2 every card shows its Quiet glass panel');
  assert.equal(await fallback.page.locator('.shell').evaluate(node => getComputedStyle(node).backgroundImage === 'none'), false, 'the shell keeps its wash');
  await shot(fallback.page, '1440-no-webgl2');
  await controlsWork(fallback.page, 'no WebGL 2');
  assert.deepEqual(fallback.sent, [], 'without WebGL 2 the controls used send no command');
  assert.deepEqual(fallback.errors, []);await plain.close();report['noWebgl2'] = true;

  console.log(JSON.stringify(report));
} finally {await browser.close();await world.close();}
