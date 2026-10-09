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
    await page.getByRole('link', {name: 'Library', exact: true}).click();
    await page.getByRole('button', {name: 'Inspect Landscape.png', exact: true}).first().click();
    page.once('dialog', dialog => {void dialog.accept();});
    await page.getByRole('button', {name: 'Delete media', exact: true}).click();
    for (let attempt = 0; (await world.pixooMedia()).items.length !== 0 && attempt < 100; attempt++) await delay(20);
    assert.equal((await world.pixooMedia()).items.length, 0); assert.equal(sent.length, 3);
    await page.getByText('No matching media.', {exact: true}).waitFor();
    assert.equal(await page.getByRole('complementary', {name: 'Selected media', exact: true}).count(), 0);
    await page.reload(); await feed(page, 'connected'); assert.equal(sent.length, 3);
    assert.equal(world.pixooState().sent, 0); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-render-delete', requests: 3, keptOriginalRendition: true, croppedPreviewPixel: [200, 20, 10], displayWrites: 0, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
