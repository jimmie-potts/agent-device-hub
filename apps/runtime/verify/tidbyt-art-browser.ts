import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {Harness} from '../tests/scenarios/framework.js';

/** Inspect the real private rendition through its authenticated owner; this adds no product preview surface. */
export async function captureTidbytArt(t: CaptureContext, run: Harness, compositionId: string): Promise<void> {
  assert.match(compositionId, /^[0-9a-f]{64}$/);
  const page = t.page as Page, path = `/modules/tidbyt/content/art.${compositionId}`;
  page.setDefaultTimeout(10_000);
  await t.expect('the exact Tidbyt preview refuses an anonymous read', async () => {
    assert.equal((await run.gateway({as: 'anonymous', method: 'GET', path})).status, 401);
  });
  await page.goto(new URL('/', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.evaluate(path => {
    const link = document.createElement('a'); link.id = 'synthetic-tidbyt-proof'; link.href = path;
    link.textContent = 'Synthetic API review: open exact Tidbyt animation. Physical display unverified.';
    Object.assign(link.style, {position: 'fixed', top: '12px', left: '12px', zIndex: '9999', color: '#fff', background: '#111827', padding: '16px', outline: '3px solid #fbbf24'});
    document.body.append(link);
    const cursor = document.createElement('div'); cursor.id = 'synthetic-tidbyt-cursor';
    Object.assign(cursor.style, {position: 'fixed', left: '10px', top: '10px', width: '20px', height: '20px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 10}px`; cursor.style.top = `${event.clientY - 10}px`;});
  }, path);
  const link = page.locator('#synthetic-tidbyt-proof'), box = await link.boundingBox();
  assert.ok(box !== null);
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.mouse.move(20, 20);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});
  await page.waitForTimeout(500);
  await page.locator('#synthetic-tidbyt-cursor').evaluate(element => {(element as HTMLElement).style.background = '#fbbf24';});
  await page.waitForTimeout(150);
  const [response] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === path), link.click()]);
  await t.expect('the authenticated exact Tidbyt WebP loads at its declared dimensions', async () => {
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'] ?? '', /^image\/webp/);
    await page.locator('img').waitFor();
    await page.waitForFunction(() => {const image = document.querySelector('img'); return image?.complete === true && image.naturalWidth === 64 && image.naturalHeight === 32;});
  });
  await page.evaluate(() => {
    Object.assign(document.body.style, {margin: '0', minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#101827', color: '#fff', fontFamily: 'system-ui'});
    const image = document.querySelector('img');
    if (image === null) throw new Error('the exact preview image is missing');
    Object.assign(image.style, {width: '512px', height: '256px', maxWidth: '80vw', objectFit: 'contain', imageRendering: 'pixelated', background: '#000'});
    const label = document.createElement('p'); label.textContent = 'Synthetic Tidbyt art preview · physical display unverified';
    Object.assign(label.style, {position: 'fixed', top: '16px', left: '24px', right: '24px', fontSize: '24px', textAlign: 'center'});
    document.body.append(label);
    const note = document.createElement('p'); note.textContent = 'Exact module-owned 64 × 32 animation, enlarged for inspection. No live provider or device.';
    Object.assign(note.style, {position: 'fixed', bottom: '24px', left: '24px', right: '24px', textAlign: 'center'});
    document.body.append(note);
  });
  // The scenario qualifies eight 200 ms frames. Keep more than two complete loops in the recording.
  await page.waitForTimeout(3700);
}
