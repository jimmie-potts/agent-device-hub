import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {expect} from 'playwright/test';
import type {Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

/** Actual disposable host and module, fixed generated input and simulated controllers only. */
export async function musicPreviewJourney(browser: Browser): Promise<void> {
  const world = await startWorld({nanoleaf: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const sent = changes(page), reads: string[] = [];
    page.on('request', request => {if (new URL(request.url()).pathname === '/modules/nanoleaf/content/music-preview') reads.push(request.url());});
    await page.goto(`${world.url}/#/audio`); await feed(page, 'connected');
    await page.getByRole('link', {name: 'Music effect preview', exact: true}).click();
    const preview = page.getByRole('region', {name: 'Music effect preview', exact: true});
    await preview.locator('summary').focus(); await preview.locator('summary').press('Enter');
    await preview.getByText('Generated input · example geometry · unsaved draft', {exact: true}).waitFor();
    await delay(250);
    const outputState = (): object => {
      const state = world.nanoleafState();
      return {...state, devices: Object.fromEntries(Object.entries(state.devices).map(([id, {reads: _reads, ...device}]) => [id, device]))};
    };
    const before = structuredClone(outputState());
    assert.equal(reads.length, 0); assert.equal(sent.length, 0);
    const ready = async (): Promise<void> => {await preview.getByText('Example colors are ready for this draft.', {exact: true}).waitFor();};
    const prepare = async (): Promise<void> => {
      const button = preview.getByRole('button', {name: 'Preview', exact: true});
      await button.focus(); await button.press('Enter'); await ready();
    };
    for (const effect of ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient']) {
      await preview.getByLabel('Built-in effect', {exact: true}).selectOption(effect);
      for (const model of ['lines-demo-v1', 'nl22-demo-v1']) {
        await preview.getByLabel('Example layout', {exact: true}).selectOption(model);
        await expect(preview.locator('figure')).toHaveCount(0);
        const count: number = reads.length; await prepare(); assert.equal(reads.length, count + 1);
        await expect(preview.getByRole('img')).toHaveCount(model === 'lines-demo-v1' ? 12 : 6);
        await expect(preview.locator('figcaption')).toContainText('Generated sample 7 of 20');
        const slider = preview.getByLabel('Sample', {exact: true});
        await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
        await expect(preview.locator('figcaption')).toContainText('Generated sample 2 of 20');
        assert.equal(reads.length, count + 1, 'scrubbing is browser-local');
      }
    }
    await preview.getByLabel('Color 1', {exact: true}).fill('#12ab34');
    await expect(preview.locator('figure')).toHaveCount(0);
    const intensity = preview.getByRole('slider', {name: 'Intensity', exact: true});
    await intensity.focus(); await intensity.press('End');
    await prepare();

    let startedRead: (() => void) | undefined, releaseRead: (() => void) | undefined;
    const started = new Promise<void>(resolve => {startedRead = resolve;});
    const held = new Promise<void>(resolve => {releaseRead = resolve;});
    await page.route('**/modules/nanoleaf/content/music-preview?*', async route => {
      const response = await route.fetch(); assert.equal(response.status(), 200);
      startedRead?.(); await held; await route.fulfill({response});
    }, {times: 1});
    await preview.getByRole('button', {name: 'Preview', exact: true}).click(); await started;
    await intensity.focus(); await intensity.press('Home');
    await expect(preview.getByRole('button', {name: 'Preparing preview…', exact: true})).toBeDisabled();
    releaseRead?.();
    await expect(preview.getByRole('button', {name: 'Preview', exact: true})).toBeEnabled();
    await expect(preview.locator('figure')).toHaveCount(0);
    await prepare();

    const beforeReconnect = reads.length;
    await page.route('**/api/sdk/v1/stream', route => route.abort()); world.dropDashboardStreams();
    await preview.getByText('Connect to request an example.', {exact: true}).waitFor();
    await expect(preview.locator('figure')).toHaveCount(0);
    await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected');
    await expect(preview.getByRole('button', {name: 'Preview', exact: true})).toBeEnabled();
    assert.equal(reads.length, beforeReconnect, 'reconnect requires another explicit read');
    await prepare();

    const query = new URLSearchParams({request: JSON.stringify({version: 1, preset: 'level-glow', palette: ['#ffffff'], intensity: 1, model: 'lines-demo-v1'})});
    const path = `${world.url}/modules/nanoleaf/content/music-preview?${query}`;
    const reader = await fetch(path, {headers: {authorization: `Bearer ${world.readerToken}`}});
    assert.equal(reader.status, 200); await reader.arrayBuffer();
    const anonymous = await fetch(path); assert.equal(anonymous.status, 401); await anonymous.arrayBuffer();

    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json',
      body: '{"error":{"code":"forbidden","retryable":false}}'}));
    const beforeReload = reads.length;
    await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    assert.equal(reads.length, beforeReload); await expect(preview.locator('figure')).toHaveCount(0);
    await page.getByText('Read-only access. Wall changes require control access.', {exact: true}).waitFor();
    await prepare();
    const receipts = process.env.DASHBOARD_RECEIPTS;
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({colorScheme, reducedMotion: 'reduce'}); await page.setViewportSize({width, height: 1000});
      const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => item.id), [], `${colorScheme}/${String(width)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
      if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: join(receipts, `music-preview-${colorScheme}-${String(width)}.png`), fullPage: true});}
    }
    const beforeExit = reads.length;
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
    await expect(preview).toHaveCount(0);
    await page.goto(`${world.url}/#/module/nanoleaf/wall`); await feed(page, 'connected');
    await preview.locator('summary').click(); await expect(preview.locator('figure')).toHaveCount(0);
    assert.equal(reads.length, beforeExit); assert.equal(sent.length, 0); assert.deepEqual(outputState(), before); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'synthetic-music-preview', effects: 5, exampleModels: 2,
      explicitReads: reads.length, commands: 0, deviceChanges: 0, physical: false, localScrub: true, lateDraftFence: true,
      reconnect: 'explicit only', reader: 200, anonymous: 401, axe: ['light/dark desktop', '390px', '320px']})}\n`);
  } finally {await context.close(); await world.close();}
}
