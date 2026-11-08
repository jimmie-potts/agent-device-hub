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
    await page.setContent('<label>Native selection baseline<select><option value="first">First</option><option value="last">Last</option></select></label>');
    const nativeSelect = page.getByRole('combobox', {name: 'Native selection baseline'});
    await nativeSelect.focus(); await nativeSelect.press('End');
    const nativeKeyboardSelection = await nativeSelect.inputValue() === 'last';
    const sent = changes(page), reads: string[] = [];
    page.on('request', request => {if (new URL(request.url()).pathname === '/modules/nanoleaf/content/music-preview') reads.push(request.url());});
    await page.goto(`${world.url}/#/audio`); await feed(page, 'connected');
    // The Music lighting card links the same page while no reactive preset is saved, so take the workspace's own link.
    await page.locator('p', {hasText: 'Compare generated examples in the Wall page.'}).getByRole('link', {name: 'Music effect preview', exact: true}).click();
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
      await preview.getByRole('combobox', {name: 'Built-in effect', exact: true}).selectOption(effect);
      if (effect === 'bass-pulse') {
        const halfLife = preview.getByRole('slider', {name: 'Pulse half-life', exact: true});
        await halfLife.focus(); await halfLife.press('Home'); await expect(halfLife).toHaveValue('100');
        await halfLife.press('End'); await expect(halfLife).toHaveValue('2000');
        await expect(halfLife).toHaveAttribute('aria-valuetext', '2000 milliseconds');
      }
      if (effect === 'spectrum' || effect === 'traveling-wave') {
        const direction = preview.getByRole('combobox', {name: 'Direction', exact: true});
        await expect(direction).toHaveJSProperty('tagName', 'SELECT'); await direction.focus();
        if (nativeKeyboardSelection) await direction.press('End');
        else await direction.selectOption('counterclockwise');
        await expect(direction).toHaveValue('counterclockwise'); await direction.focus(); await expect(direction).toBeFocused();
        await direction.press('Tab'); await expect(direction).not.toBeFocused(); await expect(direction).toHaveValue('counterclockwise');
      }
      if (effect === 'traveling-wave') {
        const cycle = preview.getByRole('slider', {name: 'Wave cycle', exact: true});
        await cycle.focus(); await cycle.press('Home'); await expect(cycle).toHaveValue('400');
        await cycle.press('End'); await expect(cycle).toHaveValue('10000');
        await expect(cycle).toHaveAttribute('aria-valuetext', '10000 milliseconds');
      }
      for (const model of ['lines-demo-v1', 'nl22-demo-v1']) {
        await preview.getByRole('combobox', {name: 'Example layout', exact: true}).selectOption(model);
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

    await preview.getByRole('combobox', {name: 'Built-in effect', exact: true}).selectOption('traveling-wave');
    let startedRead: (() => void) | undefined, releaseRead: (() => void) | undefined;
    const started = new Promise<void>(resolve => {startedRead = resolve;});
    const held = new Promise<void>(resolve => {releaseRead = resolve;});
    await page.route('**/modules/nanoleaf/content/music-preview?*', async route => {
      const response = await route.fetch(); assert.equal(response.status(), 200);
      startedRead?.(); await held; await route.fulfill({response});
    }, {times: 1});
    await preview.getByRole('button', {name: 'Preview', exact: true}).click(); await started;
    const cycle = preview.getByRole('slider', {name: 'Wave cycle', exact: true});
    await cycle.focus(); await cycle.press('Home');
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
    for (const theme of ['default', 'applied'] as const) {
      await page.evaluate(theme => localStorage.setItem('bunny.art-theme.v1', JSON.stringify(theme === 'default'
        ? {version: 1, mode: 'default'} : {version: 1, mode: 'locked', palette: ['#0b6e4f', '#d26a22']})), theme);
      await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
      if (theme === 'applied') await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
      for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
        await page.emulateMedia({colorScheme, reducedMotion: 'reduce'}); await page.setViewportSize({width, height: 1000});
        for (const effect of ['traveling-wave', 'bass-pulse']) {
          await preview.getByRole('combobox', {name: 'Built-in effect', exact: true}).selectOption(effect);
          const motion = preview.getByRole('slider', {name: effect === 'bass-pulse' ? 'Pulse half-life' : 'Wave cycle', exact: true});
          await motion.focus(); await motion.press('End'); await expect(motion).toBeFocused();
          await prepare();
          const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert.deepEqual(axe.violations.map(item => item.id), [], `${theme}/${colorScheme}/${String(width)}/${effect}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
          if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: join(receipts, `music-preview-${theme}-${colorScheme}-${String(width)}-${effect}.png`), fullPage: true});}
        }
      }
    }
    const beforeExit = reads.length;
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
    await expect(preview).toHaveCount(0);
    await page.goto(`${world.url}/#/module/nanoleaf/wall`); await feed(page, 'connected');
    await preview.locator('summary').click(); await expect(preview.locator('figure')).toHaveCount(0);
    assert.equal(reads.length, beforeExit); assert.equal(sent.length, 0); assert.deepEqual(outputState(), before); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'synthetic-music-preview', effects: 5, exampleModels: 2,
      explicitReads: reads.length, commands: 0, deviceChanges: 0, physical: false, localScrub: true, lateDraftFence: true,
      reconnect: 'explicit only', reader: 200, anonymous: 401, motionEdits: true, appliedArt: true, reducedMotion: true, nativeKeyboardSelection, axe: ['light/dark desktop', '390px', '320px']})}\n`);
  } finally {await context.close(); await world.close();}
}
