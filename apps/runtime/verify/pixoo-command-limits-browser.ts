import assert from 'node:assert/strict';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {Locator, Page} from 'playwright';

/** Inspect the long import in the normal library, then read the configured route in Settings. */
export async function capturePixooCommandLimits(t: CaptureContext): Promise<void> {
  const page = t.page as Page;
  await page.goto(new URL('/#/module/pixoo/library', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.evaluate(() => {
    const label = document.createElement('div'), cursor = document.createElement('div');
    label.id = 'pixoo-demo-action'; label.textContent = 'Synthetic demo · Pixoo Library'; cursor.id = 'pixoo-demo-cursor';
    Object.assign(label.style, {position: 'fixed', left: '12px', bottom: '12px', padding: '10px', background: '#111827', color: 'white', zIndex: '10000', pointerEvents: 'none'});
    Object.assign(cursor.style, {position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    cursor.setAttribute('aria-hidden', 'true'); document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 11}px`; cursor.style.top = `${event.clientY - 11}px`;});
  });
  const click = async (control: Locator, label: string): Promise<void> => {
    await page.locator('#pixoo-demo-action').evaluate((node, text) => {node.textContent = `Synthetic demo · ${text}`;}, label);
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox(); assert.ok(box);
    await control.evaluate(node => {(node as HTMLElement).style.outline = '3px solid #fbbf24';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});
    await page.waitForTimeout(450);
    await page.locator('#pixoo-demo-cursor').evaluate(node => {(node as HTMLElement).style.background = '#fbbf24';});
    await control.click();
    await page.waitForTimeout(550);
    await page.locator('#pixoo-demo-cursor').evaluate(node => {(node as HTMLElement).style.background = 'transparent';});
    if (await control.count() > 0) await control.evaluate(node => {(node as HTMLElement).style.outline = '';});
  };
  const long = page.getByRole('row').filter({hasText: 'Synthetic 1001-frame animation'});
  await click(long.getByRole('button', {name: /Inspect/}), 'Inspect the 1,001-frame animation');
  await t.expect('the library preview displays the complete animation', async () => {
    await page.getByText(/1001 frames/).waitFor();
    await page.locator('canvas[aria-label="Effective preview"]').waitFor();
  });
  await click(page.getByRole('button', {name: 'Animate preview'}), 'Animate the library preview');
  await page.getByRole('button', {name: 'Pause preview'}).waitFor();
  await click(page.getByRole('navigation', {name: 'pixoo pages'}).getByRole('link', {name: 'Settings', exact: true}), 'Read the configured playback route');
  const settings = page.getByRole('region', {name: 'Pixoo settings'});
  await t.expect('Settings names the direct command and its documented frame limit', async () => {
    await settings.getByText('Direct raw frames', {exact: true}).waitFor();
    await settings.getByText('Up to 59 on Draw/SendHttpGif', {exact: true}).waitFor();
    await settings.getByText('One delay for the whole animation', {exact: true}).waitFor();
  });
}
