// One focused confirmed Connections journey against the built synthetic runtime; no installed services or devices.
import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {sessionStarted, turnStarted, turnEnded} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = [];
    context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const sent = changes(page), clears = (): number => sent.filter(path => path === '/api/v2/commands/notice-clear').length;
    await page.goto(world.url); await feed(page, 'connected');
    await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
    await world.observe(turnStarted); await world.observe(turnEnded);
    await page.locator('article.session .chip', {hasText: 'Finished'}).waitFor();
    assert.equal(await page.getByRole('button', {name: /acknowledge/i}).count(), 0, 'session rows stay passive');
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await page.getByLabel('Session', {exact: true}).selectOption({label: 'Port the wall'});
    const clear = page.getByRole('button', {name: 'Clear this notice on every device', exact: true});
    await clear.click();
    const confirm = page.getByRole('button', {name: 'Confirm clear', exact: true});
    assert.equal(await confirm.evaluate(button => button === document.activeElement), true);
    assert.equal(clears(), 0, 'opening confirmation sends nothing');
    await confirm.press('Escape');
    assert.equal(await clear.evaluate(button => button === document.activeElement), true);
    await clear.click();
    const axe = (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(axe.map(item => item.id), []);
    await confirm.press('Enter');
    await page.getByText('Accepted. The synced record supplies the result.', {exact: true}).waitFor();
    await page.getByText(/Every configured consumer acknowledged this notice in the synced session record: dashboard, nanoleaf, pixoo/).waitFor();
    assert.equal(clears(), 1);
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page.getByRole('link', {name: /^Home/}).click();
    await page.locator('article.session .chip', {hasText: 'Idle'}).waitFor();
    assert.equal(await page.getByRole('button', {name: /acknowledge/i}).count(), 0);
    world.dropDashboardStreams(); await feed(page, 'connected');
    await page.reload(); await feed(page, 'connected');
    assert.equal(clears(), 1, 'reconnect and reload do not replay the override');

    // A lost reply changes local uncertainty; the operation and session copies can independently confirm the save.
    await world.observe(turnStarted, {turn: 'turn-second'}); await world.observe(turnEnded, {turn: 'turn-second'});
    await page.locator('article.session .chip', {hasText: 'Finished'}).waitFor();
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await page.getByLabel('Session', {exact: true}).selectOption({label: 'Port the wall'});
    await page.route('**/api/v2/commands/notice-clear', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await clear.click(); await confirm.click();
    await page.getByText('The reply is uncertain. The action was not sent again.', {exact: true}).waitFor();
    await page.getByText(/Every configured consumer acknowledged this notice in the synced session record/).waitFor();
    assert.equal(clears(), 2);
    await page.reload(); await feed(page, 'connected'); assert.equal(clears(), 2);

    // UI authority refusal is a read-only presentation check; the real gateway refusal is covered independently.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.reload(); await feed(page, 'connected');
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await page.getByText('Read-only connection. Operator controls require control authority.', {exact: true}).waitFor();
    assert.equal(await clear.isDisabled(), true); assert.equal(clears(), 2);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, checks: ['confirmed notice override, synced acknowledgments, passive row, keyboard/axe, no replay and read-only refusal'], clearRequests: clears()})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
