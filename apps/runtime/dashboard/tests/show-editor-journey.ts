import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import {LINES_ADDRESS} from '@jimmie-potts/nanoleaf';
import type {Browser} from 'playwright';
import {changes, feed, startWorld, type WorldOptions} from './harness.ts';
import {musicCaptureProducer} from './music-capture-producer.ts';
import {musicPlaybackProducer} from './music-playback-producer.ts';

/** Real gateway/core/module, synthetic plans and controller. No installed service or media is selected. */
export async function showEditorJourney(browser: Browser): Promise<void> {
  type AuthoringProvider = NonNullable<WorldOptions['musicShowAuthoring']>;
  const calls: Parameters<AuthoringProvider>[0][] = [];
  const world = await startWorld({nanoleaf: true, musicCapture: true, musicPlayback: true, musicShowAuthoring: input => {
    calls.push(input);
    const span = input.analysis?.spans[0];
    assert.ok(span !== undefined, 'the browser chose a measured excerpt');
    assert.equal(calls.length, 1, 'only the explicitly generated draft calls the fake provider');
    return Promise.resolve({draft: {cues: [{startMs: span.offsetMs, endMs: span.offsetMs + span.durationMs, effect: 'pulse', palette: ['#4f85ff'], intensity: 0.45}]}, costUsd: 0.0123});
  }});
  let capture: Awaited<ReturnType<typeof musicCaptureProducer>> | undefined;
  let playback: Awaited<ReturnType<typeof musicPlaybackProducer>> | undefined;
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
    const sent = changes(page);
    const saves: {requestId: string; target: string; data: {showId: string; expectedVersion: number; name: string; versionName: string; timeline: object}}[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/nanoleaf-show-save') {
        const value: unknown = request.postDataJSON();
        assert.ok(typeof value === 'object' && value !== null && 'requestId' in value && 'target' in value && 'data' in value);
        const body = value.data;
        assert.ok(typeof value.requestId === 'string' && typeof value.target === 'string' && typeof body === 'object' && body !== null
          && 'showId' in body && typeof body.showId === 'string' && 'expectedVersion' in body && typeof body.expectedVersion === 'number'
          && 'name' in body && typeof body.name === 'string' && 'versionName' in body && typeof body.versionName === 'string'
          && 'timeline' in body && typeof body.timeline === 'object' && body.timeline !== null);
        saves.push({requestId: value.requestId, target: value.target, data: {showId: body.showId, expectedVersion: body.expectedVersion,
          name: body.name, versionName: body.versionName, timeline: body.timeline}});
      }
    });
    const read = async (id: string, version: number): Promise<unknown> => {
      const response = await context.request.get(`${world.url}/modules/nanoleaf/content/show-version?showId=${id}&version=${String(version)}`);
      assert.equal(response.status(), 200); const value: unknown = await response.json(); await response.dispose(); return value;
    };
    await page.goto(`${world.url}/#/audio`); await feed(page, 'connected');
    await page.getByRole('link', {name: 'Saved shows', exact: true}).click();
    const editor = page.locator('.nanoleaf-shows'); await editor.waitFor();
    await editor.getByText('Your private library is empty. Choose a starter to prepare a draft.', {exact: true}).waitFor();
    await delay(300);
    // Ordinary controller polling may continue while the offline editor is open.
    const outputState = (): object => {
      const state = world.nanoleafState();
      return {...state, devices: Object.fromEntries(Object.entries(state.devices).map(([id, {reads: _reads, ...device}]) => [id, device]))};
    };
    const deviceBefore = structuredClone(outputState());
    const wallBefore = await world.nanoleafWall();
    assert.equal(sent.length, 0, 'opening the authoring page sends no command');
    const starter = editor.getByRole('button', {name: 'Use Ocean drift', exact: true});
    await starter.focus(); await starter.press('Enter');
    await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).waitFor();
    await editor.getByLabel('Show name', {exact: true}).fill('Synthetic ocean study');
    await editor.getByLabel('Version name', {exact: true}).fill('Opening');
    const cues = editor.locator('.show-cue-edit');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('35');
    await editor.getByRole('slider').fill('9000');
    await editor.getByRole('status').filter({hasText: 'Gap: no cue.'}).waitFor();
    assert.equal(sent.length, 0, 'draft edits and storyboard inspection send no command');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 1', exact: true}).waitFor();
    assert.equal(saves.length, 1); const first = saves[0]; assert.ok(first);
    assert.equal(first.target, 'shows'); assert.equal(first.data.expectedVersion, 0);
    const versionOne = await read(first.data.showId, 1);
    await editor.getByLabel('Version name', {exact: true}).fill('Quieter');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('20');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 2', exact: true}).waitFor();
    assert.equal(saves.length, 2); assert.deepEqual(await read(first.data.showId, 1), versionOne);
    await editor.getByLabel('Saved version', {exact: true}).selectOption('1');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 1', exact: true}).waitFor();
    assert.equal(await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).inputValue(), '35');
    assert.equal(await editor.getByRole('button', {name: 'Save new version', exact: true}).isDisabled(), true, 'old version cannot overwrite the newer head');
    await editor.getByLabel('Saved version', {exact: true}).selectOption('2');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 2', exact: true}).waitFor();
    await editor.getByLabel('Version name', {exact: true}).fill('Unsubmitted local change');
    await editor.getByRole('button', {name: 'Refresh show library', exact: true}).click();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change');
    assert.equal(saves.length, 2, 'refresh does not save the draft');

    let releaseRead: (() => void) | undefined;
    const heldRead = new Promise<void>(resolve => {releaseRead = resolve;});
    let readStarted: (() => void) | undefined;
    const startedRead = new Promise<void>(resolve => {readStarted = resolve;});
    await page.route('**/modules/nanoleaf/content/show-version?**', async route => {
      const response = await route.fetch(); readStarted?.(); await heldRead; await route.fulfill({response});
    }, {times: 1});
    try {
      await editor.getByLabel('Saved version', {exact: true}).selectOption('1');
      await editor.getByRole('button', {name: 'Open saved version', exact: true}).click(); await startedRead;
      await editor.getByRole('button', {name: 'Cancel version read', exact: true}).click();
      assert.equal(await editor.getByLabel('Version name', {exact: true}).isDisabled(), false);
      assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change');
    } finally {releaseRead?.();}
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).waitFor();
    await delay(100);
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change', 'late cancelled read cannot replace the draft');
    await page.route('**/modules/nanoleaf/content/show-version?**', route => route.fulfill({status: 503, contentType: 'application/json',
      body: '{"error":{"code":"unavailable","retryable":true}}'}), {times: 1});
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('alert').filter({hasText: 'That saved version is unavailable.'}).waitFor();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change', 'failed read retains the draft');

    // A different authenticated client wins the same head. The browser retains its local draft.
    const other = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 2, versionName: 'Other client'});
    assert.equal(other.status, 200);
    await editor.getByRole('alert').filter({hasText: 'The saved head differs from this draft.'}).waitFor();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Unsubmitted local change');
    const conflict = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 2, versionName: 'Stale client'});
    assert.equal(conflict.status, 409);
    const readonly = await fetch(`${world.url}/api/v2/commands/nanoleaf-show-save`, {method: 'POST', headers: {authorization: `Bearer ${world.readerToken}`, 'content-type': 'application/json'},
      body: JSON.stringify({target: 'shows', requestId: 'show-readonly-denied', data: {...first.data, expectedVersion: 3}})});
    assert.equal(readonly.status, 403); await readonly.arrayBuffer();
    const cross = await context.request.post(`${world.url}/api/v2/commands/nanoleaf-show-save`, {headers: {origin: 'https://unrelated.invalid', [REQUEST_HEADER]: '1'},
      data: {target: 'shows', requestId: 'show-origin-denied', data: {...first.data, expectedVersion: 3}}});
    assert.equal(cross.status(), 403); await cross.dispose();
    const malformed = await world.credentialAction('nanoleaf-show-save', 'shows', {...first.data, expectedVersion: 3, audio: 'not-allowed'});
    assert.equal(malformed.status, 400);
    assert.deepEqual(outputState(), deviceBefore, 'authoring, saves and preview leave output, writes and controller command history unchanged');
    assert.deepEqual(await world.nanoleafWall(), wallBefore, 'no device configuration or displayed task mutation');
    const receipts = process.env.DASHBOARD_RECEIPTS;
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({colorScheme}); await page.setViewportSize({width, height: 1000});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
      if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: join(receipts, `shows-${colorScheme}-${String(width)}.png`), fullPage: true});}
    }
    await page.reload(); await feed(page, 'connected'); await editor.waitFor();
    assert.equal(await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).count(), 0);
    assert.equal(saves.length, 2, 'reload retains only attempt identity and sends no save');
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 3', exact: true}).waitFor();
    const prepare = editor.getByRole('button', {name: 'Prepare measured show', exact: true});
    const priorName = await editor.getByLabel('Show name', {exact: true}).inputValue();
    const beforePrepareCommands = sent.length;
    await prepare.click();
    await editor.getByRole('alert').filter({hasText: 'No measured excerpt is available'}).waitFor();
    assert.equal(await editor.getByLabel('Show name', {exact: true}).inputValue(), priorName);

    const measurement = {item: {libraryScopeId: 'fixture-library', itemId: 'F17E'}, analysis: {method: 'energy-onset-v1', sampleCount: 3}};
    const measuredTimeline = {version: 1, durationMs: 1307, cues: [{id: 'fixture-pulse', offsetMs: 1007, durationMs: 300, intensity: 0.453,
      recipe: {pattern: 'pulse', colors: ['#4f85ff'], speed: 'medium', loop: true}}]};
    let draftReads = 0;
    // This browser fixture replaces only the measured draft response. The authenticated save/read use the real runtime.
    await page.route('**/modules/nanoleaf/content/measured-show-draft', async route => {
      assert.equal(route.request().method(), 'GET');
      draftReads++;
      await route.fulfill({status: 200, json: {...measurement, timeline: measuredTimeline, measurementProof: '0'.repeat(64)}});
    }, {times: 1});
    await prepare.click();
    await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).waitFor();
    await editor.getByText('Captured excerpt for a scoped Mac Music library item.', {exact: false}).waitFor();
    await editor.getByRole('heading', {name: 'Measured cue storyboard', exact: true}).waitFor();
    for (const label of ['Show duration (ms)', 'Start (ms)', 'Duration (ms)', 'Intensity (%)']) {
      const input = editor.getByLabel(label, {exact: true});
      assert.equal(await input.evaluate((node: HTMLInputElement) => node.validity.valid), true, `captured ${label} is a valid number input`);
    }
    await editor.getByLabel('Show name', {exact: true}).fill('Synthetic measured excerpt');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('50');
    assert.equal(sent.length, beforePrepareCommands, 'preparing and inspecting an excerpt send no command');
    const deniedSave = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v2/commands/nanoleaf-show-save');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    assert.equal((await deniedSave).ok(), false, 'the real runtime refuses an excerpt without authentic capture provenance');
    assert.equal(saves.length, 3);
    const measuredSave = saves[2];
    assert.ok(measuredSave);
    const missing = await context.request.get(`${world.url}/modules/nanoleaf/content/show-version?showId=${measuredSave.data.showId}&version=1`);
    assert.equal(missing.status(), 404); await missing.dispose();
    assert.equal(draftReads, 1);
    assert.equal(await editor.getByLabel('Show name', {exact: true}).inputValue(), 'Synthetic measured excerpt');
    assert.equal(await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).inputValue(), '50');
    assert.deepEqual(outputState(), deviceBefore, 'preparation, editing and a denied save leave the controller unchanged');
    assert.deepEqual(await world.nanoleafWall(), wallBefore, 'measured authoring leaves device state unchanged');
    // Both producer roles publish synthetic observations to the real gateway. No draft response is intercepted below.
    playback = await musicPlaybackProducer(world.url, world.musicPlaybackToken);
    capture = await musicCaptureProducer(world.url, world.musicCaptureToken);
    await editor.getByRole('region', {name: 'Measured shows', exact: true}).getByRole('link', {name: 'Audio page', exact: true}).click();
    await page.getByRole('button', {name: 'Start measuring Music', exact: true}).click();
    await page.getByText('Receiving Music measurements.', {exact: true}).waitFor();
    await page.getByRole('link', {name: 'Saved shows', exact: true}).click();
    await editor.waitFor();
    await playback.observe();
    const draftUrl = `${world.url}/modules/nanoleaf/content/measured-show-draft`;
    let draftStatus = 503;
    for (let attempt = 0; attempt < 12 && draftStatus !== 200; attempt++) {
      if (attempt !== 0) await delay(550);
      await playback.observe();
      const result = await context.request.get(draftUrl);
      draftStatus = result.status();
      await result.dispose();
    }
    assert.equal(draftStatus, 200, 'the runtime prepared a draft from the synthetic producer feeds');
    const authoring = editor.getByRole('region', {name: 'Claude show generation', exact: true});
    const generate = authoring.getByRole('button', {name: 'Generate paid draft', exact: true});
    await authoring.getByText(/one paid Anthropic API attempt.*\$3 USD per day and \$20 USD per month/).waitFor();
    await authoring.getByText(/current Music track’s title and artist.*Audio stays on your Mac/).waitFor();
    assert.equal(await generate.isDisabled(), true, 'generation requires a style');
    await editor.getByRole('button', {name: 'Use Ocean drift', exact: true}).click();
    await editor.getByLabel('Show name', {exact: true}).fill('Existing edits');
    await authoring.getByRole('button', {name: 'Use warm rise style', exact: true}).click();
    await authoring.getByLabel('Mood or style', {exact: true}).fill('Synthetic amber surge');
    const commandsBeforeDraft = sent.length;
    await playback.observe();
    await generate.click();
    const openGenerated = authoring.getByRole('button', {name: 'Open generated draft', exact: true});
    await openGenerated.waitFor();
    assert.equal(await editor.getByLabel('Show name', {exact: true}).inputValue(), 'Existing edits', 'generation leaves local edits in place until the result is opened');
    assert.equal(sent.length, commandsBeforeDraft + 1, 'exactly one explicit generate command');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0] && {title: calls[0].title, artist: calls[0].artist, style: calls[0].style},
      {title: 'Synthetic Music', artist: 'Synthetic artist', style: 'Synthetic amber surge'});
    await page.route('**/modules/nanoleaf/content/generated-show-draft?**', route => route.fulfill({status: 200, json: {timeline: {}}}), {times: 1});
    await openGenerated.click();
    await editor.getByRole('alert').filter({hasText: 'The generated cues could not be opened.'}).waitFor();
    assert.equal(await editor.getByLabel('Show name', {exact: true}).inputValue(), 'Existing edits');
    await openGenerated.click();
    await editor.getByText(/Claude drafted from a measured excerpt.*Recorded generation cost is \$0.0123 USD/).waitFor();
    await editor.getByRole('heading', {name: 'Unsaved draft', exact: true}).waitFor();
    await editor.getByRole('heading', {name: 'Measured cue storyboard', exact: true}).waitFor();
    await editor.getByLabel('Show name', {exact: true}).fill('Synthetic captured excerpt');
    await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).fill('50');
    const finalCueOffset = Number(await cues.last().getByLabel('Start (ms)', {exact: true}).inputValue());
    const finalCueDuration = 8000;
    await cues.last().getByLabel('Duration (ms)', {exact: true}).fill(String(finalCueDuration));
    await editor.getByLabel('Show duration (ms)', {exact: true}).fill(String(finalCueOffset + finalCueDuration));
    assert.equal(sent.length, commandsBeforeDraft + 1, 'opening, previewing and editing generated cues send no command');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 1', exact: true}).waitFor();
    assert.equal(saves.length, 4);
    const accepted = saves[3];
    assert.ok(accepted);
    const savedExcerpt = await read(accepted.data.showId, 1);
    assert.ok(typeof savedExcerpt === 'object' && savedExcerpt !== null && 'kind' in savedExcerpt && 'measurement' in savedExcerpt);
    assert.equal(savedExcerpt.kind, 'measured');
    assert.ok(typeof savedExcerpt.measurement === 'object' && savedExcerpt.measurement !== null && 'item' in savedExcerpt.measurement);
    assert.deepEqual(savedExcerpt.measurement.item, playback.item);
    assert.equal('measurementProof' in savedExcerpt, false);
    assert.equal('authoringProof' in savedExcerpt, false);
    assert.ok('provenance' in savedExcerpt);
    assert.deepEqual(savedExcerpt.provenance, {model: 'claude-fable-5-2', costUsd: 0.0123, confidence: 'measured-excerpt'});
    await editor.getByLabel('Show', {exact: true}).selectOption(first.data.showId);
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 3', exact: true}).waitFor();
    await editor.getByLabel('Show', {exact: true}).selectOption(accepted.data.showId);
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Measured cue storyboard', exact: true}).waitFor();
    assert.equal(await cues.nth(0).getByLabel('Intensity (%)', {exact: true}).inputValue(), '50');
    assert.deepEqual(outputState(), deviceBefore, 'successful measured authoring and reopening leave the controller unchanged');
    assert.deepEqual(await world.nanoleafWall(), wallBefore);
    if (receipts !== undefined) await page.screenshot({path: join(receipts, 'shows-measured-excerpt.png'), fullPage: true});

    await page.setViewportSize({width: 1440, height: 1000});
    await editor.getByRole('region', {name: 'Measured shows', exact: true}).getByRole('link', {name: 'Audio page', exact: true}).click();
    const light = page.getByRole('region', {name: 'wall Music lighting', exact: true});
    const savedSelector = light.getByRole('combobox', {name: 'Saved show and version', exact: true});
    const startShow = light.getByRole('button', {name: 'Start saved show', exact: true});
    const stopShow = light.getByRole('button', {name: 'Stop Music lighting', exact: true});
    assert.equal((await world.credentialAction('device-mode-set', 'wall', {mode: 'free'})).status, 200);
    let free = false;
    for (let attempt = 0; attempt < 40 && !free; attempt++) {
      const wall = await world.nanoleafWall();
      free = 'mode' in wall && wall.mode === 'free' && 'modePending' in wall && wall.modePending === false;
      if (!free) await delay(50);
    }
    assert.ok(free, 'the simulated Lines applied Free mode');
    await savedSelector.selectOption({label: 'Synthetic captured excerpt · v1 · First draft · Measured excerpt'});
    const baseline = world.nanoleafState().devices[LINES_ADDRESS];
    assert.ok(baseline?.select !== undefined, 'the simulated Lines have an existing selection');
    await playback.observe({itemId: 'BEEF', positionMs: finalCueOffset});
    await page.getByText('Synthetic different Music item', {exact: true}).last().waitFor();
    await startShow.click();
    await light.getByText(/Music is playing a different library item\./).waitFor();
    const refused = world.nanoleafState().devices[LINES_ADDRESS];
    assert.ok(refused);
    assert.deepEqual({writes: refused.writes, streamed: refused.streamed, select: refused.select},
      {writes: baseline.writes, streamed: baseline.streamed, select: baseline.select}, 'wrong-item refusal writes no fake stream or scene');
    if (receipts !== undefined) await light.screenshot({path: join(receipts, 'shows-measured-refused.png')});

    await playback.observe({itemId: playback.item.itemId, positionMs: finalCueOffset + 200});
    await page.getByText('Synthetic Music', {exact: true}).last().waitFor();
    await startShow.click();
    await light.getByText('Active. The light module reports that the show is running.', {exact: true}).waitFor();
    let streamed = baseline.streamed;
    for (let attempt = 0; attempt < 40 && streamed <= baseline.streamed; attempt++) {
      streamed = world.nanoleafState().devices[LINES_ADDRESS]?.streamed ?? 0;
      if (streamed <= baseline.streamed) await delay(50);
    }
    assert.ok(streamed > baseline.streamed, 'the aligned saved show produced fake stream frames');
    assert.equal((await world.credentialAction('nanoleaf-show-save', 'shows', {
      ...accepted.data, expectedVersion: 1, versionName: 'Edit while playing', measurement: savedExcerpt.measurement,
    })).status, 200);
    await light.getByText(`Saved show ${accepted.data.showId}, version 1.`, {exact: false}).waitFor();
    if (receipts !== undefined) await light.screenshot({path: join(receipts, 'shows-measured-playing.png')});
    await playback.observe();
    await stopShow.click();
    await light.getByText(/Last session ended: stopped on request\. The current base scene and brightness were restored\./).waitFor();
    const stopped = world.nanoleafState().devices[LINES_ADDRESS];
    assert.ok(stopped);
    assert.deepEqual({on: stopped.on, selection: stopped.select, brightness: stopped.brightness},
      {on: baseline.on, selection: baseline.select, brightness: baseline.brightness}, 'Stop restored the simulated scene and brightness');
    if (receipts !== undefined) await light.screenshot({path: join(receipts, 'shows-measured-stopped.png')});
    await page.getByRole('link', {name: 'Saved shows', exact: true}).click();
    await editor.getByLabel('Show', {exact: true}).selectOption(first.data.showId);
    await editor.getByRole('button', {name: 'Open saved version', exact: true}).click();
    await editor.getByRole('heading', {name: 'Saved version 3', exact: true}).waitFor();

    // No real send: a lost-response fixture proves the retained UI lock and no retry through reload.
    await page.route('**/api/v2/commands/nanoleaf-show-save', route => route.fulfill({status: 503, contentType: 'application/json',
      body: '{"error":{"code":"uncertain-result","retryable":false,"detail":"Synthetic lost response."}}'}), {times: 1});
    await editor.getByLabel('Version name', {exact: true}).fill('Uncertain draft');
    await editor.getByRole('button', {name: 'Save new version', exact: true}).click();
    await editor.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
    assert.equal(await editor.getByLabel('Version name', {exact: true}).inputValue(), 'Uncertain draft');
    assert.equal(await editor.getByRole('button', {name: 'Save new version', exact: true}).isDisabled(), true);
    await page.reload(); await feed(page, 'connected'); await editor.waitFor();
    assert.equal(await editor.getByRole('button', {name: 'Use Ocean drift', exact: true}).isDisabled(), true);
    assert.equal(saves.length, 5, 'uncertainty is not retried on reload');
    assert.deepEqual(errors, []);
    assert.equal(calls.length, 1, 'saved playback, stop, edit and reload do not call the provider');
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'offline-decorative-shows', browserSaveRequests: saves.length,
      immutableVersions: true, staleSave: 409, readonly: 403, crossOrigin: 403, malformed: 400, authoringDeviceChanges: 0,
      preview: 'cue storyboard only', measuredExcerpt: 'generated, edited, saved and reopened using synthetic producers and fake Claude', generationCalls: calls.length, malformedGenerationReadPreservedEdits: true, forgedProvenanceRefused: true, measuredAudio: 'wrong item refused, matching item started and stopped, v1 pinned while v2 saved', noResend: true})}\n`);
  } catch (error) {
    const receipts = process.env.DASHBOARD_RECEIPTS, page = context.pages()[0];
    if (receipts !== undefined && page !== undefined) {
      await mkdir(receipts, {recursive: true});
      await page.screenshot({path: join(receipts, 'shows-failure.png'), fullPage: true});
      await writeFile(join(receipts, 'shows-failure.html'), await page.content());
    }
    throw error;
  } finally {
    try {await Promise.all([capture?.close(), playback?.close(), context.close()]);}
    finally {await world.close();}
  }
}
