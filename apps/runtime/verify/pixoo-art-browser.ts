import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import type {Harness} from '../tests/scenarios/framework.js';

/** Inspect one effective decoded frame through its authenticated content route. All frames are checked by the scenario. */
export async function capturePixooArt(t: CaptureContext, run: Harness): Promise<void> {
  const page = t.page as Page;
  const composition = run.reader.states<ArtState>('art', 'bunny/modules/art')[0]?.data.candidates.find(candidate => candidate.target === 'pixoo');
  assert.ok(composition !== undefined);
  await page.goto(new URL('/', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  const path = `/modules/pixoo/content/art-frame.${composition.compositionId}.0`;
  await page.evaluate(path => {
    const link = document.createElement('a'); link.id = 'synthetic-pixoo-art'; link.href = path;
    link.textContent = 'Synthetic API acceptance: open decoded Pixoo frame. Eight frames at 200 ms; no device contact.';
    Object.assign(link.style, {position: 'fixed', top: '12px', left: '12px', zIndex: '9999', color: '#fff', background: '#111827', padding: '16px', outline: '3px solid #fbbf24'});
    document.body.append(link);
    const cursor = document.createElement('div'); cursor.id = 'synthetic-pixoo-cursor';
    Object.assign(cursor.style, {position: 'fixed', left: '10px', top: '10px', width: '20px', height: '20px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 10}px`; cursor.style.top = `${event.clientY - 10}px`;});
  }, path);
  const link = page.locator('#synthetic-pixoo-art'), box = await link.boundingBox();
  assert.ok(box !== null);
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.mouse.move(20, 20);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});
  await page.waitForTimeout(500);
  await page.locator('#synthetic-pixoo-cursor').evaluate(element => {(element as HTMLElement).style.background = '#fbbf24';});
  await link.click();
  await t.expect('the exact staged frame renders as a 64 by 64 PNG', async () => {
    await page.locator('img').waitFor();
    assert.deepEqual(await page.locator('img').evaluate(element => ({width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight})), {width: 64, height: 64});
  });
  await page.waitForTimeout(1000);
}
