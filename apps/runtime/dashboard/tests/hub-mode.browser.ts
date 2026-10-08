// Focused mode selection, separate native outcomes and accessibility in an owned synthetic port-0 runtime.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({modeDevices: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const sent = changes(page), requests = (): number => sent.filter(path => path === '/api/v2/commands/mode-set').length;
    const nativeCalls = (): number => world.logs.filter(record => record.event_name === 'command.executing' && ['nanoleaf', 'pixoo'].includes(String(record.attributes['bunny.module']))).length;
    await page.goto(world.url); await feed(page, 'connected');
    const panel = page.locator('[data-widget="hub-mode"]');
    const work = panel.getByRole('button', {name: 'Work', exact: true});
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-widget="hub-mode"] button')?.disabled === false);
    await panel.getByText('Saved selection:', {exact: false}).filter({hasText: 'Free'}).waitFor();
    assert.equal(requests(), 0); assert.equal(nativeCalls(), 0, 'startup sends no native command');
    await work.focus(); assert.equal(await work.evaluate(button => button === document.activeElement), true);
    await work.press('Enter');
    await panel.getByText('Saved selection:', {exact: false}).filter({hasText: 'Work'}).waitFor();
    await panel.locator('[data-mode-device="wall"]', {hasText: 'completed · failed · evidence: none · code: unavailable'}).waitFor();
    await panel.locator('[data-mode-device="pixoo-1"]', {hasText: 'completed · succeeded · evidence: observed'}).waitFor();
    await panel.getByText('Selection completion: completed.', {exact: true}).waitFor();
    await page.locator('[data-inbox-panel] [data-inbox]').filter({hasText: 'wall · failed'}).first().waitFor();
    const violations = (await new AxeBuilder({page}).include('[data-widget="hub-mode"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(violations.map(item => item.id), []);
    assert.equal(requests(), 1); assert.equal(nativeCalls(), 2);
    if (process.argv[2] !== undefined) {await mkdir(process.argv[2], {recursive: true}); await page.screenshot({path: join(process.argv[2], 'mode-separate-results.png'), fullPage: true});}
    world.dropDashboardStreams(); await feed(page, 'connected'); await page.reload(); await feed(page, 'connected');
    await panel.locator('[data-mode-device="wall"]', {hasText: 'failed'}).waitFor();
    assert.equal(requests(), 1); assert.equal(nativeCalls(), 2, 'refresh and reconnect never replay');
    await work.click(); await panel.getByText('Selection completion: completed.', {exact: true}).waitFor();
    assert.equal(requests(), 2, 'an explicit same-mode application is allowed');
    await page.route('**/api/v2/commands/mode-set', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await panel.getByRole('button', {name: 'Quiet', exact: true}).click();
    await panel.getByText('The reply is uncertain. The request was not sent again.', {exact: true}).waitFor();
    await panel.getByText('Saved selection:', {exact: false}).filter({hasText: 'Quiet'}).waitFor();
    assert.equal(requests(), 3);
    await page.waitForFunction(() => document.querySelector('[data-mode-device="pixoo-1"]')?.textContent?.includes('succeeded'));
    await world.restart(); await page.reload(); await feed(page, 'connected');
    await panel.getByText('Saved selection:', {exact: false}).filter({hasText: 'Quiet'}).waitFor();
    assert.equal(requests(), 3); assert.equal(nativeCalls(), 6, 'restart restores the selection without another application');
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.reload(); await feed(page, 'connected');
    await panel.getByText('Read-only connection. Mode controls require control authority.', {exact: true}).waitFor();
    for (const name of ['Work', 'Free', 'Quiet']) assert.equal(await panel.getByRole('button', {name, exact: true}).isDisabled(), true);
    assert.equal(requests(), 3); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, checks: ['keyboard selection', 'saved choice and independent outcomes', 'failed participant in the real inbox', 'changed-panel axe', 'same-mode reapply', 'lost reply', 'reconnect/reload/restart no replay', 'read-only'], requests: requests(), nativeCalls: nativeCalls()})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
