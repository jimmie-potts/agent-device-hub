// The existing player through authenticated content and tracked commands, with fresh synthetic media only (Hub #932).
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import sharp from 'sharp';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import {SIMULATED_SECTION} from '@jimmie-potts/pixoo';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page);
    const requestCount = (): number => sent.length;
    await page.goto(`${world.url}/#/module/pixoo/playlists`); await feed(page, 'connected');
    await page.getByRole('link', {name: 'Player', exact: true}).click();
    await page.getByRole('heading', {name: 'Player', exact: true, level: 2}).waitFor();
    await page.getByText('No active session.', {exact: true}).waitFor();
    assert.equal(sent.length, 0, 'opening and reading the player sends nothing');
    assert.equal(world.pixooState().sent, 0);
    await world.createPlaylist('Synthetic player');
    await page.getByRole('link', {name: 'Library', exact: true}).click();
    const png = await sharp({create: {width: 64, height: 64, channels: 3, background: {r: 45, g: 120, b: 70}}}).png().toBuffer();
    await page.getByLabel('Media file', {exact: true}).setInputFiles({name: 'Player still.png', mimeType: 'image/png', buffer: png});
    await page.getByRole('button', {name: 'Add media', exact: true}).click();
    for (let attempt = 0; (await world.pixooMedia()).items.length === 0 && attempt < 100; attempt++) await delay(20);
    const media = await page.evaluate(async () => {
      const response = await fetch('/modules/pixoo/content/catalog-media');
      return await response.json() as {items: {renditionId: string}[]};
    });
    const rendition = media.items[0]; assert.ok(rendition);
    const playlist = (await world.pixooPlaylists())[0]; assert.ok(playlist);
    const setupCommand = async (data: object): Promise<void> => {
      const reply = await page.evaluate(async ({target, header, data}) => {
        const response = await fetch('/api/v2/commands/pixoo-playlist-change', {method: 'POST',
          headers: {'content-type': 'application/json', [header]: '1'},
          body: JSON.stringify({target, requestId: crypto.randomUUID(), data})});
        return {status: response.status, body: await response.json() as {status?: string}};
      }, {target: SIMULATED_SECTION.config.device.id, header: REQUEST_HEADER, data});
      assert.equal(reply.status, 200); assert.equal(reply.body.status, 'accepted');
    };
    await setupCommand({change: {operation: 'items', playlistId: playlist.id, revision: playlist.playlistRevision,
      items: [1, 2].map(() => ({renditionId: rendition.renditionId, playback: {mode: 'duration', durationMs: 120000}}))}});
    for (let attempt = 0; (await world.pixooPlaylists())[0]?.items.length !== 2 && attempt < 100; attempt++) await delay(20);
    const saved = (await world.pixooPlaylists())[0]; assert.ok(saved); assert.equal(saved.items.length, 2);
    const setupRequests = requestCount(); assert.equal(setupRequests, 2);
    type Reading = {state: {state: string; intent: string; itemId: string | null}; session: {id: string; playlist: {name: string; revision: number}} | null;
      sampledAtMs: number; simulated: boolean};
    const readPlayer = (): Promise<Reading> => page.evaluate(async () => {
      const response = await fetch('/modules/pixoo/content/player');
      const text = await response.text();
      if (response.status !== 200 || new TextEncoder().encode(text).byteLength > 256 * 1024) throw new Error('invalid bounded player response');
      return JSON.parse(text) as Reading;
    });
    const waitState = async (state: string): Promise<Reading> => {
      let reading = await readPlayer();
      for (let attempt = 0; reading.state.state !== state && attempt < 100; attempt++) { await delay(20); reading = await readPlayer(); }
      assert.equal(reading.state.state, state); return reading;
    };
    await page.getByRole('link', {name: 'Player', exact: true}).click();
    await page.getByRole('combobox', {name: 'Playlist to play', exact: true}).selectOption(saved.id);
    assert.equal(sent.length, setupRequests, 'player selection sends no command');
    assert.equal(world.pixooState().sent, 0, 'synthetic setup and reads do not paint');
    const play = page.getByRole('button', {name: 'Play playlist', exact: true});
    await play.focus(); await play.press('Enter');
    const started = await waitState('playing'); assert.ok(started.session);
    assert.equal(started.simulated, true); assert.ok(Number.isFinite(started.sampledAtMs));
    assert.equal(started.session.playlist.revision, saved.playlistRevision); assert.equal(sent.length, setupRequests + 1);
    await page.getByText(/^Estimated remaining: [0-9.]+ seconds$/).waitFor();
    await page.getByRole('img', {name: 'Effective preview', exact: true}).waitFor();
    const afterStart = world.pixooState().sent; assert.ok(afterStart > 0);
    await page.getByRole('button', {name: 'Pause playlist', exact: true}).click();
    await waitState('paused'); assert.equal(world.pixooState().sent, afterStart);
    await page.getByRole('button', {name: 'Resume', exact: true}).click();
    await waitState('playing');
    await page.getByRole('button', {name: 'Next', exact: true}).click();
    let second = await waitState('playing');
    for (let attempt = 0; second.state.itemId === started.state.itemId && attempt < 100; attempt++) { await delay(20); second = await readPlayer(); }
    assert.notEqual(second.state.itemId, started.state.itemId);
    await page.getByRole('button', {name: 'Previous', exact: true}).click();
    let previous = await waitState('playing');
    for (let attempt = 0; previous.state.itemId !== started.state.itemId && attempt < 100; attempt++) { await delay(20); previous = await readPlayer(); }
    assert.equal(previous.state.itemId, started.state.itemId); assert.equal(sent.length, setupRequests + 5);
    await setupCommand({change: {operation: 'rename', playlistId: saved.id, revision: saved.playlistRevision, name: 'Saved player changes'}});
    for (let attempt = 0; (await world.pixooPlaylists())[0]?.name !== 'Saved player changes' && attempt < 100; attempt++) await delay(20);
    assert.equal((await readPlayer()).session?.playlist.name, 'Synthetic player', 'the session retains its frozen saved snapshot');
    await page.getByText('Saved changes are waiting for the next session. Restart with changes applies them now.', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Stop', exact: true}).click();
    const stopped = await waitState('idle'); assert.equal(stopped.state.intent, 'stopped'); assert.ok(stopped.session);
    const afterStop = world.pixooState().sent;
    await page.reload(); await feed(page, 'connected');
    await page.getByRole('heading', {name: 'Player', exact: true, level: 2}).waitFor();
    assert.equal(sent.length, setupRequests + 7, 'reload never resends'); assert.equal(world.pixooState().sent, afterStop);
    await page.getByRole('button', {name: 'Restart with changes', exact: true}).click();
    const restarted = await waitState('playing'); assert.ok(restarted.session);
    assert.notEqual(restarted.session.id, started.session.id);
    assert.equal(restarted.session.playlist.name, 'Saved player changes'); assert.equal(restarted.session.playlist.revision, saved.playlistRevision + 1);
    await page.getByRole('button', {name: 'Clear session', exact: true}).click();
    const cleared = await waitState('idle'); assert.equal(cleared.session, null);
    await page.getByText('No active session.', {exact: true}).waitFor();
    await page.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('monitor');
    const beforeMode = requestCount();
    await page.getByRole('button', {name: 'Set display mode', exact: true}).click();
    await page.getByText('monitor', {exact: true}).waitFor();
    assert.equal(sent.length, beforeMode + 1);
    await page.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('media');
    await page.getByRole('button', {name: 'Set display mode', exact: true}).click();
    await page.getByText('media', {exact: true}).waitFor();
    assert.equal(sent.length, beforeMode + 2);
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await page.getByText('Read-only access.', {exact: true}).waitFor();
    assert.equal(await play.count(), 0);
    const readerRequests = sent.length; await readPlayer(); assert.equal(sent.length, readerRequests);
    assert.equal(sent.length, 13); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-player-controls', requests: sent.length, simulatedWrites: world.pixooState().sent,
      frozenSession: true, restartWithChanges: true, noReplay: true, readOnlyControls: true, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
