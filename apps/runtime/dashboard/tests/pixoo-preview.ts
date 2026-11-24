// The Pixoo preview's bitmap lifetime (Hub #1900): a bitmap is never drawn after it is closed, and every decoded bitmap
// is closed exactly once. The real Preview component runs in a page of its own with a stand-in content reader, a stand-in
// decoder whose bitmaps record their draws and closes, and the preview's frame timer held by the test. The page never
// reaches a server.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext, Page} from 'playwright';

/** The preview's frame delay. The stand-in holds only timers of this length, so React's own scheduling is untouched. */
const DELAY_MS = 777;
const FRAMES = 3;
const RENDITION = 'a'.repeat(64);

type Probe = {
  /** Mounts the preview, or unmounts it with `false`. */
  render(mounted: boolean): void;
  /** Delivers the held frame read for `frame`, if any; with `tick`, fires the held frame timer in the same task. */
  deliver(frame: number | undefined, tick: boolean): Promise<void>;
  held(): {reads: number[]; timers: number};
  bitmaps(): {frame: number; closes: number; drawsAfterClose: number}[];
  errors: string[];
};

export async function checkPixooPreview(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {Preview} from '../../../../modules/pixoo/src/frontend/preview.tsx';
    const probe = window.pixooPreviewProbe = {errors: []};
    window.addEventListener('error', event => { probe.errors.push(event.error?.name ?? 'error'); });
    // Stand-in bitmaps: drawing one after close() throws, as Chromium's detached ImageBitmap does.
    const made = [];
    window.createImageBitmap = async blob => {
      const bitmap = {frame: blob.frame, closes: 0, drawsAfterClose: 0, width: 64, height: 64,
        close() { this.closes += 1; }};
      made.push(bitmap);
      return bitmap;
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
      if (made.includes(image)) {
        if (image.closes > 0) { image.drawsAfterClose += 1; throw new DOMException('The image source is detached', 'InvalidStateError'); }
        return;
      }
      return draw.call(this, image, ...rest);
    };
    // The preview's frame timer is held until the test fires it; every other timer runs as usual.
    const timers = new Map(); let next = 0;
    const nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => {
      if (delay !== ${DELAY_MS}) return nativeSet(handler, delay, ...args);
      next += 1; timers.set(-next, handler); return -next;
    };
    window.clearTimeout = id => { if (!timers.delete(id)) nativeClear(id); };
    const reads = new Map();
    const preview = {renditionId: '${RENDITION}', width: 64, height: 64, frameCount: ${FRAMES}, durationMs: ${DELAY_MS * FRAMES},
      frames: Array.from({length: ${FRAMES}}, (_, index) => ({index, delayMs: ${DELAY_MS}})), warnings: []};
    const api = {
      read: async () => preview,
      image: path => new Promise(resolve => { reads.set(Number(path.slice(path.lastIndexOf('.') + 1)), resolve); }),
    };
    const root = createRoot(document.getElementById('root'));
    probe.render = mounted => flushSync(() => root.render(mounted ? React.createElement(Preview, {api, renditionId: '${RENDITION}', active: true}) : null));
    probe.held = () => ({reads: [...reads.keys()], timers: timers.size});
    probe.bitmaps = () => made.map(({frame, closes, drawsAfterClose}) => ({frame, closes, drawsAfterClose}));
    // One task: the decoded frame's state update and the frame tick are both queued before React renders, so they
    // commit together. Microtasks are drained here, inside the same task, before the tick.
    probe.deliver = async (frame, tick) => {
      if (frame !== undefined) { const resolve = reads.get(frame); reads.delete(frame); resolve(Object.assign(new Blob(), {frame})); }
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      if (tick) { const [[id, handler]] = timers; timers.delete(id); handler(); }
    };
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'pixoo-preview-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const javascript = bundle.outputFiles[0].text;
  const page: Page = await context.newPage(); page.setDefaultTimeout(5000);
  const pageErrors: string[] = []; page.on('pageerror', error => { pageErrors.push(error.name); });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://preview.localhost') { await route.abort(); return; }
      if (url.pathname === '/bundle.js') await route.fulfill({contentType: 'text/javascript', body: javascript});
      else if (url.pathname === '/') await route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Pixoo preview fixture</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'});
      else await route.abort();
    });
    await page.goto('http://preview.localhost/');
    await page.waitForFunction(() => 'pixooPreviewProbe' in window);
    const call = <T>(run: (probe: Probe) => T | Promise<T>): Promise<T> =>
      page.evaluate<T>(`(${run.toString()})(window.pixooPreviewProbe)`);
    const settled = async (expected: {reads: number[]; timers: number}): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const held = await call(probe => probe.held());
        if (JSON.stringify(held) === JSON.stringify(expected)) return;
        await page.waitForTimeout(10);
      }
      assert.deepEqual(await call(probe => probe.held()), expected);
    };
    await call(probe => { probe.render(true); });
    await settled({reads: [0], timers: 0});
    await call(probe => probe.deliver(0, false));
    const canvas = page.getByRole('img', {name: 'Effective preview', exact: true});
    await canvas.waitFor();
    await page.getByRole('button', {name: 'Animate preview', exact: true}).click();
    // The tick to frame 1 starts its read; the next tick is held at once, independent of the read.
    await settled({reads: [], timers: 1});
    await call(probe => probe.deliver(undefined, true));
    await settled({reads: [1], timers: 1});
    // Frame 1's bitmap and the tick to frame 2 commit together.
    await call(probe => probe.deliver(1, true));
    await page.waitForTimeout(50);
    assert.deepEqual([pageErrors, await call(probe => probe.errors)], [[], []], 'drawing the decoded frame raised no uncaught error');
    await settled({reads: [2], timers: 1});
    // Frame 2's read is superseded: the tick to frame 0 commits first, then frame 2's decode lands.
    await call(probe => probe.deliver(undefined, true));
    await settled({reads: [2, 0], timers: 1});
    await call(probe => probe.deliver(2, false));
    await call(probe => probe.deliver(0, false));
    await page.getByRole('button', {name: 'Pause preview', exact: true}).waitFor();
    assert.equal(await canvas.count(), 1, 'the preview stays on the page');
    assert.deepEqual(await call(probe => probe.errors), [], 'no uncaught error reached the page');
    assert.deepEqual(pageErrors, [], 'no uncaught error reached the page');
    const shown = await call(probe => probe.bitmaps());
    assert.deepEqual(shown.map(bitmap => bitmap.drawsAfterClose), shown.map(() => 0), 'no bitmap is drawn after it is closed');
    assert.deepEqual(shown.map(bitmap => [bitmap.frame, bitmap.closes]), [[0, 1], [1, 1], [2, 1], [0, 0]],
      'each replaced or superseded bitmap is closed once; the shown one stays open');
    await call(probe => { probe.render(false); });
    assert.deepEqual((await call(probe => probe.bitmaps())).map(bitmap => bitmap.closes), [1, 1, 1, 1], 'unmounting closes the shown bitmap once');
  } finally { await page.close(); }
}
