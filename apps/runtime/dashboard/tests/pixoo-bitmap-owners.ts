// The bitmap lifetime of the Pixoo playlist item and the Monitor's exact preview (Hub #2133): a bitmap is never drawn
// after it is closed, and every decoded bitmap is closed exactly once. The real PlaylistItem and Monitor Pixels components
// run in a page of their own with a stand-in content reader and a stand-in decoder whose bitmaps record their draws and
// closes. The page never reaches a server.
//
// The fault: a decode's state update and a change of the component's source commit together. The source effect's cleanup
// then closes the decoded bitmap before the canvas effect of the same commit draws it.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext, Page} from 'playwright';

type Mount = {kind: 'item'; renditionId: string} | {kind: 'pixels'; refs: string[]; revision: number};
type Probe = {
  /** Renders the component at once, or unmounts it with `undefined`. */
  render(mount: Mount | undefined): void;
  /**
   * In one task: delivers the held image read `key`, drains microtasks so its decode lands, then renders `mount` without
   * flushing, so both commit together.
   */
  deliver(key: string, mount?: Mount): Promise<void>;
  /** Holds the decode of `key` until `decoded(key)` completes it. */
  holdDecode(key: string): void;
  decoded(key: string): Promise<void>;
  reads(): string[];
  bitmaps(): {key: string; closes: number; drawsAfterClose: number}[];
  errors: string[];
};

export async function checkPixooBitmapOwners(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {PlaylistItem} from '../../../../modules/pixoo/src/frontend/playlists.tsx';
    import {Pixels} from '../../../../modules/pixoo/src/frontend/monitor.tsx';
    const probe = window.pixooOwnersProbe = {errors: []};
    window.addEventListener('error', event => { probe.errors.push(event.error?.name ?? 'error'); });
    // Stand-in bitmaps: drawing one after close() throws, as Chromium's detached ImageBitmap does.
    const made = [], decodes = new Map();
    window.createImageBitmap = async blob => {
      if (decodes.has(blob.key)) await new Promise(resolve => { decodes.set(blob.key, resolve); });
      const bitmap = {key: blob.key, closes: 0, drawsAfterClose: 0, width: 64, height: 64, close() { this.closes += 1; }};
      made.push(bitmap);
      return bitmap;
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
    const drain = async () => { for (let turn = 0; turn < 10; turn += 1) await Promise.resolve(); };
    const reads = new Map();
    // Image keys drop the content prefix and shorten a rendition to its first character: 'thumbnail.a', 'f1'.
    const api = {
      read: async path => ({renditionId: path.slice(path.lastIndexOf('.') + 1), frameCount: 1}),
      image: path => new Promise(resolve => {
        reads.set(path.slice('/modules/pixoo/content/'.length).replace(/([a-f0-9])[a-f0-9]{63}$/, '$1'), resolve);
      }),
    };
    const context = {api, control: false, connected: true};
    const noop = () => {};
    const element = mount => mount === undefined ? null : mount.kind === 'item'
      ? React.createElement('ol', null, React.createElement(PlaylistItem, {context, index: 0, length: 1, disabled: false, edit: noop, move: noop, remove: noop,
        item: {key: 'k', renditionId: mount.renditionId, playback: {mode: 'duration', durationMs: 10000}}}))
      : React.createElement(Pixels, {context, refs: mount.refs, delay: null, revision: mount.revision, label: 'Exact monitor preview'});
    const root = createRoot(document.getElementById('root'));
    probe.render = mount => flushSync(() => root.render(element(mount)));
    probe.deliver = async (key, mount) => {
      const resolve = reads.get(key); reads.delete(key); resolve(Object.assign(new Blob(), {key}));
      await drain();
      if (mount !== undefined) root.render(element(mount));
    };
    probe.holdDecode = key => { decodes.set(key, undefined); };
    probe.decoded = async key => { const resolve = decodes.get(key); decodes.delete(key); resolve(); await drain(); };
    probe.reads = () => [...reads.keys()];
    probe.bitmaps = () => made.map(({key, closes, drawsAfterClose}) => ({key, closes, drawsAfterClose}));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'pixoo-bitmap-owners-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const javascript = bundle.outputFiles[0].text;
  const page: Page = await context.newPage(); page.setDefaultTimeout(5000);
  const pageErrors: string[] = []; page.on('pageerror', error => { pageErrors.push(`${error.name}: ${error.stack ?? error.message}`); });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://owners.localhost') { await route.abort(); return; }
      if (url.pathname === '/bundle.js') await route.fulfill({contentType: 'text/javascript', body: javascript});
      else if (url.pathname === '/') await route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Pixoo bitmap owners fixture</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'});
      else await route.abort();
    });
    await page.goto('http://owners.localhost/');
    await page.waitForFunction(() => 'pixooOwnersProbe' in window);
    const call = <T>(run: (probe: Probe) => T | Promise<T>): Promise<T> =>
      page.evaluate<T>(`(${run.toString()})(window.pixooOwnersProbe)`);
    const reads = async (expected: string[]): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (JSON.stringify(await call(probe => probe.reads())) === JSON.stringify(expected)) return;
        await page.waitForTimeout(10);
      }
      assert.deepEqual(await call(probe => probe.reads()), expected);
    };
    const clean = async (step: string): Promise<void> => {
      await page.waitForTimeout(50);
      assert.deepEqual([pageErrors, await call(probe => probe.errors)], [[], []], `${step}: no uncaught error reached the page`);
      assert.equal(await page.locator('#root > *').count(), 1, `${step}: the component stays mounted`);
    };
    const closes = async (expected: [string, number][], message: string): Promise<void> => {
      const made = await call(probe => probe.bitmaps());
      assert.deepEqual(made.map(bitmap => bitmap.drawsAfterClose), made.map(() => 0), `${message}: no bitmap is drawn after it is closed`);
      assert.deepEqual(made.map(bitmap => [bitmap.key, bitmap.closes]), expected, message);
    };

    // The playlist item: its thumbnail's decode lands as the item's rendition changes.
    await call(probe => { probe.render({kind: 'item', renditionId: 'a'.repeat(64)}); });
    await reads(['thumbnail.a']);
    await call(probe => probe.deliver('thumbnail.a', {kind: 'item', renditionId: 'b'.repeat(64)}));
    await clean('the item changes rendition with a decoded thumbnail');
    await reads(['thumbnail.b']);
    // A superseded decode: the item changes rendition again while the thumbnail decodes.
    await call(probe => { probe.holdDecode('thumbnail.b'); });
    await call(probe => probe.deliver('thumbnail.b'));
    await call(probe => { probe.render({kind: 'item', renditionId: 'a'.repeat(64)}); });
    await reads(['thumbnail.a']);
    await call(probe => probe.decoded('thumbnail.b'));
    await call(probe => probe.deliver('thumbnail.a'));
    await clean('a superseded thumbnail decode lands');
    await closes([['thumbnail.a', 1], ['thumbnail.b', 1], ['thumbnail.a', 0]], 'the item closes each replaced or superseded thumbnail once; the shown one stays open');
    await call(probe => { probe.render(undefined); });
    await closes([['thumbnail.a', 1], ['thumbnail.b', 1], ['thumbnail.a', 1]], 'unmounting the item closes its shown thumbnail once');

    // The Monitor's exact preview: its last frame's decode lands as the display revision changes.
    await call(probe => { probe.render({kind: 'pixels', refs: ['f1', 'f2'], revision: 1}); });
    await reads(['f1']);
    await call(probe => probe.deliver('f1'));
    await reads(['f2']);
    await call(probe => probe.deliver('f2', {kind: 'pixels', refs: ['f1', 'f2'], revision: 2}));
    await clean('the display revision changes with decoded frames');
    await reads(['f1']);
    await call(probe => probe.deliver('f1'));
    await reads(['f2']);
    await call(probe => probe.deliver('f2'));
    // The frames change while their decode lands.
    await reads([]);
    await call(probe => { probe.render({kind: 'pixels', refs: ['f3'], revision: 2}); });
    await reads(['f3']);
    await call(probe => probe.deliver('f3', {kind: 'pixels', refs: ['f4'], revision: 2}));
    await clean('the frames change with a decoded frame');
    // A superseded decode: the revision changes while a frame decodes.
    await reads(['f4']);
    await call(probe => { probe.holdDecode('f4'); });
    await call(probe => probe.deliver('f4'));
    await call(probe => { probe.render({kind: 'pixels', refs: ['f4'], revision: 3}); });
    await reads(['f4']);
    await call(probe => probe.decoded('f4'));
    await call(probe => probe.deliver('f4'));
    await clean('a superseded frame decode lands');
    const item = [['thumbnail.a', 1], ['thumbnail.b', 1], ['thumbnail.a', 1]] as [string, number][];
    await closes([...item, ['f1', 1], ['f2', 1], ['f1', 1], ['f2', 1], ['f3', 1], ['f4', 1], ['f4', 0]],
      'the Monitor preview closes each replaced or superseded frame once; the shown one stays open');
    await call(probe => { probe.render(undefined); });
    await closes([...item, ['f1', 1], ['f2', 1], ['f1', 1], ['f2', 1], ['f3', 1], ['f4', 1], ['f4', 1]], 'unmounting the Monitor preview closes its frames once');
    assert.deepEqual(pageErrors, [], 'no uncaught error reached the page');
  } finally { await page.close(); }
}
