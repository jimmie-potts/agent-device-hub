import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {expect} from 'playwright/test';
import type {Browser} from 'playwright';
import {connectRemote} from '@jimmie-potts/sdk';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import {reactiveCatalog, type ReactiveCatalog} from '../../../../modules/nanoleaf/dist/src/music-preset-data.js';
import {changes, feed, startWorld} from './harness.ts';

/** Actual private gateway/core/module, synthetic recipes and simulated controllers only. */
export async function reactivePresetJourney(browser: Browser): Promise<void> {
  const world = await startWorld({nanoleaf: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const catalog = async (): Promise<ReactiveCatalog> => {
    const reader = await connectRemote({url: world.url, source: 'bunny/parts/reader', token: world.readerToken});
    try {
      const answer = await reader.sync<ReactiveCatalog>(['nanoleaf-reactive-presets'], () => {}, {owner: 'bunny/modules/nanoleaf', timeoutMs: 5000});
      assert.equal(answer.status, 'synced'); if (answer.status !== 'synced') throw new Error('Synthetic catalog sync failed.');
      return reactiveCatalog(answer.copy.states().find(message => message.data.id === 'reactive-presets')?.data);
    } finally {await reader.close();}
  };
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const sent = changes(page), saves: unknown[] = [], previews: unknown[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname === '/api/v2/commands/nanoleaf-reactive-preset-save') saves.push(request.postDataJSON());
      if (url.pathname === '/modules/nanoleaf/content/music-preview') previews.push(JSON.parse(url.searchParams.get('request') ?? 'null'));
    });
    await page.goto(`${world.url}/#/module/nanoleaf/wall`); await feed(page, 'connected');
    const preview = page.getByRole('region', {name: 'Music effect preview', exact: true});
    const library = preview.getByRole('region', {name: 'Saved reactive presets', exact: true});
    await preview.locator('summary').click(); await library.getByText('0 of 32 saved presets.', {exact: false}).waitFor();
    await delay(250); assert.equal(sent.length, 0); assert.equal(previews.length, 0);
    const output = (): object => {
      const state = world.nanoleafState();
      return {...state, devices: Object.fromEntries(Object.entries(state.devices).map(([id, {reads: _reads, ...device}]) => [id, device]))};
    };
    const before = structuredClone(output()), wallBefore = await world.nanoleafWall();
    await preview.getByRole('combobox', {name: 'Built-in effect', exact: true}).selectOption('traveling-wave');
    await preview.getByLabel('Color 1', {exact: true}).fill('#12ab34');
    await preview.getByRole('slider', {name: 'Intensity', exact: true}).fill('35');
    await library.getByLabel('New preset name', {exact: true}).fill('Synthetic wave');
    const save = library.getByRole('button', {name: 'Save new preset', exact: true});
    await expect(save).toBeEnabled(); await save.focus(); await save.press('Enter');
    await library.getByText('This named draft was saved. Change its name or recipe to save another preset.', {exact: true}).waitFor();
    assert.equal(saves.length, 1); await expect(save).toBeDisabled();
    const first = await catalog(); assert.equal(first.presets.length, 1);
    assert.equal(first.presets[0]?.recipe.palette[0], '#12ab34'); assert.equal(first.presets[0]?.recipe.intensity, 0.35);
    await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    await library.getByRole('button', {name: 'Load into draft', exact: true}).click();
    assert.equal(saves.length, 1); assert.equal(previews.length, 0);
    await expect(preview.getByLabel('Color 1', {exact: true})).toHaveValue('#12ab34');
    await expect(preview.getByRole('slider', {name: 'Intensity', exact: true})).toHaveValue('35');
    const external = {presetId: 'preset-external', expectedRevision: first.revision, name: 'Synthetic custom renderer',
      recipe: {rendererVersion: 1, effect: 'traveling-wave', palette: ['#abcdef'], intensity: 0.2,
        sensitivity: 3, smoothingMs: 900, direction: 'inward', periodMs: 9000}};
    assert.equal((await world.credentialAction('nanoleaf-reactive-preset-save', 'reactive-presets', external)).status, 200);
    const second = await catalog(); assert.equal(second.presets.length, 2); assert.deepEqual(second.presets.find(preset => preset.presetId === first.presets[0]?.presetId), first.presets[0]);
    await library.getByRole('combobox', {name: 'Saved preset', exact: true}).selectOption('preset-external');
    await library.getByRole('button', {name: 'Load into draft', exact: true}).click();
    await preview.getByText(/Sensitivity 3 · Renderer smoothing 900 ms/).waitFor();
    await preview.getByText(/Direction inward/).waitFor(); await preview.getByText(/Wave period 9000 ms/).waitFor();
    await preview.getByRole('button', {name: 'Preview', exact: true}).click();
    await preview.getByText('Example colors are ready for this draft.', {exact: true}).waitFor();
    assert.deepEqual(previews.at(-1), {version: 1, recipe: external.recipe, model: 'lines-demo-v1'});
    await library.getByLabel('New preset name', {exact: true}).fill('Retained local draft');
    await library.getByRole('button', {name: 'Refresh preset library', exact: true}).click();
    await expect(library.getByLabel('New preset name', {exact: true})).toHaveValue('Retained local draft'); assert.equal(saves.length, 1);
    const stale = await world.credentialAction('nanoleaf-reactive-preset-save', 'reactive-presets', {...external, presetId: 'preset-stale'});
    assert.equal(stale.status, 409);
    const invalid = await world.credentialAction('nanoleaf-reactive-preset-save', 'reactive-presets', {...external, presetId: 'preset-bad', expectedRevision: second.revision,
      recipe: {...external.recipe, rawAudio: 'synthetic forbidden field'}});
    assert.equal(invalid.status, 400);
    const readonly = await fetch(`${world.url}/api/v2/commands/nanoleaf-reactive-preset-save`, {method: 'POST',
      headers: {authorization: `Bearer ${world.readerToken}`, 'content-type': 'application/json'},
      body: JSON.stringify({target: 'reactive-presets', requestId: 'preset-readonly', data: {...external, expectedRevision: second.revision}})});
    assert.equal(readonly.status, 403); await readonly.arrayBuffer();
    const cross = await context.request.post(`${world.url}/api/v2/commands/nanoleaf-reactive-preset-save`, {
      headers: {origin: 'https://unrelated.invalid', [REQUEST_HEADER]: '1'},
      data: {target: 'reactive-presets', requestId: 'preset-origin', data: {...external, expectedRevision: second.revision}},
    }); assert.equal(cross.status(), 403); await cross.dispose();
    await page.route('**/api/sdk/v1/stream', route => route.abort()); world.dropDashboardStreams();
    await library.getByText(/Saving is disabled/).waitFor(); await expect(save).toBeDisabled();
    await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected');
    await expect(save).toBeEnabled(); assert.equal(saves.length, 1);
    await expect(library.getByLabel('New preset name', {exact: true})).toHaveValue('Retained local draft');
    assert.deepEqual(output(), before); assert.deepEqual(await world.nanoleafWall(), wallBefore);
    await world.restart(); await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    assert.deepEqual((await catalog()).presets, second.presets); assert.equal(saves.length, 1);
    await library.getByRole('combobox', {name: 'Saved preset', exact: true}).selectOption('preset-external');
    await library.getByRole('button', {name: 'Load into draft', exact: true}).click();
    const receipts = process.env.DASHBOARD_RECEIPTS;
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({colorScheme}); await page.setViewportSize({width, height: 1000});
      const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => item.id), [], `${colorScheme}/${String(width)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: join(receipts, `reactive-presets-${colorScheme}-${String(width)}.png`), fullPage: true});}
    }
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    await library.getByText('Read-only access. You can load saved presets; saving requires control access.', {exact: true}).waitFor();
    await expect(save).toBeDisabled(); await library.getByRole('button', {name: 'Load into draft', exact: true}).click(); assert.equal(saves.length, 1);
    await page.unroute('**/api/v2/authority?scope=control'); await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    // Lost-response fixture sends no real command. It checks draft retention, shared lock and passive reload.
    await page.route('**/api/v2/commands/nanoleaf-reactive-preset-save', route => route.fulfill({status: 503, contentType: 'application/json',
      body: '{"error":{"code":"uncertain-result","retryable":false,"detail":"Synthetic lost response."}}'}), {times: 1});
    await library.getByLabel('New preset name', {exact: true}).fill('Uncertain draft'); await expect(save).toBeEnabled(); await save.click();
    await library.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
    await expect(library.getByLabel('New preset name', {exact: true})).toHaveValue('Uncertain draft'); await expect(save).toBeDisabled();
    await page.reload(); await feed(page, 'connected'); await preview.locator('summary').click();
    await expect(save).toBeDisabled(); await expect(library.getByLabel('New preset name', {exact: true})).toBeDisabled();
    assert.equal(saves.length, 2); assert.deepEqual((await catalog()).presets, second.presets); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'reactive-presets', browserSaveRequests: saves.length, immutablePresets: true,
      restart: true, fullRecipePreview: true, stale: 409, invalid: 400, readonly: 403, origin: 403, deviceChanges: 0, noResend: true,
      axe: ['light/dark desktop', '390px', '320px'], physical: false})}\n`);
  } finally {await context.close(); await world.close();}
}
