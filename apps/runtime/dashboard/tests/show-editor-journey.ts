import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import type {Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

/** Real gateway/core/module, synthetic plans and controller. No installed service or media is selected. */
export async function showEditorJourney(browser: Browser): Promise<void> {
  const world = await startWorld({nanoleaf: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
    const sent = changes(page);
    const saves: {requestId: string; target: string; data: {showId: string; expectedVersion: number; name: string; versionName: string; timeline: object}}[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/nanoleaf-show-save') {
        const value: unknown = request.postDataJSON();
        assert.ok(typeof value === 'object' && value !== null && 'requestId' in value && 'target' in value && 'data' in value);
        const body = value.data;
        assert.ok(typeof value.requestId === 'string' && typeof value.target === 'string' && typeof body === 'object' && body !== null
          && 'showId' in body && typeof body.showId === 'string' && 'expectedVersion' in body && typeof body.expectedVersion === 'number'
          && 'name' in body && typeof body.name === 'string' && 'versionName' in body && typeof body.versionName === 'string'
          && 'timeline' in body && typeof body.timeline === 'object' && body.timeline !== null);
        saves.push({requestId: value.requestId, target: value.target, data: {showId: body.showId, expectedVersion: body.expectedVersion,
          name: body.name, versionName: body.versionName, timeline: body.timeline}});
      }
    });
    const read = async (id: string, version: number): Promise<unknown> => {
      const response = await context.request.get(`${world.url}/modules/nanoleaf/content/show-version?showId=${id}&version=${String(version)}`);
      assert.equal(response.status(), 200); const value: unknown = await response.json(); await response.dispose(); return value;
    };
    await page.goto(`${world.url}/#/audio`); await feed(page, 'connected');
    await page.getByRole('link', {name: 'Decorative shows', exact: true}).click();
    const editor = page.locator('.nanoleaf-shows'); await editor.waitFor();
    await editor.getByText('Your private library is empty. Choose a starter to prepare a draft.', {exact: true}).waitFor();
    await delay(300);
    const deviceBefore = structuredClone(world.nanoleafState());
    const wallBefore = await world.nanoleafWall();
    assert.equal(sent.length, 0, 'opening the authoring page sends no command');
    const starter = editor.getByRole('button', {name: 'Use Ocean drift', exact: true});
    await starter.focus(); await starter.press('Enter');
    await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).waitFor();
    await editor.getByLabel('Show name', {exact: true}).fill('Synthetic ocean study');
    await editor.getByLabel('Version name', {exact: true}).fill('Opening');
    const cues = editor.locator('.show-cue-edit');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('35');
    await editor.getByRole('slider').fill('9000');
    await editor.getByRole('status').filter({hasText: 'Gap: no cue.'}).waitFor();
    assert.equal(sent.length, 0, 'draft edits and storyboard inspection send no command');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 1', exact: true}).waitFor();
    assert.equal(saves.length, 1); const first = saves[0]; assert.ok(first);
    assert.equal(first.target, 'shows'); assert.equal(first.data.expectedVersion, 0);
    const versionOne = await read(first.data.showId, 1);
    await editor.getByLabel('Version name', {exact: true}).fill('Quieter');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('20');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 2', exact: true}).waitFor();
    assert.equal(saves.length, 2); assert.deepEqual(await read(first.data.showId, 1), versionOne);
    await editor.getByLabel('Saved version', {exact: true}).selectOption('1');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 1', exact: true}).waitFor();
    assert.equal(await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).inputValue(), '35');
    assert.equal(await editor.getByRole('button', {name: 'Save new version', exact: true}).isDisabled(), true, 'old version cannot overwrite the newer head');
    await editor.getByLabel('Saved version', {exact: true}).selectOption('2');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 2', exact: true}).waitFor();
    await editor.getByLabel('Version name', {exact: true}).fill('Unsubmitted local change');
    await editor.getByRole('button', {name: 'Refresh show library', exact: true}).click();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change');
    assert.equal(saves.length, 2, 'refresh does not save the draft');

    // A different authenticated client wins the same head. The browser retains its local draft.
    const other = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 2, versionName: 'Other client'});
    assert.equal(other.status, 200);
    await editor.getByRole('alert').filter({hasText: 'The saved head differs from this draft.'}).waitFor();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change');
    const conflict = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 2, versionName: 'Stale client'});
    assert.equal(conflict.status, 409);
    const readonly = await fetch(`${world.url}/api/v2/commands/nanoleaf-show-save`, {method: 'POST', headers: {authorization: `Bearer ${world.readerToken}`, 'content-type': 'application/json'},
      body: JSON.stringify({target: 'shows', requestId: 'show-readonly-denied', data: {...first.data, expectedVersion: 3}})});
    assert.equal(readonly.status, 403); await readonly.arrayBuffer();
    const cross = await context.request.post(`${world.url}/api/v2/commands/nanoleaf-show-save`, {headers: {origin: 'https://unrelated.invalid', [REQUEST_HEADER]: '1'},
      data: {target: 'shows', requestId: 'show-origin-denied', data: {...first.data, expectedVersion: 3}}});
    assert.equal(cross.status(), 403); await cross.dispose();
    const malformed = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 3, audio: 'not-allowed'});
    assert.equal(malformed.status, 400);
    assert.deepEqual(world.nanoleafState(), deviceBefore, 'authoring, saves and preview leave the simulated device unchanged');
    assert.deepEqual(await world.nanoleafWall(), wallBefore, 'no device configuration or displayed task mutation');
    const receipts = process.env.DASHBOARD_RECEIPTS;
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({colorScheme}); await page.setViewportSize({width, height: 1000});
      const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`), [], `${colorScheme}/${String(width)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
      if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: join(receipts, `shows-${colorScheme}-${String(width)}.png`), fullPage: true});}
    }
    await page.reload(); await feed(page, 'connected'); await editor.waitFor();
    assert.equal(await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).count(), 0);
    assert.equal(saves.length, 2, 'reload retains only attempt identity and sends no save');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 3', exact: true}).waitFor();
    // No real send: a lost-response fixture proves the retained UI lock and no retry through reload.
    await page.route('**/api/v2/commands/nanoleaf-show-save', route => route.fulfill({status: 503, contentType: 'application/json',
      body: '{"error":{"code":"uncertain-result","retryable":false,"detail":"Synthetic lost response."}}'}), {times: 1});
    await editor.getByLabel('Version name', {exact: true}).fill('Uncertain draft');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Uncertain draft');
    assert.equal(await editor.getByRole('button', {name: 'Save new version', exact: true}).isDisabled(), true);
    await page.reload(); await feed(page, 'connected'); await editor.waitFor();
    assert.equal(await editor.getByRole('button', {name: 'Use Ocean drift', exact: true}).isDisabled(), true);
    assert.equal(saves.length, 3, 'uncertainty is not retried on reload');
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'offline-decorative-shows', browserSaveRequests: saves.length,
      immutableVersions: true, staleSave: 409, readonly: 403, crossOrigin: 403, malformed: 400, deviceChanges: 0,
      preview: 'cue storyboard only', noResend: true, axe: ['light/dark desktop', '390px', '320px']})}\n`);
  } catch (error) {
    const receipts = process.env.DASHBOARD_RECEIPTS, page = context.pages()[0];
    if (receipts !== undefined && page !== undefined) {
      await mkdir(receipts, {recursive: true});
      await page.screenshot({path: join(receipts, 'shows-failure.png'), fullPage: true});
      await writeFile(join(receipts, 'shows-failure.html'), await page.content());
    }
    throw error;
  } finally {await context.close(); await world.close();}
}
