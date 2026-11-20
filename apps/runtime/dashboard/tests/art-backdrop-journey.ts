import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect} from 'playwright/test';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {artworkOf, browserArt} from '../../../../modules/art/dist/src/frontend/model.js';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

// The dashboard's policy before #1928; the backdrop source adds no image source.
const POLICY = 'default-src \'none\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\'; frame-src \'self\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'self\'';

/**
 * The Home backdrop source (#1928): the shell receives the artwork the Art widget presents, decoded from one request for
 * its largest still; a slow or failing newer image keeps the previous one; no art, or the art module stopped, is none.
 */
export async function artBackdropJourney(): Promise<void> {
  const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
  const artifacts = await browserArtifactDirectory(), context = await browser.newContext({viewport: {width: 1440, height: 1100}});
  const page = await context.newPage(), creator = await context.newPage();page.setDefaultTimeout(10_000);
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => {errors.push(error.message);});page.on('request', request => {requests.push(request.url());});
  let release: (() => void) | undefined;
  try {
    const response = await page.goto(`${world.url}/#/`);await feed(page, 'connected');
    assert.equal(response?.headers()['content-security-policy'], POLICY, 'the dashboard policy is unchanged');
    const backdrop = page.locator('[data-art-backdrop]');
    await expect(backdrop).toHaveAttribute('data-art-backdrop', 'none');await expect(backdrop).toBeHidden();
    await creator.goto(`${world.url}/#/module/art/gallery`);await feed(creator, 'connected');
    await creator.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await creator.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
    const generate = async (): Promise<ArtworkSummary> => {
      const calls = world.art.state().imageCalls, tiles = creator.locator('[data-gallery-art]');
      const previous = await tiles.count() === 0 ? null : await tiles.first().getAttribute('data-gallery-art');
      await creator.getByLabel('What would you like to see?', {exact: true}).fill(`Synthetic backdrop example ${calls + 1}`);
      await creator.getByRole('button', {name: 'Create art', exact: true}).click();
      await expect.poll(() => world.art.state().imageCalls).toBe(calls + 1);
      await expect(creator.locator('[data-art-job]').first()).toContainText('succeeded');
      if (previous !== null) await expect(tiles.first()).not.toHaveAttribute('data-gallery-art', previous);
      const id = await tiles.first().getAttribute('data-gallery-art');assert.ok(id !== null);
      const read = await fetch(`${world.url}/modules/art/content/artwork.${id}`, {headers: {authorization: `Bearer ${world.readerToken}`}});
      assert.equal(read.status, 200);const artwork = artworkOf(await read.json());assert.ok(artwork !== undefined);
      return artwork;
    };
    const still = (artwork: ArtworkSummary) => {const art = browserArt(artwork, false);assert.ok(art !== undefined);return art;};
    const select = (artwork: ArtworkSummary): Promise<void> => world.presentArt(artwork.artworkId, still(artwork).compositionId);
    // Different colors give each artwork its own rendition.
    world.art.act('warm-colors');const first = await generate();
    world.art.act('cool-colors');const second = await generate();
    assert.notEqual(still(first).rendition.renditionId, still(second).rendition.renditionId);
    const expectShown = async (artwork: ArtworkSummary, status = 'ready'): Promise<void> => {
      await expect(backdrop).toHaveAttribute('data-art-backdrop', status);
      await expect(backdrop).toHaveAttribute('data-artwork', artwork.artworkId);
      await expect(backdrop).toHaveAttribute('data-composition', still(artwork).compositionId);
      await expect(backdrop).toHaveAttribute('data-rendition', still(artwork).rendition.renditionId);
    };
    // With no selection the backdrop follows the latest art, as the Art widget does; Home has no Art card (#1930).
    await expectShown(second);await expect(page.locator('[data-home-card="art"]')).toHaveCount(0);
    const fetched = (artwork: ArtworkSummary): number => requests.filter(url => new URL(url).pathname === `/modules/art/content/${still(artwork).rendition.ref}`).length;
    assert.equal(fetched(second), 1, 'one content request for the backdrop rendition');
    // A slow newer image keeps the previous ready image until it decodes.
    const held = new Promise<void>(resolve => {release = resolve;});
    await page.route(`**/modules/art/content/${still(first).rendition.ref}`, async route => {await held;await route.continue();});
    const earlier = fetched(first);await select(first);
    await expectShown(second, 'loading');
    release?.();await page.unrouteAll({behavior: 'wait'});
    await expectShown(first);assert.equal(fetched(first) - earlier, 1, 'one content request for the newly selected backdrop');
    // A failing newer image keeps it too.
    await page.route(`**/modules/art/content/${still(second).rendition.ref}`, route => route.fulfill({status: 200, contentType: 'image/webp', body: 'invalid synthetic bytes'}));
    await select(second);
    await expectShown(first, 'unavailable');
    await page.unrouteAll({behavior: 'wait'});
    await page.screenshot({path: join(artifacts, 'art-backdrop-home-1440.png'), fullPage: true});
    // The art module stopped mounts no source; Home still renders and nothing throws.
    await page.route('**/api/v2/modules', async route => {
      const answer = await route.fetch(), body: unknown = await answer.json();
      assert.ok(typeof body === 'object' && body !== null && 'modules' in body && Array.isArray(body.modules));
      await route.fulfill({response: answer, json: {...body, modules: body.modules.map((module: unknown) =>
        typeof module === 'object' && module !== null && 'name' in module && module.name === 'art' ? {...module, state: 'stopped'} : module)}});
    });
    await page.reload();await feed(page, 'connected');
    await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeVisible();await expect(backdrop).toHaveCount(0);
    await page.unrouteAll({behavior: 'wait'});
    const origin = new URL(world.url).origin, foreign = requests.filter(url => new URL(url).origin !== origin);
    assert.deepEqual(foreign, [], 'no request leaves the dashboard origin');
    assert.deepEqual(errors, []);
    console.log(`Art backdrop browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {await page.screenshot({path: join(artifacts, 'art-backdrop-failed.png'), fullPage: true});throw error;}
  finally {release?.();await browser.close();await world.close();}
}
