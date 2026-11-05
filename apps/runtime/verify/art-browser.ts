import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import type {Harness} from '../tests/scenarios/framework.js';

/** Browser inspection of an authenticated rendition. The gallery UI belongs to #682. */
export async function captureArtRendition(t: CaptureContext, run: Harness): Promise<void> {
  const page = t.page as Page;
  page.setDefaultTimeout(10_000);
  const saved = run.reader.states<ArtState>('art', 'bunny/modules/art')[0]?.data.artworks.find(art => art.favorite);
  const rendition = saved?.compositions.find(composition => composition.target === 'ui')?.renditions[0];
  assert.ok(rendition !== undefined);
  await page.goto(new URL('/', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  const path = `/modules/art/content/${rendition.ref}`;
  await page.evaluate(path => {
    const link = document.createElement('a'); link.id = 'synthetic-art-proof'; link.href = path;
    link.textContent = 'Synthetic API acceptance: open saved rendition. No live provider or device.';
    Object.assign(link.style, {position: 'fixed', top: '12px', left: '12px', zIndex: '9999', color: '#fff', background: '#111827', padding: '16px', outline: '3px solid #fbbf24'});
    document.body.append(link);
  }, path);
  const link = page.locator('#synthetic-art-proof'), box = await link.boundingBox();
  assert.ok(box !== null);
  const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
  await page.evaluate(() => {
    const cursor = document.createElement('div'); cursor.id = 'synthetic-art-cursor';
    Object.assign(cursor.style, {position: 'fixed', left: '10px', top: '10px', width: '20px', height: '20px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 10}px`; cursor.style.top = `${event.clientY - 10}px`;});
  });
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.mouse.move(20, 20);
  await page.mouse.move(point.x, point.y, {steps: reduced ? 1 : 8});
  await page.waitForTimeout(500);
  await page.locator('#synthetic-art-cursor').evaluate(element => {(element as HTMLElement).style.background = '#fbbf24';});
  await link.click();
  await t.expect('the saved synthetic WebP renders through the authenticated content owner', async () => {
    await page.locator('img').waitFor();
    assert.deepEqual(await page.locator('img').evaluate(element => ({width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight})), {width: rendition.width, height: rendition.height});
  });
  await page.waitForTimeout(1000);
}
