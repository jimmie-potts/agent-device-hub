import assert from 'node:assert/strict';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import {errorType} from '@jimmie-potts/sdk';
import type {Locator, Page} from 'playwright';

/** What the page showed when a step failed: the route, the feed and the Library, preview and Settings state (Hub #1900). */
type PageState = Record<string, unknown>;

/** Reads the parts of the page the journey depends on, in a short bounded read; a page that cannot answer says so. */
async function pageState(page: Page): Promise<PageState | string> {
  const read = page.evaluate(() => {
    const text = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const buttons = (root: Element | null): string[] => [...(root?.querySelectorAll('button') ?? [])]
      .map(button => `${text(button)}${button.disabled ? '(disabled)' : ''}`);
    const library = document.querySelector('section[aria-label="Pixoo library"]');
    const row = [...(library?.querySelectorAll('tr') ?? [])].find(item => item.textContent?.includes('Synthetic 1001-frame animation'));
    const editor = document.querySelector('aside[aria-label="Selected media"]');
    const settings = document.querySelector('[aria-label="Pixoo settings"]');
    return {
      route: location.hash,
      feed: document.querySelector('main#main')?.getAttribute('data-feed') ?? 'no main',
      library: library === null ? 'absent' : [...library.querySelectorAll(':scope > [role="status"], :scope > p[role="status"]')].map(text).filter(Boolean),
      row: row === undefined ? 'absent' : buttons(row),
      preview: editor === null ? 'absent' : {
        status: [...editor.querySelectorAll('[role="status"], [role="alert"]')].map(text),
        frames: /\d+ frames?/.exec(editor.textContent ?? '')?.[0] ?? 'none',
        canvas: editor.querySelector('canvas[aria-label="Effective preview"]') !== null,
        buttons: buttons(editor).filter(name => /preview/i.test(name)),
      },
      settings: settings === null ? 'absent' : text(settings),
    };
  });
  const bounded = new Promise<string>(resolve => setTimeout(() => resolve('the page did not answer within 2 s'), 2000).unref());
  return Promise.race([read, bounded]).catch((error: unknown) => `the page could not be read (${errorType(error)})`);
}

/** Inspect the long import in the normal library, then read the configured route in Settings. */
export async function capturePixooCommandLimits(t: CaptureContext): Promise<void> {
  const page = t.page as Page;
  // A failed step names itself, its action and locator, the last step that completed, the types of the page's uncaught
  // errors and what the page showed, so a timeout in hosted CI identifies the missed transition (Hub #1900). Waits and
  // assertions are unchanged. As ADR 0012's safe errors require, an exception is named by its type and stays the cause;
  // its message is never quoted. The capture reason keeps 500 characters, so the page state comes last.
  let last = 'none';
  const uncaught: string[] = [];
  page.on('pageerror', error => {uncaught.push(errorType(error));});
  const step = async <T>(label: string, action: string, target: Locator | string, run: () => Promise<T>): Promise<T> => {
    try {
      const value = await run();
      last = label;
      return value;
    } catch (error) {
      const state = await pageState(page);
      const errors = uncaught.length === 0 ? 'no uncaught page error' : `uncaught page errors ${JSON.stringify(uncaught.slice(0, 3))}${uncaught.length > 3 ? ` and ${uncaught.length - 3} more` : ''}`;
      const text = `${label}: ${action} ${String(target)} failed after "${last}" (${errorType(error)}); ${errors}; page ${JSON.stringify(state)}`;
      t.note(text);
      throw new Error(text, {cause: error});
    }
  };
  await step('Open the Pixoo library', 'goto', '/#/module/pixoo/library', () => page.goto(new URL('/#/module/pixoo/library', t.url).href));
  const connected = page.locator('main#main[data-feed="connected"]');
  await step('Wait for the connected feed', 'waitFor', connected, () => connected.waitFor());
  await page.evaluate(() => {
    const label = document.createElement('div'), cursor = document.createElement('div');
    label.id = 'pixoo-demo-action'; label.textContent = 'Synthetic demo · Pixoo Library'; cursor.id = 'pixoo-demo-cursor';
    Object.assign(label.style, {position: 'fixed', left: '12px', bottom: '12px', padding: '10px', background: '#111827', color: 'white', zIndex: '10000', pointerEvents: 'none'});
    Object.assign(cursor.style, {position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    cursor.setAttribute('aria-hidden', 'true'); document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 11}px`; cursor.style.top = `${event.clientY - 11}px`;});
  });
  const click = (control: Locator, label: string): Promise<void> => step(label, 'click', control, async () => {
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
  });
  const waitFor = (target: Locator, label: string): Promise<void> => step(label, 'waitFor', target, () => target.waitFor());
  const long = page.getByRole('row').filter({hasText: 'Synthetic 1001-frame animation'});
  await click(long.getByRole('button', {name: /Inspect/}), 'Inspect the 1,001-frame animation');
  await t.expect('the library preview displays the complete animation', async () => {
    await waitFor(page.getByText(/1001 frames/), 'Read the preview frame count');
    await waitFor(page.locator('canvas[aria-label="Effective preview"]'), 'See the preview canvas');
  });
  await click(page.getByRole('button', {name: 'Animate preview'}), 'Animate the library preview');
  await waitFor(page.getByRole('button', {name: 'Pause preview'}), 'See the preview animating');
  // Device settings is linked from the Pixoo's Display view (Hub #1950).
  await click(page.getByRole('navigation', {name: 'pixoo pages'}).getByRole('link', {name: 'Display', exact: true}), 'Open the Pixoo display');
  await click(page.getByRole('navigation', {name: 'Display links'}).getByRole('link', {name: 'Device settings', exact: true}), 'Read the configured playback route');
  const settings = page.getByRole('region', {name: 'Pixoo settings'});
  await t.expect('Settings names the direct command and its documented frame limit', async () => {
    await waitFor(settings.getByText('Direct raw frames', {exact: true}), 'Read the direct command');
    await waitFor(settings.getByText('Up to 59 on Draw/SendHttpGif', {exact: true}), 'Read the frame limit');
    await waitFor(settings.getByText('One delay for the whole animation', {exact: true}), 'Read the delay rule');
  });
}
