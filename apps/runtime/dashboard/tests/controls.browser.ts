// Focused #922 control/navigation acceptance against a synthetic process, never an installed service or real device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({devices: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = [];
    context.on('weberror', error => { errors.push(error.error().name); });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const sent = changes(page);
    const receipts = process.env.DASHBOARD_RECEIPTS;
    const screenshot = async (name: string): Promise<void> => {
      if (receipts === undefined) return;
      await mkdir(receipts, {recursive: true});
      await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true});
    };
    await page.goto(`${world.url}/#/component/pendant-1`);
    await feed(page, 'connected');
    const card = page.locator('[data-device="pendant-1"]');
    const off = card.getByRole('button', {name: 'Turn off', exact: true});
    await off.waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-device="pendant-1"] button')?.disabled === false);
    assert.equal(sent.length, 0, 'bookmark sign-in and reads send no command');
    const axe = async (): Promise<void> => {
      const result = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`), []);
    };
    await axe();
    await off.focus(); assert.equal(await off.evaluate(element => element === document.activeElement), true);
    world.holdDeviceWrites(true);
    await page.keyboard.press('Enter');
    await card.locator('p[role="status"]').filter({hasText: 'Accepted. Waiting for completion.'}).waitFor();
    assert.equal(await card.getByRole('button', {name: /^Turn /}).isDisabled(), true);
    assert.equal(sent.length, 1);
    await screenshot('accepted');
    world.holdDeviceWrites(false);
    await card.locator('p[role="status"]').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.match(await card.locator('p[role="status"]').innerText(), /physical effect was not observed/);
    // The next explicit control applies, but every bounded protocol attempt loses its acknowledgement.
    world.loseDeviceReply();
    await card.getByRole('button', {name: 'Turn on', exact: true}).click();
    await card.locator('p[role="status"]').filter({hasText: 'Uncertain result.'}).waitFor();
    assert.equal(sent.length, 2);
    await page.reload(); await feed(page, 'connected');
    await card.locator('p[role="status"]').filter({hasText: 'Uncertain result.'}).waitFor();
    assert.equal(await card.getByRole('button', {name: /^Turn /}).isDisabled(), true);
    await card.getByRole('button', {name: 'Refresh current state'}).click();
    assert.equal(sent.length, 2, 'reload and explicit refresh never replay the uncertain action');
    assert.equal(await card.getByRole('button', {name: /^Turn /}).isDisabled(), true);
    await screenshot('uncertain-after-reload');
    const moduleLink = page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: 'Sign preview'});
    await moduleLink.focus(); await page.keyboard.press('Enter');
    await page.frameLocator('iframe.module-page').getByRole('heading', {name: 'hello'}).waitFor();
    assert.equal(await page.getByRole('heading', {name: 'Sign preview', exact: true}).count(), 1);
    assert.equal(sent.length, 2, 'opening a declared page sends no command');
    await screenshot('module-page');
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await page.getByRole('heading', {name: 'Running build'}).waitFor();
    await page.getByText('0.1.0', {exact: true}).waitFor();
    await axe();
    await page.setViewportSize({width: 390, height: 844}); await axe();
    await page.getByRole('link', {name: 'Home', exact: false}).first().click(); await axe();
    await screenshot('phone-home');
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await card.getByText('Your session is read-only.').waitFor();
    assert.equal(await card.getByRole('button').count(), 0, 'read-only callers see no write controls');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({journey: 'controls-navigation', actions: sent.length, acceptedThenCompleted: true, uncertainLockedAfterReload: true, modulePage: true, keyboard: true, axe: 'desktop and phone passed'}));
  } finally { await context.close(); }
} finally { await browser?.close(); await world.close(); }
