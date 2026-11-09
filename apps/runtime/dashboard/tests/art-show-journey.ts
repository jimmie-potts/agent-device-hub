import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, expect} from 'playwright/test';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

/** Show now (Hub #1581) through the real gallery, gateway, core and simulated Tidbyt; providers are synthetic. The runtime scenario covers display sends. */
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
    const axe = await new AxeBuilder({page}).include('.art-show').analyze();assert.deepEqual(axe.violations.map(item => item.id), []);
    await page.screenshot({path: join(artifacts, 'art-show-now.png'), fullPage: true});
    // The owner attempts appear beside rule attempts on the Automation page.
    await page.goto(`${world.url}/#/automation`);await feed(page, 'connected');
    const history = page.getByRole('article', {name: 'Recent automation attempts', exact: true});
    await history.getByText('Recent attempts', {exact: true}).click();
    await expect(history.getByText('Owner art show', {exact: true})).toHaveCount(2);
    await expect(history.getByText('unsupported-capability', {exact: true})).toHaveCount(1);
    await expect(history.getByText('completed · succeeded · observed', {exact: true})).toHaveCount(1);
    assert.deepEqual(errors, []);
    console.log(`Art show browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {
    await page.screenshot({path: join(artifacts, 'art-show-failed.png'), fullPage: true});throw error;
  }
  finally {await browser.close();await world.close();}
}
