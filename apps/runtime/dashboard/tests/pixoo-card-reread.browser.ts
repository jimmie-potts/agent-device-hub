// The Pixoo card keeps its controls through a routine re-read of the player, and a press during that read sends the one
// command its label names (#2124). The card's genuine blocks still disable every control. A disposable real owner, a
// synthetic still image and held reads only; no installed services or devices.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium, expect, type Locator, type Route} from 'playwright/test';
import sharp from 'sharp';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import {SIMULATED_SECTION} from '@jimmie-potts/pixoo';
import {feed, startWorld} from './harness.ts';

const deviceId = SIMULATED_SECTION.config.device.id;
const world = await startWorld({pixooPages: true});
const browser = await chromium.launch({headless: true});
const results: Record<string, boolean | string> = {};
let evidence = (): Promise<string> => Promise.resolve('none');
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => { errors.push(error.error().name); });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  // Every command request the page makes, with its body: the card's presses and this journey's own setup requests.
  const bodies: {path: string; data: Record<string, unknown>}[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('/api/v2/commands/')) return;
    const body = JSON.parse(request.postData() ?? '{}') as {data?: Record<string, unknown>};
    bodies.push({path: new URL(request.url()).pathname, data: body.data ?? {}});
  });
  // On a miss, what the page showed: the route, the feed, each Home Pixoo placement, each Pixoo card with its shape,
  // state line, result line and buttons, the reads held or answered, and the device and display records the runtime holds.
  let reads = 0;
  evidence = async (): Promise<string> => JSON.stringify({heldReads: held.length, reads, hold, failReads, page: await page.evaluate(async id => {
    const snapshot = async (family: string): Promise<unknown> => ((await (await fetch(`/api/v2/snapshot?families=${family}&owner=bunny/modules/pixoo`)).json()) as {records: Record<string, {id: string}[]>}).records[family]?.find(value => value.id === id);
    return {hash: location.hash, feed: document.querySelector('main#main')?.getAttribute('data-feed') ?? null,
      // A Home placement without a Pixoo card in it shows here by its text, such as the card's loading line.
      home: [...document.querySelectorAll('[data-home-card^="device:bunny/modules/pixoo:"]')].map(node => ({shape: node.getAttribute('data-home-shape'),
        packed: node.closest('.home-layout-grid')?.getAttribute('data-packed') ?? null, text: node.textContent.slice(0, 200)})),
      cards: [...document.querySelectorAll('article.pixoo-card')].map(node => ({home: node.closest('[data-home-card]')?.getAttribute('data-home-card') ?? null,
        shape: node.getAttribute('data-pixoo-shape'), state: node.querySelector('.light-card-heading p')?.textContent ?? null,
        result: node.querySelector('[role=status]')?.textContent ?? null, alert: node.querySelector('[role=alert]')?.textContent ?? null,
        buttons: [...node.querySelectorAll('button')].map(button => `${button.getAttribute('aria-label') ?? button.textContent.trim()}${button.disabled ? ' (disabled)' : ''}`)})),
      device: await snapshot('device'), display: await snapshot('pixoo-display')};
  }, deviceId).catch((error: unknown) => String(error))});
  // The card's player reads pass through until the journey holds them; a held read answers only when released.
  let hold = false; let failReads = false;
  const held: Route[] = [];
  await page.route('**/modules/pixoo/content/player', route => {
    if (failReads) void route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"unavailable","retryable":true}}'});
    else if (hold) held.push(route);
    else { reads += 1; void route.continue(); }
  });
  const release = async (): Promise<void> => { hold = false; for (const route of held.splice(0)) await route.continue(); };
  // A request another surface could make, sent by the page itself, so the shell's operation records include it.
  const setup = async (family: string, data: object): Promise<void> => {
    const status = await page.evaluate(async ({family, target, header, data}) => (await fetch(`/api/v2/commands/${family}`, {method: 'POST',
      headers: {'content-type': 'application/json', [header]: '1'}, body: JSON.stringify({target, requestId: crypto.randomUUID(), data})})).status,
    {family, target: deviceId, header: REQUEST_HEADER, data});
    assert.equal(status, 200, `${family} setup request`);
  };
  const device = async (): Promise<{configurationRevision: number; generation: number}> => page.evaluate(async id => {
    const data = await (await fetch('/api/v2/snapshot?families=device&owner=bunny/modules/pixoo')).json() as {records: {device: {id: string; configurationRevision: number; generation: number}[]}};
    const record = data.records.device.find(value => value.id === id); if (record === undefined) throw new Error('pixoo-record');
    return {configurationRevision: record.configurationRevision, generation: record.generation};
  }, deviceId);
  type Display = {moments: {overStatus: boolean}; player: {state: string; intent: string; itemId: string | null; lastError: string | null}};
  const display = async (): Promise<Display> => page.evaluate(async id => {
    const data = await (await fetch('/api/v2/snapshot?families=pixoo-display&owner=bunny/modules/pixoo')).json() as {records: {'pixoo-display': (Display & {id: string})[]}};
    const record = data.records['pixoo-display'].find(value => value.id === id); if (record === undefined) throw new Error('pixoo-display-record');
    return record;
  }, deviceId);
  // A display change that leaves playback alone: Moments over the status view. It makes the card read the player again.
  const displayChange = async (): Promise<void> => { await setup('pixoo-moments-set', {overStatus: !(await display()).moments.overStatus}); };
  const playerRead = (): Promise<unknown> => page.waitForResponse(response => new URL(response.url()).pathname === '/modules/pixoo/content/player' && response.status() === 200);
  // A press on a control that should refuse it: the click reaches the page and no request leaves it.
  const refused = async (control: Locator, why: string): Promise<void> => {
    assert.equal(await control.isDisabled(), true, why);
    const before = bodies.length;
    await control.click({force: true}); await delay(300);
    assert.equal(bodies.length, before, `${why}: no request`);
  };

  // Setup: one synthetic still in a two-item playlist, each item shown for two minutes, so no item changes on its own.
  await world.createPlaylist('Synthetic re-read');
  await page.goto(`${world.url}/#/module/pixoo/library`); await feed(page, 'connected');
  const png = await sharp({create: {width: 64, height: 64, channels: 3, background: {r: 30, g: 90, b: 140}}}).png().toBuffer();
  await page.getByLabel('Media file', {exact: true}).setInputFiles({name: 'Re-read still.png', mimeType: 'image/png', buffer: png});
  await page.getByRole('button', {name: 'Add media', exact: true}).click();
  for (let attempt = 0; (await world.pixooMedia()).items.length === 0 && attempt < 200; attempt++) await delay(20);
  const rendition = (await world.pixooMedia()).items[0]; assert.ok(rendition);
  const created = (await world.pixooPlaylists())[0]; assert.ok(created);
  await setup('pixoo-playlist-change', {change: {operation: 'items', playlistId: created.id, revision: created.playlistRevision,
    items: [1, 2].map(() => ({renditionId: rendition.renditionId, playback: {mode: 'duration', durationMs: 120_000}}))}});
  for (let attempt = 0; (await world.pixooPlaylists())[0]?.items.length !== 2 && attempt < 200; attempt++) await delay(20);

  // First load: before the card holds any player content, every control is disabled.
  hold = true;
  await page.goto(`${world.url}/#/component/${encodeURIComponent(deviceId)}`); await feed(page, 'connected');
  const card = page.getByRole('article', {name: 'Pixoo display', exact: true});
  const screenOn = card.getByRole('button', {name: 'Screen on', exact: true});
  await screenOn.waitFor(); await expect.poll(() => held.length).toBeGreaterThan(0);
  for (const control of [screenOn, card.getByRole('button', {name: 'Screen off', exact: true})]) await refused(control, 'the first load disables the controls');
  results['first-load'] = true;
  await release();
  await expect(screenOn).toBeEnabled();

  // Start the playlist from the card.
  await card.getByRole('tab', {name: 'Content', exact: true}).click();
  await card.getByRole('combobox', {name: 'Saved playlist', exact: true}).selectOption(created.id);
  await card.getByRole('button', {name: 'Play playlist', exact: true}).click();
  await card.getByRole('tab', {name: 'Display', exact: true}).click();
  const pause = card.getByRole('button', {name: 'Pause', exact: true}), resume = card.getByRole('button', {name: 'Resume', exact: true});
  await expect(pause).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('playing');
  const next = card.getByRole('button', {name: 'Next', exact: true}), previous = card.getByRole('button', {name: 'Previous', exact: true});
  const toggle = card.getByRole('button', {name: /^(Pause|Resume)$/});
  const sentData = async (): Promise<Record<string, unknown>> => { const guard = await device(); return {expectedConfigurationRevision: guard.configurationRevision, expectedGeneration: guard.generation}; };

  // A command in flight: while its request is unanswered every control is disabled and another press sends nothing.
  let answer = (): void => {};
  const answered = new Promise<void>(resolve => { answer = resolve; });
  await page.route('**/api/v2/commands/media-control', async route => { await answered; await route.continue(); });
  let guard = await sentData(); let mark = bodies.length;
  await next.click();
  await expect.poll(() => bodies.length).toBe(mark + 1);
  assert.deepEqual(bodies.at(-1), {path: '/api/v2/commands/media-control', data: {action: 'next', ...guard}});
  await expect(next).toBeDisabled();
  for (const control of [screenOn, toggle, previous]) assert.equal(await control.isDisabled(), true, 'a command in flight disables the controls');
  await next.click({force: true});
  await delay(300);
  assert.equal(bodies.length, mark + 1, 'a press while a command is in flight sends nothing');
  // A read that lands while the command is in flight re-enables nothing and sends nothing.
  const landed = playerRead(); await displayChange(); await landed;
  mark = bodies.length;
  for (const control of [next, previous, toggle, screenOn]) await refused(control, 'a read landing during a command in flight keeps the controls disabled');
  assert.equal(bodies.length, mark);
  results['read-lands-in-flight'] = true;
  answer(); await page.unroute('**/api/v2/commands/media-control');
  await expect(pause).toBeEnabled(); await expect(screenOn).toBeEnabled();
  results['command-in-flight'] = true;
  guard = await sentData(); mark = bodies.length;
  await pause.click();
  await expect.poll(() => bodies.length).toBe(mark + 1);
  assert.deepEqual(bodies.at(-1)?.data, {action: 'pause', ...guard});
  await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('paused');

  // (b) The player resumes from another surface while the card's read is held. The card still shows Resume over the
  // paused content it read, but the newer display record says the player runs again, so Resume refuses the press and
  // sends nothing: resuming a running player would restart its item (#2124 F1). When the read lands, the label and the
  // command change together: Pause shows and sends pause.
  hold = true;
  await setup('media-control', {action: 'resume'});
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect.poll(async () => (await display()).player.state).toBe('playing');
  // Let the setup command settle, so only the held read decides the card's controls.
  await delay(500); await expect(screenOn).toBeEnabled();
  assert.equal(await pause.count(), 0, 'the label stays with the content the card holds');
  assert.equal(await card.locator('.light-card-heading p').textContent(), 'paused', 'a control blocked for a re-read is not a stale card');
  await refused(resume, 'Resume over a player the newer record says is playing');
  await release();
  await expect(pause).toBeEnabled(); await expect(screenOn).toBeEnabled();
  assert.equal(await resume.count(), 0);
  guard = await sentData(); mark = bodies.length;
  await pause.click();
  await expect.poll(() => bodies.length).toBe(mark + 1);
  assert.deepEqual(bodies.at(-1)?.data, {action: 'pause', ...guard}, 'Pause shown, pause sent');
  results['label-names-command'] = true;
  await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('paused');

  // Another surface moves to the next item while the card's read is held: Next, Previous and Resume would act on an
  // item the card no longer shows, so they refuse the press. Pause-like absolute controls stay live.
  const item = (await display()).player.itemId;
  hold = true;
  await setup('media-control', {action: 'next'});
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect.poll(async () => (await display()).player.itemId).not.toBe(item);
  await delay(500); await expect(screenOn).toBeEnabled();
  for (const control of [next, previous, resume]) await refused(control, 'an item-relative control over an item the record has left');
  results['item-mismatch'] = true;
  await release();
  await expect(next).toBeEnabled(); await expect(resume).toBeEnabled();
  // When the record agrees with the read on the item, a routine re-read leaves Next live and a press sends once.
  hold = true;
  await displayChange();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(next).toBeEnabled({timeout: 5000});
  guard = await sentData(); mark = bodies.length;
  await next.click();
  await expect.poll(() => bodies.length).toBe(mark + 1); await delay(300);
  assert.equal(bodies.length, mark + 1);
  assert.deepEqual(bodies.at(-1), {path: '/api/v2/commands/media-control', data: {action: 'next', ...guard}});
  results['item-agreement'] = true;
  await release();
  await expect(next).toBeEnabled(); await expect(screenOn).toBeEnabled();

  // Work mode, set from another surface while the card's read is held, still blocks every content control.
  hold = true;
  await setup('device-mode-set', {mode: 'work'});
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await delay(500); await expect(screenOn).toBeEnabled();
  for (const control of [next, previous, toggle]) await refused(control, 'work mode during a re-read');
  results['work-mode'] = true;
  await release();
  await setup('device-mode-set', {mode: 'free'});
  await expect(next).toBeEnabled(); await expect(resume).toBeEnabled();

  // A failed re-read: the card drops the content it held, says why and disables the controls until a read succeeds.
  failReads = true;
  await displayChange();
  await card.getByRole('alert').filter({hasText: 'Player unavailable.'}).waitFor();
  for (const control of [screenOn, card.getByRole('button', {name: 'Screen off', exact: true})]) await refused(control, 'a failed read disables the controls');
  assert.equal(await toggle.count() + await next.count() + await previous.count(), 0, 'no playback control without content');
  failReads = false;
  await card.getByRole('button', {name: 'Refresh player', exact: true}).click();
  await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();
  results['failed-read'] = true;

  // Stale records: while the dashboard's stream is replaced, every control is disabled, read or not.
  let releaseSync = (): void => {};
  const heldSync = new Promise<void>(resolve => { releaseSync = resolve; });
  await page.route('**/api/sdk/v1/sync', async route => { await heldSync; await route.continue(); });
  try {
    const replacement = page.waitForRequest(request => new URL(request.url()).pathname === '/api/sdk/v1/sync');
    world.dropDashboardStreams(); await replacement;
    await card.getByText('Pixoo records are stale.', {exact: true}).waitFor();
    for (const control of [screenOn, card.getByRole('button', {name: 'Screen off', exact: true})]) await refused(control, 'stale records disable the controls');
    if (await toggle.count() > 0) await refused(toggle, 'stale records disable the playback controls');
  } finally { releaseSync(); await page.unroute('**/api/sdk/v1/sync'); }
  await feed(page, 'connected'); await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();
  results['stale-records'] = true;

  // Read-only access offers no control at all.
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected');
  await card.getByText('Read-only access.', {exact: true}).waitFor();
  assert.equal(await screenOn.count() + await pause.count() + await resume.count(), 0, 'read-only access offers no control');
  results['read-only'] = true;
  await page.unroute('**/api/v2/authority?scope=control');
  await page.reload(); await feed(page, 'connected');
  await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();

  // (a) A read showed Resume enabled; a display change that leaves playback alone starts another read, held here. The
  // card keeps the content it read and its controls, and a press during the held read sends one request, for the
  // command its label names. This fails while a re-read disables the controls (#2124).
  hold = true;
  await displayChange();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(resume).toBeEnabled({timeout: 5000});
  assert.equal(held.length > 0, true, 'the re-read is still open');
  guard = await sentData(); mark = bodies.length;
  await resume.click();
  await expect.poll(() => bodies.length).toBe(mark + 1);
  await delay(300);
  assert.equal(bodies.length, mark + 1, 'one press during a re-read sends one request');
  assert.deepEqual(bodies.at(-1), {path: '/api/v2/commands/media-control', data: {action: 'resume', ...guard}});
  results['press-during-re-read'] = true;
  await release();
  await expect(pause).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('playing');

  // Another surface pauses while the card's read is held: the card still shows Pause over the playing content it read,
  // but the newer record's player no longer runs, so Pause refuses the press. A Pause the player no longer needs would
  // still interrupt the Monitor status base (#2124 N1). When the read lands, Resume shows.
  hold = true;
  await setup('media-control', {action: 'pause'});
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect.poll(async () => (await display()).player.intent).toBe('paused');
  await delay(500); await expect(screenOn).toBeEnabled();
  assert.equal(await resume.count(), 0, 'the label stays with the content the card holds');
  await refused(pause, 'Pause over a player the newer record says is paused');
  results['pause-after-outside-pause'] = true;
  await release();
  await expect(resume).toBeEnabled(); assert.equal(await pause.count(), 0);
  await resume.click();
  await expect(pause).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('playing');

  // The #1789 sequence: after Resume the read and the record both say playing; the record changes again and the card
  // reads again; Pause stays live and one press sends pause once.
  hold = true;
  await displayChange();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(pause).toBeEnabled({timeout: 5000});
  guard = await sentData(); mark = bodies.length;
  await pause.click();
  await expect.poll(() => bodies.length).toBe(mark + 1); await delay(300);
  assert.equal(bodies.length, mark + 1, 'Pause during a re-read sends once');
  assert.deepEqual(bodies.at(-1)?.data, {action: 'pause', ...guard});
  results['pause-during-re-read'] = true;
  await release();
  await expect(resume).toBeEnabled(); await expect(screenOn).toBeEnabled();
  await expect.poll(async () => (await display()).player.state).toBe('paused');

  // The compact face on Home decides Pause and Resume as the full face does.
  await page.goto(`${world.url}/#/home`); await feed(page, 'connected');
  const homeCard = page.locator('[data-home-card^="device:bunny/modules/pixoo:"]').first();
  const widget = await homeCard.getAttribute('data-home-card'); assert.ok(widget !== null);
  assert.equal(await page.evaluate(async widget => {
    const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': {revision: number}[]}};
    const record = data.records['home-layout'][0]; if (record === undefined) throw new Error('home-record');
    const layout = [{widget, size: 'medium', hidden: false, shape: 'wide'}];
    return (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop: layout, phone: layout}}})})).status;
  }, widget), 200);
  const compact = page.locator(`[data-home-card="${widget}"] [data-pixoo-shape="wide"]`);
  const compactPause = compact.getByRole('button', {name: 'Pause', exact: true}), compactResume = compact.getByRole('button', {name: 'Resume', exact: true});
  await expect(compactResume).toBeEnabled();
  hold = true;
  await setup('media-control', {action: 'resume'});
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect.poll(async () => (await display()).player.state).toBe('playing');
  await delay(500); await expect(compact.getByRole('button', {name: 'Screen on', exact: true})).toBeEnabled();
  await refused(compactResume, 'the compact Resume over a player the newer record says is playing');
  await release();
  await expect(compactPause).toBeEnabled();
  hold = true;
  await displayChange();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(compactPause).toBeEnabled({timeout: 5000});
  guard = await sentData(); mark = bodies.length;
  await compactPause.click();
  await expect.poll(() => bodies.length).toBe(mark + 1); await delay(300);
  assert.equal(bodies.length, mark + 1);
  assert.deepEqual(bodies.at(-1), {path: '/api/v2/commands/media-control', data: {action: 'pause', ...guard}});
  results['compact-face'] = true;
  await release();
  await expect(compactResume).toBeEnabled();

  // An unavailable Pixoo, outside any re-read: the simulated panel goes offline and a screen change from another
  // surface finds it unreachable. Every control is disabled, its line says why, and a press sends nothing.
  world.pixooMode('offline');
  await setup('power-set', {on: true});
  await expect.poll(async () => page.evaluate(async id => {
    const data = await (await fetch('/api/v2/snapshot?families=device&owner=bunny/modules/pixoo')).json() as {records: {device: {id: string; availability: string}[]}};
    return data.records.device.find(value => value.id === id)?.availability;
  }, deviceId), {timeout: 15_000}).toBe('unavailable');
  const compactLine = compact.locator('.pixoo-compact-result');
  await expect(compactLine).toHaveText('Pixoo is unavailable.');
  assert.equal(held.length, 0, 'no read is outstanding');
  for (const control of [compact.getByRole('button', {name: 'Screen on', exact: true}), compact.getByRole('button', {name: 'Screen off', exact: true}),
    compact.getByRole('button', {name: 'Next', exact: true}), compact.getByRole('button', {name: 'Previous', exact: true}), compactResume]) await refused(control, 'an unavailable Pixoo disables the controls');
  results['unavailable'] = true;

  assert.deepEqual(errors, []);
  await context.close();
  process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-card-reread', results})}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({passed: false, journey: 'pixoo-card-reread', results})}\nPage at the miss: ${await evidence()}\n`);
  throw error;
} finally { await browser.close(); await world.close(); }
