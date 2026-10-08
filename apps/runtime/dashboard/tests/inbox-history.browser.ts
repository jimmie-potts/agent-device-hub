// Focused #923 journey: one synthetic runtime, no installed service or physical device.
import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
const world = await startWorld({devices: true, inbox: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const sent = changes(page);
    const axe = async (): Promise<void> => {
      const result = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(result.violations.map(item => item.id), []);
    };
    await page.goto(`${world.url}/#/`); await feed(page, 'connected');
    const panel = page.locator('[data-inbox-panel]');
    await world.failCommand();
    await panel.getByRole('heading', {name: /g1 · failed/}).waitFor();
    await axe();
    const resend = panel.getByRole('button', {name: 'Send again'});
    await resend.focus(); await page.keyboard.press('Enter');
    await panel.getByText('No commands need handling.').waitFor();
    assert.equal(sent.length, 1, 'one explicit resend handling command');
    assert.ok(world.logs.some(record => record.event_name === 'command.completed' && record.attributes['bunny.outcome'] === 'succeeded'));
    await page.getByRole('link', {name: /pendant/i}).first().click();
    const card = page.locator('[data-device="pendant-1"]');
    const off = card.getByRole('button', {name: 'Turn off', exact: true});
    await off.waitFor(); await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-device="pendant-1"] button')?.disabled === false);
    world.loseDeviceReply(); await off.click();
    await card.locator('p[role="status"]').filter({hasText: 'Uncertain result.'}).waitFor();
    await page.getByRole('link', {name: /Home/}).first().click();
    await panel.getByRole('heading', {name: /pendant-1 · uncertain/}).waitFor();
    await axe(); const beforeReload = sent.length;
    await page.reload(); await feed(page, 'connected');
    await panel.getByRole('button', {name: 'Dismiss'}).waitFor();
    assert.equal(sent.length, beforeReload, 'reload never resends');
    assert.equal((await world.inboxViaMcp()).length, 1);
    const dismiss = panel.getByRole('button', {name: 'Dismiss'});
    await dismiss.focus(); await page.keyboard.press('Enter');
    await panel.getByText('No commands need handling.').waitFor();
    assert.equal((await world.inboxViaMcp()).length, 0, 'dashboard dismissal clears the MCP inbox');
    await page.getByRole('link', {name: 'Timeline', exact: true}).click();
    await page.getByRole('heading', {name: 'Timeline', exact: true}).waitFor();
    await page.getByRole('status').filter({hasText: 'history entries.'}).waitFor();
    await page.getByLabel('Kind', {exact: true}).selectOption('operation');
    await page.getByLabel('Source', {exact: true}).fill('bunny/parts/dashboard');
    await page.getByRole('button', {name: 'Apply filters'}).click();
    await page.getByRole('status').filter({hasText: 'history entries.'}).waitFor();
    assert.ok(await page.locator('ol li').count() >= 2);
    for (const text of await page.locator('ol li h2').allTextContents()) assert.match(text, /^operation/);
    assert.equal(sent.length, beforeReload + 1, 'timeline filters send no command');
    await axe(); await page.setViewportSize({width: 390, height: 844}); await axe();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('link', {name: /Home/}).first().click(); await axe();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await panel.getByText('Your session is read-only.').waitFor();
    assert.equal(await panel.getByRole('button').count(), 0);
    console.log(JSON.stringify({journey: 'inbox-history', explicitResend: true, dismissVisibleThroughMcp: true, noReplay: true, timelineFilters: true, keyboard: true, readOnly: true, axe: 'desktop and phone passed'}));
  } finally { await context.close(); }
} finally { await browser?.close(); await world.close(); }
