// Real disposable core/gateway with numeric-only source data. No native helper or physical device.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {startWorld, changes, feed} from './harness.ts';
import {musicCaptureProducer} from './music-capture-producer.ts';
import {browserArtifactDirectory} from './browser-artifacts.ts';

const world = await startWorld({musicCapture: true});
let producer: Awaited<ReturnType<typeof musicCaptureProducer>> | undefined;
const browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
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
  await page.route('**/api/sdk/v1/sync', async route => {
    const request = route.request().postDataJSON() as {request?: {data?: {families?: string[]}}};
    if (request.request?.data?.families?.includes('music-capture-state') !== true) {await route.continue(); return;}
    const reply = await route.fetch(); await new Promise(resolve => {setTimeout(resolve, 150);}); await route.fulfill({response: reply});
  });
  await card.getByRole('button', {name: 'Refresh capture status'}).click();
  await card.getByText('Measurement timing is unavailable. Refresh status to check again.', {exact: true}).waitFor();
  await expect(card.getByRole('meter', {name: 'Input level', exact: true})).toHaveCount(0); await expect(stop).toBeEnabled();
  await page.unroute('**/api/sdk/v1/sync'); await card.getByRole('button', {name: 'Refresh capture status'}).click();
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
  await expect(responseControls.getByRole('combobox', {name: 'Noise gate', exact: true})).toHaveValue('off');
  await responseControls.getByRole('button', {name: 'Use suggested gate in draft', exact: true}).click();
  await responseControls.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('2');
  await responseControls.getByRole('spinbutton', {name: 'Smoothing (ms)', exact: true}).fill('0');
  await applyResponse.click();await responseControls.getByText(/Apply: Completed: succeeded/).waitFor();
  await expect(preview).toHaveAttribute('value', '0');
  await expect(micCard.getByRole('meter', {name: 'Input level', exact: true})).toHaveAttribute('value', '0.01');
  producer.level(0.25);await expect(preview).toHaveAttribute('value', '0.5');
  assert.equal(producer.commands.length, 2, 'response settings do not dispatch source or light work');

  const otherPage = await micContext.newPage();await otherPage.goto(world.url + '/#/audio');await feed(otherPage, 'connected');
  const otherResponse = otherPage.getByRole('region', {name: 'Microphone response settings'});
  await micPage.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('3');
  await otherResponse.getByRole('spinbutton', {name: 'Sensitivity', exact: true}).fill('4');
  await otherResponse.getByRole('button', {name: 'Apply response settings', exact: true}).click();
  await otherResponse.getByText(/Apply: Completed: succeeded/).waitFor();
  await responseControls.getByText(/Saved settings changed/).waitFor();
  await expect(micPage.getByRole('spinbutton', {name: 'Sensitivity', exact: true})).toHaveValue('3');
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
} finally {await browser.close(); await producer?.close(); await world.close();}
