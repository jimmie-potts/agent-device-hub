import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Page, type Request} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {chooseConversation, openDeviceMenu} from './navigation-helpers.ts';
import {installSyntheticSpeech} from '../../dist/verify/speech-fixture.js';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';

function isStopCall(request: Request, kind: 'control' | 'receipt'): boolean {
  const call = kind === 'control' ? 'request' : 'publish';
  if (request.method() !== 'POST' || new URL(request.url()).pathname !== `/api/sdk/v1/${call}`) return false;
  const body: unknown = request.postDataJSON();
  if (typeof body !== 'object' || body === null) return false;
  const message = kind === 'control' ? ('command' in body ? body.command : undefined) : ('message' in body ? body.message : undefined);
  const type = kind === 'control' ? 'org.bunny.companion-speech.endpoint.requested' : 'org.bunny.companion-speech.playback.observed';
  if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== type || !('data' in message)) return false;
  const data = message.data;
  return typeof data === 'object' && data !== null && (kind === 'control' ? 'action' in data && data.action === 'stop' : 'status' in data && data.status === 'stopped');
}

/**
 * At phone width the open profile is named in the conversation's one header row (Hub #1890): the name, the Demo label
 * for a demo, and Details at the row's end. The name is whole, nothing covers it and the page does not overflow.
 */
async function assertNarrowProfile(page: Page, expected: string, demo = false): Promise<void> {
  const trigger = page.getByRole('button', {name: 'Details', exact: true});
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  const header = page.locator('.conversation-header');
  const measured = await header.evaluate(node => {
    const name = node.querySelector('h2'), details = node.querySelector('button');
    if (name === null || details === null) throw new Error('Expected a profile name and Details in the header row');
    const text = document.createRange();
    text.selectNodeContents(name);
    const box = name.getBoundingClientRect(), button = details.getBoundingClientRect();
    const exposed = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {text: name.textContent, lines: text.getClientRects().length, tag: node.querySelector('.conversation-demo-tag')?.textContent ?? '',
      nameExposed: exposed !== null && name.contains(exposed), sameRow: box.top + box.height / 2 > button.top && box.top + box.height / 2 < button.bottom,
      clear: box.right <= button.left, overflow: document.documentElement.scrollWidth - innerWidth};
  });
  assert.equal(measured.text, expected);
  assert.equal(measured.tag, demo ? 'Demo' : '');
  assert.equal(measured.lines, 1, `the profile name is on one line: ${JSON.stringify(measured)}`);
  assert.ok(measured.nameExposed, 'the profile name stays visible');
  assert.ok(measured.sameRow && measured.clear, `the profile name and Details share one row without touching: ${JSON.stringify(measured)}`);
  assert.ok(measured.overflow <= 1, 'profile and conversation controls fit the viewport');
  await trigger.click({trial: true});
}

/** Real runtime and page, with only browser identity and the audio device replaced by explicit synthetic fixtures. */
export async function speechJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  try {
    await context.addInitScript(installSyntheticSpeech);
    const page = await context.newPage(), other = await context.newPage(); page.setDefaultTimeout(12_000); other.setDefaultTimeout(12_000);
    const tab = async (target: Page, name: string): Promise<void> => {await target.getByRole('tab', {name, exact: true}).click();};
    const visit = async (target: Page): Promise<void> => {await target.goto(`${world.url}/#/module/companions/reachy`); await feed(target, 'connected'); await tab(target, 'Voice');};
    const controls = (target: Page) => target.getByRole('region', {name: 'Spoken alerts', exact: true});
    const enable = (target: Page) => controls(target).getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true});
    const enabled = (target: Page) => controls(target).getByText('Spoken alerts enabled in this tab.', {exact: true});
    const count = (target = page) => target.evaluate(() => window.speechFixture.calls);
    let sequence = 0;
    const question = async (id: string): Promise<void> => {
      await world.observe(turnStarted, {turn: id, sequence: ++sequence});
      await world.observe({kind: 'question-continuing', attention: {status: 'known', id}}, {turn: id, sequence: ++sequence, nativeEventId: id});
      await tab(page, 'Latest');
      await page.getByRole('article', {name: 'Reachy card', exact: true}).getByText('Coding attention', {exact: true}).waitFor();
      await tab(page, 'Voice');
      await page.waitForTimeout(150);
    };
    await visit(page); await visit(other);
    await controls(page).getByText(/Mute before calls or media; they aren’t detected/).waitFor();
    await tab(page, 'Controls');
    await page.getByRole('button', {name: 'Enable Reachy text cards', exact: true}).click();
    await page.getByRole('button', {name: 'Disable Reachy text cards', exact: true}).waitFor();
    await tab(page, 'Voice');
    await world.observe(sessionStarted, {sequence: ++sequence}); await question('speech-off'); assert.equal(await count(), 0);
    await enable(page).focus(); await enable(page).press('Enter'); await enabled(page).waitFor();
    await controls(other).getByText('Another tab has spoken alerts enabled.', {exact: true}).waitFor(); assert.equal(await enable(other).isDisabled(), true);
    assert.equal(await count(), 0, 'explicit enablement does not catch up the previous card');
    await question('speech-complete'); await page.waitForFunction(() => window.speechFixture.calls === 1); assert.equal(await count(other), 0);
    await page.evaluate(() => window.speechFixture.finish());
    await controls(page).getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    await controls(page).getByText('Tracked operation: succeeded.', {exact: true}).waitFor();
    await question('speech-stop'); await page.waitForFunction(() => window.speechFixture.calls === 2);
    let delayedReceipt = false;
    await page.route('**/api/sdk/v1/publish', async route => {
      if (!delayedReceipt && isStopCall(route.request(), 'receipt')) {
        delayedReceipt = true;
        await new Promise(resolve => {setTimeout(resolve, 2000);});
      }
      await route.continue();
    });
    const stoppedControl = page.waitForEvent('requestfinished', {predicate: request => isStopCall(request, 'control')});
    const stoppedReceipt = page.waitForEvent('requestfinished', {predicate: request => isStopCall(request, 'receipt')});
    const stop = controls(page).getByRole('button', {name: 'Stop speaking', exact: true}); await stop.focus(); await stop.press('Enter');
    await controls(page).getByText('Playback: Playback stopped. The sentence may be incomplete.', {exact: true}).waitFor();
    // Local cancellation is immediate; the next scenario needs the completed control and receipt writes.
    for (const request of await Promise.all([stoppedControl, stoppedReceipt])) assert.equal((await request.response())?.status(), 200);
    await question('speech-mute'); await page.waitForFunction(() => window.speechFixture.calls === 3);
    await page.unroute('**/api/sdk/v1/publish');
    await controls(page).getByRole('button', {name: 'Mute spoken alerts', exact: true}).click();
    await controls(page).getByText('Spoken alerts are off in this tab.', {exact: true}).waitFor();
    await question('speech-muted'); assert.equal(await count(), 3); assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 2);
    await enable(page).click(); await enabled(page).waitFor(); assert.equal(await count(), 3);
    await tab(page, 'Controls');
    await page.getByRole('button', {name: 'Mute Coding attention', exact: true}).click(); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).waitFor();
    await tab(page, 'Voice');
    await question('speech-category-muted'); assert.equal(await count(), 3);
    await tab(page, 'Controls'); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).click(); await tab(page, 'Voice');
    await other.goto(`${world.url}/#/`); const hub = other.locator('[data-widget="hub-mode"]');
    await hub.getByRole('button', {name: 'Quiet', exact: true}).click(); await controls(page).getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor();
    await question('speech-quiet'); assert.equal(await count(), 3);
    await hub.getByRole('button', {name: 'Work', exact: true}).click(); await controls(page).getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor({state: 'detached'});
    await page.evaluate(() => {window.speechFixture.voices = false;});
    await question('speech-delayed'); assert.equal(await count(), 3);
    await tab(page, 'Controls');
    await page.getByRole('button', {name: 'Mute Coding attention', exact: true}).click(); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).waitFor();
    await tab(page, 'Voice');
    await page.evaluate(() => window.speechFixture.releaseVoices());
    await controls(page).getByText('Playback: Speech did not start.', {exact: true}).waitFor(); assert.equal(await count(), 3);
    await tab(page, 'Controls'); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).click(); await tab(page, 'Voice');
    const receipts = process.env.DASHBOARD_RECEIPTS;
    if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: `${receipts}/speech-desktop.png`, fullPage: true});}
    await page.setViewportSize({width: 390, height: 844}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/speech-phone.png`, fullPage: true});
    world.dropDashboardStreams(); await feed(page, 'connected'); await controls(page).getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor({state: 'detached'});
    assert.equal(await count(), 3); await question('speech-disconnected'); assert.equal(await count(), 3);
    await enable(page).click(); await enabled(page).waitFor(); assert.equal(await count(), 3);
    await page.reload(); await feed(page, 'connected'); await tab(page, 'Voice'); await enabled(page).waitFor({state: 'detached'}); assert.equal(await count(), 0);
    await enable(page).click(); await enabled(page).waitFor(); await question('speech-error'); await page.waitForFunction(() => window.speechFixture.calls === 1);
    await page.evaluate(() => window.speechFixture.fail()); await controls(page).getByText('Playback: Playback is uncertain. It will not be replayed automatically.', {exact: true}).waitFor();
    assert.equal(await count(), 1); assert.equal(await page.evaluate(() => window.speechFixture.overlap), 0);
    await tab(page, 'Controls');
    assert.equal(await page.getByRole('button', {name: 'Disable Reachy text cards', exact: true}).isEnabled(), true, 'uncertain speech must not lock independent visual controls');
    await tab(page, 'Voice');
    await world.restart(); await page.reload(); await feed(page, 'connected'); await tab(page, 'Voice');
    assert.equal(await count(), 0); await enabled(page).waitFor({state: 'detached'});
    const recover = controls(page).getByRole('button', {name: 'Recover voice', exact: true});
    await recover.waitFor(); assert.equal(await recover.isDisabled(), true); assert.equal(await enable(page).isDisabled(), true);
    await controls(page).getByRole('checkbox', {name: 'I have stopped playback in all earlier voice tabs or closed them.', exact: true}).check();
    await recover.click(); await controls(page).getByText('Spoken alerts are off in this tab.', {exact: true}).waitFor();
    assert.equal(await count(), 0, 'recovery never speaks');
    await enable(page).click(); await enabled(page).waitFor(); assert.equal(await count(), 0, 'fresh enable never replays');
    await question('speech-recovered'); await page.waitForFunction(() => window.speechFixture.calls === 1);
    assert.equal(await page.evaluate(() => window.speechFixture.overlap), 0);
    await page.evaluate(() => window.speechFixture.finish());
    await controls(page).getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    await world.restart(); await page.reload(); await feed(page, 'connected'); await tab(page, 'Voice');
    assert.equal(await count(), 0); assert.equal(await recover.count(), 0, 'acknowledged uncertainty does not block another restart');
    await enable(page).click(); await enabled(page).waitFor();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await tab(page, 'Voice'); await page.getByText('Read-only access. Controls require operator authority.', {exact: true}).waitFor();
    assert.equal(await enable(page).isDisabled(), true); assert.deepEqual(errors, []);
  } finally {await context.close(); await world.close();}
  process.stdout.write('Speech browser: selected tab, manual availability, completed/Stop/mute receipts, Quiet/category policy, delayed voice recheck, reload/disconnect/restart silence, uncertainty, reader controls, keyboard and narrow layout passed with synthetic audio.\n');
}

/** Removing an opted-in Home card withdraws its endpoint without enabling another tab. */
export async function homeSpeechLifetimeJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  // Reachy's full card on Home is in one column (#1672); the wide grid shows its generic compact face.
  const context = await browser.newContext({viewport: {width: 560, height: 1000}, reducedMotion: 'reduce'});
  try {
    await context.addInitScript(installSyntheticSpeech);
    const page = await context.newPage(), other = await context.newPage();
    await page.goto(`${world.url}/#/`); await feed(page, 'connected');
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await page.getByRole('button', {name: 'Add card', exact: true}).click();
    await page.getByRole('button', {name: 'Add Reachy', exact: true}).click();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    const card = page.locator('.companion-card[data-companion=reachy]');
    await card.getByRole('tab', {name: 'Voice', exact: true}).click();
    await card.getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true}).click();
    await card.getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor();
    await card.getByRole('tab', {name: 'Controls', exact: true}).click();
    await card.getByRole('button', {name: 'Enable Reachy text cards', exact: true}).waitFor();
    await card.getByRole('tab', {name: 'Voice', exact: true}).click();
    await card.getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor();
    await other.goto(`${world.url}/#/module/companions/reachy`); await feed(other, 'connected');
    await other.getByRole('tab', {name: 'Voice', exact: true}).click();
    await other.getByText('Another tab has spoken alerts enabled.', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await page.getByRole('button', {name: 'Remove Reachy', exact: true}).click();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await card.waitFor({state: 'detached'});
    await other.getByText('Another tab has spoken alerts enabled.', {exact: true}).waitFor({state: 'detached'});
    assert.equal(await other.getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true}).isEnabled(), true);
    assert.equal(await other.getByText('Spoken alerts enabled in this tab.', {exact: true}).count(), 0, 'endpoint loss never selects the remaining tab');
    await other.getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true}).click();
    await other.getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.speechFixture.calls), 0);
    assert.equal(await other.evaluate(() => window.speechFixture.calls), 0);
  } finally {await context.close(); await world.close();}
}

/** Typed requests on the Conversation page are answered aloud through the same endpoint, with Speak, Stop and Quiet behaving as documented (Hub #500). */
export async function spokenRepliesJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  try {
    await context.addInitScript(installSyntheticSpeech, '151.0.0.1');
    const page = await context.newPage(), other = await context.newPage(); page.setDefaultTimeout(12_000); other.setDefaultTimeout(12_000);
    const registrations: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/sdk/v1/respond') return;
      const body: unknown = request.postDataJSON();
      if (typeof body === 'object' && body !== null && 'pattern' in body && typeof body.pattern === 'string'
        && body.pattern.startsWith('bunny.cmd.companion-speech-output.')) registrations.push(body.pattern);
    });
    await page.goto(`${world.url}/#/module/companions/assistant`); await feed(page, 'connected');
    const assistant = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const voice = assistant.getByRole('button', {name: /^Voice (off|on|· (Speaking|Needs attention|Unavailable))$/});
    const voiceState = (name: string) => assistant.getByRole('button', {name: name.startsWith('Voice ') ? name : `Voice · ${name}`, exact: true});
    await voiceState('Voice off').waitFor({timeout: 3500});
    assert.equal(await voice.getAttribute('aria-expanded'), 'false');
    await voice.click();
    const controls = assistant.getByRole('region', {name: 'Spoken replies', exact: true});
    const count = () => page.evaluate(() => window.speechFixture.calls);
    const evidence = controls.getByText('Voice requirements and playback evidence', {exact: true});
    const receipts = process.env.DASHBOARD_RECEIPTS;
    if (receipts !== undefined) await mkdir(receipts, {recursive: true});
    const enableAssistant = assistant.getByRole('button', {name: 'Enable conversation', exact: true});
    await enableAssistant.focus(); await enableAssistant.press('Enter');
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).waitFor();
    await controls.getByText(/This tab becomes the one speaker/).waitFor();
    const enable = controls.getByRole('button', {name: 'Enable', exact: true});
    await enable.focus(); await enable.press('Enter');
    await voiceState('Voice on').waitFor();
    await voice.click();
    const composer = assistant.getByRole('button', {name: 'Send', exact: true});
    const message = assistant.getByRole('textbox', {name: 'Message', exact: true});
    await message.fill('Draft through voice disclosure');
    const dismissalWrites = changes(page);
    const heldRegistration = [...registrations];
    await voice.press('Enter');
    const close = controls.getByRole('button', {name: 'Close spoken replies', exact: true});
    await controls.getByRole('heading', {name: 'Spoken replies', exact: true}).waitFor();
    await close.press('Enter');
    assert.equal(await controls.isVisible(), false);
    assert.equal(await voice.evaluate(node => node === document.activeElement), true, 'Close restores Voice focus');
    await voice.press('Enter');
    await close.press('Escape');
    assert.equal(await controls.isVisible(), false);
    assert.equal(await voice.evaluate(node => node === document.activeElement), true, 'Escape restores Voice focus');
    await voice.click();
    await message.click();
    assert.equal(await controls.isVisible(), false);
    assert.equal(await message.evaluate(node => node === document.activeElement), true, 'outside click keeps focus at its target');
    assert.equal(await message.inputValue(), 'Draft through voice disclosure');
    assert.deepEqual(dismissalWrites, [], 'Voice disclosure sends no command');
    assert.deepEqual(registrations, heldRegistration, 'Voice dismissal keeps the selected speaker');
    const closedComposer = await composer.boundingBox();
    assert.ok(closedComposer !== null && closedComposer.y + closedComposer.height <= 900, 'closed Voice leaves the composer in the desktop viewport');
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/voice-desktop-closed.png`});
    await voice.click();
    const openComposer = await composer.boundingBox();
    assert.deepEqual(openComposer, closedComposer, 'opening Voice does not move the composer');
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).click({trial: true});
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/voice-desktop-open.png`});
    const openEvidence = async (): Promise<void> => {
      if (!await controls.isVisible()) await voice.click();
      if (await evidence.locator('..').getAttribute('open') === null) await evidence.click();
    };
    await evidence.click();
    await controls.getByText(/Qualification recorded in Chrome/).waitFor();
    await other.goto(`${world.url}/#/module/companions/assistant`); await feed(other, 'connected');
    const otherPage = other.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await otherPage.getByRole('button', {name: 'Voice · Unavailable', exact: true}).click();
    await otherPage.getByText('Another tab is the selected speaker.', {exact: true}).waitFor();
    assert.ok(await otherPage.getByRole('button', {name: 'Enable', exact: true}).isDisabled());
    const unavailable = otherPage.getByRole('button', {name: 'Voice · Unavailable', exact: true});
    await unavailable.click();
    for (const width of [390, 320]) {
      await other.setViewportSize({width, height: 844});
      await unavailable.click({trial: true});
      await assertNarrowProfile(other, 'B.U.N.N.Y.');
      if (receipts !== undefined) await other.screenshot({path: `${receipts}/profile-bunny-voice-unavailable-${width}.png`});
      await chooseConversation(other, 'microduck');
      await assertNarrowProfile(other, 'MicroDuck', true);
      if (receipts !== undefined) await other.screenshot({path: `${receipts}/profile-microduck-voice-unavailable-${width}.png`});
      await chooseConversation(other, 'bunny');
    }
    await other.setViewportSize({width: 1280, height: 1000});
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/voice-desktop.png`, fullPage: true});
    // The synthetic provider asks a question first: the question is spoken, then the final result after the answer.
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-PROMPT');
    const send = assistant.getByRole('button', {name: 'Send', exact: true}); await send.focus(); await send.press('Enter');
    await assistant.getByText('Needs your answer', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 1);
    await page.evaluate(() => window.speechFixture.finish());
    await openEvidence();
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    await assistant.getByRole('textbox', {name: 'Answer', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-ANSWER');
    const answer = assistant.getByRole('button', {name: 'Answer', exact: true}); await answer.focus(); await answer.press('Enter');
    await assistant.getByText('Task completed', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 2);
    await page.evaluate(() => window.speechFixture.finish());
    await openEvidence();
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    // Speak replays the saved result through the same endpoint and reports its receipt separately from playback.
    const messages = assistant.getByRole('list', {name: 'Saved conversation messages', exact: true});
    const tool = messages.getByRole('article', {name: 'tool message'}).filter({hasText: /coding agent session/});
    await voice.click();
    await tool.locator('summary').click();
    await tool.getByText(/coding agent session/).waitFor();
    await tool.locator('summary').click();
    assert.equal(await count(), 2, 'reading saved tool output never queues speech');
    const result = messages.getByRole('article', {name: 'assistant message', exact: true}).filter({hasText: 'Synthetic result:'}).last();
    const speak = result.getByRole('button', {name: /^Read aloud message /}); await speak.focus(); await speak.press('Enter');
    // The receipt must leave its idle text; the accepted control is the saved request, the playback report is the speech.
    await assistant.getByText(/^Read aloud receipt: (?!No command sent)/).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 3);
    await page.evaluate(() => window.speechFixture.finish());
    await openEvidence();
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    // Stop speaking stops the audio of a question without answering or cancelling the task.
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-SECOND');
    await send.click(); await assistant.getByText('Needs your answer', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 4);
    await voiceState('Speaking').waitFor();
    const question = await assistant.getByRole('article', {name: 'Saved question', exact: true}).innerText();
    const details = assistant.getByRole('dialog', {name: 'Conversation details', exact: true});
    const detailsToggle = assistant.getByRole('button', {name: 'Details', exact: true});
    const closeDetails = details.getByRole('button', {name: 'Close details', exact: true});
    const draft = assistant.getByRole('textbox', {name: 'Answer', exact: true});
    const savedDraft = 'Draft held during Voice and Details checks';
    // Sending the message dismissed Voice. Open the saved result before both panels.
    assert.equal(await controls.isVisible(), false);
    await tool.locator('summary').click();
    await draft.fill(savedDraft);
    await detailsToggle.click();
    await details.getByText('Capabilities', {exact: true}).click();
    const provider = details.getByText('Synthetic (no paid calls)', {exact: true});
    await provider.waitFor();
    await voice.click();
    await controls.waitFor();
    await details.waitFor({state: 'hidden'});
    await detailsToggle.click();
    await provider.waitFor();
    await controls.waitFor({state: 'hidden'});
    const composerBounds = await draft.boundingBox();
    assert.ok(composerBounds !== null && composerBounds.y + composerBounds.height <= 900);
    await draft.click({trial: true});
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/conversation-voice-details.png`});
    const transcript = assistant.locator('.conversation-transcript');
    await transcript.evaluate(node => {node.scrollTop = 20;});
    assert.ok(await transcript.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop > 24), 'reading above the live tail');
    const readingAnchor = () => transcript.evaluate(node => {
      const top = node.getBoundingClientRect().top;
      return Array.from(node.querySelectorAll('[data-message]')).find(row => row.getBoundingClientRect().bottom > top)?.getAttribute('data-message');
    });
    const heldEndpoint = [...registrations];
    assert.equal(heldEndpoint.length, 1);
    const reflow = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await reflow();
    const heldAnchor = await readingAnchor();
    assert.equal(typeof heldAnchor, 'string');
    // The other companion pages are in the Devices menu (Hub #1889). Opening and closing it leaves the page as it was.
    const deviceMenu = await openDeviceMenu(page);
    await deviceMenu.getByRole('menuitem', {name: 'Reachy', exact: true}).waitFor();
    await page.keyboard.press('Escape');
    await deviceMenu.waitFor({state: 'detached'});
    await reflow();
    assert.equal(await readingAnchor(), heldAnchor, 'the Devices menu preserves the reading anchor');
    assert.equal(await draft.inputValue(), savedDraft);
    assert.deepEqual(registrations, heldEndpoint, 'the Devices menu keeps the speaking endpoint');
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({width, height: 900});
      await reflow();
      assert.equal(await readingAnchor(), heldAnchor);
      assert.equal(await tool.locator('details').getAttribute('open'), '');
      assert.equal(await draft.inputValue(), savedDraft);
      await provider.waitFor();
      const stop = assistant.getByRole('button', {name: 'Stop speaking', exact: true});
      assert.equal(await stop.count(), 1, 'only one Stop speaking action is presented');
      await stop.click({trial: true});
      assert.equal(await details.getByRole('button', {name: 'Stop speaking', exact: true}).count(), width === 1280 ? 0 : 1);
      if (width !== 1280 && receipts !== undefined) await page.screenshot({path: `${receipts}/details-stop-${width}.png`});
    }
    assert.equal(await count(), 4);
    assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 0);
    await closeDetails.click();
    const toolbarStop = assistant.getByRole('button', {name: 'Stop speaking', exact: true});
    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 844});
      await assertNarrowProfile(page, 'B.U.N.N.Y.');
      await toolbarStop.click({trial: true});
      if (receipts !== undefined) await page.screenshot({path: `${receipts}/profile-bunny-stop-${width}.png`});
    }
    await page.setViewportSize({width: 320, height: 790});
    // A profile chosen in the rail's drawer keeps the page, its draft and its one speech endpoint.
    await chooseConversation(page, 'reachy'); await voiceState('Speaking').waitFor();
    await detailsToggle.click();
    await details.locator('.conversation-details-profile').getByText('Reachy', {exact: true}).waitFor();
    await closeDetails.click();
    await chooseConversation(page, 'bunny'); await voiceState('Speaking').waitFor();
    assert.equal(await draft.inputValue(), savedDraft);
    assert.deepEqual(registrations, heldEndpoint, 'panel, viewport and profile changes keep the original speech endpoint');
    assert.equal(await count(), 4);
    assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 0);
    await detailsToggle.click();
    await provider.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/voice-narrow-speaking.png`});
    const stop = details.getByRole('button', {name: 'Stop speaking', exact: true});
    assert.equal(await assistant.getByRole('button', {name: 'Stop speaking', exact: true}).count(), 1);
    await stop.click({trial: true});
    await stop.focus(); await stop.press('Enter');
    await page.waitForFunction(() => window.speechFixture.cancelled === 1);
    await details.waitFor();
    await closeDetails.click();
    await voiceState('Voice on').waitFor();
    assert.equal(await assistant.getByRole('article', {name: 'Saved question', exact: true}).innerText(), question);
    assert.equal(await draft.inputValue(), savedDraft);
    await page.setViewportSize({width: 1280, height: 1000});
    await voice.click(); await evidence.click();
    await controls.getByText('Playback: Playback stopped. The sentence may be incomplete.', {exact: true}).waitFor();
    await assistant.getByText('Needs your answer', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 1);
    // Quiet keeps the result written only; Work lets the next reply speak again.
    await other.goto(`${world.url}/#/`); await feed(other, 'connected'); const hub = other.locator('[data-widget="hub-mode"]');
    await hub.getByRole('button', {name: 'Quiet', exact: true}).click(); await controls.getByText('Quiet mode suppresses spoken replies.', {exact: true}).waitFor();
    await assistant.getByRole('textbox', {name: 'Answer', exact: true}).fill('Synthetic answer in Quiet');
    await answer.click(); await assistant.getByText('Task completed', {exact: true}).waitFor();
    await page.waitForTimeout(300); assert.equal(await count(), 4, 'Quiet suppresses a short reply');

    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('Synthetic long reply fixture');
    await send.click(); await assistant.getByText('Needs your answer', {exact: true}).waitFor();
    const longAnswer = 'A synthetic reply detail. '.repeat(24);
    await assistant.getByRole('textbox', {name: 'Answer', exact: true}).fill(longAnswer);
    await answer.click(); await assistant.getByText('Task completed', {exact: true}).waitFor();
    const longReply = messages.getByRole('article', {name: 'assistant message', exact: true}).filter({hasText: 'Synthetic result: A synthetic reply detail.'});
    await longReply.getByText('Written only. Read aloud supports up to 512 characters.', {exact: true}).waitFor();
    assert.equal(await longReply.getByRole('button', {name: /^Read aloud/}).count(), 0);
    assert.equal(await count(), 4, 'Quiet mode speaks no reply');
    await hub.getByRole('button', {name: 'Work', exact: true}).click();
    await voice.click();
    await controls.getByText('Quiet mode suppresses spoken replies.', {exact: true}).waitFor({state: 'detached'});
    await controls.getByRole('button', {name: 'Mute', exact: true}).click();
    await voiceState('Voice off').waitFor();
    await enable.click(); await voiceState('Voice on').waitFor();
    assert.equal(await count(), 4, 'fresh enable does not replay Quiet history');
    world.dropDashboardStreams(); await feed(page, 'connected');
    await voiceState('Voice on').waitFor({state: 'detached'});
    assert.equal(await count(), 4, 'reconnect does not replay');
    await page.reload(); await feed(page, 'connected');
    await voice.waitFor(); assert.equal(await voice.getAttribute('aria-expanded'), 'false');
    assert.equal(await count(), 0, 'reload does not enable or replay');
    assert.equal(await messages.getByRole('article', {name: /^(owner|tool) message$/}).getByRole('button', {name: /^Read aloud/}).count(), 0);

    await voice.click(); await enable.click(); await voiceState('Voice on').waitFor();
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('Synthetic voice recovery fixture');
    await send.click(); await page.waitForFunction(() => window.speechFixture.calls === 1);
    await page.evaluate(() => window.speechFixture.fail());
    await voiceState('Needs attention').waitFor();
    await other.goto(`${world.url}/#/module/companions/assistant`);
    await feed(other, 'connected');
    const otherVoice = otherPage.getByRole('button', {name: /^Voice (off|on|· (Speaking|Needs attention|Unavailable))$/});
    await otherPage.getByRole('button', {name: 'Voice · Needs attention', exact: true}).click();
    const otherControls = otherPage.getByRole('region', {name: 'Spoken replies', exact: true});
    const otherEnable = otherControls.getByRole('button', {name: 'Enable', exact: true});
    const recover = otherControls.getByRole('button', {name: 'Recover voice', exact: true});
    const beforeRestart = {enableDisabled: await otherEnable.isDisabled(), recoveryVisible: await recover.isVisible()};
    await otherControls.getByText('Earlier playback is unresolved. Voice stays off until recovery is available.', {exact: true}).waitFor();

    // Hold the retained tab offline until the other tab renews their shared browser session.
    const edge = '**/api/sdk/v1/**';
    await page.route(edge, route => route.abort('internetdisconnected'));
    await world.restart();
    await other.reload(); await feed(other, 'connected');
    await otherPage.getByRole('button', {name: 'Voice · Needs attention', exact: true}).click();
    const confirmation = otherControls.getByRole('checkbox', {name: /I have stopped playback/});
    const recoveryDraft = otherPage.getByRole('textbox', {name: 'Answer', exact: true});
    const recoveryAnswer = otherPage.getByRole('button', {name: 'Answer', exact: true});
    const retainedAnswer = 'Synthetic answer held during voice recovery';
    await recoveryDraft.fill(retainedAnswer);
    assert.equal(await recoveryAnswer.isEnabled(), true, 'the retained answer is eligible to submit');
    await otherPage.evaluate(node => {
      node.addEventListener('submit', () => {node.setAttribute('data-draft-submitted', '');}, {once: true});
    });
    const recoveryWrites = changes(other);
    await confirmation.press('Enter');
    assert.equal(await otherPage.getAttribute('data-draft-submitted'), null, 'Enter in Voice recovery does not submit the answer form');
    assert.deepEqual(recoveryWrites, [], 'Enter in Voice recovery does not stage an answer');
    assert.equal(await recoveryDraft.inputValue(), retainedAnswer);
    assert.equal(await confirmation.isChecked(), false);
    assert.equal(await recover.isDisabled(), true);
    assert.equal(await otherEnable.isDisabled(), true);
    for (const width of [390, 320]) {
      await other.setViewportSize({width, height: 844});
      await confirmation.click({trial: true});
      await assertNarrowProfile(other, 'B.U.N.N.Y.');
      if (receipts !== undefined) await other.screenshot({path: `${receipts}/profile-bunny-voice-recovery-${width}.png`});
    }
    await confirmation.check();
    await recover.click({trial: true});
    await otherControls.getByRole('button', {name: 'Close spoken replies', exact: true}).click();
    await otherVoice.click();
    assert.equal(await confirmation.isChecked(), false);
    await confirmation.check(); await recover.click();
    await otherPage.getByRole('button', {name: 'Voice off', exact: true}).waitFor();
    await otherControls.getByText('Voice requirements and playback evidence', {exact: true}).click();
    await otherControls.getByText('Recovery acknowledged. The earlier playback remains uncertain.', {exact: true}).waitFor();
    assert.equal(await other.evaluate(() => window.speechFixture.calls), 0, 'recovery produces no audio');
    await other.setViewportSize({width: 1280, height: 1000});

    await page.unroute(edge);
    await feed(page, 'connected');
    await voice.click();
    await enable.click();
    await controls.getByRole('button', {name: 'Mute', exact: true}).waitFor();
    await evidence.click();
    await controls.getByText('Playback: Playback is uncertain. It will not be replayed automatically.', {exact: true}).waitFor();
    const currentVoice = await voice.innerText();
    assert.deepEqual({beforeRestart, currentVoice}, {
      beforeRestart: {enableDisabled: true, recoveryVisible: false}, currentVoice: 'Voice on',
    });
    assert.equal(await count(), 1, 'fresh enable does not replay the recovered operation');

    const unavailableVoice = otherPage.getByRole('button', {name: 'Voice · Unavailable', exact: true});
    const unavailableEnable = otherPage.getByRole('button', {name: 'Enable', exact: true});
    const controlAuthority = '**/api/v2/authority?scope=control';
    await other.route(controlAuthority, route => route.fulfill({status: 403, json: {error: {code: 'forbidden', retryable: false}}}));
    await other.goto(`${world.url}/#/module/companions/assistant`); await other.reload(); await feed(other, 'connected');
    await unavailableVoice.click();
    await otherPage.getByText('Voice controls require operator access.', {exact: true}).waitFor();
    assert.ok(await unavailableEnable.isDisabled());
    await other.unroute(controlAuthority);
    await other.route('**/modules/companions/content/speech-qualification', route => route.fulfill({status: 404}));
    await other.reload(); await feed(other, 'connected');
    await unavailableVoice.click();
    await otherPage.getByText(/Voice requires qualified Google Chrome on macOS/).waitFor();
    assert.ok(await unavailableEnable.isDisabled());
    assert.equal(JSON.stringify(world.logs).includes('PRIVATE-SYNTHETIC'), false, 'diagnostics contain no spoken text');
    assert.deepEqual(errors, []);
  } finally {await context.close(); await world.close();}
  process.stdout.write('Spoken replies browser: question, result and Read aloud receipt, second-tab exclusion, playback through profile and layout changes, Stop in narrow Details, Quiet silence, mute and fresh enable passed with synthetic audio.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await spokenRepliesJourney(browser);}
  finally {await browser.close();}
}
