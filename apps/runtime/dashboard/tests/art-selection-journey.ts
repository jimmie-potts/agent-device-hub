import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect} from 'playwright/test';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {artworkOf, browserArt} from '../../../../modules/art/dist/src/frontend/model.js';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

/** Saved-art selection through the existing core control; all generation uses the synthetic provider. */
export async function artSelectionJourney(): Promise<void> {
  const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
  const artifacts = await browserArtifactDirectory(), context = await browser.newContext({viewport: {width: 1440, height: 1100}});
  const page = await context.newPage(), creator = await context.newPage();page.setDefaultTimeout(10_000);
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  let releaseMetadata: (() => void) | undefined;
  try {
    await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
    await creator.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await creator.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
    const generate = async (): Promise<ArtworkSummary> => {
      const calls = world.art.state().imageCalls;
      const tiles = creator.locator('[data-gallery-art]'), previous = await tiles.count() === 0 ? null : await tiles.first().getAttribute('data-gallery-art');
      await creator.getByLabel('What would you like to see?', {exact: true}).fill(`Synthetic selection example ${calls + 1}`);
      await creator.getByRole('button', {name: 'Create art', exact: true}).click();
      await expect.poll(() => world.art.state().imageCalls).toBe(calls + 1);
      await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');
      await expect(creator.locator('[data-gallery-art]').first()).toBeVisible();
      if (previous !== null) await expect(tiles.first()).not.toHaveAttribute('data-gallery-art', previous);
      const id = await creator.locator('[data-gallery-art]').first().getAttribute('data-gallery-art');assert.ok(id !== null);
      const response = await fetch(`${world.url}/modules/art/content/artwork.${id}`, {headers: {authorization: `Bearer ${world.readerToken}`}});
      assert.equal(response.status, 200);const value: unknown = await response.json(), artwork = artworkOf(value);assert.ok(artwork !== undefined);
      return artwork;
    };
    const select = async (artwork: ArtworkSummary): Promise<void> => {
      const image = browserArt(artwork);assert.ok(image !== undefined);
      await world.presentArt(artwork.artworkId, image.compositionId);
    };
    world.art.act('warm-colors');const first = await generate();
    world.art.act('cool-colors');const second = await generate();
    await page.goto(`${world.url}/#/`);await feed(page, 'connected');
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await page.getByRole('button', {name: 'Add card', exact: true}).click();await page.getByRole('button', {name: 'Add Art', exact: true}).click();
    await page.getByRole('button', {name: 'Close', exact: true}).click();await page.getByRole('button', {name: 'Done', exact: true}).click();
    const image = page.locator('[data-home-card="art"] .art-image');
    const colors = () => page.evaluate(() => {
      const probe = document.createElement('span');probe.style.visibility = 'hidden';document.body.append(probe);
      const values = ['--accent', '--panel', '--bg'].map(role => {probe.style.color = `var(${role})`;return getComputedStyle(probe).color;});
      probe.remove();return values;
    });
    const settledFrame = () => page.evaluate(() => new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});}));
    const pixels = () => image.locator('canvas').evaluate(node => {
      if (!(node instanceof HTMLCanvasElement)) throw new Error('missing-art-canvas');
      return node.toDataURL();
    });
    await expect(image).toHaveAttribute('data-art-image-state', 'ready');
    await expect(image).toHaveAttribute('data-artwork', second.artworkId, {timeout: 10_000});
    await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
    const secondColors = await colors(), beforeSelection = world.art.state();
    await select(first);
    await expect(image).toHaveAttribute('data-artwork', first.artworkId, {timeout: 10_000});
    await expect.poll(colors).not.toEqual(secondColors);const firstColors = await colors();
    assert.deepEqual(world.art.state(), beforeSelection, 'selecting saved art never calls either provider');
    // Push both selected candidates outside the bounded 24-record state snapshot.
    let latest = second;
    for (let index = 0; index < 25; index += 1) latest = await generate();
    await expect(image).toHaveAttribute('data-artwork', first.artworkId);
    await page.reload();await feed(page, 'connected');
    await expect(image).toHaveAttribute('data-art-image-state', 'ready');await expect(image).toHaveAttribute('data-artwork', first.artworkId);
    await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');await expect.poll(colors).toEqual(firstColors);
    const settledCalls = world.art.state();
    const previousPixels = await pixels(), previousColors = await colors();
    // Retain the decoded bitmap while selected metadata is pending; a superseded reply cannot replace it.
    const held = new Promise<void>(resolve => {releaseMetadata = resolve;});
    let intercepted = false;
    await page.route(`**/modules/art/content/artwork.${second.artworkId}`, async route => {intercepted = true;await held;await route.continue();});
    await select(second);await expect.poll(() => intercepted).toBe(true);
    await expect(image).toHaveAttribute('data-art-image-state', 'loading');await expect(image).toHaveAttribute('data-artwork', first.artworkId);
    assert.equal(await pixels(), previousPixels, 'pending metadata retains the actual decoded pixels');
    await settledFrame();assert.deepEqual(await colors(), previousColors, 'pending selected metadata cannot replace the visible palette');
    await expect(image.getByRole('img')).toBeVisible();await page.screenshot({path: join(artifacts, 'art-selection-metadata-loading.png'), fullPage: true});
    await select(latest);await expect(image).toHaveAttribute('data-artwork', latest.artworkId);await expect(image).toHaveAttribute('data-art-image-state', 'ready');
    await expect.poll(colors).toEqual(secondColors);
    assert.ok(releaseMetadata !== undefined);releaseMetadata();await page.unrouteAll({behavior: 'wait'});
    await expect(image).toHaveAttribute('data-artwork', latest.artworkId);
    await select(first);await expect(image).toHaveAttribute('data-artwork', first.artworkId);await expect(image).toHaveAttribute('data-art-image-state', 'ready');
    await expect.poll(colors).toEqual(firstColors);const retainedPixels = await pixels();
    // Missing metadata never silently substitutes the latest item; preserve the actual prior image and truthful status.
    await page.route(`**/modules/art/content/artwork.${second.artworkId}`, route => route.fulfill({status: 404, contentType: 'application/json', body: '{}'}));
    await select(second);await expect(image).toHaveAttribute('data-art-image-state', 'unavailable');await expect(image).toHaveAttribute('data-artwork', first.artworkId);
    await expect(image).toContainText('Selected artwork is unavailable');
    assert.equal(await pixels(), retainedPixels, 'refused metadata retains the actual decoded pixels rather than the latest art');
    await settledFrame();assert.deepEqual(await colors(), firstColors, 'refused selected metadata cannot replace the visible palette');
    await page.screenshot({path: join(artifacts, 'art-selection-metadata-unavailable.png'), fullPage: true});
    await page.unrouteAll({behavior: 'wait'});
    await select(latest);await expect(image).toHaveAttribute('data-artwork', latest.artworkId);
    await select(second);await expect(image).toHaveAttribute('data-artwork', second.artworkId);await expect(image).toHaveAttribute('data-art-image-state', 'ready');
    await world.restart();await page.reload();await feed(page, 'connected');
    await expect(image).toHaveAttribute('data-artwork', second.artworkId);await expect(image).toHaveAttribute('data-art-image-state', 'ready');
    assert.deepEqual(world.art.state(), settledCalls, 'metadata reads, selection and restart never call either provider');
    assert.deepEqual(errors, []);await page.screenshot({path: join(artifacts, 'art-selection-restarted.png'), fullPage: true});
    console.log(`Art selection browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {await page.screenshot({path: join(artifacts, 'art-selection-failed.png'), fullPage: true});throw error;}
  finally {releaseMetadata?.();await browser.close();await world.close();}
}
