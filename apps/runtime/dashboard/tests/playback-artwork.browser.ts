// Focused #1069 RED/green fixture: real producer owner/decoder, authenticated native image and shared Home/Music card.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser, type ElementHandle, type Route} from 'playwright';
import {expect} from 'playwright/test';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {REQUEST_HEADER, SOURCE_HEADER} from '@jimmie-potts/sdk';
import {SimulatedSpeakers, type SonyReply, type PlaybackModuleOptions} from '@jimmie-potts/playback';
import {changes, feed, startWorld} from './harness.ts';
import {controlReach, textOverlaps} from './layout.ts';

// Independent valid input and pixel oracle, without a production image renderer/helper.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4ISLyHwAEiAHwkp1qPAAAAABJRU5ErkJggg==', 'base64');
const TITLE = 'Synthetic browser song', ARTIST = 'Synthetic browser artist';
const PATH = '/synthetic-browser-artwork.png';
class ArtworkSpeakers extends SimulatedSpeakers {
  candidate: string | undefined = PATH;
  override async sony(endpoint: string, method: string, version: string, signal: AbortSignal): Promise<SonyReply> {
    const reply = await super.sony(endpoint, method, version, signal);
    if (method === 'getPlayingContentInfo' && 'result' in reply) {
      for (const item of reply.result.flat()) if (typeof item === 'object' && item !== null) {
        Object.assign(item, {content: this.candidate === undefined ? undefined : {thumbnailUrl: `${new URL(endpoint).origin}${this.candidate}`}});
      }
    }
    return reply;
  }
}
type ArtworkFetch = NonNullable<NonNullable<PlaybackModuleOptions['artwork']>['fetch']>;
type SyncCall = {schema: string; owner?: string; request: Message<{requestId: string; families: string[]}>};
const speakers = new ArtworkSpeakers({sony: {input: 'airplay', status: 'playing', title: TITLE, artist: ARTIST}});
let acquisitions = 0;
const fetchArtwork: ArtworkFetch = (candidate, endpoint, signal) => {
  assert.ok(!signal.aborted, 'synthetic acquisition is current');
  assert.ok(new URL(candidate).origin === new URL(endpoint).origin && new URL(candidate).pathname.startsWith('/synthetic-browser-'), 'only configured synthetic candidates are acquired');
  acquisitions++;
  return Promise.resolve({ok: true, value: new Uint8Array(new URL(candidate).pathname.endsWith('-red.png') ? PNG_B : PNG)});
};
const world = await startWorld({playbackArtwork: {speakers, fetch: fetchArtwork}});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const sent = changes(page);
    let playbackSync: SyncCall | undefined;
    const contentRequests: string[] = [];
    page.on('request', request => {if (new URL(request.url()).pathname.startsWith('/modules/playback/content/')) contentRequests.push(request.url());});
    // Observe the page's actual SDK protocol call, not an invented gateway state route.
    page.on('request', request => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/sdk/v1/sync') return;
      const call = request.postDataJSON() as SyncCall;
      if (call.request?.data?.families?.includes('playback') === true) playbackSync = call;
    });
    await page.goto(world.url); await feed(page, 'connected');
    const card = page.locator('article[aria-label="Music living-room"]');
    await card.getByText(TITLE, {exact: true}).waitFor();
    await card.getByText(ARTIST, {exact: true}).waitFor();
    assert.ok(playbackSync !== undefined, 'the visible owner record arrived through a real playback SDK sync');
    assert.equal(playbackSync.schema, 'sdk-remote/1.0');
    assert.equal(playbackSync.request.source, 'bunny/parts/dashboard');
    const initialSync = playbackSync;
    // Refresh only envelope identity/deadline on a legitimate read, with the existing session cookie.
    const readyProbe: {value: PlaybackState | false} = {value: false};
    await expect.poll(async () => {
      readyProbe.value = await page.evaluate(async ({template, sourceHeader, requestHeader}) => {
      const call = structuredClone(template), now = Date.now();
      call.request.id = crypto.randomUUID(); call.request.data.requestId = crypto.randomUUID();
      call.request.time = new Date(now).toISOString(); call.request.expiresat = new Date(now + 5000).toISOString();
      call.owner = 'bunny/modules/playback';
      const response = await fetch('/api/sdk/v1/sync', {method: 'POST', credentials: 'same-origin',
        headers: {'content-type': 'application/json', [sourceHeader]: 'bunny/parts/dashboard', [requestHeader]: '1'},
        body: JSON.stringify(call)});
      if (!response.ok) throw new Error(`fixture playback sync refused with HTTP ${response.status}`);
      const body = await response.json() as {schema: string; answer: {status: string; states?: {data: PlaybackState}[]}};
      if (body.schema !== 'sdk-remote/1.0' || body.answer.status !== 'served') throw new Error('fixture playback sync was not served');
      const state = body.answer.states?.find(message => message.data.id === 'living-room')?.data;
      return state?.availability === 'available' && state.playback.status === 'known' && state.playback.player === 'playing'
        && state.artwork?.status === 'ready' ? state : false;
      }, {template: initialSync, sourceHeader: SOURCE_HEADER, requestHeader: REQUEST_HEADER});
      return readyProbe.value !== false;
    }, {timeout: 15_000, intervals: [100]}).toBe(true);
    const ready = readyProbe.value; assert.ok(ready !== false);
    assert.ok(ready.artwork?.status === 'ready');
    assert.equal(ready.artwork.width, 1); assert.equal(ready.artwork.height, 1);
    assert.equal(acquisitions, 1, 'the default producer worker completed one synthetic acquisition');
    const expectedPath = `/modules/playback/content/artwork.${ready.artwork.generation}.${ready.revision}`;
    const image = card.locator('.playback-artwork img');
    // Initial qualified RED: ready producer and current card above, but current text-only card has no image.
    await image.waitFor({state: 'attached'});
    assert.equal(await image.count(), 1);
    const checkImage = async (): Promise<void> => {
      const src = await image.getAttribute('src'); assert.ok(src !== null);
      const url = new URL(src, page.url()); assert.equal(url.origin, new URL(world.url).origin);
      assert.equal(url.pathname, expectedPath); assert.equal(url.search, ''); assert.equal(url.hash, '');
      await image.evaluate(element => {
        if (!(element instanceof HTMLImageElement)) throw new Error('artwork is not a native image');
        return element.decode();
      });
      await image.waitFor({state: 'visible'});
      assert.equal(await image.isVisible(), true);
      const decoded = await image.evaluate(element => {
        const img = element as HTMLImageElement, canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const painter = canvas.getContext('2d'); if (painter === null) throw new Error('test pixel oracle unavailable');
        painter.drawImage(img, 0, 0);
        return {width: img.naturalWidth, height: img.naturalHeight, pixel: [...painter.getImageData(0, 0, 1, 1).data]};
      });
      assert.deepEqual(decoded, {width: 1, height: 1, pixel: [20, 60, 100, 255]});
      assert.equal(await image.getAttribute('alt'), '');
      assert.equal(await card.getByRole('img').count(), 0, 'decorative artwork adds no redundant accessible image');
      assert.equal(await image.evaluate(element => element instanceof HTMLElement && element.tabIndex < 0), true);
      assert.deepEqual(await card.locator('fieldset button').allTextContents(), ['Pause', 'Next', 'Previous']);
      for (const name of ['Pause', 'Next', 'Previous']) assert.equal(await card.getByRole('button', {name, exact: true}).isEnabled(), true);
      await card.getByText(TITLE, {exact: true}).waitFor(); await card.getByText(ARTIST, {exact: true}).waitFor();
      assert.ok(await controlReach(page) <= 1); assert.deepEqual(await textOverlaps(page), []);
    };
    await checkImage();
    await card.getByRole('button', {name: 'Pause', exact: true}).focus();
    assert.equal(await image.evaluate(element => document.activeElement === element), false, 'artwork adds no keyboard stop');
    await page.getByRole('link', {name: 'Music', exact: true}).click();
    assert.equal(new URL(page.url()).hash, '#/music/living-room');
    await image.waitFor({state: 'attached'}); await checkImage();
    assert.equal(acquisitions, 1, 'Home and Music reuse one receiver acquisition');
    assert.deepEqual(speakers.state().sony.commands, []); assert.deepEqual(speakers.state().sonos.commands, []);
    assert.deepEqual(sent, []); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'playback-artwork', routes: ['home', 'music'], acquisitions,
      pixel: [20, 60, 100, 255], realProducerWorker: true, commands: 0})}\n`);

    const output = process.env.DASHBOARD_RECEIPTS;
    if (output !== undefined) await mkdir(output, {recursive: true});
    const shot = async (name: string): Promise<void> => {if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: true});};
    const checks: string[] = [];
    const latch = <T,>(): {wait: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void} => {
      let resolve: (value: T) => void = () => {}, reject: (reason: unknown) => void = () => {};
      const wait = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
      return {wait, resolve, reject};
    };
    const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {return await Promise.race([promise, new Promise<never>((_yes, no) => {
        timer = setTimeout(() => {no(new Error(`fixture barrier timed out: ${label}`));}, 15_000);
      })]);} finally {if (timer !== undefined) clearTimeout(timer);}
    };
    type Wanted = {title?: string; player?: string; artwork?: string; after?: number; availability?: string};
    const current = async (wanted: Wanted = {}, timeout = 15_000): Promise<PlaybackState> => {
      assert.ok(playbackSync);
      const currentSync = playbackSync;
      const observed: {value: PlaybackState | false} = {value: false};
      await expect.poll(async () => {
        observed.value = await page.evaluate(async ({template, sourceHeader, requestHeader, wanted}) => {
        const call = structuredClone(template), now = Date.now();
        call.request.id = crypto.randomUUID(); call.request.data.requestId = crypto.randomUUID();
        call.request.time = new Date(now).toISOString(); call.request.expiresat = new Date(now + 5000).toISOString();
        call.owner = 'bunny/modules/playback';
        const answer = await fetch('/api/sdk/v1/sync', {method: 'POST', credentials: 'same-origin',
          headers: {'content-type': 'application/json', [sourceHeader]: 'bunny/parts/dashboard', [requestHeader]: '1'}, body: JSON.stringify(call)});
        if (!answer.ok) throw new Error(`fixture sync refused with HTTP ${answer.status}`);
        const body = await answer.json() as {schema: string; answer: {status: string; states?: {data: PlaybackState}[]}};
        if (body.schema !== 'sdk-remote/1.0' || body.answer.status !== 'served') throw new Error('fixture sync not served');
        const state = body.answer.states?.find(message => message.data.id === 'living-room')?.data;
        return state !== undefined && (wanted.availability === undefined || state.availability === wanted.availability)
          && (wanted.after === undefined || state.revision > wanted.after)
          && (wanted.artwork === undefined || state.artwork?.status === wanted.artwork)
          && (wanted.title === undefined || state.playback.status === 'known' && state.playback.title === wanted.title)
          && (wanted.player === undefined || state.playback.status === 'known' && state.playback.player === wanted.player) ? state : false;
        }, {template: currentSync, sourceHeader: SOURCE_HEADER, requestHeader: REQUEST_HEADER, wanted});
        return observed.value !== false;
      }, {timeout, intervals: [100]}).toBe(true);
      assert.ok(observed.value !== false); return observed.value;
    };
    const pathOf = (record: PlaybackState): string => {assert.ok(record.artwork?.status === 'ready', `ready fixture required: ${JSON.stringify(record)}`); return `/modules/playback/content/artwork.${record.artwork.generation}.${record.revision}`;};
    const square = async (): Promise<void> => {
      assert.equal(await card.locator('.playback-artwork').count(), 1, 'missing/unsupported/error artwork keeps its reserved square');
      const box = await card.locator('.playback-artwork').boundingBox(); assert.ok(box); assert.equal(box.width, 80); assert.equal(box.height, 80);
    };
    const noImage = async (): Promise<void> => {
      await page.waitForFunction(() => document.querySelector('article[aria-label="Music living-room"] .playback-artwork img') === null);
    };
    const frame = async (record: PlaybackState, pixel: number[]): Promise<void> => {
      const path = pathOf(record);
      await page.waitForFunction(path => {
        const img = document.querySelector<HTMLImageElement>('article[aria-label="Music living-room"] .playback-artwork img');
        return img !== null && new URL(img.src).pathname === path && img.complete && img.naturalWidth === 1
          && img.closest<HTMLElement>('.playback-artwork')?.dataset.loaded === 'true';
      }, path);
      await image.waitFor({state: 'visible'});
      assert.deepEqual(await image.evaluate(element => {
        const img = element as HTMLImageElement, canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const painter = canvas.getContext('2d'); if (painter === null) throw new Error('test pixel oracle unavailable');
        painter.drawImage(img, 0, 0); return [...painter.getImageData(0, 0, 1, 1).data];
      }), pixel);
      await square();
    };
    const textAndControls = async (title: string, status?: string): Promise<void> => {
      await card.getByText(title, {exact: true}).waitFor();
      const state = await current({title, availability: 'available'}); assert.ok(state.playback.status === 'known');
      await page.waitForFunction(() => {const buttons = [...document.querySelectorAll<HTMLButtonElement>('article[aria-label="Music living-room"] fieldset button')]; return buttons.length > 0 && buttons.every(button => !button.disabled);});
      assert.deepEqual(await card.locator('fieldset button').allTextContents(), state.playback.controls.map(value => value.charAt(0).toUpperCase() + value.slice(1)));
      for (const button of await card.locator('fieldset button').all()) assert.equal(await button.isEnabled(), true);
      assert.equal(await card.getByRole('img').count(), 0);
      if (status !== undefined) {
        await page.waitForFunction(status => document.querySelector('article[aria-label="Music living-room"] p[role="status"]')?.textContent === status, status);
        assert.equal(await card.getByRole('status').innerText(), status);
      }
      await square(); assert.ok(await controlReach(page) <= 1); assert.deepEqual(await textOverlaps(page), []);
    };
    const imagePattern = '**/modules/playback/content/artwork.*';
    const heldImage = async (begin: () => void, during: (record: PlaybackState, old: ElementHandle, url: string) => Promise<void>): Promise<void> => {
      const entered = latch<string>(), release = latch<void>(), ended = latch<void>(); let first = true;
      const handler = async (route: Route): Promise<void> => {
        if (!first) {await route.continue(); return;} first = false;
        try {
          const response = await route.fetch(); assert.equal(response.status(), 200, 'A response is captured truthfully while A is current');
          assert.equal(response.headers()['content-type'], 'image/png'); entered.resolve(route.request().url());
          await release.wait;
          try {await route.fulfill({response});} catch (error) {if (route.request().failure() === null) throw error;}
          ended.resolve();
        } catch (error) {entered.reject(error); ended.reject(error);}
      };
      // Handler failure is reported by the bounded barrier; keep rejection handled even before cleanup.
      void ended.wait.catch(() => {});
      await page.route(imagePattern, handler);
      let element: ElementHandle | null = null;
      try {
        begin(); const url = await bounded(entered.wait, 'truthful A image');
        const record = await current({artwork: 'ready', availability: 'available'});
        await image.waitFor({state: 'attached'}); element = await image.elementHandle();
        assert.equal(new URL(await image.getAttribute('src') ?? '', world.url).href, url);
        assert.equal(await image.isVisible(), false, 'held loading image is not shown');
        await textAndControls(record.playback.status === 'known' ? record.playback.title ?? '' : ''); await shot('playback-loading');
        await during(record, element, url);
        release.resolve(); await bounded(ended.wait, 'late A release');
        assert.equal(await element.evaluate(node => node.isConnected), false, 'late A cannot return to current membership');
      } finally {release.resolve(); await bounded(ended.wait, 'held-image cleanup').catch(() => {}); await page.unroute(imagePattern, handler); await element?.dispose();}
    };
    const titleOf = (record: PlaybackState): string => {assert.equal(record.playback.status, 'known'); return record.playback.status === 'known' ? record.playback.title ?? '' : '';};
    let serial = 0;
    const select = (title: string, red = false): void => {
      speakers.candidate = `/synthetic-browser-${++serial}${red ? '-red' : '-blue'}.png`;
      speakers.stop('sonos'); speakers.play('sony', {title, artist: ARTIST});
    };
    // Metadata A→B: capture real A200 before B and keep A hidden until its late completion.
    await heldImage(() => {select('Race A');}, async (a, old) => {
      select('Race B', true); const b = await current({title: 'Race B', artwork: 'ready', after: a.revision});
      assert.notEqual(b.artwork?.generation, a.artwork?.generation);
      await frame(b, [200, 20, 20, 255]); assert.equal(await old.evaluate(node => node.isConnected), false);
    });
    await frame(await current({title: 'Race B', artwork: 'ready'}), [200, 20, 20, 255]);
    checks.push('truthful delayed A after B');
    // Candidate-only replacement: same text and generation, distinct revision/src and independent red B pixel.
    await heldImage(() => {select('Identical candidate text');}, async (a, old, url) => {
      speakers.candidate = `/synthetic-browser-${++serial}-red.png`;
      const b = await current({title: titleOf(a), artwork: 'ready', after: a.revision});
      assert.equal(b.artwork?.generation, a.artwork?.generation); assert.notEqual(pathOf(b), new URL(url).pathname);
      await frame(b, [200, 20, 20, 255]); assert.equal(await old.evaluate(node => node.isConnected), false);
    });
    await frame(await current({title: 'Identical candidate text', artwork: 'ready'}), [200, 20, 20, 255]);
    checks.push('same-generation replacement');
    // Source identity changes although every displayed metadata field remains identical.
    await heldImage(() => {select('Identical speaker text');}, async (a, old) => {
      speakers.stop('sony'); speakers.play('sonos', {title: titleOf(a), artist: ARTIST});
      const b = await current({title: titleOf(a), artwork: 'unsupported', after: a.revision});
      assert.notEqual(b.artwork?.generation, a.artwork?.generation); await noImage(); await textAndControls(titleOf(a));
      assert.equal(await old.evaluate(node => node.isConnected), false);
    }); await noImage(); checks.push('same-title Sony/Sonos');
    // A pending native request is retired when the route unmounts; re-entry uses current membership only.
    await heldImage(() => {select('Unmount A');}, async (_a, old) => {
      await page.getByRole('link', {name: 'Connections', exact: true}).click();
      await page.getByRole('heading', {name: 'Connections', exact: true}).waitFor();
      assert.equal(await card.count(), 0); assert.equal(await old.evaluate(node => node.isConnected), false);
    });
    assert.equal(await card.count(), 0, 'late unmounted A cannot recreate the card');
    const beforeReentry = acquisitions;
    await page.getByRole('link', {name: /^Home/}).click(); await feed(page, 'connected');
    await frame(await current({title: 'Unmount A', artwork: 'ready'}), [20, 60, 100, 255]);
    assert.equal(acquisitions, beforeReentry); checks.push('unmount/re-entry');
    // Lose sync while A200 is pending; hold the page's existing replacement SDK snapshot.
    await heldImage(() => {select('Sync A');}, async (_a, old) => {
      const enteredSync = latch<void>(), releaseSync = latch<void>(), endedSync = latch<void>(); let firstSync = true;
      const syncHandler = async (route: Route): Promise<void> => {
        const call = route.request().postDataJSON() as SyncCall;
        if (!firstSync || !call.request.data.families.includes('playback')) {await route.continue(); return;}
        firstSync = false; enteredSync.resolve(); await releaseSync.wait;
        try {await route.continue(); endedSync.resolve();} catch (error) {endedSync.reject(error);}
      };
      void endedSync.wait.catch(() => {}); await page.route('**/api/sdk/v1/sync', syncHandler);
      try {
        world.dropDashboardStreams(); await bounded(enteredSync.wait, 'replacement playback sync'); await feed(page, 'connected');
        await noImage(); await card.getByText('Playback unavailable', {exact: true}).waitFor(); await square();
        assert.equal(await old.evaluate(node => node.isConnected), false);
        assert.equal(await card.locator('fieldset button').count(), 3);
        for (const button of await card.locator('fieldset button').all()) assert.equal(await button.isDisabled(), true);
        select('Reconnect B', true); await current({title: 'Reconnect B', artwork: 'ready'});
      } finally {releaseSync.resolve(); await bounded(endedSync.wait, 'replacement sync continuation'); await page.unroute('**/api/sdk/v1/sync', syncHandler);}
      await frame(await current({title: 'Reconnect B', artwork: 'ready'}), [200, 20, 20, 255]);
    });
    await frame(await current({title: 'Reconnect B', artwork: 'ready'}), [200, 20, 20, 255]); checks.push('pending image/sync loss/reconnect');
    assert.deepEqual(sent, [], 'image and lifecycle transitions never send a command');
    // All requests in each fault phase remain failed, including the revision created by a successful pause.
    const fault = async (kind: '404' | 'invalid', act = false): Promise<void> => {
      let requests = 0;
      const handler = async (route: Route): Promise<void> => {requests++; await route.fulfill(kind === '404'
        ? {status: 404, contentType: 'application/json', body: '{"error":{"code":"not-found","retryable":false}}'}
        : {status: 200, contentType: 'image/png', body: Buffer.from([1, 2, 3])});};
      await page.route(imagePattern, handler);
      try {
        select(`Image ${kind}`); const state = await current({title: `Image ${kind}`, artwork: 'ready'});
        await page.waitForFunction(path => {const img = document.querySelector<HTMLImageElement>('article[aria-label="Music living-room"] img');
          return img !== null && new URL(img.src).pathname === path && img.complete && img.naturalWidth === 0;}, pathOf(state));
        await textAndControls(`Image ${kind}`); assert.equal(await image.isVisible(), false);
        if (act) {
          const beforePause = await image.elementHandle();
          const pause = card.getByRole('button', {name: 'Pause', exact: true}); await pause.focus(); await pause.press('Enter');
          await card.getByRole('status').filter({hasText: 'Completed: succeeded. Transmitted; physical effect was not observed.'}).waitFor();
          assert.deepEqual(speakers.state().sony.commands, ['pause']); assert.deepEqual(speakers.state().sonos.commands, []); assert.equal(sent.length, 1);
          const paused = await current({title: `Image ${kind}`, player: 'paused', artwork: 'ready', after: state.revision});
          assert.equal(paused.artwork?.generation, state.artwork?.generation);
          await page.waitForFunction(path => {const img = document.querySelector<HTMLImageElement>('article[aria-label="Music living-room"] img');
            return img !== null && new URL(img.src).pathname === path;}, pathOf(paused));
          assert.equal(await beforePause.evaluate(node => node.isConnected), false, 'a new revision retires the previous image even within one generation');
          await beforePause.dispose();
        }
        const operation = await card.getByRole('status').innerText();
        await textAndControls(`Image ${kind}`, operation); await shot(`playback-${kind}-${new URL(page.url()).hash.includes('/music/') ? 'music' : 'home'}`);
        // Another eligible revision/image request is independent of the already recorded command outcome.
        const beforeReplacement = await current({title: `Image ${kind}`, artwork: 'ready'});
        speakers.candidate = `/synthetic-browser-${++serial}-blue.png`;
        const next = await current({title: `Image ${kind}`, artwork: 'ready', after: beforeReplacement.revision});
        assert.equal(next.artwork?.generation, beforeReplacement.artwork?.generation); assert.notEqual(pathOf(next), pathOf(beforeReplacement));
        await page.waitForFunction(path => {const img = document.querySelector<HTMLImageElement>('article[aria-label="Music living-room"] img');
          return img !== null && new URL(img.src).pathname === path && img.complete && img.naturalWidth === 0;}, pathOf(next));
        await textAndControls(`Image ${kind}`, operation); assert.ok(requests <= 3, 'one request per selected observation, no image retry loop');
      } finally {await page.unroute(imagePattern, handler);}
    };
    await fault('404', true); await fault('invalid');
    await page.getByRole('link', {name: 'Music', exact: true}).click();
    await fault('404'); await fault('invalid');
    assert.equal(sent.length, 1); assert.deepEqual(speakers.state().sony.commands, ['pause']);
    checks.push('Home/Music 404/invalid PNG and keyboard pause outcome');
    // Optional missing image and unsupported cases keep the square/text/control layout.
    speakers.candidate = undefined;
    const missing = await current({artwork: 'missing'}); await noImage(); await textAndControls(titleOf(missing));
    checks.push('missing artwork square');
    // Long metadata and phone layout, using actual producer bytes and current WCAG tags.
    const longTitle = 'Synthetic long track title '.repeat(6).trim(), longArtist = 'Synthetic long artist '.repeat(5).trim();
    speakers.candidate = `/synthetic-browser-${++serial}-blue.png`; speakers.play('sony', {title: longTitle, artist: longArtist});
    const long = await current({title: longTitle, artwork: 'ready'}); await frame(long, [20, 60, 100, 255]);
    const completed = await card.getByRole('status').innerText(); assert.ok(completed.includes('Completed: succeeded.'));
    for (const destination of ['Music', 'Home']) {
      const beforeNavigation: number = acquisitions;
      await page.getByRole('link', {name: destination === 'Home' ? /^Home/ : 'Music', exact: destination !== 'Home'}).click();
      await frame(await current({title: longTitle, artwork: 'ready'}), [20, 60, 100, 255]);
      assert.equal(acquisitions, beforeNavigation);
      for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 900}); await textAndControls(longTitle, completed);
        await card.getByText(longArtist, {exact: true}).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
        await shot(`playback-long-${destination.toLowerCase()}-${width}`);
      }
    }
    checks.push('long text/390px/axe');
    const beforeReload = acquisitions;
    await page.reload(); await feed(page, 'connected');
    await frame(await current({title: longTitle, artwork: 'ready'}), [20, 60, 100, 255]);
    await textAndControls(longTitle, completed);
    assert.equal(acquisitions, beforeReload); assert.equal(sent.length, 1); assert.deepEqual(speakers.state().sony.commands, ['pause']);
    checks.push('completion survives re-entry without command replay');
    // Reject a real playback replacement sync, then keep its scheduled retry pending while late A finishes.
    const rejectedSync = latch<void>(), enteredRetry = latch<void>(), releaseRetry = latch<void>(), endedRetry = latch<void>();
    let playbackAttempts = 0, beforeRefusalAcquisitions = 0;
    const failedSyncHandler = async (route: Route): Promise<void> => {
      const call = route.request().postDataJSON() as SyncCall;
      if (call.owner !== 'bunny/modules/playback' || !call.request.data.families.includes('playback')) {await route.continue(); return;}
      playbackAttempts++;
      if (playbackAttempts === 1) {
        await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({schema: 'sdk-remote/1.0',
          answer: {status: 'rejected', requestId: call.request.data.requestId,
            error: errorBody('unavailable', {detail: 'synthetic playback sync refusal', requestId: call.request.data.requestId})}})});
        rejectedSync.resolve(); return;
      }
      enteredRetry.resolve(); await releaseRetry.wait;
      try {await route.continue(); endedRetry.resolve();} catch (error) {endedRetry.reject(error);}
    };
    void endedRetry.wait.catch(() => {});
    try {
      await heldImage(() => {select('Failed sync A');}, async (_a, old) => {
        beforeRefusalAcquisitions = acquisitions;
        await page.route('**/api/sdk/v1/sync', failedSyncHandler);
        const refusal = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sdk/v1/sync'
          && (response.request().postDataJSON() as SyncCall).owner === 'bunny/modules/playback');
        world.dropDashboardStreams();
        const response = await refusal; const answer = await response.json() as {answer: {status: string; error: {error: {code: string}}}};
        assert.equal(response.status(), 200); assert.equal(answer.answer.status, 'rejected'); assert.equal(answer.answer.error.error.code, 'unavailable');
        await bounded(rejectedSync.wait, 'real playback sync rejection'); await bounded(enteredRetry.wait, 'scheduled playback retry after rejection');
        await feed(page, 'connected'); await noImage(); await card.getByText('Playback unavailable', {exact: true}).waitFor(); await square();
        assert.equal(await old.evaluate(node => node.isConnected), false);
        for (const button of await card.locator('fieldset button').all()) assert.equal(await button.isDisabled(), true);
        assert.equal(await card.locator('fieldset button').count(), 3);
        assert.equal(await card.getByRole('status').innerText(), completed);
      });
      // The truthful delayed A response has completed while the failed copy still cannot claim current membership.
      await noImage(); await card.getByText('Playback unavailable', {exact: true}).waitFor();
      assert.equal(await card.getByRole('status').innerText(), completed);
      assert.equal(acquisitions, beforeRefusalAcquisitions, 'sync refusal and late image completion never reacquire artwork');
      const expectedBAcquisitions = acquisitions + 1;
      select('Failed sync B', true); releaseRetry.resolve(); await bounded(endedRetry.wait, 'successful playback retry');
      await page.unroute('**/api/sdk/v1/sync', failedSyncHandler);
      await frame(await current({title: 'Failed sync B', artwork: 'ready'}), [200, 20, 20, 255]);
      await textAndControls('Failed sync B', completed);
      assert.equal(acquisitions, expectedBAcquisitions, 'only selecting B starts its one acquisition; retry and browser consumers reuse it');
      assert.ok(playbackAttempts >= 2); assert.equal(sent.length, 1); assert.deepEqual(speakers.state().sony.commands, ['pause']);
      checks.push('rejected playback sync/late image/retry/no command replay');
    } finally {releaseRetry.resolve(); await page.unroute('**/api/sdk/v1/sync', failedSyncHandler);}
    // Production freshness cadence remains unchanged; await evidence boundaries, never arbitrary sleeps.
    speakers.silent('sony'); speakers.silent('sonos');
    await current({availability: 'stale'}); await noImage(); await card.getByText('Playback unavailable', {exact: true}).waitFor(); await square();
    for (const button of await card.locator('fieldset button').all()) assert.equal(await button.isDisabled(), true);
    await current({availability: 'unavailable'}, 40_000); await noImage(); await square();
    assert.equal(await card.getByRole('status').innerText(), completed); checks.push('stale/unavailable');
    assert.equal(sent.length, 1); assert.deepEqual(speakers.state().sony.commands, ['pause']); assert.deepEqual(speakers.state().sonos.commands, []);
    assert.deepEqual(errors, []);
    assert.ok(!JSON.stringify(world.logs).includes('/synthetic-browser-'));
    assert.ok(contentRequests.length > 0);
    for (const reference of contentRequests) {
      const url = new URL(reference); assert.equal(url.origin, new URL(world.url).origin); assert.equal(url.search, ''); assert.equal(url.hash, '');
      assert.match(url.pathname, /^\/modules\/playback\/content\/artwork\.[0-9a-f-]{36}\.[1-9][0-9]*$/);
      assert.ok(!reference.includes('/synthetic-browser-'));
    }
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'playback-artwork-races', checks, commands: 1, screenshots: output !== undefined})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
