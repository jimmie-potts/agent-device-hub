// #722 Music lighting controls over the real disposable core, gateway and Nanoleaf module on simulated Lines and NL22
// Light Panels controllers (#1272), with the numeric-only Music producer fixture. No device, capture, network light or
// installed service.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium, type Request} from 'playwright';
import {expect} from 'playwright/test';
import {LINES_ADDRESS, PANELS_ADDRESS} from '@jimmie-potts/nanoleaf';
import {startWorld, changes, feed} from './harness.ts';
import {musicCaptureProducer} from './music-capture-producer.ts';
import {browserArtifactDirectory} from './browser-artifacts.ts';

type Control = {target: string; requestId: string; data: {action: 'start' | 'stop'; expectedRevision: number; capture?: {endpointId: string; generation: string}; presetId?: string}};
const RECIPE = {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0};
const world = await startWorld({nanoleaf: true, nanoleafPanels: true, musicCapture: true});
/** Sets a light's mode outside the lighting card, as the light card would, and waits until the module applied it. */
async function mode(value: 'free' | 'work', light: 'wall' | 'nl22' = 'wall'): Promise<void> {
  assert.equal((await world.credentialAction('device-mode-set', light, {mode: value})).status, 200);
  const address = light === 'wall' ? LINES_ADDRESS : PANELS_ADDRESS;
  await expect.poll(async () => {
    const wall = await world.nanoleafWall(light) as unknown as {mode?: string; modePending?: boolean};
    return wall.mode === value && wall.modePending === false && world.nanoleafState().devices[address]?.select !== undefined;
  }, {timeout: 10_000}).toBe(true);
}
let producer: Awaited<ReturnType<typeof musicCaptureProducer>> | undefined;
const browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
/** The page's API requests still without an answer, which a failure prints: a hung request is told apart from a slow card. */
const unanswered = new Map<Request, string>();
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  // Playwright stops intercepting when a page's last route goes, and a request paused at that moment can hang with no
  // answer and no failure, whatever its URL (#1664). This pass-through route stays, so each `unroute` below only removes
  // its own handler. With interception on, Playwright also keeps the page's HTTP cache off for the whole journey; no
  // assertion here depends on caching.
  await page.route('**/*', route => route.fallback());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const sent = changes(page), controls: Control[] = [];
  page.on('request', request => {
    const {pathname} = new URL(request.url());
    if (pathname.startsWith('/api/')) unanswered.set(request, `${request.method()} ${pathname}`);
    if (request.method() === 'POST' && pathname === '/api/v2/commands/music-lighting-control') controls.push(request.postDataJSON() as Control);
  });
  page.on('response', response => {unanswered.delete(response.request());}); page.on('requestfailed', request => {unanswered.delete(request);});
  await page.goto(world.url + '/#/audio'); await feed(page, 'connected');
  const card = page.getByRole('article', {name: 'Music lighting', exact: true});
  // One section per light: the Lines (`wall`) and the NL22 Light Panels (`nl22`).
  await expect(card.getByRole('region', {name: /Music lighting$/})).toHaveCount(2);
  const light = card.getByRole('region', {name: 'wall Music lighting', exact: true});
  const panels = card.getByRole('region', {name: 'nl22 Music lighting', exact: true});
  const start = light.getByRole('button', {name: 'Start Music lighting', exact: true});
  const stop = light.getByRole('button', {name: 'Stop Music lighting', exact: true});
  const preset = light.getByRole('combobox', {name: 'Saved reactive preset', exact: true});
  await light.getByText('Idle. No Music lighting session is running.', {exact: true}).waitFor();
  await card.getByText(/No saved reactive presets yet/).waitFor();
  await expect(card.getByRole('link', {name: 'Music effect preview', exact: true})).toHaveAttribute('href', '#/module/nanoleaf/wall');
  await expect(start).toBeDisabled(); await expect(stop).toBeDisabled(); await expect(preset).toBeDisabled();
  await light.getByText(/Start unavailable: Music input is unavailable\./).waitFor();
  await page.screenshot({path: join(artifacts, 'music-lighting-empty-desktop.png'), fullPage: true});

  // Free on a named scene, one saved preset and an active Music capture, all outside the lighting card.
  await mode('free');
  assert.equal((await world.credentialAction('nanoleaf-reactive-preset-save', 'reactive-presets',
    {presetId: 'preset-green', expectedRevision: 0, name: 'Synthetic green', recipe: RECIPE})).status, 200);
  await expect(preset).toHaveValue('preset-green');
  await light.getByText(/Start unavailable: Music input is unavailable\./).waitFor();
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken);
  await light.getByText(/Start unavailable: Start measuring Music.app first/).waitFor();
  await page.getByRole('article', {name: 'Music input measurement', exact: true}).getByRole('button', {name: 'Start measuring Music', exact: true}).click();
  await expect(start).toBeEnabled();
  assert.equal(controls.length, 0, 'opening Audio and every state change send no lighting command');
  // #1614: before any read, the card explains what an ending will and won't put back.
  await light.getByText(/^Start reads what the light shows\. .*scene saved on the light or a plain colour, and leaves anything else on the last Music frame\./).waitFor();

  await start.focus(); await page.keyboard.press('Enter');
  await light.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  await light.getByText(/Start request: Completed: succeeded\. The core saved it; the light reports separately\./).waitFor();
  await light.getByText(/Start light work: Completed: succeeded\. Written to the light; the physical effect was not observed\./).waitFor();
  await light.getByText(/Preset: Synthetic green\./).waitFor();
  await light.getByText(/^This session started over a scene saved on the light\. .*puts it back at its brightness\./).waitFor();
  const first = controls[0];
  assert.equal(controls.length, 1); assert.ok(first?.data.action === 'start');
  assert.equal(first.target, 'wall'); assert.equal(first.data.presetId, 'preset-green');
  assert.equal(first.data.capture?.endpointId, producer.endpointId);
  assert.equal(first.data.capture.generation, producer.commands.at(-1)?.data.generation, 'Start binds the current capture generation');
  await expect(start).toBeDisabled(); await expect(stop).toBeEnabled();
  await page.screenshot({path: join(artifacts, 'music-lighting-active-desktop.png'), fullPage: true});

  await page.reload(); await feed(page, 'connected');
  await light.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  await page.route('**/api/sdk/v1/stream', route => route.abort()); world.dropDashboardStreams();
  await expect(stop).toBeDisabled();
  await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected'); await expect(stop).toBeEnabled();
  assert.equal(controls.length, 1, 'reload and reconnect send no lighting command');

  await stop.click();
  await light.getByText('Idle. No Music lighting session is running.', {exact: true}).waitFor();
  await light.getByText(/Last session ended: stopped on request\. The current base scene and brightness were restored\./).waitFor();
  await light.getByText(/Stop request: Completed: succeeded/).waitFor();
  assert.deepEqual(controls.map(control => control.data.action), ['start', 'stop']);

  // Source loss ends the session; capture coming back restarts nothing.
  await start.click(); await light.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  producer.pause();
  await light.getByText(/Last session ended: the Music input was lost or went stale/).waitFor({timeout: 15_000});
  await producer.start(); await expect(start).toBeEnabled(); await delay(500);
  await light.getByText('Idle. No Music lighting session is running.', {exact: true}).waitFor();
  assert.deepEqual(controls.map(control => control.data.action), ['start', 'stop', 'start'], 'no automatic restart');

  // Outside Free, Start is admitted by the core and refused by the light; nothing switches the mode.
  await mode('work');
  await light.getByText(/saved mode is not Free, so a Start would be refused/).waitFor();
  await start.click();
  await light.getByText(/Last session ended: the light refused the start \(invalid-state\)\. No restoration was attempted\./).waitFor();
  await light.getByText(/Start light work: Refused \(invalid-state\)/).waitFor();
  assert.equal(controls.length, 4);
  await mode('free'); await expect(light.getByText(/saved mode is not Free/)).toHaveCount(0);

  // #1614: a light that is off refuses the Start; the card then says what it read and what an ending would put back.
  world.nanoleafPower(false);
  await start.click();
  await light.getByText(/^Last read at .+?: (a scene saved on the light|a plain colour|streamed frames|an effect|a selection)[^.]*\. /).waitFor();
  await light.getByText(/Start light work: Refused \(invalid-state\)/).waitFor();
  assert.equal(controls.length, 5);
  world.nanoleafPower(true);

  // A stale lighting read disables controls until an explicit refresh succeeds.
  let refusedReads = 0;
  await page.route('**/api/sdk/v1/sync', async route => {
    const request = route.request().postDataJSON() as {request?: {data?: {families?: string[]}}};
    if (request.request?.data?.families?.includes('music-lighting-state') === true) {refusedReads += 1; await route.abort(); return;}
    await route.continue();
  });
  const refresh = card.getByRole('button', {name: 'Refresh lighting status', exact: true});
  await refresh.click();
  await card.getByText('Lighting status is stale or unavailable. Controls are disabled until a fresh read.', {exact: true}).waitFor();
  await expect(start).toBeDisabled(); await light.getByText(/Last known: Idle/).waitFor();
  // The stale view shows as soon as a refresh starts; the failed read must also have settled before the route goes.
  await expect.poll(() => refusedReads).toBeGreaterThan(0); await expect(refresh).toBeEnabled();
  await page.unroute('**/api/sdk/v1/sync'); await refresh.click();
  await expect(start).toBeEnabled();

  // A lost Start reply stays locked and uncertain across reload; Stop remains available and nothing is resent.
  let lost = 0;
  await page.route('**/api/sdk/v1/stream', route => route.abort());
  await page.route('**/api/sdk/v1/sync', route => route.abort());
  await page.route('**/api/v2/commands/music-lighting-control', async route => {
    world.dropDashboardStreams(); const reply = await route.fetch(); assert.equal(reply.status(), 200); lost += 1; await reply.dispose(); await route.abort();
  }, {times: 1});
  await start.click(); await light.getByText(/Start request: Uncertain result/).waitFor();
  await expect(start).toBeDisabled(); await expect(stop).toBeDisabled();
  await page.unroute('**/api/sdk/v1/sync'); await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected');
  await light.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  await expect(stop).toBeEnabled(); await page.reload(); await feed(page, 'connected');
  await light.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  await expect(stop).toBeEnabled(); await expect(start).toBeDisabled(); assert.equal(lost, 1); assert.equal(controls.length, 6);

  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390, 320]) {
    await page.emulateMedia({colorScheme}); await page.setViewportSize({width, height: 900});
    await stop.focus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: join(artifacts, `music-lighting-${colorScheme}-${String(width)}.png`), fullPage: true});
  }
  await page.setViewportSize({width: 1280, height: 900});
  await stop.click(); await light.getByText(/Last session ended: stopped on request/).waitFor();
  assert.deepEqual(controls.map(control => control.data.action), ['start', 'stop', 'start', 'start', 'start', 'start', 'stop']);

  // #1272: the Panels card starts and stops the NL22's own session through its version 1 stream; the Lines stay idle.
  const panelsStart = panels.getByRole('button', {name: 'Start Music lighting', exact: true});
  const panelsStop = panels.getByRole('button', {name: 'Stop Music lighting', exact: true});
  await panels.getByText(/saved mode is not Free, so a Start would be refused/).waitFor();
  await mode('free', 'nl22');
  await expect(panels.getByText(/saved mode is not Free/)).toHaveCount(0);
  await expect(panelsStart).toBeEnabled();
  const linesBefore = world.nanoleafState().devices[LINES_ADDRESS];
  await panelsStart.click();
  await panels.getByText('Active. The light reported that it is playing this session.', {exact: true}).waitFor();
  await panels.getByText(/Start light work: Completed: succeeded\. Written to the light; the physical effect was not observed\./).waitFor();
  await light.getByText('Idle. No Music lighting session is running.', {exact: true}).waitFor();
  await expect.poll(() => world.nanoleafState().devices[PANELS_ADDRESS]?.streamed ?? 0).toBeGreaterThan(2);
  const streaming = world.nanoleafState().devices[PANELS_ADDRESS];
  assert.deepEqual({select: streaming?.select, streaming: streaming?.streaming}, {select: '*ExtControl*', streaming: {version: 'v1', port: 60221}});
  assert.deepEqual(Object.keys(streaming?.frame ?? {}).sort(), ['200', '201', '202', '203'], 'the NL22 frames light its own panels');
  const linesNow = world.nanoleafState().devices[LINES_ADDRESS];
  assert.deepEqual({writes: linesNow?.writes, streamed: linesNow?.streamed}, {writes: linesBefore?.writes, streamed: linesBefore?.streamed}, 'the Lines are untouched');
  await page.screenshot({path: join(artifacts, 'music-lighting-panels-active-desktop.png'), fullPage: true});
  await panelsStop.click();
  await panels.getByText(/Last session ended: stopped on request\. The current base scene and brightness were restored\./).waitFor();
  assert.equal(world.nanoleafState().devices[PANELS_ADDRESS]?.select, 'Beach Waves');
  assert.deepEqual(controls.slice(-2).map(control => [control.target, control.data.action]), [['nl22', 'start'], ['nl22', 'stop']]);

  // Read-only access disables both controls and sends nothing.
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected');
  await light.getByText(/Start unavailable: Read-only access/).waitFor();
  await expect(start).toBeDisabled(); await expect(stop).toBeDisabled();
  await page.unroute('**/api/v2/authority?scope=control');

  // A microphone measurement is never offered to lights.
  const capture = page.getByRole('article', {name: 'Music input measurement', exact: true});
  await producer.close();
  // The core refuses a new producer's endpoint until it has retired the closed one, as the capture journey also waits.
  await capture.getByText('Music input is unavailable.', {exact: true}).waitFor();
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken, 'studio-mic');
  await page.reload(); await feed(page, 'connected');
  await capture.getByRole('combobox', {name: 'Audio input'}).selectOption('microphone');
  await capture.getByRole('button', {name: 'Start measuring studio-mic', exact: true}).click();
  await capture.getByText('Receiving studio-mic measurements.', {exact: true}).waitFor();
  await light.getByText(/Start unavailable: Lights use Music.app input only, never a microphone/).waitFor();
  await expect(start).toBeDisabled();
  assert.equal(controls.length, 9);
  assert.equal(sent.filter(path => path === '/api/v2/commands/music-lighting-control').length, 9);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'music-lighting', lightingCommands: controls.length, lostReplies: lost, artifacts, physical: false}));
  await context.close();
} catch (error) {
  // Hosted runs keep no screenshot, so a failure prints what each page showed before the browser closes (#1664). Each
  // page read has its own 2 s limit, since `evaluate` ignores the default timeout, and the original error always follows.
  try {
    for (const context of browser.contexts()) for (const open of context.pages()) {
      const limit = new AbortController();
      const shown = await Promise.race([open.evaluate(() => ({feed: document.querySelector('main#main')?.getAttribute('data-feed'),
        statuses: [...document.querySelectorAll('main [role=status]')].map(item => (item as HTMLElement).innerText.replace(/\s+/g, ' ').trim())}))
        .catch((failure: unknown) => String(failure)), delay(2000, 'timed out', {signal: limit.signal})]);
      limit.abort();
      console.error(JSON.stringify({journey: 'music-lighting', failed: new URL(open.url()).hash, shown}));
    }
    console.error(JSON.stringify({journey: 'music-lighting', unanswered: [...unanswered.values()]}));
    console.error(JSON.stringify({journey: 'music-lighting', warnings: world.logs.filter(record => record.severity_text !== 'INFO').slice(-20)
      .map(record => [record.event_name, record.attributes])}));
  } catch (failure) {console.error(JSON.stringify({journey: 'music-lighting', dumpFailed: String(failure)}));}
  throw error;
} finally {await browser.close(); await producer?.close(); await world.close();}
