import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect} from 'playwright/test';
import {manualClock} from '../../dist/tests/support.js';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

/** Actual scheduler selection and decoded artwork over a synthetic weather service and manual runtime clock. */
export async function artNoticeJourney(): Promise<void> {
  const clock = manualClock(new Date(2026, 10, 5, 8, 0).getTime());
  const world = await startWorld({art: true, artSchedule: {clock, scheduler: clock.scheduler, choice: () => 0}});
  // Art reacts only while visible; standard-height Home rows (#1658) need a taller viewport to keep it in view.
  const browser = await chromium.launch({headless: true}), context = await browser.newContext({viewport: {width: 1440, height: 2000}});
  const page = await context.newPage(), artifacts = await browserArtifactDirectory(), errors: string[] = [];
  page.setDefaultTimeout(12_000);page.on('pageerror', error => {errors.push(error.message);});
  const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
  const read = async () => {
    const response = await fetch(`${world.url}/api/v2/automation/art`, {headers: {authorization: `Bearer ${world.readerToken}`}});
    assert.equal(response.status, 200);const value: unknown = await response.json();
    assert.ok(object(value) && value.schema === 'art-schedule/2.0' && value.id === 'art');
    const next = value.nextOpportunity;
    let nextOpportunity: {id: string; startAtMs: number} | null = null;
    if (next !== null) {
      assert.ok(object(next));const {id, startAtMs} = next;
      assert.ok(typeof id === 'string' && typeof startAtMs === 'number');nextOpportunity = {id, startAtMs};
    }
    return {weather: value.weather, nextOpportunity,
      lastOpportunityId: object(value.lastOpportunity) ? value.lastOpportunity.id : undefined};
  };
  const advance = async (ms: number): Promise<void> => {clock.advance(ms);await page.clock.fastForward(ms);clock.advance(0);};
  try {
    await page.clock.install({time: new Date(clock.now())});clock.advance(0);
    await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
    await page.getByLabel('Tidbyt', {exact: true}).uncheck();await page.getByLabel('Pixoo', {exact: true}).uncheck();
    await page.getByLabel('What would you like to see?', {exact: true}).fill('Synthetic garden for a forecast caption');
    await page.getByRole('button', {name: 'Create art', exact: true}).click();
    await expect(page.locator('[data-art-job]').first()).toContainText('succeeded');
    const artworkId = await page.locator('[data-gallery-art]').first().getAttribute('data-gallery-art');assert.ok(artworkId !== null);
    const calls = world.art.state();
    await page.goto(`${world.url}/#/automation`);await feed(page, 'connected');await page.getByRole('tab', {name: 'Art', exact: true}).click();
    const panel = page.getByRole('region', {name: 'Daily art', exact: true});
    await panel.getByLabel('Waking day starts', {exact: true}).fill('08:00');await panel.getByLabel('Waking day ends', {exact: true}).fill('23:00');
    await panel.getByLabel('Refresh ambient art', {exact: true}).uncheck();await panel.getByLabel('Allow new art generation', {exact: true}).uncheck();
    await panel.getByLabel('Use weather for art and rain forecasts', {exact: true}).check();await panel.getByLabel('Enable daily art', {exact: true}).check();
    await panel.getByRole('button', {name: 'Save art settings', exact: true}).click();await expect(panel).toContainText('Daily art settings saved.');
    await expect.poll(async () => (await read()).weather).toBe('fresh');
    const planned = (await read()).nextOpportunity;assert.ok(planned !== null);assert.ok(planned.startAtMs > clock.now() + 45_000);
    await page.goto(`${world.url}/#/`);await feed(page, 'connected');
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();await page.getByRole('button', {name: 'Add card', exact: true}).click();
    await page.getByRole('button', {name: 'Add Art', exact: true}).click();await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    const image = page.locator('[data-home-card="art"] .art-image'), notice = image.locator('.art-notice');
    await expect(image).toHaveAttribute('data-art-image-state', 'ready');await expect(image).toHaveAttribute('data-artwork', artworkId);
    await expect(notice).toHaveCount(0);
    await advance(planned.startAtMs - 45_000 - clock.now());
    await expect.poll(async () => (await read()).lastOpportunityId).toBe(planned.id);
    await expect(notice).toHaveCount(0, {timeout: 1000});
    await advance(planned.startAtMs - clock.now());
    await expect(notice).toBeVisible();await expect(notice).toHaveAttribute('data-art-opportunity', planned.id);
    await expect(notice).toContainText('Rain forecast');await expect(notice).toContainText('Chance of rain');
    await expect(notice).toContainText('separate from the imagined artwork');
    await expect(image).toHaveAttribute('data-artwork', artworkId);assert.deepEqual(world.art.state(), calls, 'saved scheduled art sends no provider request');
    const pixels = await image.locator('canvas').evaluate(node => {if (!(node instanceof HTMLCanvasElement)) throw new Error('missing-canvas');return node.toDataURL();});
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 1100});await image.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await expect(notice).toBeVisible();
      await page.screenshot({path: join(artifacts, `art-notice-${String(width)}.png`), fullPage: true});
    }
    await advance(30_001);await expect(notice).toHaveCount(0);await expect(image).toHaveAttribute('data-artwork', artworkId);
    assert.equal(await image.locator('canvas').evaluate(node => {if (!(node instanceof HTMLCanvasElement)) throw new Error('missing-canvas');return node.toDataURL();}), pixels,
      'forecast expiry removes only the factual label, preserving the decoded artwork');
    assert.deepEqual(world.art.state(), calls);assert.deepEqual(errors, []);
    await page.screenshot({path: join(artifacts, 'art-notice-expired.png'), fullPage: true});
    console.log(`Scheduled art notice browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {await page.screenshot({path: join(artifacts, 'art-notice-failed.png'), fullPage: true});throw error;}
  finally {await browser.close();await world.close();}
}
