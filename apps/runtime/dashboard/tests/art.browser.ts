// Real art owner, authenticated browser routes and private disposable storage. Only synthetic providers are reachable.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, expect, type Page} from 'playwright/test';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {changes, feed, startWorld} from './harness.ts';
import {artSelectionJourney} from './art-selection-journey.ts';
import {artScheduleJourney} from './art-schedule-journey.ts';

await artScheduleJourney();
await artSelectionJourney();

const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
const noOverflow = async (page: Page): Promise<void> => {assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'art must not create horizontal scrolling');};
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, reducedMotion: 'reduce'}), page = await context.newPage();
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
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations, [], `art gallery axe at ${width}`);
    await page.screenshot({path: join(artifacts, `art-gallery-${theme}-${width}.png`), fullPage: true});
  }
  // Provider loss is spent uncertainty, no inferred successful generation or automatic retry.
  world.art.act('lose-next');await create.click();await expect(page.locator('[data-art-job]').first()).toContainText('uncertain');
  const uncertainCalls = world.art.state().imageCalls;
  await page.reload();await feed(page, 'connected');await expect(create).toBeEnabled();assert.equal(world.art.state().imageCalls, uncertainCalls);
  await expect(page.getByRole('region', {name: 'Art allowance'})).toContainText('Uncertain');
  // Reserve a Home row through the existing layout owner; image changes never change its order.
  await page.setViewportSize({width: 1440, height: 1100});await page.getByRole('link', {name: /^Home/}).first().click();
  const edit = page.getByRole('button', {name: 'Edit Home', exact: true});await expect(edit).toBeEnabled();
  await edit.click();await page.getByRole('button', {name: 'Add card', exact: true}).click();
  await page.getByRole('button', {name: 'Add Art', exact: true}).click();await page.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();await expect(edit).toBeEnabled();
  const art = page.locator('[data-home-card="art"]'), controls = art.getByRole('group', {name: 'Art placement'});
  await expect(art.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');
  const order = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card')));
  const savedGeometry = () => page.locator('[data-home-card]:not([data-home-card="art"])').evaluateAll(nodes => nodes.map(node => {const r = node.getBoundingClientRect();return [node.getAttribute('data-home-card'), r.x, r.y, r.width, r.height];}));
  await edit.focus();const beforeArrival = await savedGeometry();
  const creator = await context.newPage();await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
  await creator.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await creator.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
  await creator.getByLabel('What would you like to see?', {exact: true}).fill('Synthetic focus preservation');
  await creator.getByRole('button', {name: 'Create art', exact: true}).click();await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');
  await expect.poll(() => world.art.state().imageCalls).toBe(uncertainCalls + 1);
  await expect(edit).toBeFocused();assert.deepEqual(await savedGeometry(), beforeArrival, 'image arrival preserves functional geometry and focused control');
  await creator.close();
  const afterArrivalCalls = world.art.state().imageCalls;
  const layoutStart = sent.length;
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1100});
    if (width <= 600) await expect(page.locator('.home-layout')).toHaveClass(/home-phone/);
    else await expect(page.locator('.home-layout')).not.toHaveClass(/home-phone/);
    await expect(art).toBeVisible();
    for (const shape of ['banner', 'square', 'tall']) {
      await controls.getByRole('combobox', {name: 'Art shape'}).selectOption(shape);
      await expect(controls.getByRole('combobox', {name: 'Art shape'})).toBeEnabled();
      await expect(art.locator('[data-art-format]')).toHaveAttribute('data-art-format', shape);await noOverflow(page);
      const frame = await art.locator('.art-image-frame').boundingBox();assert.ok(frame !== null && frame.height >= 75, 'wrapped mobile controls leave a usable art image');
      await art.screenshot({path: join(artifacts, `art-shape-${width}-${shape}.png`)});
    }
    await page.screenshot({path: join(artifacts, `art-home-${width}.png`), fullPage: true});
  }
  assert.ok(sent.slice(layoutStart).every(path => path.endsWith('/home-layout-set')), 'shape changes send only layout commands');
  assert.equal(world.art.state().imageCalls, afterArrivalCalls, 'layout does not generate');
  await page.setViewportSize({width: 1440, height: 1100});assert.deepEqual(await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card'))), order);
  await controls.getByRole('button', {name: 'Dismiss art widget'}).click();await expect(art).toHaveCount(0);
  await page.reload();await feed(page, 'connected');await expect(art).toHaveCount(0);
  await page.getByRole('button', {name: 'Restore art widget'}).click();await expect(art).toBeVisible();
  await world.restart();await page.reload();await feed(page, 'connected');await expect(art).toBeVisible();assert.equal(world.art.state().imageCalls, afterArrivalCalls, 'restart does not replay art');
  // Automatic placement uses only a free trailing rectangle and freezes during interaction.
  await edit.click();
  const hideNames = await page.getByRole('button', {name: /^Hide /}).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  for (const name of hideNames) {
    if (name === null || name === 'Hide Art') continue;
    const button = page.getByRole('button', {name, exact: true});if (await button.isEnabled()) await button.click();
  }
  await page.getByRole('button', {name: 'Done', exact: true}).click();await expect(edit).toBeEnabled();
  await controls.getByRole('button', {name: 'Unpin art', exact: true}).click();await expect(art).toHaveCount(0);
  await page.getByRole('heading', {name: 'Home', exact: true}).click();
  const automatic = page.locator('[data-art-placement="automatic"] .home-art-box');await expect(automatic).toBeVisible();
  const automaticCommands = sent.length, beforePointer = await automatic.boundingBox();assert.ok(beforePointer !== null);
  const editBox = await page.getByRole('heading', {name: 'Home', exact: true}).boundingBox();assert.ok(editBox !== null);
  await page.mouse.move(editBox.x + 8, editBox.y + 8);await page.mouse.down();await page.setViewportSize({width: 1440, height: 300});
  assert.deepEqual(await automatic.boundingBox(), beforePointer, 'active pointer freezes automatic geometry');
  await page.mouse.up();await page.getByRole('heading', {name: 'Home', exact: true}).click();await expect(automatic).toHaveCount(0);
  assert.equal(sent.length, automaticCommands, 'free-space fitting and omission send no commands');
  await page.setViewportSize({width: 1440, height: 1100});await expect(automatic).toBeVisible();
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations, [], 'Home art accessibility');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log(`Art browser passed; synthetic screenshots: ${artifacts}`);
} finally {world.art.act('release');await browser.close();await world.close();}
