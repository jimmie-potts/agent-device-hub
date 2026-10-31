import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import type {Browser, Page, Request} from 'playwright';
import {feed, startWorld} from './harness.ts';
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
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
    const receipts = process.env.DASHBOARD_RECEIPTS;
    if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: `${receipts}/speech-desktop.png`, fullPage: true});}
    await page.setViewportSize({width: 390, height: 844}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
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
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await tab(page, 'Voice'); await page.getByText('Read-only access. Controls require operator authority.', {exact: true}).waitFor();
    assert.equal(await enable(page).isDisabled(), true); assert.deepEqual(errors, []);
  } finally {await context.close(); await world.close();}
  process.stdout.write('Speech browser: selected tab, manual availability, completed/Stop/mute receipts, Quiet/category policy, delayed voice recheck, reload/disconnect/restart silence, uncertainty, reader controls, keyboard, narrow layout and axe passed with synthetic audio.\n');
}

/** Removing an opted-in Home card withdraws its endpoint without enabling another tab. */
export async function homeSpeechLifetimeJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
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
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  try {
    await context.addInitScript(installSyntheticSpeech);
    const page = await context.newPage(), other = await context.newPage(); page.setDefaultTimeout(12_000); other.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`); await feed(page, 'connected');
    const assistant = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const controls = assistant.getByRole('region', {name: 'Spoken replies', exact: true});
    const count = () => page.evaluate(() => window.speechFixture.calls);
    const enableAssistant = assistant.getByRole('button', {name: 'Enable conversation', exact: true});
    await enableAssistant.focus(); await enableAssistant.press('Enter');
    await assistant.getByRole('button', {name: 'Disable conversation', exact: true}).waitFor();
    await controls.getByText(/This tab becomes the one speaker/).waitFor();
    const enable = controls.getByRole('button', {name: 'Enable spoken replies in this tab', exact: true});
    await enable.focus(); await enable.press('Enter');
    await controls.getByText('Spoken replies enabled in this tab.', {exact: true}).waitFor();
    // The synthetic provider asks a question first: the question is spoken, then the final result after the answer.
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-PROMPT');
    const send = assistant.getByRole('button', {name: 'Send message', exact: true}); await send.focus(); await send.press('Enter');
    await assistant.getByText('Task status: waiting', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 1);
    await page.evaluate(() => window.speechFixture.finish());
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    await assistant.getByRole('textbox', {name: 'Answer', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-ANSWER');
    const answer = assistant.getByRole('button', {name: 'Save answer and continue', exact: true}); await answer.focus(); await answer.press('Enter');
    await assistant.getByText('Task status: succeeded', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 2);
    await page.evaluate(() => window.speechFixture.finish());
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    // Speak replays the saved result through the same endpoint and reports its receipt separately from playback.
    const messages = assistant.getByRole('list', {name: 'Saved conversation messages', exact: true});
    const result = messages.getByRole('article', {name: 'assistant message', exact: true}).filter({hasText: 'Synthetic result:'}).last();
    const speak = result.getByRole('button', {name: /^Speak message /}); await speak.focus(); await speak.press('Enter');
    await assistant.getByText(/^Speak receipt: /).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 3);
    await page.evaluate(() => window.speechFixture.finish());
    await controls.getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    // Stop speaking stops the audio of a question without answering or cancelling the task.
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-SECOND');
    await send.click(); await assistant.getByText('Task status: waiting', {exact: true}).waitFor();
    await page.waitForFunction(() => window.speechFixture.calls === 4);
    const stop = controls.getByRole('button', {name: 'Stop speaking', exact: true}); await stop.focus(); await stop.press('Enter');
    await controls.getByText('Playback: Playback stopped. The sentence may be incomplete.', {exact: true}).waitFor();
    await assistant.getByText('Task status: waiting', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 1);
    // Quiet keeps the result written only; Work lets the next reply speak again.
    await other.goto(`${world.url}/#/`); await feed(other, 'connected'); const hub = other.locator('[data-widget="hub-mode"]');
    await hub.getByRole('button', {name: 'Quiet', exact: true}).click(); await controls.getByText('Quiet mode suppresses spoken replies.', {exact: true}).waitFor();
    await assistant.getByRole('textbox', {name: 'Answer', exact: true}).fill('PRIVATE-SYNTHETIC-BROWSER-QUIET');
    await answer.click(); await assistant.getByText('Task status: succeeded', {exact: true}).waitFor();
    await page.waitForTimeout(300); assert.equal(await count(), 4, 'Quiet mode speaks no reply');
    await hub.getByRole('button', {name: 'Work', exact: true}).click(); await controls.getByText('Quiet mode suppresses spoken replies.', {exact: true}).waitFor({state: 'detached'});
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
    const receipts = process.env.DASHBOARD_RECEIPTS;
    if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: `${receipts}/spoken-replies-desktop.png`, fullPage: true});}
    await controls.getByRole('button', {name: 'Mute spoken replies', exact: true}).click();
    await controls.getByText('Spoken replies are off in this tab.', {exact: true}).waitFor();
    assert.equal(JSON.stringify(world.logs).includes('PRIVATE-SYNTHETIC'), false, 'diagnostics contain no spoken text');
    assert.deepEqual(errors, []);
  } finally {await context.close(); await world.close();}
  process.stdout.write('Spoken replies browser: question, result and Speak replay spoken through the Conversation tab, Stop without cancelling, Quiet silence, mute, keyboard and axe passed with synthetic audio.\n');
}
