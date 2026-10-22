// Real core/edge over scripted participants; no installed service or physical transport.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {checkHubCardProjections} from './hub-control-projections.ts';

const world = await startWorld({modeDevices: true, inbox: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    await checkHubCardProjections(context);
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const sent = changes(page), requests = (): number => sent.filter(path => path === '/api/v2/commands/mode-set').length;
    const nativeCalls = (): number => world.logs.filter(record => record.event_name === 'command.executing' && ['nanoleaf', 'pixoo'].includes(String(record.attributes['bunny.module']))).length;
    const waitForCalls = async (count: number): Promise<void> => {
      for (let attempt = 0; attempt < 150 && nativeCalls() < count; attempt++) await page.waitForTimeout(20);
      assert.equal(nativeCalls(), count);
    };
    await page.goto(world.url); await feed(page, 'connected');
    const panel = page.locator('[data-widget="hub-mode"]'), inbox = page.locator('[data-inbox-panel]');
    const work = panel.getByRole('button', {name: 'Work', exact: true});
    const warning = panel.getByRole('button', {name: 'Check Inbox', exact: true});
    const calls = async (n: number): Promise<void> => {await page.waitForFunction(() => document.querySelector('[data-widget="hub-mode"] .hub-control-sr')?.textContent?.includes('Selection completed')); assert.equal(nativeCalls(), n);};
    await work.waitFor(); await panel.locator('.hub-mode-choice', {hasText: 'Free'}).waitFor();
    assert.equal(requests(), 0); assert.equal(nativeCalls(), 0, 'startup sends no native command');
    const surface = await panel.evaluate(el => ({background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor}));
    await work.focus(); await work.press('Enter');
    await panel.locator('.hub-mode-choice', {hasText: 'Work'}).waitFor(); await warning.waitFor();
    assert.equal(await panel.locator('.hub-mode-art [data-mode-icon=work]').count(), 1);
    assert.deepEqual(await panel.evaluate(el => ({background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor})), surface);
    assert.doesNotMatch(await panel.innerText(), /Saved choice|Latest request|Reapply|Nanoleaf|Pixoo/);
    const beforeInspect = sent.length; await warning.click();
    const failed = inbox.locator('[data-inbox]').filter({hasText: 'wall'}).first();
    assert.equal(await failed.locator('details.inbox-entry').getAttribute('open'), '');
    assert.equal(await failed.locator('summary').first().evaluate(el => el === document.activeElement), true);
    assert.equal(sent.length, beforeInspect, 'warning navigation is passive');
    await failed.getByText('Command evidence', {exact: true}).click();
    await failed.getByText(/evidence: none/i).waitFor();
    assert.equal(requests(), 1); assert.equal(nativeCalls(), 2);
    await world.failCommand();
    const unrelated = inbox.locator('[data-inbox]').filter({hasText: 'g1'}); await unrelated.locator('summary').first().click();
    await unrelated.getByRole('button', {name: 'Dismiss'}).click(); await unrelated.waitFor({state: 'detached'}); assert.equal(await warning.count(), 1);
    await failed.getByRole('button', {name: 'Dismiss'}).click(); await failed.waitFor({state: 'detached'}); await warning.waitFor({state: 'detached'});
    await work.click(); await warning.waitFor(); assert.equal(requests(), 2, 'selected Work explicitly reapplies');
    world.modeResult('none'); await work.click();
    await waitForCalls(6);
    await page.waitForFunction(() => document.querySelector('[data-widget="hub-mode"] .hub-control-sr')?.textContent?.includes('Check Inbox'));
    assert.equal(requests(), 3); assert.equal(await warning.count(), 1, 'acceptance cannot clear a prior issue');
    await world.completeMode('succeeded'); await warning.waitFor({state: 'detached'});
    assert.equal(await inbox.locator('[data-inbox]').count(), 1, 'resolved historical Inbox evidence remains');
    // A late contradictory result reopens review and cannot be hidden by arrival order.
    await world.completeMode('failed'); await warning.waitFor(); await warning.click();
    await inbox.getByText('Both success and failure were reported.', {exact: true}).waitFor();
    world.modeResult('succeeded'); await panel.getByRole('button', {name: 'Free', exact: true}).click(); await warning.waitFor({state: 'detached'});
    await panel.locator('.hub-mode-choice', {hasText: 'Free'}).waitFor(); await calls(8);
    const beforeReload = requests(), nativeBeforeReload = nativeCalls();
    world.dropDashboardStreams(); await feed(page, 'connected'); await page.reload(); await feed(page, 'connected');
    await panel.locator('.hub-mode-choice', {hasText: 'Free'}).waitFor(); assert.equal(requests(), beforeReload); assert.equal(nativeCalls(), nativeBeforeReload, 'reload/reconnect never replay');
    await page.route('**/api/v2/commands/mode-set', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await panel.getByRole('button', {name: 'Quiet', exact: true}).click(); await panel.locator('.hub-mode-choice', {hasText: 'Quiet'}).waitFor();
    await calls(10); assert.equal(requests(), beforeReload + 1);
    await world.restart(); await page.reload(); await feed(page, 'connected');
    await panel.locator('.hub-mode-choice', {hasText: 'Quiet'}).waitFor(); assert.equal(nativeCalls(), 10, 'restart restores choice without effects');
    for (const width of [1440, 390, 320]) for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({width, height: 1000}); await page.emulateMedia({colorScheme});
      const violations = (await new AxeBuilder({page}).include('[data-widget="hub-mode"]').include('[data-widget="inbox"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(violations.map(item => item.id), []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.argv[2] !== undefined) {await mkdir(process.argv[2], {recursive: true}); await page.screenshot({path: join(process.argv[2], `mode-inbox-${width}-${colorScheme}.png`), fullPage: true});}
    }
    // A real transport failure without an operation cannot claim an Inbox item.
    await page.route('**/api/v2/commands/mode-set', route => route.abort('failed'), {times: 1});
    await work.click(); await panel.getByRole('button', {name: /Result unknown/}).waitFor(); assert.equal(await warning.count(), 0);
    const beforeReadOnly = requests();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.reload(); await feed(page, 'connected'); await panel.getByText('Read only', {exact: true}).waitFor();
    for (const name of ['Work', 'Free', 'Quiet']) assert.equal(await panel.getByRole('button', {name, exact: true}).isDisabled(), true);
    assert.equal(requests(), beforeReadOnly); assert.deepEqual(errors, []);
    process.stdout.write(JSON.stringify({passed: true, checks: ['matching artwork', 'same-mode explicit request', 'correlated issue link/focus', 'unrelated dismissal', 'handled removal', 'accepted is not resolution', 'later success with retained Inbox', 'late conflict', 'lost reply', 'no replay', 'read-only', 'desktop/phone light/dark axe'], requests: requests(), nativeCalls: nativeCalls()})+'\n');
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
