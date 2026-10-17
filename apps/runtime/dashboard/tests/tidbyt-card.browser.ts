// Real Tidbyt owner and synthetic cloud only; never installed services or physical devices.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({tidbyt: true});
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  try {
    const errors: string[] = []; context.on('weberror', event => { errors.push(event.error().message); });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const sent = changes(page);
    await page.goto(world.url); await feed(page, 'connected');
    const card = page.getByRole('article', {name: 'Tidbyt display', exact: true});
    const catalog = await page.evaluate(async () => await (await fetch('/api/v2/modules')).json() as {modules: {name: string; state: string; serves?: string[]}[]});
    const owner = catalog.modules.find(module => module.name === 'tidbyt');
    assert.ok(owner);
    assert.equal(owner.state, 'running', 'the actual Tidbyt owner must be running before testing its card');
    assert.equal(owner.serves?.includes('device'), true);
    // This assertion is the feature's negative control on the unmodified Home composition.
    await card.getByRole('tab', {name: 'Status', exact: true}).waitFor().catch(async error => { console.error(await page.locator('main').innerText()); console.error(JSON.stringify(await page.evaluate(async () => { const value: unknown = await (await fetch('/api/v2/modules')).json(); return value; }))); throw error; });
    const surfaces = ['#/home', '#/component/tidbyt', '#/module/tidbyt/display'];
    for (const route of surfaces) {
      await page.goto(`${world.url}/${route}`);
      // Home/device reuse preserves the selected tab; choose the face being inspected.
      await card.getByRole('tab', {name: 'Status', exact: true}).click();
      await card.getByText('Current cloud evidence', {exact: true}).waitFor();
      const artwork = await card.locator('[data-tidbyt-artwork]').elementHandle(); assert.notEqual(artwork, null);
      await card.getByRole('img', {name: 'Illustrative Tidbyt display, 64 by 32 pixels', exact: true}).waitFor();
      await card.getByRole('tab', {name: 'Status', exact: true}).focus();
      for (const key of ['ArrowRight', 'Home', 'End', 'ArrowLeft']) await page.keyboard.press(key);
      assert.equal(await card.getByRole('tab', {name: 'Status', exact: true}).getAttribute('aria-selected'), 'true');
      for (let index = 0; index < 4; index++) {
        await card.getByRole('tab', {name: 'Content', exact: true}).click();
        await card.getByRole('tab', {name: 'Status', exact: true}).click();
      }
      assert.equal(await artwork.evaluate(node => node === document.querySelector('[data-tidbyt-artwork]')), true);
      assert.equal(await card.getByRole('tab').count(), 2);
      assert.equal(await card.getByRole('slider').count(), 0);
      await card.getByText('Cloud availability', {exact: true}).waitFor();
      await card.getByText('Physical display unobserved.', {exact: true}).waitFor();
      await card.getByRole('tab', {name: 'Content', exact: true}).click();
      await card.getByText('Now playing · optional', {exact: true}).waitFor();
      assert.equal(world.browserSessions(), 1);
      const violations = (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(violations.map(value => value.id), []);
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.setViewportSize({width: 390, height: 844});
    await card.getByRole('tab', {name: 'Status', exact: true}).click();
    assert.equal(await card.getByRole('tabpanel').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const evidence = process.env.DASHBOARD_RECEIPTS;
    if (evidence !== undefined) { await mkdir(evidence, {recursive: true}); await page.screenshot({path: `${evidence}/tidbyt-phone.png`, fullPage: true}); }
    let release = (): void => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/sdk/v1/sync', async route => { await held; await route.continue(); });
    try {
      const replacement = page.waitForRequest(request => new URL(request.url()).pathname === '/api/sdk/v1/sync');
      world.dropDashboardStreams(); await replacement; await feed(page, 'connected');
      await card.getByText('Saved cloud evidence · stale', {exact: true}).waitFor();
      assert.equal(await card.getByText('Current cloud evidence', {exact: true}).count(), 0);
    } finally { release(); await page.unrouteAll({behavior: 'wait'}); }
    await card.getByText('Current cloud evidence', {exact: true}).waitFor();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await card.getByText('Current cloud evidence', {exact: true}).waitFor();
    await card.getByRole('tab', {name: 'Content', exact: true}).click();
    assert.equal(await card.getByRole('button', {name: /power|brightness|push|remove|play|screen/i}).count(), 0);
    assert.deepEqual(sent, [], 'inspection, reconnect and read-only navigation issue no command');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, journey: 'tidbyt-reusable-card', surfaces: surfaces.length, stationaryArtwork: true, heldOwnerSync: true, readOnly: true, phone: true, axe: true, commandRequests: sent.length}));
  } finally { await context.close(); }
} finally { try { await browser.close(); } finally { await world.close(); } }
