import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import type {BrowserContext, Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {sessionStarted, turnStarted} from '../tests/fixtures/agents.js';
import {dispatchOnce, publish} from '../tests/scenarios/framework.js';
import {connectRun} from './adapter.js';
import {installSyntheticSpeech} from './speech-fixture.js';

/** Real disposable runtime and rendered controls; the browser identity and audio are explicit synthetic inputs. */
export async function speechBrowserCapture(t: CaptureContext): Promise<void> {
  const page = t.page as Page, context = t.context as BrowserContext;
  const harness = t.endpoints?.harness;
  assert.ok(harness !== undefined && harness !== '', 'the existing run owns its harness');
  const run = await connectRun({url: t.url, harness, dataDir: t.dataDir,
    seed: {modules: ['core', 'companions'], follows: [{owner: 'bunny/core', families: ['session', 'mode', 'operation']}]}});
  const errors: string[] = [];
  page.on('pageerror', error => {errors.push(error.name);});
  await context.addInitScript(installSyntheticSpeech);
  const other = await context.newPage();
  const region = (p = page) => p.getByRole('region', {name: 'Spoken alerts', exact: true});
  const enable = (p = page) => region(p).getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true});
  const enabled = (p = page) => region(p).getByText('Spoken alerts enabled in this tab.', {exact: true});
  const count = (p = page) => p.evaluate(() => window.speechFixture.calls);
  const visit = async (p: Page): Promise<void> => {
    await p.goto(new URL('/#/module/companions/reachy', t.url).href);
    await p.locator('main#main[data-feed="connected"]').waitFor();
  };
  let step = 0, sequence = 0;
  const indicate = async (label: string, target?: Locator): Promise<void> => {
    let point = {x: 24, y: 64};
    if (target !== undefined) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox(); assert.ok(box);
      point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
      await target.evaluate(element => {if (element instanceof HTMLElement) {element.style.outline = '3px solid #fbbf24'; element.dataset.speechCaptureTarget = 'true';}});
    }
    await page.evaluate(({label, point, step}) => {
      let caption = document.getElementById('speech-test-caption');
      if (caption === null) {caption = document.createElement('div'); caption.id = 'speech-test-caption'; document.body.append(caption);}
      caption.textContent = `Synthetic demo ${step}: ${label}`;
      caption.style.cssText = 'pointer-events: none';
      Object.assign(caption.style, {position: 'fixed', top: '8px', left: '8px', zIndex: '9999', background: '#111827', color: '#fff', padding: '8px', fontSize: '14px', maxWidth: '90vw'});
      let cursor = document.getElementById('speech-test-cursor');
      if (cursor === null) {cursor = document.createElement('div'); cursor.id = 'speech-test-cursor'; document.body.append(cursor);}
      cursor.style.cssText = 'pointer-events: none';
      Object.assign(cursor.style, {position: 'fixed', left: `${point.x - 9}px`, top: `${point.y - 9}px`, width: '18px', height: '18px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '9998', });
    }, {label, point, step: ++step});
    await page.mouse.move(point.x, point.y, {steps: 8});
    await page.waitForTimeout(180);
  };
  const click = async (target: Locator, label: string, keyboard = false): Promise<void> => {
    await indicate(label, target);
    await page.evaluate(() => {const cursor = document.getElementById('speech-test-cursor'); if (cursor !== null) cursor.style.background = '#fbbf24';});
    if (keyboard) {await target.focus(); await target.press('Enter');} else await target.click();
    await page.waitForTimeout(240);
    await page.evaluate(() => {const cursor = document.getElementById('speech-test-cursor'); if (cursor !== null) cursor.style.background = 'transparent';});
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('[data-speech-capture-target]')) {
        if (element instanceof HTMLElement) {element.style.outline = ''; delete element.dataset.speechCaptureTarget;}
      }
    });
  };
  const question = async (id: string): Promise<void> => {
    await indicate(`New synthetic coding question: ${id}`);
    await publish(run, turnStarted, {turn: id, sequence: ++sequence});
    await publish(run, {kind: 'question-continuing', attention: {status: 'known', id}}, {turn: id, sequence: ++sequence, nativeEventId: id});
    await page.getByRole('article', {name: 'Reachy card', exact: true}).getByText('Coding attention', {exact: true}).waitFor();
    await page.waitForTimeout(200);
  };
  const mode = async (value: 'work' | 'free' | 'quiet'): Promise<void> => {
    await indicate(`Synthetic operator selects ${value} mode`);
    await dispatchOnce(run, 'operator', `speech-mode-${step}`, {key: 'bunny.cmd.mode-set.hub', draft: {
      type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: value},
    }}, `speech-mode-${step}`);
    await t.expect(`the core saves ${value} before its speech check`, async () => {
      const selected = () => run.reader.states<ModeState>('mode').find(state => state.data.id === 'hub')?.data.mode;
      for (let attempt = 0; attempt < 100 && selected() !== value; attempt++) await run.wait(20);
      assert.equal(selected(), value);
    });
  };
  try {
    await visit(page); await visit(other);
    await click(page.getByRole('button', {name: 'Enable Reachy text cards', exact: true}), 'Enable text cards');
    await page.getByText('Controls saved.', {exact: false}).waitFor();
    await publish(run, sessionStarted, {sequence: ++sequence});
    await question('default-off');
    await t.expect('text enablement alone submits no speech', async () => assert.equal(await count(), 0));
    await click(enable(), 'Enable speech in this tab with Enter', true); await enabled().waitFor();
    await region(other).getByText('Another tab has spoken alerts enabled.', {exact: true}).waitFor();
    await t.expect('manual availability does not replay and another tab cannot take over', async () => {
      assert.equal(await count(), 0); assert.equal(await enable(other).isDisabled(), true);
    });
    for (const selected of ['work', 'free'] as const) {
      await mode(selected); await question(`${selected}-complete`);
      const expected = selected === 'work' ? 1 : 2;
      await page.waitForFunction(expected => window.speechFixture.calls === expected, expected);
      await indicate('Synthetic browser reports playback completed');
      await page.evaluate(() => window.speechFixture.finish());
      await t.expect(`${selected}: fresh question reaches only the selected tab with separate playback and operation receipts`, async () => {
        await region().getByText('Playback: The browser reported playback completed.', {exact: true}).waitFor();
        await region().getByText('Tracked operation: succeeded.', {exact: true}).waitFor();
        assert.equal(await count(other), 0);
      });
    }
    await question('stop'); await page.waitForFunction(() => window.speechFixture.calls === 3);
    await click(region().getByRole('button', {name: 'Stop speaking', exact: true}), 'Stop speaking with Enter', true);
    await t.expect('Stop cancels local output and preserves possible partial speech', async () => {
      await region().getByText('Playback: Playback stopped. The sentence may be incomplete.', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 1);
    });
    await question('mute'); await page.waitForFunction(() => window.speechFixture.calls === 4);
    await click(region().getByRole('button', {name: 'Mute spoken alerts', exact: true}), 'Mute spoken alerts');
    await region().getByText('Spoken alerts are off in this tab.', {exact: true}).waitFor();
    await question('muted');
    await t.expect('Mute cancels active speech and suppresses a later question', async () => {
      assert.equal(await count(), 4); assert.equal(await page.evaluate(() => window.speechFixture.cancelled), 2);
    });
    await click(enable(), 'Enable speech again'); await enabled().waitFor();
    await click(page.getByRole('button', {name: 'Mute Coding attention', exact: true}), 'Mute Coding attention');
    await question('category-muted');
    await t.expect('category mute suppresses new speech without catch-up', async () => assert.equal(await count(), 4));
    await click(page.getByRole('button', {name: 'Unmute Coding attention', exact: true}), 'Unmute Coding attention');
    await mode('quiet'); await region().getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor();
    await question('quiet');
    await t.expect('Quiet mode suppresses new speech', async () => assert.equal(await count(), 4));
    await mode('work'); await region().getByText('Quiet mode suppresses new spoken alerts.', {exact: true}).waitFor({state: 'detached'});
    await page.evaluate(() => {window.speechFixture.voices = false;});
    await question('delayed-voices');
    await click(page.getByRole('button', {name: 'Mute Coding attention', exact: true}), 'Mute category while voice discovery waits');
    await indicate('Synthetic voice discovery completes after mute'); await page.evaluate(() => window.speechFixture.releaseVoices());
    await t.expect('delayed voice discovery rechecks current policy and stays silent', async () => {
      await region().getByText('Playback: Speech did not start.', {exact: true}).waitFor(); assert.equal(await count(), 4);
    });
    await click(page.getByRole('button', {name: 'Unmute Coding attention', exact: true}), 'Unmute category');
    await t.expect('desktop controls have no targeted accessibility violations or overlapping speech', async () => {
      assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
      assert.equal(await page.evaluate(() => window.speechFixture.overlap), 0);
    });
    await indicate('Reload this synthetic tab; speech availability must be renewed'); await page.reload();
    await page.locator('main#main[data-feed="connected"]').waitFor();
    await t.expect('reload loses availability and does not replay', async () => {await enable().waitFor(); assert.equal(await count(), 0);});
    await click(enable(), 'Enable speech after reload'); await enabled().waitFor();
    await question('callback-error'); await page.waitForFunction(() => window.speechFixture.calls === 1);
    await indicate('Synthetic browser reports synthesis failure'); await page.evaluate(() => window.speechFixture.fail());
    await t.expect('uncertain playback is explicit and does not disable independent text controls', async () => {
      await region().getByText('Playback: Playback is uncertain. It will not be replayed automatically.', {exact: true}).waitFor();
      assert.equal(await count(), 1);
      assert.equal(await page.getByRole('button', {name: 'Disable Reachy text cards', exact: true}).isEnabled(), true);
    });
    await indicate('Restart only this synthetic runtime'); await run.restart(); await page.reload();
    await page.locator('main#main[data-feed="connected"]').waitFor();
    await t.expect('runtime restart does not restore availability or replay output', async () => {await enable().waitFor(); assert.equal(await count(), 0);});
    await indicate('Inspect the same controls at a phone viewport'); await page.setViewportSize({width: 390, height: 844});
    await t.expect('narrow controls fit and retain accessibility', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
    });
    await indicate('Return to the desktop viewport');
    await page.setViewportSize({width: 1280, height: 1000}); await region().scrollIntoViewIfNeeded();
    await indicate('Synthetic speech check complete; availability remains off');
    await t.expect('the real dashboard reports no browser errors or invalid messages', () => {assert.deepEqual(errors, []); assert.deepEqual(run.problems(), []);});
    t.note('Actual core, companions, SDK, gateway and dashboard; synthetic browser identity, voice and callbacks; no native audio or installed resources.');
  } finally {await other.close(); await run.close();}
}
