// Device settings remain one runtime configuration; explicit display controls use tracked commands.
import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page);
    await page.goto(`${world.url}/#/module/pixoo/settings`); await feed(page, 'connected');
    await page.getByRole('heading', {name: 'Settings', exact: true, level: 2}).waitFor();
    await page.getByText('pixoo64-gif-2026-10-01', {exact: true}).waitFor();
    assert.equal(sent.length, 0); assert.equal(world.pixooState().sent, 0);
    assert.equal(await page.getByRole('button', {name: 'Save configuration', exact: true}).count(), 0);
    const brightness = page.getByRole('spinbutton', {name: 'Requested brightness', exact: true});
    const apply = page.getByRole('button', {name: 'Apply brightness', exact: true});
    await brightness.fill('101'); assert.equal(await apply.isDisabled(), true);
    await brightness.fill('37'); assert.equal(sent.length, 0);
    await apply.focus(); await apply.press('Enter');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(world.pixooState().brightness, 37); assert.equal(sent.length, 1);
    await page.getByRole('button', {name: 'Screen off', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(world.pixooState().screenOn, false);
    await page.getByRole('button', {name: 'Screen on', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(world.pixooState().screenOn, true); assert.equal(sent.length, 3);
    const written = world.pixooState().sent;
    await page.getByRole('button', {name: 'Refresh settings', exact: true}).click();
    await page.getByText('pixoo64-gif-2026-10-01', {exact: true}).waitFor();
    assert.equal(sent.length, 3); assert.equal(world.pixooState().sent, written);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    await page.reload(); await feed(page, 'connected'); assert.equal(sent.length, 3);
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await page.getByText('Read-only access.', {exact: true}).waitFor();
    assert.equal(await apply.count(), 0); assert.equal(await page.getByRole('button', {name: 'Screen off', exact: true}).count(), 0);
    assert.equal(sent.length, 3); assert.equal(world.pixooState().sent, written); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-settings', requests: 3, brightness: 37, readOnlyControls: true, configurationReadOnly: true, noReplay: true, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
