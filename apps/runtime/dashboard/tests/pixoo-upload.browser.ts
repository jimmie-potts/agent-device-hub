// Ordinary media addition through the real shared shell and tracked Pixoo import, with synthetic media only.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import sharp from 'sharp';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  const bytes = await sharp(randomBytes(128 * 128 * 3), {raw: {width: 128, height: 128, channels: 3}}).png().toBuffer();
  assert.ok(bytes.byteLength > 16_384, 'ordinary input exceeds the JSON command body limit');
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page);
    let uploadUrl: string | undefined;
    page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/pixoo/upload')) uploadUrl = request.url();});
    await page.goto(`${world.url}/#/module/pixoo/library`); await feed(page, 'connected');
    const file = page.getByLabel('Media file', {exact: true}); await file.waitFor();
    assert.equal((await world.pixooMedia()).items.length, 0);
    assert.equal(sent.length, 0);
    await file.setInputFiles({name: 'Synthetic upload.png', mimeType: 'image/png', buffer: bytes});
    assert.equal(sent.length, 0, 'choosing a file stages nothing');
    const upload = page.getByRole('button', {name: 'Add media', exact: true});
    await upload.focus(); await upload.press('Enter');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    await page.getByRole('cell', {name: 'Synthetic upload.png', exact: true}).waitFor();
    const saved = await world.pixooMedia(); assert.equal(saved.items.length, 1);
    assert.equal(sent.length, 1); assert.equal(world.pixooState().sent, 0);
    await page.getByRole('button', {name: 'Inspect Synthetic upload.png', exact: true}).click();
    const preview = page.getByRole('img', {name: 'Effective preview', exact: true});
    await preview.waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Effective preview"]');
      return image?.width === 64 && image.height === 64 && image.getContext('2d')?.getImageData(0, 0, 1, 1).data[3] === 255;
    });
    assert.equal(sent.length, 1, 'selection and referenced preview send no command');
    assert.equal(world.pixooState().sent, 0);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    await page.reload(); await feed(page, 'connected');
    await file.waitFor(); assert.equal(await file.inputValue(), ''); assert.equal(sent.length, 1, 'reload never resends or retains a file');
    assert.notEqual(uploadUrl, undefined);
    const repeated = await page.evaluate(async ({url, values}) => {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/octet-stream', 'bunny-request': '1'}, body: new Uint8Array(values)});
      await response.arrayBuffer(); return response.status;
    }, {url: uploadUrl as string, values: [...bytes]});
    assert.equal(repeated, 200);
    assert.deepEqual(await world.pixooMedia(), saved, 'an identical request does not import again');
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await page.getByText('Read-only access.', {exact: true}).waitFor();
    assert.equal(await file.count(), 0);
    assert.equal(await world.readonlyUpload(bytes), 403);
    assert.deepEqual(await world.pixooMedia(), saved);
    assert.equal(world.pixooState().sent, 0); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-upload', inputBytes: bytes.byteLength, imports: 1, reusedRequest: true, readOnlyRefused: true, displayWrites: 0, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
