import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';

/** Real Home and the authenticated selected rendition behind it, using only the scenario's synthetic artwork. */
export async function captureSharedArt(t: CaptureContext, artworkId: string): Promise<void> {
  const page = t.page as Page;page.setDefaultTimeout(15_000);
  await page.goto(new URL('/#/', t.url).href);await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.evaluate(() => {
    const label = document.createElement('div');label.id = 'shared-art-label';label.textContent = 'Synthetic shared-art review. Physical displays remain unverified.';
    Object.assign(label.style, {position: 'fixed', bottom: '12px', left: '12px', padding: '12px', background: '#111827', color: '#fff', border: '2px solid #fbbf24', zIndex: '9999'});
    document.body.append(label);
  });
  // Clear Home (#1930) draws the presented art as its backdrop, with the art's controls as chips in the hero.
  const backdrop = page.locator('[data-art-backdrop="ready"]');await backdrop.waitFor({state: 'attached'});
  await t.expect('Home\'s backdrop decodes the exact retained selection after newer art and restart', async () => {
    assert.equal(await backdrop.getAttribute('data-artwork'), artworkId);
  });
  await page.locator('#shared-art-label').evaluate(node => {node.textContent = 'One retained idea is drawn behind the real Home. Device results are independent; physical visibility is unverified.';});
  await page.waitForTimeout(1500);
  await page.locator('#shared-art-label').evaluate(node => {node.textContent = 'Synthetic review complete. Capturing a full-page still. Physical visibility remains unverified.';});
  await page.waitForTimeout(1000);
}
