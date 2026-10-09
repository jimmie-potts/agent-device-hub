// Existing rendition editing and deletion through the authenticated owner, with synthetic media only.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import sharp from 'sharp';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page);
    await page.goto(`${world.url}/#/module/pixoo/library`); await feed(page, 'connected');
    assert.equal(sent.length, 0);
    const bytes = await sharp({create: {width: 64, height: 32, channels: 3, background: {r: 200, g: 20, b: 10}}}).png().toBuffer();
    await page.getByLabel('Media file', {exact: true}).setInputFiles({name: 'Landscape.png', mimeType: 'image/png', buffer: bytes});
    await page.getByRole('button', {name: 'Add media', exact: true}).click();
    await page.getByRole('cell', {name: 'Landscape.png', exact: true}).waitFor();
    const original = await world.pixooMedia(); assert.equal(original.items.length, 1);
    await page.getByRole('button', {name: 'Inspect Landscape.png', exact: true}).click();
    const fit = page.getByRole('combobox', {name: 'Fit', exact: true});
    await fit.selectOption('crop');
    await page.getByRole('combobox', {name: 'Scaling', exact: true}).selectOption('smooth');
    assert.deepEqual(await world.pixooMedia(), original, 'render settings remain a draft');
    assert.equal(sent.length, 1);
    const render = page.getByRole('button', {name: 'Render preview', exact: true});
    await render.focus(); await render.press('Enter');
    for (let attempt = 0; (await world.pixooMedia()).items.length < 2 && attempt < 100; attempt++) await delay(20);
    const rendered = await world.pixooMedia(); assert.equal(rendered.items.length, 2);
    assert.equal(sent.length, 2);
    await page.waitForFunction(() => {
      const frame = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Effective preview"]');
      const pixel = frame?.getContext('2d')?.getImageData(0, 0, 1, 1).data;
      return pixel?.[0] === 200 && pixel[1] === 20 && pixel[2] === 10 && pixel[3] === 255;
    });
    assert.equal(await page.getByRole('combobox', {name: 'Saved rendition', exact: true}).locator('option').count(), 2);
    assert.equal(world.pixooState().sent, 0, 'saving a preview never writes the display');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    await page.getByRole('link', {name: 'Use in playlist', exact: true}).click();
    await page.getByRole('heading', {name: 'Playlists', exact: true, level: 2}).waitFor();
    assert.equal(sent.length, 2, 'opening playlist selection sends no edit');
    await page.getByRole('textbox', {name: 'New playlist name', exact: true}).fill('Rendered sequence');
    await page.getByRole('button', {name: 'Create playlist', exact: true}).click();
    for (let attempt = 0; (await world.pixooPlaylists()).length === 0 && attempt < 100; attempt++) await delay(20);
    const playlist = (await world.pixooPlaylists())[0]; assert.ok(playlist);
    await page.getByRole('combobox', {name: 'Playlist', exact: true}).selectOption(playlist.id);
    const picker = page.getByRole('combobox', {name: 'Media to add', exact: true});
    const selectedRendition = rendered.items.find(item => item.renditionId !== original.items[0]?.renditionId); assert.ok(selectedRendition);
    await picker.locator('option').filter({hasText: `Landscape.png · rendition ${selectedRendition.renditionId.slice(0, 10)}`}).waitFor({state: 'attached'});
    const labels = await picker.locator('option').allTextContents();
    assert.equal(new Set(labels).size, labels.length, 'saved renditions have distinct visible choices');
    assert.equal(await picker.locator('option').count(), 3);
    const originalRendition = original.items[0]; assert.ok(originalRendition);
    await picker.selectOption(originalRendition.renditionId);
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="Selected rendition to add"] canvas');
      const pixel = canvas?.getContext('2d')?.getImageData(0, 0, 1, 1).data;
      return pixel?.[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255;
    });
    let releasePixels = (): void => {};
    const pixelsHeld = new Promise<void>(resolve => { releasePixels = resolve; });
    await page.route(`**/modules/pixoo/content/frame.${selectedRendition.renditionId}.0`, async route => {
      const response = await route.fetch(); await pixelsHeld; await route.fulfill({response});
    });
    try {
      await picker.selectOption(selectedRendition.renditionId);
      assert.equal(await page.getByRole('button', {name: 'Add selected media', exact: true}).isDisabled(), true,
        'Add waits until the selected rendition preview is ready');
    } finally { releasePixels(); }
    const selectedPreview = page.getByRole('group', {name: 'Selected rendition to add', exact: true});
    await selectedPreview.getByText(selectedRendition.renditionId, {exact: true}).waitFor();
    await selectedPreview.getByRole('img', {name: 'Effective preview', exact: true}).waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="Selected rendition to add"] canvas');
      const pixel = canvas?.getContext('2d')?.getImageData(0, 0, 1, 1).data;
      return pixel?.[0] === 200 && pixel[1] === 20 && pixel[2] === 10 && pixel[3] === 255;
    });
    await page.unroute(`**/modules/pixoo/content/frame.${selectedRendition.renditionId}.0`);
    assert.equal(sent.length, 3, 'choosing the exact saved rendition and preview sends no edit');
    await page.getByRole('button', {name: 'Add selected media', exact: true}).click();
    assert.equal(sent.length, 3, 'Add changes the draft only');
    await page.getByRole('button', {name: 'Save items', exact: true}).click();
    for (let attempt = 0; (await world.pixooPlaylists())[0]?.items.length !== 1 && attempt < 100; attempt++) await delay(20);
    assert.equal((await world.pixooPlaylists())[0]?.items[0]?.renditionId, selectedRendition.renditionId);
    assert.equal(sent.length, 4);
    await page.getByText('The saved playlist changed. Load its saved name before editing again.', {exact: true}).waitFor();
    page.once('dialog', dialog => {void dialog.accept();});
    await page.getByRole('button', {name: 'Reload saved playlist', exact: true}).click();
    page.once('dialog', dialog => {void dialog.accept();});
    await page.getByRole('button', {name: 'Delete playlist', exact: true}).click();
    for (let attempt = 0; (await world.pixooPlaylists()).length !== 0 && attempt < 100; attempt++) await delay(20);
    assert.deepEqual(await world.pixooPlaylists(), []); assert.equal(sent.length, 5);
    await page.getByRole('link', {name: 'Library', exact: true}).click();
    await page.getByRole('button', {name: 'Inspect Landscape.png', exact: true}).first().click();
    page.once('dialog', dialog => {void dialog.accept();});
    await page.getByRole('button', {name: 'Delete media', exact: true}).click();
    for (let attempt = 0; (await world.pixooMedia()).items.length !== 0 && attempt < 100; attempt++) await delay(20);
    assert.equal((await world.pixooMedia()).items.length, 0); assert.equal(sent.length, 6);
    await page.getByText('No matching media.', {exact: true}).waitFor();
    assert.equal(await page.getByRole('complementary', {name: 'Selected media', exact: true}).count(), 0);
    await page.reload(); await feed(page, 'connected'); assert.equal(sent.length, 6);
    assert.equal(world.pixooState().sent, 0); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-render-delete', requests: 6, exactRenditionAdded: true, keptOriginalRendition: true, croppedPreviewPixel: [200, 20, 10], displayWrites: 0, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
