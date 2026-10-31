import {openAudio} from './navigation-helpers.ts';
// Shared Music card journey through a real disposable runtime; all media and receivers are synthetic.
import assert from 'node:assert/strict';
import {chromium, type Route} from 'playwright';
import {expect} from 'playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {SimulatedSpeakers} from '@jimmie-potts/playback';
import {changes, feed, startWorld} from './harness.ts';

const speakers = new SimulatedSpeakers({sony: {input: 'airplay', status: 'playing', title: 'Synthetic song', artist: 'Synthetic artist', album: 'Synthetic album'}});
const world = await startWorld({lighting: true, playbackArtwork: {speakers, fetch: () => Promise.resolve({ok: false, code: 'unavailable', transient: false})}});
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const sent = changes(page);
  await page.goto(world.url); await feed(page, 'connected');
  const card = page.getByRole('article', {name: 'Music living-room', exact: true});
  await card.getByText('Synthetic song', {exact: true}).waitFor();
  await card.getByText('Synthetic album', {exact: true}).waitFor();
  await card.getByText('Now playing', {exact: true}).waitFor();
  await card.getByText('Audio output · Not reported', {exact: true}).waitFor();
  assert.equal(await card.getByText('No command sent from this page.', {exact: true}).count(), 0, 'the idle Music face omits routine command boilerplate');
  assert.equal(await card.getByRole('tab').count(), 0); assert.equal(await card.locator('details').count(), 0);
  assert.deepEqual(await card.locator('fieldset button').allTextContents(), ['Previous', 'Pause', 'Next']);
  assert.equal(await card.locator('.playback-artwork').count(), 1);
  await openAudio(page); assert.equal(new URL(page.url()).hash, '#/audio');
  await card.getByText('Synthetic album', {exact: true}).waitFor();
  await page.getByText('Show in rooms', {exact: true}).click();
  await page.getByText('Create rooms on the Rooms page first.', {exact: true}).waitFor();
  assert.equal(sent.length, 0, 'viewing Home and Audio sends no commands');
  const layout = {rooms: [{id: 'studio', name: 'Studio'}, {id: 'kitchen', name: 'Kitchen'}], assignments: [], groups: [], home: null};
  const response = await page.request.post(world.url + '/api/v2/commands/lighting-layout-set', {headers: {origin: world.url, 'bunny-request': '1'}, data: {target: 'lighting', requestId: 'prepare-music-rooms', data: {expectedRevision: 0, layout}}});
  assert.equal(response.status(), 200);
  const studio = page.getByRole('checkbox', {name: 'Show living-room in Studio', exact: true});
  await studio.check(); await page.getByRole('button', {name: 'Save room placement', exact: true}).focus(); await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText: 'Room placement saved.'}).waitFor();
  assert.equal(sent.filter(url => url.endsWith('/playback-layout-set')).length, 1);
  await page.getByRole('link', {name: 'Rooms', exact: true}).click();
  const room = page.getByRole('region', {name: 'Studio audio', exact: true}); await room.getByRole('article', {name: 'Music living-room', exact: true}).waitFor();
  assert.equal(await page.getByRole('region', {name: 'Kitchen audio', exact: true}).count(), 0);
  const second = await context.newPage(); const secondSent = changes(second); await second.goto(world.url + '/#/rooms'); await feed(second, 'connected');
  await second.getByRole('region', {name: 'Studio audio', exact: true}).waitFor(); assert.equal(secondSent.length, 0); await second.close();
  await world.restart(); await page.reload(); await feed(page, 'connected'); await room.waitFor();
  assert.equal(sent.filter(url => url.endsWith('/playback-layout-set')).length, 1, 'restart and reload never replay placement');
  const roomsState = async (): Promise<number> => {
    const response = await page.request.get(world.url + '/api/v2/snapshot?families=lighting-layout&owner=bunny%2Fcore');
    const body = await response.json() as {records: {'lighting-layout': {revision: number}[]}};
    const revision = body.records['lighting-layout'][0]?.revision; assert.ok(revision !== undefined); return revision;
  };
  for (const remove of [true, false]) {
    const response = await page.request.post(world.url + '/api/v2/commands/lighting-layout-set', {headers: {origin: world.url, 'bunny-request': '1'},
      data: {target: 'lighting', requestId: crypto.randomUUID(), data: {expectedRevision: await roomsState(), layout: {...layout, rooms: remove ? layout.rooms.filter(room => room.id !== 'studio') : layout.rooms}}}});
    assert.equal(response.status(), 200);
    await expect(room).toHaveCount(remove ? 0 : 1);
  }
  await page.goto(world.url + '/#/music/living-room'); await feed(page, 'connected'); await card.getByText('Synthetic album', {exact: true}).waitFor();
  await card.getByRole('button', {name: 'Pause', exact: true}).click();
  await card.getByRole('status').filter({hasText: /Completed: succeeded/}).waitFor();
  assert.equal(await card.getByRole('button', {name: 'Play', exact: true}).isDisabled(), true);
  await card.getByText('Resume from your iPhone.', {exact: true}).waitFor();
  assert.equal(sent.filter(url => url.endsWith('/playback-control')).length, 1);
  await openAudio(page); await page.getByText('Show in rooms', {exact: true}).click();
  await studio.waitFor(); assert.equal(await studio.isChecked(), true);
  await page.route('**/api/sdk/v1/sync', route => route.abort());
  await page.route('**/api/sdk/v1/stream', route => route.abort()); world.dropDashboardStreams();
  await card.getByText('Stale', {exact: true}).waitFor(); assert.equal(await card.getByRole('button', {name: 'Next', exact: true}).isDisabled(), true);
  assert.equal(await page.getByRole('button', {name: 'Save room placement', exact: true}).isDisabled(), true);
  await page.unroute('**/api/sdk/v1/sync'); await page.unroute('**/api/sdk/v1/stream'); await feed(page, 'connected');
  await page.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
  await page.getByRole('checkbox', {name: 'Show living-room in Kitchen', exact: true}).check();
  let releaseSave = (): void => {};
  const saveReplyGate = new Promise<void>(resolve => {releaseSave = resolve;});
  let competingSaved = false;
  let releaseRefresh = (): void => {};
  const refreshReplyGate = new Promise<void>(resolve => {releaseRefresh = resolve;});
  const fetchedRefreshFamilies = new Set<string>();
  const holdPlacementRefresh = async (route: Route): Promise<void> => {
    const call = route.request().postDataJSON() as {owner?: string; request?: {data?: {families?: string[]}}};
    const families = call.request?.data?.families ?? [];
    const family = families.length === 1 ? families[0] : undefined;
    if (call.owner !== 'bunny/core' || family !== 'lighting-layout' && family !== 'playback-layout') {await route.continue(); return;}
    const response = await route.fetch(); assert.equal(response.status(), 200);
    fetchedRefreshFamilies.add(family);
    await refreshReplyGate; await route.fulfill({response});
  };
  await page.route('**/api/v2/commands/playback-layout-set', async route => {
    const original = route.request().postDataJSON() as {data: {expectedRevision: number}};
    const competing = await page.request.post(world.url + '/api/v2/commands/playback-layout-set', {headers: {origin: world.url, 'bunny-request': '1'},
      data: {target: 'playback', requestId: 'competing-placement', data: {expectedRevision: original.data.expectedRevision, assignments: [{playback: 'living-room', rooms: ['studio']}]}}});
    assert.equal(competing.status(), 200); competingSaved = true; await saveReplyGate; await route.continue();
  }, {times: 1});
  try {
    await page.getByRole('button', {name: 'Save room placement', exact: true}).click();
    await expect.poll(() => competingSaved, {timeout: 10_000}).toBe(true);
    await page.route('**/api/sdk/v1/sync', holdPlacementRefresh);
    await page.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
    await expect.poll(() => [...fetchedRefreshFamilies].sort()).toEqual(['lighting-layout', 'playback-layout']);
    const conflictReply = page.waitForResponse(response => response.url().endsWith('/api/v2/commands/playback-layout-set'));
    releaseSave();
    const conflict = await (await conflictReply).json() as {error: {code: string}};
    assert.equal(conflict.error.code, 'revision-conflict');
    // A stale placement copy masks the saved refusal until this explicit refresh settles.
    await page.getByText('Placement records are unavailable or stale. Editing is read-only.', {exact: true}).waitFor();
    assert.equal(await studio.isDisabled(), true);
    releaseRefresh();
    await page.getByRole('status').filter({hasText: /revision-conflict/}).waitFor();
    assert.equal(await studio.isDisabled(), true, 'refresh started before refusal cannot acknowledge that conflict');
  } finally {
    releaseSave(); releaseRefresh(); await page.unroute('**/api/sdk/v1/sync', holdPlacementRefresh);
  }
  const failedRefreshFamilies = new Set<string>();
  await page.route('**/api/sdk/v1/sync', async route => {
    const call = route.request().postDataJSON() as {owner?: string; request?: {data?: {families?: string[]}}};
    await route.abort();
    const families = call.request?.data?.families ?? [];
    if (call.owner === 'bunny/core' && families.length === 1
      && (families[0] === 'lighting-layout' || families[0] === 'playback-layout')) failedRefreshFamilies.add(families[0]);
  });
  await page.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
  // Refresh marks copies stale before sending requests. Keep the fault until both required reads actually fail.
  await expect.poll(() => [...failedRefreshFamilies].sort()).toEqual(['lighting-layout', 'playback-layout']);
  await page.getByText('Placement records are unavailable or stale. Editing is read-only.', {exact: true}).waitFor();
  await page.unroute('**/api/sdk/v1/sync');
  await page.getByRole('status').filter({hasText: /revision-conflict/}).waitFor();
  assert.equal(await studio.isDisabled(), true, 'a failed refresh cannot be satisfied by automatic sync recovery');
  await page.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
  await expect(studio).toBeEnabled();
  const faultContext = await browser.newContext();
  try {
    const fault = await faultContext.newPage(); fault.setDefaultTimeout(10_000); const faultSends = changes(fault); let forwarded = 0;
    await fault.goto(world.url + '/#/audio'); await feed(fault, 'connected'); await fault.getByText('Show in rooms', {exact: true}).click();
    await fault.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
    await fault.getByRole('checkbox', {name: 'Show living-room in Kitchen', exact: true}).check();
    await fault.route('**/api/sdk/v1/stream', route => route.abort());
    await fault.route('**/api/sdk/v1/sync', route => route.abort());
    await fault.route('**/api/v2/commands/playback-layout-set', async route => {
      world.dropDashboardStreams(); const reply = await route.fetch(); assert.equal(reply.status(), 200); forwarded++; await reply.dispose(); await route.abort();
    });
    await fault.getByRole('button', {name: 'Save room placement', exact: true}).click();
    await fault.getByRole('button', {name: 'Refresh placement records', exact: true}).waitFor();
    assert.equal(await fault.getByRole('button', {name: 'Save room placement', exact: true}).isDisabled(), true);
    assert.equal(faultSends.length, 1, 'an uncertain save is never retried');
    await fault.unroute('**/api/sdk/v1/sync'); await fault.unroute('**/api/sdk/v1/stream'); await feed(fault, 'connected');
    await fault.getByRole('status').filter({hasText: 'Room placement saved.'}).waitFor();
    const kitchen = fault.getByRole('checkbox', {name: 'Show living-room in Kitchen', exact: true});
    assert.equal(await kitchen.isDisabled(), true, 'automatic stream recovery still requires explicit review after an uncertain save');
    await fault.getByRole('button', {name: 'Refresh placement records', exact: true}).click();
    await expect(kitchen).toBeEnabled();
    assert.equal(faultSends.length, 1, 'refresh never retries an uncertain save');
    await fault.reload(); await feed(fault, 'connected');
    await fault.getByText('Show in rooms', {exact: true}).click();
    await expect(fault.getByRole('checkbox', {name: 'Show living-room in Kitchen', exact: true})).toBeChecked();
    assert.equal(forwarded, 1); assert.equal(faultSends.length, 1, 'reload reconciles the actual committed placement without replay');
  } finally {await faultContext.close();}
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected'); await page.getByText('Show in rooms', {exact: true}).click();
  assert.equal(await studio.isDisabled(), true); assert.equal(await card.getByRole('button', {name: 'Next', exact: true}).isDisabled(), true);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme});
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); assert.deepEqual(axe.violations.map(v => v.id), []);
  }
  if (process.env.DASHBOARD_RECEIPTS !== undefined) await page.screenshot({path: process.env.DASHBOARD_RECEIPTS + '/music-card-phone.png', fullPage: true});
  assert.equal(sent.filter(url => url.endsWith('/playback-control')).length, 1, 'only the explicit synthetic pause sent playback');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'reusable-music', home: true, audio: true, rooms: true, restart: true, readOnly: true, stale: true,
    failedRefreshAborts: [...failedRefreshFamilies].sort(), physical: false}));
  await context.close();
} finally {await browser.close(); await world.close();}
