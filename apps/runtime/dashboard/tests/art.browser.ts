import {namedBrowserEntry} from './failure-context.ts';
// Real art owner, authenticated browser routes and private disposable storage. Only synthetic providers are reachable.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect, type Page} from 'playwright/test';
import {openJourneyContext} from './browser-context.ts';
import type {HomeArrangements} from '@jimmie-potts/event-contracts/v2/families';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {changes, feed, startWorld} from './harness.ts';
import {artSelectionJourney} from './art-selection-journey.ts';
import {artScheduleJourney} from './art-schedule-journey.ts';
import {artNoticeJourney} from './art-notice-journey.ts';
import {artShowJourney} from './art-show-journey.ts';
import {artBackdropJourney} from './art-backdrop-journey.ts';
import {destinationLink} from './navigation-helpers.ts';

await namedBrowserEntry(artScheduleJourney);
await namedBrowserEntry(artNoticeJourney);
await namedBrowserEntry(artSelectionJourney);
await namedBrowserEntry(artShowJourney);
await namedBrowserEntry(artBackdropJourney);

const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
const noOverflow = async (page: Page): Promise<void> => {assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'art must not create horizontal scrolling');};
try {
  const context = await openJourneyContext(browser, {viewport: {width: 1440, height: 1100}, reducedMotion: 'reduce'}), page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent = changes(page);
  await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
  await expect(page.getByRole('heading', {name: 'Art Gallery', exact: true})).toBeVisible();
  const create = page.getByRole('button', {name: 'Create art', exact: true});await expect(create).toBeEnabled();
  for (const name of ['Browser', 'Tidbyt', 'Pixoo']) await expect(page.getByRole('checkbox', {name, exact: true})).toBeChecked();
  assert.equal(world.art.state().imageCalls, 0, 'opening the gallery never generates artwork');
  await page.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await page.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
  await page.getByLabel('What would you like to see?', {exact: true}).fill('A synthetic moon and garden');
  world.art.act('hold');await create.click();
  await expect.poll(() => world.art.state().pending).toBe(1);
  await expect(page.locator('[data-art-job]').first()).toContainText('running');
  assert.equal(await page.locator('[data-art-image-state="ready"]').count(), 0, 'admission does not claim a decoded artwork');
  world.art.act('release');
  const selected = page.getByRole('region', {name: 'Selected artwork'}), tiles = page.locator('[data-gallery-art]');
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');await expect(tiles).toHaveCount(1);
  await expect(page.locator('[data-art-job]').first()).toContainText('succeeded');
  const first = await selected.locator('.art-image').getAttribute('data-artwork');assert.ok(first !== null && first !== '');
  const firstCalls = world.art.state().imageCalls;
  await tiles.first().getByRole('button', {name: 'Favorite', exact: true}).click();await expect(tiles.first().getByRole('button', {name: 'Unfavorite', exact: true})).toBeEnabled();
  await tiles.first().getByRole('button', {name: 'More like this', exact: true}).click();await expect(tiles.first()).toContainText('Feedback: more');
  assert.equal(world.art.state().imageCalls, firstCalls, 'favorite and feedback never call providers');
  await tiles.first().getByRole('button', {name: 'Vary', exact: true}).click();
  await expect(page.getByLabel('What would you like to see?', {exact: true})).toBeFocused();
  await page.getByLabel('What would you like to see?', {exact: true}).fill('Add a second synthetic moon');
  await page.getByRole('button', {name: 'Create variation', exact: true}).click();await expect(tiles).toHaveCount(2);
  await expect(page.locator('[data-art-job]').first()).toContainText('succeeded');
  await page.getByRole('button', {name: 'Cancel variation', exact: true}).click();
  // Pagination through the real numeric cursor; each explicit request makes exactly one selected composition.
  for (let i = 0; i < 5; i += 1) {
    await create.click();await expect.poll(() => world.art.state().imageCalls).toBe(firstCalls + 2 + i);
    await expect(page.locator('[data-art-job]').first()).toContainText('succeeded');
  }
  await expect(tiles).toHaveCount(6);await expect(page.getByRole('button', {name: 'Next art', exact: true})).toBeEnabled();
  const beforeRevisit = world.art.state().imageCalls, beforeRevisitCommands = sent.length;
  await page.getByRole('button', {name: 'Next art', exact: true}).click();await expect(tiles).toHaveCount(1);
  await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-artwork', first);
  await expect(selected).toBeFocused();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');
  assert.equal(sent.length, beforeRevisitCommands);assert.equal(world.art.state().imageCalls, beforeRevisit, 'gallery revisit is a read, not reuse or generation');
  // A selected image is replaced only after decode. A late obsolete fetch cannot win selection.
  await page.getByRole('button', {name: 'Previous art', exact: true}).click();await expect(tiles).toHaveCount(6);
  const newest = await tiles.first().getAttribute('data-gallery-art');assert.ok(newest !== null);
  let releaseImage: (() => void) | undefined;
  const heldImage = new Promise<void>(resolve => {releaseImage = resolve;});
  await page.route('**/modules/art/content/rendition.*', async route => {await heldImage;await route.continue();});
  await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'loading');
  await expect(selected.locator('.art-image')).toHaveAttribute('data-artwork', first);
  await page.getByRole('button', {name: 'Next art', exact: true}).click();await expect(tiles).toHaveCount(1);
  await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  releaseImage?.();await page.unrouteAll({behavior: 'wait'});
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');
  await expect(selected.locator('.art-image')).toHaveAttribute('data-artwork', first);
  // Preserve the previous complete image when selected bytes fail decoding.
  await page.getByRole('button', {name: 'Previous art', exact: true}).click();await expect(tiles).toHaveCount(6);
  await page.route('**/modules/art/content/rendition.*', route => route.fulfill({status: 200, contentType: 'image/webp', body: 'invalid synthetic bytes'}));
  await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'unavailable');
  await expect(selected.locator('.art-image')).toHaveAttribute('data-artwork', first);
  await page.unroute('**/modules/art/content/rendition.*');
  await page.getByRole('button', {name: 'Next art', exact: true}).click();await expect(tiles).toHaveCount(1);
  await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');
  // A malformed read keeps the existing collection and offers an explicit read retry.
  await page.route('**/modules/art/content/catalog?*', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"artworks":[{}],"nextAfter":null}'}));
  await page.getByRole('button', {name: 'Refresh gallery', exact: true}).click();await expect(page.getByRole('alert')).toContainText('Gallery content is unavailable');
  await expect(tiles).toHaveCount(1);assert.equal(world.art.state().imageCalls, beforeRevisit);
  await page.unroute('**/modules/art/content/catalog?*');await page.getByRole('button', {name: 'Refresh gallery', exact: true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: theme});await page.setViewportSize({width, height: 1100});await noOverflow(page);
    await page.screenshot({path: join(artifacts, `art-gallery-${theme}-${width}.png`), fullPage: true});
  }
  // Provider loss is spent uncertainty, no inferred successful generation or automatic retry.
  world.art.act('lose-next');await create.click();await expect(page.locator('[data-art-job]').first()).toContainText('uncertain');
  const uncertainCalls = world.art.state().imageCalls;
  await page.reload();await feed(page, 'connected');await expect(create).toBeEnabled();assert.equal(world.art.state().imageCalls, uncertainCalls);
  await expect(page.getByRole('region', {name: 'Art allowance'})).toContainText('Uncertain');
  // Home shows the presented art as its backdrop and the Art card's controls as hero chips (#1930); there is no Art card.
  await page.setViewportSize({width: 1440, height: 1100});await (await destinationLink(page, /^Home/)).click();
  const edit = page.getByRole('button', {name: 'Edit Home', exact: true});await expect(edit).toBeEnabled();
  const hero = page.locator('[data-hub-mode]'), chip = (name: string) => hero.getByRole('button', {name, exact: true});
  await expect(page.locator('[data-art-backdrop]')).toHaveAttribute('data-art-backdrop', 'ready');
  await expect(page.locator('[data-home-card="art"]')).toHaveCount(0);
  await expect(hero.getByRole('link', {name: 'Open Gallery', exact: true})).toHaveAttribute('href', '#/module/art/gallery');
  const geometry = () => page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => {const r = node.getBoundingClientRect();return [node.getAttribute('data-home-card'), r.x, r.y, r.width, r.height];}));
  await edit.focus();const beforeArrival = await geometry();
  const creator = await context.newPage();await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
  await creator.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await creator.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
  await creator.getByLabel('What would you like to see?', {exact: true}).fill('Synthetic focus preservation');
  await creator.getByRole('button', {name: 'Create art', exact: true}).click();await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');
  await expect.poll(() => world.art.state().imageCalls).toBe(uncertainCalls + 1);
  await expect(edit).toBeFocused();assert.deepEqual(await geometry(), beforeArrival, 'image arrival preserves card geometry and the focused control');
  await creator.close();
  const afterArrivalCalls = world.art.state().imageCalls, layoutStart = sent.length;
  // Pin and Unpin, Dismiss and Restore change only the saved art placement of this arrangement, as the Art card's did.
  const stored = async (): Promise<HomeArrangements> => page.evaluate(async () => {
    const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': {layouts: HomeArrangements}[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');return record.layouts;
  });
  const artOf = async (key: keyof HomeArrangements) => (await stored())[key].find(entry => entry.widget === 'art');
  await chip('Pin art').click();await expect(chip('Unpin art')).toBeEnabled();
  assert.deepEqual((await artOf('desktop'))?.art, {format: 'auto', pinned: true});assert.equal(await artOf('phone'), undefined, 'the phone arrangement is independent');
  await chip('Unpin art').click();await expect(chip('Pin art')).toBeEnabled();assert.deepEqual((await artOf('desktop'))?.art, {format: 'auto', pinned: false});
  await chip('Dismiss art').click();await expect(chip('Restore art')).toBeEnabled();
  assert.equal((await artOf('desktop'))?.hidden, true);
  await expect(hero.getByRole('link', {name: 'Open Gallery', exact: true})).toHaveCount(0);await expect(chip('Pin art')).toHaveCount(0);
  await page.reload();await feed(page, 'connected');await expect(chip('Restore art')).toBeEnabled();
  await page.screenshot({path: join(artifacts, 'art-home-dismissed-1440.png'), fullPage: true});
  await chip('Restore art').click();await expect(chip('Dismiss art')).toBeEnabled();assert.equal((await artOf('desktop'))?.hidden, false);
  await world.restart();await page.reload();await feed(page, 'connected');
  await expect(hero.getByRole('link', {name: 'Open Gallery', exact: true})).toBeVisible();await expect(chip('Pin art')).toBeEnabled();
  assert.deepEqual(sent.slice(layoutStart), Array.from({length: 4}, () => '/api/v2/commands/home-layout-set'), 'the art chips send only layout commands, one each');
  assert.equal(world.art.state().imageCalls, afterArrivalCalls, 'layout choices and restart never generate or replay art');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1100});await noOverflow(page);
    await page.screenshot({path: join(artifacts, `art-home-${String(width)}.png`), fullPage: true});
  }
  assert.deepEqual(errors, [], 'no browser errors');
  console.log(`Art browser passed; synthetic screenshots: ${artifacts}`);
} finally {world.art.act('release');await browser.close();await world.close();}
