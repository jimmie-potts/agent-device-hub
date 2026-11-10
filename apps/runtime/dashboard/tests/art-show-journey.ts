import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect} from 'playwright/test';
import {CATALOG_PAGE_SIZE} from '../../../../modules/art/dist/src/frontend/model.js';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

/** Show now (Hub #1581), including art past the record's 24 most recent (Hub #1584), through the real gallery, gateway, core and simulated Tidbyt; providers are synthetic. The runtime scenario covers display sends. */
export async function artShowJourney(): Promise<void> {
  const world = await startWorld({art: true, tidbyt: true}), browser = await chromium.launch({headless: true});
  const artifacts = await browserArtifactDirectory(), context = await browser.newContext({viewport: {width: 1440, height: 1100}, reducedMotion: 'reduce'});
  const page = await context.newPage();page.setDefaultTimeout(15_000);
  const errors: string[] = [], shows: unknown[] = [];
  page.on('pageerror', error => {errors.push(error.message);});
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/art-show') shows.push(request.postDataJSON());});
  try {
    await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
    await page.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
    await page.getByLabel('What would you like to see?', {exact: true}).fill('A synthetic lighthouse for showing now');
    await page.getByRole('button', {name: 'Create art', exact: true}).click();
    await expect(page.locator('[data-art-job]').first()).toContainText('succeeded');
    const tile = page.locator('[data-gallery-art]').first();await expect(tile).toBeVisible();
    const artworkId = await tile.getAttribute('data-gallery-art');assert.ok(artworkId !== null);
    const panel = page.getByRole('region', {name: 'Show now', exact: true});
    await expect(panel.getByRole('checkbox', {name: 'Show on Browser', exact: true})).toBeChecked();
    const tidbyt = panel.getByRole('checkbox', {name: /^Show on Tidbyt · /});await expect(tidbyt).toBeChecked();
    const target = ((await tidbyt.getAttribute('aria-label')) ?? '').replace('Show on Tidbyt · ', '');assert.notEqual(target, '');
    for (const box of [await tidbyt.boundingBox(), await panel.getByRole('checkbox', {name: 'Show on Browser', exact: true}).boundingBox()])
      assert.ok(box !== null && box.width <= 24, 'a surface checkbox keeps its own width beside a long label; the shell keeps its 44 px touch height');
    const label = await panel.locator('label').filter({hasText: 'Tidbyt · '}).boundingBox();assert.ok(label !== null && label.height <= 48, 'the display label stays on one line');
    const calls = world.art.state().imageCalls;
    await tile.getByRole('button', {name: 'Show now', exact: true}).click();
    await expect.poll(() => shows.length).toBe(1);
    const sent = shows[0] as {target: string; requestId: string; data: {artworkId: string; targets: string[]}};
    assert.equal(sent.target, 'hub');assert.deepEqual(sent.data, {artworkId, targets: ['browser', target]}, 'one command names the artwork and its showable surfaces');
    await expect(panel.getByRole('button', {name: 'Show now', exact: true})).toBeDisabled();
    await expect(tile.getByRole('button', {name: 'Show now', exact: true})).toBeDisabled();
    const results = panel.getByRole('list', {name: 'Show results', exact: true});
    await expect(results.locator('[data-art-show-surface="browser"]')).toContainText('Waiting for the common start');
    await expect(panel.getByRole('status')).toContainText('Show handed off. Each surface has its own result below.', {timeout: 40_000});
    await expect(results.locator('[data-art-show-surface="browser"]')).toContainText('Browser selection saved; rendering is not confirmed.');
    // This harness's simulated Tidbyt declares no exact art, so the plan skips it and says so; the browser proceeds alone.
    await expect(results.locator(`[data-art-show-surface="${target}"]`)).toContainText('Not sent. Recent automation attempts on the Automation page give the reason.');
    assert.equal(world.art.state().imageCalls, calls, 'Show now never calls a provider');
    await page.screenshot({path: join(artifacts, 'art-show-now.png'), fullPage: true});
    // The owner attempts appear beside rule attempts on the Automation page.
    await page.goto(`${world.url}/#/automation`);await feed(page, 'connected');
    const history = page.getByRole('article', {name: 'Recent automation attempts', exact: true});
    await history.getByText('Recent attempts', {exact: true}).click();
    await expect(history.getByText('Owner art show', {exact: true})).toHaveCount(2);
    await expect(history.getByText('unsupported-capability', {exact: true})).toHaveCount(1);
    await expect(history.getByText('completed · succeeded · observed', {exact: true})).toHaveCount(1);
    // Hub #1584: push the first artwork out of the art record's 24 most recent, then show it from a later gallery page.
    await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
    await page.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await page.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
    for (let index = 0; index < 24; index += 1) {
      const before = world.art.state().imageCalls, newest = await page.locator('[data-gallery-art]').first().getAttribute('data-gallery-art');
      await page.getByLabel('What would you like to see?', {exact: true}).fill(`Synthetic newer art ${index + 1}`);
      await page.getByRole('button', {name: 'Create art', exact: true}).click();
      await expect.poll(() => world.art.state().imageCalls).toBe(before + 1);
      await expect(page.locator('[data-gallery-art]').first()).not.toHaveAttribute('data-gallery-art', newest ?? '');
    }
    const catalog = await (await fetch(`${world.url}/modules/art/content/catalog?after=0&limit=100`, {headers: {authorization: `Bearer ${world.readerToken}`}})).json() as {artworks: {artworkId: string}[]};
    const position = catalog.artworks.findIndex(item => item.artworkId === artworkId);
    assert.ok(position >= 24, 'the first artwork is past the 24 most recent');
    const older = page.locator(`[data-gallery-art="${artworkId}"]`);
    const pager = page.getByRole('navigation', {name: 'Gallery pages', exact: true});
    // Page straight to the artwork's page. The previous page's tiles and Next art stay for a render after each click, so
    // the next click waits until the first tile belongs to the new page; probing tiles earlier could page past the artwork.
    const olderPage = Math.floor(position / CATALOG_PAGE_SIZE) + 1, tiles = page.locator('[data-gallery-art]');
    for (let number = 2; number <= olderPage; number += 1) {
      const shown = await tiles.first().getAttribute('data-gallery-art');assert.ok(shown !== null);
      await pager.getByRole('button', {name: 'Next art', exact: true}).click();
      await expect(pager.getByText(`Page ${number}`, {exact: true})).toBeVisible();
      await expect(tiles.first()).toHaveAttribute('data-gallery-art', catalog.artworks[(number - 1) * CATALOG_PAGE_SIZE]?.artworkId ?? '');
      assert.notEqual(await tiles.first().getAttribute('data-gallery-art'), shown);
    }
    await expect(older).toBeVisible();
    const olderShow = older.getByRole('button', {name: 'Show now', exact: true});
    await expect(olderShow).toBeEnabled();
    await expect(panel.getByText('Only artwork in the current art record', {exact: false})).toHaveCount(0);
    await olderShow.click();
    await expect.poll(() => shows.length).toBe(2);
    const resent = shows[1] as {target: string; data: {artworkId: string; targets: string[]}};
    assert.deepEqual(resent.data, {artworkId, targets: ['browser', target]}, 'older retained art is sent like recent art');
    await expect(results.locator('[data-art-show-surface="browser"]')).toContainText('Waiting for the common start');
    await expect(results.locator('[data-art-show-surface="browser"]')).toContainText('Browser selection saved; rendering is not confirmed.', {timeout: 40_000});
    await expect(panel.getByRole('status')).toContainText('Show handed off. Each surface has its own result below.');
    await page.screenshot({path: join(artifacts, 'art-show-older.png'), fullPage: true});
    assert.deepEqual(errors, []);
    console.log(`Art show browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {
    await page.screenshot({path: join(artifacts, 'art-show-failed.png'), fullPage: true});throw error;
  }
  finally {await browser.close();await world.close();}
}
