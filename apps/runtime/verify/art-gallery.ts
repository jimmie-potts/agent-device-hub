import assert from 'node:assert/strict';
import type {Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';

/** Scripted synthetic UI evidence. Every transition is labelled and driven through its visible control. */
export async function captureArtGallery(t: CaptureContext): Promise<void> {
  const page = t.page as Page;
  page.setDefaultTimeout(15_000);
  await page.goto(new URL('/#/module/art/gallery', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.locator('.art-selected [data-art-image-state="ready"]').waitFor();
  await page.evaluate(() => {
    const label = document.createElement('div');label.id = 'art-demo-label';label.textContent = 'Scripted synthetic review: Art Gallery';
    Object.assign(label.style, {position: 'fixed', bottom: '12px', left: '12px', zIndex: '9999', padding: '12px', color: '#fff', background: '#111827', border: '2px solid #fbbf24'});
    const cursor = document.createElement('div');cursor.id = 'art-demo-cursor';
    Object.assign(cursor.style, {position: 'fixed', width: '22px', height: '22px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 11}px`;cursor.style.top = `${event.clientY - 11}px`;});
  });
  const click = async (target: Locator, label: string): Promise<void> => {
    const viewport = page.viewportSize();let box = await target.boundingBox();assert.ok(box !== null && viewport !== null);
    if (box.y < 0 || box.y + box.height > viewport.height) {
      await page.locator('#art-demo-label').evaluate((element, text) => {element.textContent = `Scripted synthetic review: scroll to ${text}`;}, label);
      await page.mouse.move(viewport.width - 32, viewport.height / 2);await page.waitForTimeout(350);
      await page.mouse.wheel(0, box.y - 100);await page.waitForTimeout(500);
      box = await target.boundingBox();assert.ok(box !== null);
    }
    await page.locator('#art-demo-label').evaluate((element, text) => {element.textContent = `Scripted synthetic review: ${text}`;}, label);
    await target.evaluate(element => {(element as HTMLElement).style.outline = '3px solid #fbbf24';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});await page.waitForTimeout(400);
    await page.locator('#art-demo-cursor').evaluate(element => {(element as HTMLElement).style.background = '#fbbf24';});
    await target.click();await page.waitForTimeout(650);
    await page.locator('#art-demo-cursor').evaluate(element => {(element as HTMLElement).style.background = 'transparent';});
    if (await target.count() === 1) await target.evaluate(element => {(element as HTMLElement).style.outline = '';});
  };
  const tile = page.locator('[data-gallery-art]').first();
  await click(tile.getByRole('button', {name: 'Favorite', exact: true}), 'Favorite saved artwork');
  await tile.getByRole('button', {name: 'Unfavorite', exact: true}).waitFor();
  await click(tile.getByRole('button', {name: 'More like this', exact: true}), 'Give explicit positive feedback');
  await tile.getByText(/Feedback: more/).waitFor();
  await click(tile.getByRole('button', {name: /Open artwork from/}), 'Revisit this saved artwork without generation');
  await t.expect('the real gallery presents a completely decoded saved browser composition', async () => {
    assert.equal(await page.locator('.art-selected [data-art-image-state="ready"] canvas').count(), 1);
    assert.equal(await tile.getByRole('button', {name: 'Unfavorite', exact: true}).getAttribute('aria-pressed'), 'true');
  });
  await page.waitForTimeout(1000);
}
