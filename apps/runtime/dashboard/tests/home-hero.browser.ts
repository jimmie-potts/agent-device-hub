// Home's hero (#1930) on a disposable synthetic runtime: no installed service or device. Headless Chromium draws WebGL 2
// with SwiftShader, as the glass journey does. The journey checks that the hero shows the hub mode over a switch whose
// glass thumb stretches as it travels and then stops drawing; that the switch sends the same mode command as the card
// did and shows refused and uncertain results as before; that it works from the keyboard without sending while moving
// and that every chip takes visible focus; that the light and plug chips match the observed records and turn unknown
// when stale; that dismissed art leaves the Quiet glass wash; that a saved layout listing the Hub mode and Art cards
// loads without error, shows neither and keeps both when saved; and that without WebGL 2 the switch has a plain thumb and
// works. The forecast chip is checked by the art notice journey. With DASHBOARD_RECEIPTS set it writes private screenshots.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Locator, type Page} from 'playwright/test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {HomeArrangements, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, holdDashboardStream, startWorld} from './harness.ts';
import {lightsChip, observedPower, plugsChip} from '../src/home-hero.ts';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({lighting: true, wemo: true, art: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing']});
const report: Record<string, unknown> = {journey: 'home-hero', physical: false};

const hero = (page: Page): Locator => page.locator('[data-hub-mode]');
const segment = (page: Page, name: string): Locator => hero(page).getByRole('group', {name: 'Choose Hub mode', exact: true}).getByRole('button', {name, exact: true});
const layer = (page: Page): Locator => page.locator('.home-layout .glass-layer');
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
async function open(context: BrowserContext, width = 1440, height = 900): Promise<{page: Page; sent: string[]; errors: string[]}> {
  const page = await context.newPage();page.setDefaultTimeout(30_000);await page.setViewportSize({width, height});
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent = changes(page);
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  return {page, sent, errors};
}
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});await page.screenshot({path: join(receipts, `hero-${name}.png`)});
}
/** The chips the hero should show, by the same rules, from the device records the core serves now. */
async function expectedChips(page: Page): Promise<{lights: string | undefined; plugs: string | undefined}> {
  const records = await page.evaluate(async () => (await (await fetch('/api/v2/families/device')).json() as {records: unknown[]}).records) as DeviceRecord[];
  const now = Date.now();
  return {lights: lightsChip(records.filter(record => record.kind === 'lifx' || record.kind === 'nanoleaf').map(record => observedPower(record, true))),
    plugs: plugsChip(records.filter(record => record.kind === 'wemo').map(record => ({name: record.label ?? record.id, power: observedPower(record, true, now, 15_000)})))};
}
async function chipsMatch(page: Page, label: string): Promise<void> {
  await expect.poll(async () => {
    const expected = await expectedChips(page);
    const shown = {lights: await hero(page).locator('[data-hero-chip=lights]').textContent().catch(() => undefined) ?? undefined,
      plugs: await hero(page).locator('[data-hero-chip=plugs]').textContent().catch(() => undefined) ?? undefined};
    return JSON.stringify(shown) === JSON.stringify(expected) ? 'match' : `${JSON.stringify(shown)} vs ${JSON.stringify(expected)}`;
  }, {message: label, timeout: 20_000}).toBe('match');
}
/** Mode command bodies the page sends. */
function modeCommands(page: Page): {target: string; data: {mode: string; expectedRevision: number}}[] {
  const bodies: {target: string; data: {mode: string; expectedRevision: number}}[] = [];
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/mode-set') bodies.push(request.postDataJSON() as typeof bodies[number]);});
  return bodies;
}
const focusShown = (locator: Locator): Promise<boolean> => locator.evaluate(node => node === document.activeElement && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none');
async function stored(page: Page): Promise<{revision: number; layouts: HomeArrangements}> {
  return page.evaluate(async () => {
    const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': {revision: number; layouts: HomeArrangements}[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');return record;
  });
}

try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'no-preference'});
  const {page, sent, errors} = await open(context);
  const bodies = modeCommands(page);
  await expect(page.locator('.home-layout')).toHaveAttribute('data-glass', 'webgl', {timeout: 30_000});
  // The hero: a small label, the mode as a large word and the switch, above the cards and not one of them.
  await expect(hero(page).getByRole('heading', {name: 'Hub mode', exact: true})).toBeVisible();
  const word = hero(page).locator('.home-hero-word');await expect(word).toHaveText('Free');
  await expect(segment(page, 'Free')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await page.locator('.home-layout-grid [data-hub-mode], .home-layout-grid [data-home-card="hub-mode"], [data-home-card="art"]').count(), 0, 'neither the Hub mode nor the Art card is in the grid');
  const heroBox = await hero(page).boundingBox(), gridBox = await page.locator('.home-layout-grid').boundingBox();
  assert.ok(heroBox !== null && gridBox !== null && heroBox.y + heroBox.height <= gridBox.y + 1, 'the hero sits above the cards');
  assert.ok(Number.parseFloat(await word.evaluate(node => getComputedStyle(node).fontSize)) >= 54, 'the mode word is large');
  await shot(page, '1440-dark');

  // The chips match the observed lights and plugs.
  await chipsMatch(page, 'chips at load');
  const lampOff = page.locator('[data-home-card="light:device:lamp-a"]').getByRole('button', {name: 'Off', exact: true});
  await lampOff.click();await chipsMatch(page, 'chips after a light switched off');
  report['chips'] = await hero(page).locator('.home-hero-chips').innerText();

  // Keyboard: the switch is one Tab stop on the selected segment; arrows move without sending; Enter selects.
  await page.getByRole('heading', {name: 'Home', exact: true}).click();
  for (let step = 0; step < 12 && !await segment(page, 'Free').evaluate(node => node === document.activeElement); step += 1) await page.keyboard.press('Tab');
  assert.equal(await focusShown(segment(page, 'Free')), true, 'Tab reaches the selected segment with a visible focus ring');
  await page.keyboard.press('ArrowRight');assert.equal(await focusShown(segment(page, 'Quiet')), true);
  await page.keyboard.press('ArrowRight');assert.equal(await focusShown(segment(page, 'Work')), true, 'arrows wrap');
  await page.keyboard.press('End');assert.equal(await focusShown(segment(page, 'Quiet')), true);
  await page.keyboard.press('Home');assert.equal(await focusShown(segment(page, 'Work')), true);
  assert.equal(bodies.length, 0, 'moving through the switch sends nothing');
  // Selecting sends the hub mode command once, as the card did; the glass thumb stretches on its way and then rests.
  await rest(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.home-layout .glass-layer'), seen: string[] = [];
    (window as unknown as {thumbs: string[]}).thumbs = seen;
    const sample = (): void => {seen.push(canvas?.dataset['glassCapsules'] ?? '');if (seen.length < 240) requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
  });
  const revision = (await page.evaluate(async () => (await (await fetch('/api/v2/families/mode')).json() as {records: {revision: number}[]}).records[0]?.revision)) ?? -1;
  await page.keyboard.press('Enter');
  await expect(word).toHaveText('Work');await expect(segment(page, 'Work')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(bodies.length, 1, 'one mode command');
  assert.deepEqual({target: bodies[0]?.target, data: bodies[0]?.data}, {target: 'hub', data: {mode: 'work', expectedRevision: revision}}, 'the card\'s command: the selection and the current revision');
  const still = await rest(page);
  const box = await segment(page, 'Work').boundingBox();assert.ok(box !== null);
  const thumb = (await layer(page).getAttribute('data-glass-capsules') ?? '').split(',').map(Number);
  for (const [index, value] of [box.x, box.y, box.width, box.height, box.x, box.y, box.width, box.height].entries()) assert.ok(Math.abs((thumb[index] ?? Infinity) - value) <= 0.6, `the thumb rests on Work: ${thumb.join(',')}`);
  const samples = await page.evaluate(() => (window as unknown as {thumbs: string[]}).thumbs);
  const stretched = samples.map(value => value.split(',').map(Number)).filter(value => value.length === 8 && Math.abs((value[0] ?? 0) - (value[4] ?? 0)) > 4);
  assert.ok(stretched.length > 0, `the thumb's two capsules part while it travels: ${samples.slice(0, 12).join(' | ')}`);
  await page.waitForTimeout(2000);assert.equal(await frames(page), still, 'nothing draws once the thumb settles');
  report['thumb'] = {stretchedFrames: stretched.length, restFrames: 0};
  await shot(page, '1440-work');

  // Every chip takes keyboard focus with a visible ring.
  const reached: string[] = [];
  await segment(page, 'Work').focus();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {const active = document.activeElement;return active?.closest('[data-hub-mode]') === null ? null : active?.matches('.home-hero-chip') === true && active.matches(':focus-visible') && getComputedStyle(active).outlineStyle !== 'none' ? active.textContent : `unringed ${active?.tagName ?? ''}`;});
    if (focused === null) break;reached.push(focused ?? '');
  }
  const chipCount = await hero(page).locator('.home-hero-chip:not(:disabled)').count();
  assert.equal(reached.length, chipCount, `Tab reaches every chip: ${reached.join(', ')}`);assert.ok(reached.every(text => !text.startsWith('unringed')), reached.join(', '));
  assert.ok(reached.includes('Open Gallery') && reached.includes('Pin art') && reached.includes('Dismiss art'), reached.join(', '));
  report['chipsReached'] = reached;
  // The hero is outside the grid, so crossing between the grid and one column keeps it and its focused chip.
  const pin = hero(page).getByRole('button', {name: 'Pin art', exact: true}), heroNode = await hero(page).elementHandle();assert.ok(heroNode !== null);
  await pin.focus();
  for (const width of [375, 1440]) {
    await page.setViewportSize({width, height: width === 375 ? 812 : 900});
    await expect(page.locator('.home-layout-grid')).toHaveAttribute('data-packed', width === 375 ? 'false' : 'true');
    assert.equal(await heroNode.evaluate(node => node.isConnected), true, `the hero stays mounted at ${String(width)}`);await expect(pin).toBeFocused();
  }
  await heroNode.dispose();

  // A refused and an uncertain change show as the card showed them, and nothing is sent again.
  await page.route('**/api/v2/commands/mode-set', route => route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: {code: 'revision-conflict', retryable: false}})}), {times: 1});
  await segment(page, 'Quiet').click();
  await expect(hero(page).getByText('Not applied')).toBeVisible();await expect(hero(page).locator('.hub-control-sr')).toHaveText('Selection refused. Code: revision-conflict.');
  await expect(word).toHaveText('Work');
  await page.route('**/api/v2/commands/mode-set', route => route.abort('failed'), {times: 1});
  await segment(page, 'Quiet').click();
  await expect(hero(page).getByText('Result unknown')).toBeVisible();await expect(hero(page).locator('.hub-control-sr')).toHaveText('The reply is uncertain. The request was not sent again.');
  await page.waitForTimeout(500);assert.equal(bodies.length, 3, 'neither result is sent again');
  await shot(page, '1440-uncertain');

  // Stale copies: the switch is read-only and the chips say unknown, never off.
  const release = await holdDashboardStream(page);world.dropDashboardStreams();
  await expect(hero(page).getByText('Stale', {exact: true})).toBeVisible();await expect(segment(page, 'Free')).toBeDisabled();
  await expect(hero(page).locator('[data-hero-chip=lights]')).toHaveText(/unknown$/);await expect(hero(page).locator('[data-hero-chip=plugs]')).toHaveText(/unknown/);
  release();await feed(page, 'connected');await chipsMatch(page, 'chips after reconnecting');

  // Dismissed art leaves Home: the layer draws the Quiet glass wash and the hero offers Restore.
  const creator = await context.newPage();await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
  for (const target of ['Tidbyt', 'Pixoo']) {const check = creator.getByRole('checkbox', {name: target, exact: true});if (await check.count() > 0) await check.uncheck();}
  await creator.getByLabel('What would you like to see?', {exact: true}).fill('Synthetic hero backdrop');
  await creator.getByRole('button', {name: 'Create art', exact: true}).click();await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');await creator.close();
  const backdrop = page.locator('[data-art-backdrop]');await expect(backdrop).toHaveAttribute('data-art-backdrop', 'ready');
  const rendition = await backdrop.getAttribute('data-rendition');assert.ok(rendition !== null && rendition !== '');
  await expect(layer(page)).toHaveAttribute('data-glass-backdrop', rendition);
  await hero(page).getByRole('button', {name: 'Dismiss art', exact: true}).click();
  await expect(hero(page).getByRole('button', {name: 'Restore art', exact: true})).toBeEnabled();
  await expect(layer(page)).toHaveAttribute('data-glass-backdrop', '');
  await shot(page, '1440-art-dismissed');
  await hero(page).getByRole('button', {name: 'Restore art', exact: true}).click();
  await expect(layer(page)).toHaveAttribute('data-glass-backdrop', rendition);await expect(hero(page).getByRole('link', {name: 'Open Gallery', exact: true})).toBeVisible();
  await shot(page, '1440-art');

  // A saved layout that lists the Hub mode and Art cards loads without error, shows neither, and a save keeps them.
  const listed: HomePlacement[] = [{widget: 'hub-mode', size: 'medium', hidden: false, shape: 'large-square'}, {widget: 'art', size: 'medium', hidden: false, shape: 'wide', art: {format: 'banner', pinned: true}},
    {widget: 'sessions', size: 'medium', hidden: false, shape: 'large-square'}, {widget: 'light:device:lamp-a', size: 'small', hidden: false, shape: 'square'}];
  const before = await stored(page);
  assert.equal(await page.evaluate(async ({revision, listed}) => (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
    body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: revision, layouts: {desktop: listed, phone: listed}}})})).status, {revision: before.revision, listed}), 200);
  const loaded = await stored(page);
  await page.reload();await feed(page, 'connected');
  await expect.poll(() => page.locator('.home-layout-grid > [data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard))).toEqual(['sessions', 'light:device:lamp-a']);
  await expect(hero(page).locator('.home-hero-word')).toHaveText('Work');
  assert.equal(await page.getByText('Some saved cards are no longer registered', {exact: false}).count(), 0, 'the hero placements are not reported as unknown');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();await page.getByRole('button', {name: 'Add card', exact: true}).click();
  const picker = page.getByRole('region', {name: 'Add a card', exact: true});
  for (const name of ['Hub mode', 'Art']) await expect(picker.getByRole('button', {name: new RegExp(`^(Add|Added|Show) ${name}$`)})).toHaveCount(0);
  assert.equal(await page.locator('.home-hero-slot').evaluate(node => (node as HTMLElement).inert), true, 'editing disables the hero');
  await picker.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();await expect(page.getByText('Home layout saved.', {exact: true})).toBeVisible();
  const after = await stored(page);
  for (const key of ['desktop', 'phone'] as const) for (const id of ['hub-mode', 'art']) {
    const kept = after.layouts[key].find(entry => entry.widget === id);assert.ok(kept !== undefined, `${key} ${id}`);
    assert.deepEqual(kept, loaded.layouts[key].find(entry => entry.widget === id), `a save keeps the ${key} ${id} placement as it was`);
  }
  report['savedLayout'] = true;

  // Phone widths, light and dark: no horizontal scroll; the hero fits.
  for (const scheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: scheme});await page.setViewportSize({width, height: width === 1440 ? 900 : 844});await rest(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${String(width)} ${scheme}`);
    const fits = await hero(page).evaluate(node => [...node.querySelectorAll('button, a, .home-hero-word')].every(child => child.getBoundingClientRect().right <= innerWidth + 0.5));
    assert.ok(fits, `the hero fits ${String(width)} px in ${scheme}`);
    await shot(page, `${String(width)}-${scheme}`);
  }
  assert.ok(sent.every(path => path.endsWith('/mode-set') || path.endsWith('/home-layout-set') || path.endsWith('/power-set') || path === '/api/sdk/v1/request'), sent.join(', '));
  assert.deepEqual(errors, []);
  await context.close();

  // Without WebGL 2 the selected segment keeps a plain fill and the switch works.
  const plain = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
  await plain.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {configurable: true, writable: true,
      value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {return kind === 'webgl2' ? null : original.call(this, kind, ...rest);}});
  });
  const fallback = await open(plain), fallbackBodies = modeCommands(fallback.page);
  await expect(layer(fallback.page)).toHaveAttribute('data-glass-fallback', 'no-webgl2');
  assert.equal(await fallback.page.locator('.home-layout').getAttribute('data-glass'), 'quiet');
  const pressed = segment(fallback.page, 'Work'), idle = segment(fallback.page, 'Free');
  await expect(pressed).toHaveAttribute('aria-pressed', 'true');
  assert.notEqual(await pressed.evaluate(node => getComputedStyle(node).backgroundColor), await idle.evaluate(node => getComputedStyle(node).backgroundColor), 'the selected segment has its own plain thumb');
  await idle.click();await expect(hero(fallback.page).locator('.home-hero-word')).toHaveText('Free');
  assert.equal(fallbackBodies.length, 1);assert.equal(fallbackBodies[0]?.data.mode, 'free');
  await shot(fallback.page, '1440-no-webgl2');
  assert.deepEqual(fallback.errors, []);await plain.close();report['noWebgl2'] = true;

  console.log(JSON.stringify(report));
} finally {await browser.close();await world.close();}
