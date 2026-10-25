import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import type {Browser, Page} from 'playwright';
import {feed, startWorld} from './harness.ts';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';

type SpeechFixture = {calls: number; cancelled: number; overlap: number; voices: boolean; finish(): void; releaseVoices(): void; fail(): void};
declare global {interface Window {speechFixture: SpeechFixture}}

/** Real runtime and page, with only browser identity and the audio device replaced by explicit synthetic fixtures. */
export async function speechJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgentData', {value: {platform: 'macOS', getHighEntropyValues: () => Promise.resolve({fullVersionList: [{brand: 'Google Chrome', version: '150.0.0.1'}]})}});
      const NativeUtterance = SpeechSynthesisUtterance;
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {value: class extends NativeUtterance {
        constructor(text: string) {super(text); Object.defineProperty(this, 'voice', {value: null, writable: true});}
      }});
      const events = new EventTarget();
      const voice = {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local', localService: true, default: true};
      let active: SpeechSynthesisUtterance | undefined;
      const fixture: SpeechFixture = {calls: 0, cancelled: 0, overlap: 0, voices: true,
        finish: () => {const utterance = active; active = undefined; if (utterance !== undefined) utterance.dispatchEvent(new SpeechSynthesisEvent('end', {utterance}));},
        releaseVoices: () => {fixture.voices = true; events.dispatchEvent(new Event('voiceschanged'));},
        fail: () => {const utterance = active; active = undefined; if (utterance !== undefined) utterance.dispatchEvent(new SpeechSynthesisErrorEvent('error', {utterance, error: 'synthesis-failed'}));},
      };
      window.speechFixture = fixture;
      Object.defineProperty(window, 'speechSynthesis', {value: {
        getVoices: () => fixture.voices ? [voice] : [],
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
        get speaking() {return active !== undefined;}, get pending() {return false;},
        speak: (utterance: SpeechSynthesisUtterance) => {
          if (active !== undefined) fixture.overlap++; fixture.calls++; active = utterance;
          queueMicrotask(() => {if (active === utterance) utterance.dispatchEvent(new SpeechSynthesisEvent('start', {utterance}));});
        },
        cancel: () => {
          const utterance = active; active = undefined;
          if (utterance !== undefined) {fixture.cancelled++; utterance.dispatchEvent(new SpeechSynthesisErrorEvent('error', {utterance, error: 'interrupted'}));}
        },
      }});
    });
    const page = await context.newPage(), other = await context.newPage(); page.setDefaultTimeout(12_000); other.setDefaultTimeout(12_000);
    const visit = async (target: Page): Promise<void> => {await target.goto(`${world.url}/#/module/companions/reachy`); await feed(target, 'connected');};
    const controls = (target: Page) => target.getByRole('region', {name: 'Spoken alerts', exact: true});
    const enable = (target: Page) => controls(target).getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true});
    const enabled = (target: Page) => controls(target).getByText('Spoken alerts enabled in this tab.', {exact: true});
    const count = (target = page) => target.evaluate(() => window.speechFixture.calls);
    let sequence = 0;
    const question = async (id: string): Promise<void> => {
      await world.observe(turnStarted, {turn: id, sequence: ++sequence});
      await world.observe({kind: 'question-continuing', attention: {status: 'known', id}}, {turn: id, sequence: ++sequence, nativeEventId: id});
      await page.getByRole('article', {name: 'Reachy card', exact: true}).getByText('Coding attention', {exact: true}).waitFor();
      await page.waitForTimeout(150);
    };
    await visit(page); await visit(other);
    await controls(page).getByText(/Calls and other applications are not detected automatically/).waitFor();
    await page.getByRole('button', {name: 'Enable Reachy text cards', exact: true}).click();
    await page.getByText('Controls saved.', {exact: false}).waitFor();
    await world.observe(sessionStarted, {sequence: ++sequence}); await question('speech-off'); assert.equal(await count(), 0);
    await enable(page).focus(); await enable(page).press('Enter'); await enabled(page).waitFor();
    await controls(other).getByText('Another tab has spoken alerts enabled.', {exact: true}).waitFor(); assert.equal(await enable(other).isDisabled(), true);
    assert.equal(await count(), 0, 'explicit enablement does not catch up the previous card');
    await question('speech-complete'); await page.waitForFunction(() => window.speechFixture.calls === 1); assert.equal(await count(other), 0);
    await page.evaluate(() => window.speechFixture.finish());
    await controls(page).getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
    await controls(page).getByText('Tracked operation: succeeded.', {exact: true}).waitFor();
    await question('speech-stop'); await page.waitForFunction(() => window.speechFixture.calls === 2);
    const stop = controls(page).getByRole('button', {name: 'Stop speaking', exact: true}); await stop.focus(); await stop.press('Enter');
    await controls(page).getByText('Playback: Playback stopped. The sentence may be incomplete.', {exact: true}).waitFor();
    await question('speech-mute'); await page.waitForFunction(() => window.speechFixture.calls === 3);
    await controls(page).getByRole('button', {name: 'Mute spoken alerts', exact: true}).click();
    await controls(page).getByText('Spoken alerts are off in this tab.', {exact: true}).waitFor();
    await question('speech-muted'); assert.equal(await count(), 3); assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 2);
    await enable(page).click(); await enabled(page).waitFor(); assert.equal(await count(), 3);
    await page.getByRole('button', {name: 'Mute Coding attention', exact: true}).click(); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).waitFor();
    await question('speech-category-muted'); assert.equal(await count(), 3);
    await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).click();
    await other.goto(`${world.url}/#/`); const hub = other.locator('[data-widget="hub-mode"]');
    await hub.getByRole('button', {name: 'Quiet', exact: true}).click(); await controls(page).getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor();
    await question('speech-quiet'); assert.equal(await count(), 3);
    await hub.getByRole('button', {name: 'Work', exact: true}).click(); await controls(page).getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor({state: 'detached'});
    await page.evaluate(() => {window.speechFixture.voices = false;});
    await question('speech-delayed'); assert.equal(await count(), 3);
    await page.getByRole('button', {name: 'Mute Coding attention', exact: true}).click(); await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).waitFor();
    await page.evaluate(() => window.speechFixture.releaseVoices());
    await controls(page).getByText('Playback: Speech did not start.', {exact: true}).waitFor(); assert.equal(await count(), 3);
    await page.getByRole('button', {name: 'Unmute Coding attention', exact: true}).click();
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
    const receipts = process.env.DASHBOARD_RECEIPTS;
    if (receipts !== undefined) {await mkdir(receipts, {recursive: true}); await page.screenshot({path: `${receipts}/speech-desktop.png`, fullPage: true});}
    await page.setViewportSize({width: 390, height: 844}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
    if (receipts !== undefined) await page.screenshot({path: `${receipts}/speech-phone.png`, fullPage: true});
    world.dropDashboardStreams(); await feed(page, 'connected'); await controls(page).getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor({state: 'detached'});
    assert.equal(await count(), 3); await question('speech-disconnected'); assert.equal(await count(), 3);
    await enable(page).click(); await enabled(page).waitFor(); assert.equal(await count(), 3);
    await page.reload(); await feed(page, 'connected'); await enabled(page).waitFor({state: 'detached'}); assert.equal(await count(), 0);
    await enable(page).click(); await enabled(page).waitFor(); await question('speech-error'); await page.waitForFunction(() => window.speechFixture.calls === 1);
    await page.evaluate(() => window.speechFixture.fail()); await controls(page).getByText('Playback: Playback is uncertain. It will not be replayed automatically.', {exact: true}).waitFor();
    assert.equal(await count(), 1); assert.equal(await page.evaluate(() => window.speechFixture.overlap), 0);
    assert.equal(await page.getByRole('button', {name: 'Disable Reachy text cards', exact: true}).isEnabled(), true, 'uncertain speech must not lock independent visual controls');
    await world.restart(); await page.reload(); await feed(page, 'connected');
    assert.equal(await count(), 0); await enabled(page).waitFor({state: 'detached'});
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await page.getByText('Read-only access. Controls require operator authority.', {exact: true}).waitFor();
    assert.equal(await enable(page).isDisabled(), true); assert.deepEqual(errors, []);
  } finally {await context.close(); await world.close();}
  process.stdout.write('Speech browser: selected tab, manual availability, completed/Stop/mute receipts, Quiet/category policy, delayed voice recheck, reload/disconnect/restart silence, uncertainty, reader controls, keyboard, narrow layout and axe passed with synthetic audio.\n');
}
