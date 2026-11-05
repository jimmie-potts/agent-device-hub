import assert from 'node:assert/strict';
import type {Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {deviceState, type Harness} from '../tests/scenarios/framework.js';

/** The recording uses only synthetic saved images and the actual gallery and Settings controls. */
export async function captureArtTheme(t: CaptureContext, run: Harness): Promise<void> {
  const page = t.page as Page;page.setDefaultTimeout(15_000);
  const state = run.reader.states<ArtState>('art', 'bunny/modules/art')[0]?.data;
  const artworkId = (requestId: string): string => state?.jobs.find(job => job.requestId === requestId)?.artworkId ?? assert.fail('synthetic theme artwork missing');
  const warmId = artworkId('art-theme-warm'), coolId = artworkId('art-theme-cool');
  const before = structuredClone(deviceState<{imageCalls: number; ideaCalls: number}>(run, 'art'));
  const commands: string[] = [];
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/v2/commands/')) commands.push(request.url());});
  const accent = (): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  const ready = async (id: string): Promise<void> => {await page.locator(`.art-selected [data-artwork="${id}"][data-art-image-state="ready"]`).waitFor();};
  await page.goto(new URL('/#/module/art/gallery', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();await ready(coolId);
  await page.locator('html[data-art-theme="applied"]').waitFor();
  const cool = await accent();
  await page.evaluate(() => {
    const label = document.createElement('div');label.id = 'art-theme-demo-label';label.textContent = 'Scripted synthetic review: artwork colors';
    Object.assign(label.style, {position: 'fixed', bottom: '12px', left: '12px', maxWidth: 'calc(100% - 24px)', zIndex: '9999', padding: '12px', color: '#fff', background: '#111827', border: '2px solid #fbbf24', pointerEvents: 'none'});
    const cursor = document.createElement('div');cursor.id = 'art-theme-demo-cursor';
    Object.assign(cursor.style, {position: 'fixed', width: '22px', height: '22px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 11}px`;cursor.style.top = `${event.clientY - 11}px`;});
  });
  const click = async (target: Locator, label: string): Promise<void> => {
    const viewport = page.viewportSize();let box = await target.boundingBox();assert.ok(box !== null && viewport !== null);
    if (box.y < 0 || box.y + box.height > viewport.height) {
      await page.locator('#art-theme-demo-label').evaluate((element, text) => {element.textContent = `Scripted synthetic review: scroll to ${text}`;}, label);
      await page.mouse.move(viewport.width - 32, viewport.height / 2);await page.waitForTimeout(350);
      await page.mouse.wheel(0, box.y - 100);await page.waitForTimeout(500);
      box = await target.boundingBox();assert.ok(box !== null);
    }
    await page.locator('#art-theme-demo-label').evaluate((element, text) => {element.textContent = `Scripted synthetic review: ${text}`;}, label);
    await target.evaluate(element => {(element as HTMLElement).style.outline = '3px solid #fbbf24';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});await page.waitForTimeout(400);
    await page.locator('#art-theme-demo-cursor').evaluate(element => {(element as HTMLElement).style.background = '#fbbf24';});
    await target.click();await page.waitForTimeout(650);
    await page.locator('#art-theme-demo-cursor').evaluate(element => {(element as HTMLElement).style.background = 'transparent';});
    if (await target.count() === 1) await target.evaluate(element => {(element as HTMLElement).style.outline = '';});
  };
  const open = (id: string): Locator => page.locator(`[data-gallery-art="${id}"]`).getByRole('button', {name: /Open artwork from/});
  const settings = page.getByRole('region', {name: 'Artwork colors'});
  const toSettings = (): Promise<void> => click(page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}), 'Open Settings');
  const toGallery = (): Promise<void> => click(settings.getByRole('link', {name: 'Open Art Gallery', exact: true}), 'Open Art Gallery');
  await click(open(warmId), 'Show the saved warm artwork');await ready(warmId);
  const warm = await accent();
  await t.expect('two visibly decoded artworks produce contrasting decoration', () => {assert.notEqual(warm, cool);});
  await toSettings();await click(settings.getByRole('button', {name: 'Lock current colors', exact: true}), 'Lock current colors');
  await toGallery();await click(open(coolId), 'Show the saved cool artwork while colors are locked');await ready(coolId);
  await t.expect('the warm palette stays locked while the cool artwork is visible', async () => {assert.equal(await accent(), warm);});
  await toSettings();await click(settings.getByRole('button', {name: 'Restore default', exact: true}), 'Restore default colors');
  await t.expect('restore removes the art decoration and selects the default', async () => {
    assert.equal(await page.locator('html').getAttribute('data-art-theme'), null);
    assert.equal(await page.locator('html').getAttribute('data-art-theme-mode'), 'default');
  });
  await click(settings.getByRole('button', {name: 'Follow artwork', exact: true}), 'Follow artwork again');
  await toGallery();await ready(coolId);
  await t.expect('following resumes from visible art without generation or device commands', async () => {
    assert.equal(await accent(), cool);assert.deepEqual(commands, []);
    const after = deviceState<{imageCalls: number; ideaCalls: number}>(run, 'art');
    assert.equal(after.imageCalls, before.imageCalls);assert.equal(after.ideaCalls, before.ideaCalls);
  });
  await page.locator('#art-theme-demo-label').evaluate(element => {element.textContent = 'Scripted review complete. Capturing a full-page still.';});
  await page.waitForTimeout(1000);
}
