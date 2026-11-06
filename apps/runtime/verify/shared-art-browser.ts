import assert from 'node:assert/strict';
import type {Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';

/** Real Home controls and the authenticated selected rendition, using only the scenario's synthetic artwork. */
export async function captureSharedArt(t: CaptureContext, artworkId: string): Promise<void> {
  const page = t.page as Page;page.setDefaultTimeout(15_000);
  await page.goto(new URL('/#/', t.url).href);await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.evaluate(() => {
    const label = document.createElement('div');label.id = 'shared-art-label';label.textContent = 'Synthetic shared-art review. Physical displays remain unverified.';
    Object.assign(label.style, {position: 'fixed', bottom: '12px', left: '12px', padding: '12px', background: '#111827', color: '#fff', border: '2px solid #fbbf24', zIndex: '9999'});
    const cursor = document.createElement('div');cursor.id = 'shared-art-cursor';
    Object.assign(cursor.style, {position: 'fixed', width: '24px', height: '24px', border: '3px solid #fbbf24', borderRadius: '50%', pointerEvents: 'none', zIndex: '10000'});
    document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 12}px`;cursor.style.top = `${event.clientY - 12}px`;});
  });
  const click = async (control: Locator, label: string): Promise<void> => {
    await control.waitFor();let box = await control.boundingBox();const viewport = page.viewportSize();assert.ok(box !== null && viewport !== null);
    if (box.y < 0 || box.y + box.height > viewport.height) {
      await page.locator('#shared-art-label').evaluate((node, text) => {node.textContent = `Synthetic review: scroll to ${text}`;}, label);
      await page.mouse.move(viewport.width - 32, viewport.height / 2);await page.waitForTimeout(350);
      await page.mouse.wheel(0, box.y - 100);await page.waitForTimeout(500);box = await control.boundingBox();assert.ok(box !== null);
    }
    await page.locator('#shared-art-label').evaluate((node, text) => {node.textContent = `Synthetic review: ${text}. Physical displays remain unverified.`;}, label);
    await control.evaluate(node => {(node as HTMLElement).style.outline = '3px solid #fbbf24';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});await page.waitForTimeout(350);
    await page.locator('#shared-art-cursor').evaluate(node => {(node as HTMLElement).style.background = '#fbbf24';});
    await control.click();await page.waitForTimeout(500);
    await page.locator('#shared-art-cursor').evaluate(node => {(node as HTMLElement).style.background = 'transparent';});
    if (await control.count() > 0) await control.evaluate(node => {(node as HTMLElement).style.outline = '';});
  };
  await click(page.getByRole('button', {name: 'Edit Home', exact: true}), 'Edit Home');
  await click(page.getByRole('button', {name: 'Add card', exact: true}), 'Add card');
  await click(page.getByRole('button', {name: 'Add Art', exact: true}), 'Add the saved Art widget');
  await click(page.getByRole('button', {name: 'Close', exact: true}), 'Close card picker');
  await click(page.getByRole('button', {name: 'Done', exact: true}), 'Save Home placement');
  const image = page.locator('[data-home-card="art"] [data-art-image-state="ready"]');await image.waitFor();
  const box = await image.boundingBox(), viewport = page.viewportSize();assert.ok(box !== null && viewport !== null);
  if (box.y < 0 || box.y + box.height > viewport.height) {
    await page.locator('#shared-art-label').evaluate(node => {node.textContent = 'Synthetic review: scroll to the retained selected artwork';});
    await page.mouse.move(viewport.width - 32, viewport.height / 2);await page.waitForTimeout(350);
    await page.mouse.wheel(0, box.y - 100);await page.waitForTimeout(650);
  }
  await t.expect('the Home widget decodes the exact retained selection after newer art and restart', async () => {
    assert.equal(await image.getAttribute('data-artwork'), artworkId);assert.equal(await image.locator('canvas').count(), 1);
    const shown = await image.boundingBox();assert.ok(shown !== null && shown.y < viewport.height && shown.y + shown.height > 0);
  });
  await page.locator('#shared-art-label').evaluate(node => {node.textContent = 'One retained idea is shown in the real Home widget. Device results are independent; physical visibility is unverified.';});
  await page.waitForTimeout(1500);
  await page.locator('#shared-art-label').evaluate(node => {node.textContent = 'Synthetic review complete. Capturing a full-page still. Physical visibility remains unverified.';});
  await page.waitForTimeout(1000);
}
