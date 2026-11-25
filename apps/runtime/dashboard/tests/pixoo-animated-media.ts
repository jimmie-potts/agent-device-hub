// The Pixoo animated tile's bitmap lifetime (Hub #2133): a bitmap is never drawn after it is closed, and every decoded
// bitmap is closed exactly once. The real AnimatedMedia component runs in a page of its own with a stand-in content
// reader, a stand-in decoder whose bitmaps record their draws and closes, an always-visible intersection observer and the
// tile's frame timer held by the test. The page never reaches a server.
//
// The fault: a decoded frame's state update and a change of `active`, `animate` or the rendition commit together. The
// tile's frame-cache cleanup then closes the new frame before the canvas effect of the same commit draws it.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext, Page} from 'playwright';

// The probe's functions run in the page, so renditions are written there as 'a' and 'b' repeated 64 times.
/** The tile's frame delay. The stand-in holds only timers of this length, so React's own scheduling is untouched. */
const DELAY_MS = 777;

type Props = {renditionId: string; active: boolean; animate: boolean};
type Probe = {
  /** Renders the tile at once, or unmounts it with `undefined`. */
  render(props: Props | undefined): void;
  /**
   * In one task: delivers the held frame read `key` (`<rendition>.<frame>`), if any, drains microtasks so its decode
   * lands, fires the held frame timer with `tick`, then renders `props` without flushing, so all commit together.
   */
  deliver(key: string | undefined, tick: boolean, props?: Props): Promise<void>;
  /** Holds the decode of frame `key` until `decoded(key)` completes it. */
  holdDecode(key: string): void;
  decoded(key: string): Promise<void>;
  held(): {reads: string[]; timers: number};
  bitmaps(): {key: string; closes: number; drawsAfterClose: number}[];
  errors: string[];
};

export async function checkPixooAnimatedMedia(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {AnimatedMedia} from '../../../../modules/pixoo/src/frontend/media-picker.tsx';
    const probe = window.pixooTileProbe = {errors: []};
    window.addEventListener('error', event => { probe.errors.push(event.error?.name ?? 'error'); });
    // The tile animates only without reduced motion and while it intersects the viewport; both are held true here.
    window.matchMedia = query => ({matches: false, media: query, addEventListener() {}, removeEventListener() {}});
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(target) { queueMicrotask(() => { this.callback([{isIntersecting: true, target}]); }); }
      disconnect() {}
    };
    // Stand-in bitmaps: drawing one after close() throws, as Chromium's detached ImageBitmap does.
    const made = [], decodes = new Map();
    window.createImageBitmap = async blob => {
      if (decodes.has(blob.key)) await new Promise(resolve => { decodes.set(blob.key, resolve); });
      const bitmap = {key: blob.key, closes: 0, drawsAfterClose: 0, width: 64, height: 64,
        close() { this.closes += 1; }};
      made.push(bitmap);
      return bitmap;
    };
    probe.holdDecode = key => { decodes.set(key, undefined); };
    probe.decoded = async key => {
      const resolve = decodes.get(key); decodes.delete(key); resolve();
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
      if (made.includes(image)) {
        if (image.closes > 0) {
          image.drawsAfterClose += 1;
          const detached = new DOMException('The image source is detached', 'InvalidStateError');
          Error.captureStackTrace(detached); throw detached;
        }
        return;
      }
      return draw.call(this, image, ...rest);
    };
    // The tile's frame timer is held until the test fires it; every other timer runs as usual.
    const timers = new Map(); let next = 0;
    const nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => {
      if (delay !== ${DELAY_MS}) return nativeSet(handler, delay, ...args);
      next += 1; timers.set(-next, handler); return -next;
    };
    window.clearTimeout = id => { if (!timers.delete(id)) nativeClear(id); };
    const reads = new Map();
    const preview = renditionId => ({renditionId, width: 64, height: 64, frameCount: 2, durationMs: ${DELAY_MS * 2},
      frames: [{index: 0, delayMs: ${DELAY_MS}}, {index: 1, delayMs: ${DELAY_MS}}], warnings: []});
    const api = {
      read: async path => preview(path.slice(path.lastIndexOf('.') + 1)),
      image: path => new Promise(resolve => {
        const key = path.slice(path.indexOf('frame.') + 6).replace(/^(.)[a-f0-9]{63}/, '$1');
        reads.set(key, resolve);
      }),
    };
    const root = createRoot(document.getElementById('root'));
    const element = props => props === undefined ? null : React.createElement(AnimatedMedia, {api, label: 'Tile preview', ...props});
    probe.render = props => flushSync(() => root.render(element(props)));
    probe.held = () => ({reads: [...reads.keys()], timers: timers.size});
    probe.bitmaps = () => made.map(({key, closes, drawsAfterClose}) => ({key, closes, drawsAfterClose}));
    probe.deliver = async (key, tick, props) => {
      if (key !== undefined) { const resolve = reads.get(key); reads.delete(key); resolve(Object.assign(new Blob(), {key})); }
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      if (tick) { const [[id, handler]] = timers; timers.delete(id); handler(); }
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      if (props !== undefined) root.render(element(props));
    };
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'pixoo-animated-media-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const javascript = bundle.outputFiles[0].text;
  const page: Page = await context.newPage(); page.setDefaultTimeout(5000);
  const pageErrors: string[] = []; page.on('pageerror', error => { pageErrors.push(`${error.name}: ${error.stack ?? error.message}`); });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://tile.localhost') { await route.abort(); return; }
      if (url.pathname === '/bundle.js') await route.fulfill({contentType: 'text/javascript', body: javascript});
      else if (url.pathname === '/') await route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Pixoo tile fixture</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'});
      else await route.abort();
    });
    await page.goto('http://tile.localhost/');
    await page.waitForFunction(() => 'pixooTileProbe' in window);
    const call = <T>(run: (probe: Probe) => T | Promise<T>): Promise<T> =>
      page.evaluate<T>(`(${run.toString()})(window.pixooTileProbe)`);
    const settled = async (expected: {reads: string[]; timers: number}): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const held = await call(probe => probe.held());
        if (JSON.stringify(held) === JSON.stringify(expected)) return;
        await page.waitForTimeout(10);
      }
      assert.deepEqual(await call(probe => probe.held()), expected);
    };
    const tile = page.locator('.pixoo-thumbnail');
    const state = async (expected: string, frame: number): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await tile.getAttribute('data-preview-state') === expected && await tile.getAttribute('data-preview-frame') === String(frame)) return;
        await page.waitForTimeout(10);
      }
      assert.deepEqual([await tile.getAttribute('data-preview-state'), await tile.getAttribute('data-preview-frame')], [expected, String(frame)]);
    };
    const clean = async (step: string): Promise<void> => {
      await page.waitForTimeout(50);
      assert.deepEqual([pageErrors, await call(probe => probe.errors)], [[], []], `${step}: no uncaught error reached the page`);
      assert.equal(await tile.count(), 1, `${step}: the tile stays on the page`);
    };
    await call(probe => { probe.render({renditionId: 'a'.repeat(64), active: true, animate: true}); });
    await settled({reads: ['a.0'], timers: 0});
    // A re-read flips `active` while frame 0's decode lands: both commit together.
    await call(probe => probe.deliver('a.0', false, {renditionId: 'a'.repeat(64), active: false, animate: true}));
    await clean('active flips with a decoded frame');
    await state('still', 0);
    // Active again: frames 0 and 1 decode and animate.
    await call(probe => probe.deliver(undefined, false, {renditionId: 'a'.repeat(64), active: true, animate: true}));
    await settled({reads: ['a.0'], timers: 0});
    await call(probe => probe.deliver('a.0', false));
    await state('animating', 0);
    await settled({reads: [], timers: 1});
    await call(probe => probe.deliver(undefined, true));
    await settled({reads: ['a.1'], timers: 0});
    await call(probe => probe.deliver('a.1', false));
    await state('animating', 1);
    await clean('frames decode');
    // The tick back to cached frame 0 and a pause of the animation commit together.
    await call(probe => probe.deliver(undefined, true, {renditionId: 'a'.repeat(64), active: true, animate: false}));
    await clean('a cached frame shows as the animation pauses');
    await settled({reads: ['a.0'], timers: 0});
    await call(probe => probe.deliver('a.0', false));
    await state('still', 0);
    // Animating again, frame 1's decode lands with a change of rendition.
    await call(probe => probe.deliver(undefined, false, {renditionId: 'a'.repeat(64), active: true, animate: true}));
    await settled({reads: ['a.0'], timers: 0});
    await call(probe => probe.deliver('a.0', false));
    await settled({reads: [], timers: 1});
    await call(probe => probe.deliver(undefined, true));
    await settled({reads: ['a.1'], timers: 0});
    await call(probe => probe.deliver('a.1', false, {renditionId: 'b'.repeat(64), active: true, animate: true}));
    await clean('the rendition changes with a decoded frame');
    await settled({reads: ['b.0'], timers: 0});
    // A superseded decode: the second rendition's frame is read and decoding when the rendition changes back.
    await call(probe => { probe.holdDecode('b.0'); });
    await call(probe => probe.deliver('b.0', false));
    await call(probe => { probe.render({renditionId: 'a'.repeat(64), active: true, animate: true}); });
    await settled({reads: ['a.0'], timers: 0});
    await call(probe => probe.decoded('b.0'));
    await call(probe => probe.deliver('a.0', false));
    await state('animating', 0);
    await clean('a superseded decode lands');
    const shown = await call(probe => probe.bitmaps());
    assert.deepEqual(shown.map(bitmap => bitmap.drawsAfterClose), shown.map(() => 0), 'no bitmap is drawn after it is closed');
    assert.deepEqual(shown.map(bitmap => [bitmap.key, bitmap.closes]),
      [['a.0', 1], ['a.0', 1], ['a.1', 1], ['a.0', 1], ['a.0', 1], ['a.1', 1], ['b.0', 1], ['a.0', 0]],
      'each replaced, released or superseded bitmap is closed once; the shown one stays open');
    await call(probe => { probe.render(undefined); });
    assert.deepEqual((await call(probe => probe.bitmaps())).map(bitmap => bitmap.closes), shown.map(() => 1), 'unmounting closes the shown bitmap once');
    assert.deepEqual(pageErrors, [], 'no uncaught error reached the page');
  } finally { await page.close(); }
}
