// Real disposable core/gateway with numeric-only source data. No native helper or physical device.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {connectRemote} from '@jimmie-potts/sdk';
import type {CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import {startWorld, changes, feed} from './harness.ts';
import {musicCaptureProducer} from './music-capture-producer.ts';
import {browserArtifactDirectory} from './browser-artifacts.ts';

type Shown = {feed: string | null; card: string[] | null; level: string | null; response: string[] | null; suggestion: string; waitingForInput: boolean | null};
/**
 * Runs in each microphone page before its own scripts (#1698): keeps every change in what the capture card shows, with
 * its wall time, so a failure can tell a measurement the core retired from a page that stopped counting its frames
 * fresh or lost its feed. It only observes; nothing waits on it, and a passing run never reads it.
 */
function recordCaptureCard(): void {
  const text = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const statuses = (root: Element | null, skip: Element | null): string[] | null => root === null ? null
    : [...root.querySelectorAll('[role=status]')].filter(item => skip === null || !skip.contains(item)).map(text);
  const show = (): Shown => {
    const card = document.querySelector('article[aria-label="Music input measurement"]');
    const region = card?.querySelector('section[aria-label="Microphone response settings"]') ?? null;
    const use = region === null ? undefined : [...region.querySelectorAll('button')].find(button => text(button) === 'Use suggested gate in draft');
    return {feed: document.querySelector('main#main')?.getAttribute('data-feed') ?? null, card: statuses(card, region),
      level: card?.querySelector('.music-input-level meter')?.getAttribute('value') ?? null, response: statuses(region, null),
      suggestion: use === undefined ? 'absent' : use.disabled ? 'disabled' : 'enabled',
      waitingForInput: region === null ? null : [...region.querySelectorAll('.music-note')].some(item => text(item).startsWith('Start the selected microphone'))};
  };
  const timeline: (Shown & {at: number})[] = [];
  let last = '';
  const note = (): void => {
    const shown = show(), key = JSON.stringify(shown);
    if (key === last) return;
    last = key; timeline.push({at: Date.now(), ...shown});
    if (timeline.length > 60) timeline.shift();
  };
  (globalThis as unknown as {captureJourney: unknown}).captureJourney = {show, timeline};
  new MutationObserver(note).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
}

const world = await startWorld({musicCapture: true});
let producer: Awaited<ReturnType<typeof musicCaptureProducer>> | undefined;
const browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
// Failure-only facts for #1698, all recorded passively: the wall time of each step around the suggested gate, and this
// process's event-loop delay. The producer fixture and the core run in this process, so a long stall here stops frames.
// Each stall of 200 ms or more is kept with the wall time it began.
const marks: Record<string, number> = {};
const loopDelay = monitorEventLoopDelay({resolution: 10}); loopDelay.enable();
const stalls: {at: number; blockedMs: number}[] = [];
let lastTick = performance.now();
const stallWatch = setInterval(() => {
  const now = performance.now();
  if (now - lastTick >= 250) {stalls.push({at: Math.round(Date.now() - (now - lastTick)), blockedMs: Math.round(now - lastTick - 50)}); if (stalls.length > 20) stalls.shift();}
  lastTick = now;
}, 50);
stallWatch.unref();
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const sent = changes(page);
  await page.goto(world.url + '/#/audio'); await feed(page, 'connected');
  const card = page.getByRole('article', {name: 'Music input measurement', exact: true});
  const start = card.getByRole('button', {name: 'Start measuring Music', exact: true});
  const stop = card.getByRole('button', {name: 'Stop measuring', exact: true});
  await card.getByText('Music producer is off.', {exact: true}).waitFor(); await expect(start).toBeDisabled();
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken);
  await expect(start).toBeEnabled(); assert.equal(producer.commands.length, 0); assert.equal(sent.length, 0);
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0); await start.focus(); await page.keyboard.press('Enter');
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.25');
  await card.getByText(/Start: Completed: succeeded/).waitFor(); assert.equal(producer.commands.length, 1);
  // A loaded runner delays the producer's timer (#1511). Like a capture helper, the fixture then delivers the windows
  // that ended meanwhile, so measurements stay fresh instead of falling permanently behind the core's clock.
  const stalled = Date.now(); while (Date.now() - stalled < 1000) {/* hold this process's event loop */}
  await delay(1000); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.25');
  await page.screenshot({path: join(artifacts, 'music-capture-active-desktop.png'), fullPage: true});
  // A capture-state sync slower than the clock bound (100 ms) leaves measurement timing unqualified. The feed syncs again
  // on its own with backoff, so one slow reply, as on a loaded page load, recovers without Refresh (#1580).
  let slowSyncs = 1;
  await page.route('**/api/sdk/v1/sync', async route => {
    const request = route.request().postDataJSON() as {request?: {data?: {families?: string[]}}};
    if (request.request?.data?.families?.includes('music-capture-state') !== true || slowSyncs === 0) {await route.continue(); return;}
    slowSyncs -= 1; const reply = await route.fetch(); await new Promise(resolve => {setTimeout(resolve, 150);}); await route.fulfill({response: reply});
  });
  await card.getByRole('button', {name: 'Refresh capture status'}).click();
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1); assert.equal(slowSyncs, 0);
  // When every recheck is slow too, the bounded rechecks end and timing stays unavailable until Refresh.
  slowSyncs = Infinity; await card.getByRole('button', {name: 'Refresh capture status'}).click();
  await card.getByText('Checking measurement timing again.', {exact: true}).waitFor();
  await card.getByText('Measurement timing is unavailable. Refresh status to check again.', {exact: true}).waitFor({timeout: 15_000});
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0); await expect(stop).toBeEnabled();
  slowSyncs = 0; await page.unroute('**/api/sdk/v1/sync'); await card.getByRole('button', {name: 'Refresh capture status'}).click();
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1);
  producer.level(0); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0');
  producer.pause(); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0); await card.getByText('Measurements are stale.', {exact: true}).waitFor();
  await producer.emit({generation: '22222222-2222-4222-8222-222222222222'}); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  await producer.start(); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1);
  const second = await context.newPage(); await second.goto(world.url + '/#/audio'); await feed(second, 'connected');
  await second.getByRole('meter', {name: 'Input level', exact: true}).waitFor(); assert.equal(producer.commands.length, 1); await second.close();
  await page.reload(); await feed(page, 'connected'); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1); assert.equal(producer.commands.length, 1);
  await page.route('**/api/sdk/v1/stream', route => route.abort()); world.dropDashboardStreams();
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0); await expect(stop).toBeDisabled();
  await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected'); await expect(stop).toBeEnabled();
  assert.equal(producer.commands.length, 1);
  await stop.click(); await card.getByText(/Stop: Completed: succeeded/).waitFor(); await expect(start).toBeEnabled();
  assert.equal(producer.commands.length, 2); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  producer.automatic(false);
  await page.route('**/api/sdk/v1/stream', route => route.abort());
  await page.route('**/api/sdk/v1/sync', route => route.abort());
  let lostReplies = 0;
  await page.route('**/api/v2/commands/music-capture-control', async route => {
    world.dropDashboardStreams(); const reply = await route.fetch(); assert.equal(reply.status(), 200);
    lostReplies += 1; await reply.dispose(); await route.abort();
  }, {times: 1});
  await start.click(); await card.getByText(/Start: Uncertain result/).waitFor();
  await expect(start).toBeDisabled(); assert.equal(producer.commands.length, 3);
  await page.unroute('**/api/sdk/v1/sync'); await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected');
  await expect(stop).toBeEnabled(); await page.reload(); await feed(page, 'connected');
  await expect(stop).toBeEnabled(); assert.equal(producer.commands.length, 3); assert.equal(lostReplies, 1);
  await card.getByText('Starting measurement. Waiting for source evidence.', {exact: true}).waitFor(); await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  await stop.click(); await card.getByText(/Stop: Completed: succeeded/).waitFor();
  assert.deepEqual(producer.commands.map(command => command.data.action), ['start', 'stop', 'start', 'stop']);
  const readsOnly = await page.request.post(world.url + '/api/v2/commands/music-capture-control', {
    headers: {authorization: `Bearer ${world.readerToken}`, 'content-type': 'application/json'},
    data: {target: 'music', requestId: 'reader-start', data: {action: 'start', input: 'music', endpointId: producer.endpointId, expectedRevision: 0}},
  });
  assert.equal(readsOnly.status(), 403); assert.equal(producer.commands.length, 4);
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected'); await card.getByText('Read-only access. Capture controls are disabled.', {exact: true}).waitFor();
  await expect(start).toBeDisabled(); await expect(stop).toBeDisabled(); assert.equal(producer.commands.length, 4);

  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390, 320]) {
    await page.emulateMedia({colorScheme}); await page.setViewportSize({width, height: 900});
    await card.getByRole('button', {name: 'Refresh capture status'}).focus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: join(artifacts, `music-capture-${colorScheme}-${width}.png`), fullPage: true});
  }
  const replacement = await browser.newContext(); const replacementPage = await replacement.newPage(); replacementPage.setDefaultTimeout(10_000);
  await replacementPage.goto(world.url + '/#/audio'); await feed(replacementPage, 'connected');
  const replacementCard = replacementPage.getByRole('article', {name: 'Music input measurement', exact: true});
  producer.automatic(true); producer.level(0.5);
  await replacementCard.getByRole('button', {name: 'Start measuring Music', exact: true}).click();
  await expect(replacementCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.5');
  const generations = producer.commands.filter(command => command.data.action === 'start').map(command => command.data.generation);
  assert.equal(new Set(generations).size, 3, 'each explicit start gets a new authoritative generation');
  await producer.close(); await expect(replacementCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  await expect(replacementCard.getByRole('button', {name: 'Stop measuring', exact: true})).toBeDisabled();
  await replacementCard.getByText('Music input is unavailable.', {exact: true}).waitFor();
  await replacement.close();
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken, 'studio-mic');
  const micContext = await browser.newContext({viewport: {width: 390, height: 900}, reducedMotion: 'reduce'});
  await micContext.addInitScript(recordCaptureCard);
  const micPage = await micContext.newPage();micPage.setDefaultTimeout(10_000);
  micPage.on('pageerror', error => errors.push(error.message));
  await micPage.goto(world.url + '/#/audio');await feed(micPage, 'connected');
  const micCard = micPage.getByRole('article', {name: 'Music input measurement', exact: true});
  const input = micCard.getByRole('combobox', {name: 'Audio input'});
  await expect(input).toBeEnabled();await input.selectOption('microphone');
  assert.equal(producer.commands.length, 0, 'choosing a configured alias starts no capture');
  await micCard.getByText(/studio-mic is configured/).waitFor();
  const micStart = micCard.getByRole('button', {name: 'Start measuring studio-mic', exact: true});
  producer.refuse(true);await micStart.click();
  await micCard.getByText(/Selected microphone is unavailable. Check its connection and microphone permission/).waitFor();
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0);
  await expect(micStart).toBeEnabled();producer.refuse(false);await micStart.click();
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.25');
  await micCard.getByText('Receiving studio-mic measurements.', {exact: true}).waitFor();
  const micCommand = producer.commands[1];assert.ok(micCommand?.data.action === 'start' && micCommand.data.input === 'microphone');
  assert.equal(micCommand.data.microphoneId, 'studio-mic');assert.ok(micCommand.dataschema.endsWith('/2.1'));
  await micPage.reload();await feed(micPage, 'connected');await expect(input).toHaveValue('microphone');
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1);assert.equal(producer.commands.length, 2);
  const responseControls = micCard.getByRole('region', {name: 'Microphone response settings'});
  const preview = responseControls.getByRole('meter', {name: 'Response preview', exact: true});
  const measureQuiet = responseControls.getByRole('button', {name: 'Measure quiet input', exact: true});
  const applyResponse = responseControls.getByRole('button', {name: 'Apply response settings', exact: true});
  producer.level(0.01);await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.01');
  await measureQuiet.focus();await micPage.keyboard.press('Enter');
  await responseControls.getByText(/Measuring five seconds/).waitFor();
  await expect(micCard.getByRole('button', {name: 'Stop measuring', exact: true})).toBeEnabled();
  await responseControls.getByRole('button', {name: 'Cancel quiet measurement', exact: true}).click();
  await responseControls.getByText(/Quiet measurement is inactive: cancelled/).waitFor();
  assert.equal(producer.commands.length, 2, 'calibration cancellation changes no source work');
  await measureQuiet.click();await responseControls.getByText(/Suggested gate: 0.0200 RMS/).waitFor({timeout: 15000});
  marks.measured = Date.now(); loopDelay.reset();
  await expect(responseControls.getByRole('combobox', {name: 'Noise gate', exact: true})).toHaveValue('off');
  await responseControls.getByRole('button', {name: 'Use suggested gate in draft', exact: true}).click();
  await responseControls.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('2');
  await responseControls.getByRole('spinbutton', {name: 'Smoothing (ms)', exact: true}).fill('0');
  await applyResponse.click();await responseControls.getByText(/Apply: Completed: succeeded/).waitFor();marks.applied = Date.now();
  await expect(preview).toHaveAttribute('value', '0');
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.01');
  producer.level(0.25);await expect(preview).toHaveAttribute('value', '0.5');
  assert.equal(producer.commands.length, 2, 'response settings do not dispatch source or light work');

  const otherPage = await micContext.newPage();await otherPage.goto(world.url + '/#/audio');await feed(otherPage, 'connected');marks.otherOpened = Date.now();
  const otherResponse = otherPage.getByRole('region', {name: 'Microphone response settings'});
  await micPage.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('3');
  await otherResponse.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('4');
  await otherResponse.getByRole('button', {name: 'Apply response settings', exact: true}).click();
  await otherResponse.getByText(/Apply: Completed: succeeded/).waitFor();marks.otherApplied = Date.now();
  await responseControls.getByText(/Saved settings changed/).waitFor();
  await expect(micPage.getByRole('spinbutton', {name: 'Sensitivity', exact: true})).toHaveValue('3');
  marks.useSuggested = Date.now();
  await responseControls.getByRole('button', {name: 'Use suggested gate in draft', exact: true}).click();
  await responseControls.getByText(/Saved settings changed/).waitFor();
  await expect(applyResponse).toBeDisabled();await responseControls.getByRole('button', {name: 'Keep my draft', exact: true}).click();
  await applyResponse.click();await expect(preview).toHaveAttribute('value', '0.75');await otherPage.close();

  let lostApply = 0;
  await responseControls.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('2.5');
  await micPage.route('**/api/v2/commands/music-capture-control', async route => {
    const body = route.request().postDataJSON() as {data?: {action?: string}};
    if (body.data?.action !== 'apply-tuning') {await route.continue();return;}
    const reply = await route.fetch();assert.equal(reply.status(), 200);lostApply += 1;await reply.dispose();await route.abort();
  }, {times: 1});
  await applyResponse.click();await expect(preview).toHaveAttribute('value', '0.625');
  await micPage.reload();await feed(micPage, 'connected');await expect(preview).toHaveAttribute('value', '0.625');
  assert.equal(lostApply, 1);assert.equal(producer.commands.length, 2);
  await micCard.getByRole('button', {name: 'Stop measuring', exact: true}).click();await expect(input).toBeEnabled();
  await input.selectOption('microphone');await expect(micStart).toBeEnabled();
  await micStart.click();await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.25');
  await responseControls.getByText(/Saved gate is inactive for this capture/).waitFor();await expect(preview).toHaveCount(0);await expect(applyResponse).toBeDisabled();
  await responseControls.getByRole('combobox', {name: 'Noise gate', exact: true}).selectOption('manual');
  await applyResponse.click();await expect(preview).toHaveAttribute('value', '0.625');
  await responseControls.getByText(/Manual threshold, uncalibrated/).waitFor();
  producer.pause();
  const incoherentAt = Date.now() - 200;
  await producer.emit({observedAtMs: incoherentAt, validUntilMs: incoherentAt + 400});
  await responseControls.getByText(/Saved gate is inactive for this capture/).waitFor();
  producer.level(0.3);await producer.start();
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.3');
  producer.level(0.25);
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.25');
  await new Promise(resolve => setTimeout(resolve, 250));
  await expect(preview).toHaveCount(0);
  await applyResponse.click();await expect(preview).toHaveAttribute('value', '0.625');
  await new Promise(resolve => setTimeout(resolve, 350));
  await expect(preview).toHaveAttribute('value', '0.625');
  assert.equal(producer.commands.length, 4, 'clock retirement and manual reapplication leave raw capture running');
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390, 320]) {
    await micPage.emulateMedia({colorScheme});await micPage.setViewportSize({width, height: 900});
    await micCard.getByRole('button', {name: 'Refresh capture status'}).focus();
    assert.equal(await micPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect(preview).toHaveAttribute('value', '0.625');
    await micPage.screenshot({path: join(artifacts, `selected-microphone-${colorScheme}-${width}.png`), fullPage: true});
  }
  await micCard.getByRole('button', {name: 'Stop measuring', exact: true}).click();await expect(input).toBeEnabled();
  await input.selectOption('music');await micCard.getByRole('button', {name: 'Start measuring Music', exact: true}).click();
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(1);
  assert.equal(producer.commands.at(-1)?.dataschema, 'https://bunny.invalid/events/music-capture-work/2.0');
  await micContext.close();await producer.close();
  const longAlias = 'm'.repeat(64);
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken, longAlias);
  const boundedContext = await browser.newContext({viewport: {width: 320, height: 900}, reducedMotion: 'reduce'});
  const boundedPage = await boundedContext.newPage();boundedPage.setDefaultTimeout(10_000);
  await boundedPage.goto(world.url + '/#/audio');await feed(boundedPage, 'connected');
  const boundedCard = boundedPage.getByRole('article', {name: 'Music input measurement', exact: true});
  await boundedCard.getByRole('combobox', {name: 'Audio input'}).selectOption('microphone');
  assert.equal(await boundedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'maximum alias fits before capture');
  await boundedCard.getByRole('button', {name: `Start measuring ${longAlias}`, exact: true}).focus();
  await boundedPage.keyboard.press('Enter');await boundedCard.getByRole('meter', {name: 'Input level', exact: true}).waitFor();
  assert.equal(producer.commands.length, 1);
  assert.equal(await boundedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'maximum alias fits during capture');
  await boundedPage.screenshot({path: join(artifacts, 'selected-microphone-max-alias-320.png'), fullPage: true});
  await boundedContext.close();assert.deepEqual(errors, []);
  await context.close();
} catch (error) {
  // Hosted runs keep no screenshot, so a failure prints, before the browser closes, what each page showed and how its
  // capture card changed, the core's capture state and this process's stalls (#1698), as the Music lighting journey
  // prints its pages (#1664). Times are milliseconds from the completed quiet measurement, or from this dump without one.
  // Each read has its own limit, since `evaluate` ignores the default timeout, and the original error always follows.
  const journey = 'music-capture', dumped = Date.now(), origin = marks.measured ?? dumped, since = (at: number): number => at - origin;
  const bounded = async <T>(read: Promise<T>, ms: number): Promise<T | string> => {
    const limit = new AbortController();
    try {return await Promise.race([read.catch((failure: unknown) => String(failure)), delay(ms, 'timed out', {signal: limit.signal})]);} finally {limit.abort();}
  };
  try {
    console.error(JSON.stringify({journey, from: marks.measured === undefined ? 'dump' : 'measured', dumpedAt: since(dumped),
      marks: Object.fromEntries(Object.entries(marks).map(([name, at]) => [name, since(at)]))}));
    for (const [contextIndex, context] of browser.contexts().entries()) for (const [pageIndex, open] of context.pages().entries()) {
      const page = `${contextIndex}.${pageIndex} ${new URL(open.url()).hash}`;
      const read = await bounded(open.evaluate(() => {
        const recorder = (globalThis as unknown as {captureJourney?: {show: () => unknown; timeline: unknown[]}}).captureJourney;
        return recorder === undefined ? {statuses: [...document.querySelectorAll('main [role=status]')].map(item => (item.textContent ?? '').replace(/\s+/g, ' ').trim())}
          : {shown: recorder.show(), timeline: recorder.timeline};
      }), 2000);
      // Each timeline entry lists only what changed from the entry before it.
      const timeline = typeof read === 'string' || !('timeline' in read) ? undefined : (read.timeline as (Record<string, unknown> & {at: number})[])
        .map(({at, ...shown}, index, all) => ({t: since(at), ...Object.fromEntries(Object.entries(shown)
          .filter(([key, value]) => index === 0 || JSON.stringify(value) !== JSON.stringify((all[index - 1] as Record<string, unknown>)[key])))}));
      console.error(JSON.stringify({journey, page, ...(typeof read === 'string' ? {unread: read} : 'shown' in read ? {shown: read.shown} : read)}));
      if (timeline !== undefined) console.error(JSON.stringify({journey, page, timeline}));
    }
    const core = await bounded((async () => {
      const reader = await connectRemote({url: world.url, source: 'bunny/parts/reader', token: world.readerToken});
      try {
        const answer = await reader.sync<CaptureState>(['music-capture-state'], () => {}, {owner: 'bunny/core', timeoutMs: 3000});
        const state = answer.status === 'synced' ? answer.copy.states()[0]?.data : undefined;
        if (state === undefined) return answer.status;
        const response = state.response, session = state.session;
        return {revision: state.revision, availability: state.availability, session: session.status, response: response === undefined ? null : {
          settingsRevision: response.settingsRevision, gate: response.settings.gate.mode,
          calibration: response.calibration.status === 'ended' ? `ended: ${response.calibration.reason}` : response.calibration.status,
          evidenceMatches: response.calibration.status !== 'idle' && response.evidence?.id === response.calibration.operationId,
          appliedTo: response.appliedTo === null ? null : 'generation' in session && response.appliedTo.generation === session.generation ? 'this capture' : 'another capture'}};
      } finally {await reader.close();}
    })(), 5000);
    console.error(JSON.stringify({journey, core}));
    console.error(JSON.stringify({journey, maxLoopDelayMs: Math.round(loopDelay.max / 1e6), p99LoopDelayMs: Math.round(loopDelay.percentile(99) / 1e6),
      stalls: stalls.map(stall => ({t: since(stall.at), blockedMs: stall.blockedMs})), producerCommands: producer?.commands.length ?? null}));
    // Refused syncs of other families recur through the whole journey and would push out the records that matter here.
    console.error(JSON.stringify({journey, warnings: world.logs.filter(record => record.severity_text !== 'INFO' &&
      (record.event_name !== 'runtime.sync.refused' || String(record.attributes['bunny.pattern']).includes('music-capture'))).slice(-20)
      .map(record => [record.timestamp === undefined ? null : since(Date.parse(record.timestamp)), record.event_name, record.attributes])}));
  } catch (failure) {console.error(JSON.stringify({journey, dumpFailed: String(failure)}));}
  throw error;
} finally {clearInterval(stallWatch); loopDelay.disable(); await browser.close(); await producer?.close(); await world.close();}
