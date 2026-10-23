// Real retained history and Home persistence; all data/devices belong to this disposable test world.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, expect} from 'playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {changes, feed, startWorld} from './harness.ts';
import type {HistoryRow} from '../src/timeline-model.ts';

const world = await startWorld({inbox: true}), browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();page.setDefaultTimeout(12_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  const historyRequests: URL[] = [];page.on('request', request => {if (new URL(request.url()).pathname === '/api/v2/history') historyRequests.push(new URL(request.url()));});
  const sent = changes(page), card = page.locator('[data-timeline-card]');
  await world.failCommand();
  await page.goto(`${world.url}/#/timeline`);await feed(page, 'connected');
  await expect(card.getByRole('status')).toContainText('history entries.');
  await expect(card.locator('.timeline-title').filter({hasText: /failed/}).first()).toBeVisible();
  await card.locator('.timeline-advanced>summary').click();
  await card.getByLabel('Kind', {exact: true}).selectOption('operation');
  await card.getByLabel('Source', {exact: true}).fill('bunny/parts/operator');
  await card.getByRole('button', {name: 'Apply filters'}).click();
  await expect(card.getByRole('status')).toContainText('history entries.');
  assert.ok(await card.locator('[data-history-row]').count() > 0);
  for (const kind of await card.locator('[data-history-row]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.historyKind))) assert.equal(kind, 'operation');
  assert.equal(sent.length, 0, 'real history browsing sends no command');
  await card.getByLabel('From', {exact: true}).fill('2020-01-01T00:00');
  await card.getByLabel('To', {exact: true}).fill('2020-01-02T00:00');
  await card.getByRole('button', {name: 'Apply filters'}).click();await expect(card.getByText('No matches in these entries', {exact: true})).toBeVisible();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('today');
  await expect(card.getByLabel('From', {exact: true})).toHaveValue('');await expect(card.getByLabel('To', {exact: true})).toHaveValue('');
  await card.getByLabel('Source', {exact: true}).fill('bunny/INVALID');
  const refused = page.waitForResponse(response => response.url().includes('/api/v2/history'));
  await card.getByRole('button', {name: 'Apply filters'}).click();
  const refusedQuery = new URL((await refused).url()).searchParams;
  assert.equal(refusedQuery.get('fromAtMs'), null);assert.equal(refusedQuery.get('toAtMs'), null, 'cleared custom dates do not return on Apply');
  await expect(card.getByRole('status')).toContainText('Check filters (invalid-request)');await expect(card).toHaveAttribute('data-history-error', 'invalid-request');
  await card.getByLabel('Source', {exact: true}).fill('bunny/parts/operator');
  await card.getByRole('button', {name: 'Apply filters'}).click();await expect(card.getByRole('status')).toContainText('history entries.');

  // Add the identical card through the existing editor and persist size/order.
  await page.getByRole('link', {name: /^Home/}).first().click();
  assert.equal(await card.count(), 0, 'Timeline is opt-in');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await page.getByRole('button', {name: 'Add card', exact: true}).click();
  await page.getByRole('button', {name: 'Add Timeline', exact: true}).click();
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Move Timeline earlier', exact: true}).click();
  await page.getByRole('combobox', {name: 'Size of Timeline', exact: true}).selectOption('large');
  const order = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card')));
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  assert.equal(sent.length, 1);assert.equal(sent[0]?.endsWith('/home-layout-set'), true);
  await page.reload();await feed(page, 'connected');await expect(card).toBeVisible();
  assert.deepEqual(await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card'))), order);
  await expect(page.locator('[data-home-card="timeline"]')).toHaveClass(/home-size-large/);
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await page.getByRole('button', {name: 'Hide Timeline', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  await expect(card).toHaveCount(0);await page.reload();await feed(page, 'connected');await expect(card).toHaveCount(0);
  const saves = sent.length;

  // Synthetic reply shapes cover presentation, empty/fault paths and long evidence.
  const now = Date.now(), rows: HistoryRow[] = Array.from({length: 35}, (_, index) => ({seq: index + 1, atMs: now - index * 1000,
    kind: index < 3 ? 'change' : 'operation', source: index === 0 ? 'bunny/core' : 'bunny/modules/lifx', subject: index === 0 ? 'synthetic-session' : 'desk-lamp',
    type: index === 0 ? 'org.bunny.session.updated' : index === 1 ? 'org.bunny.mode.updated' : 'org.bunny.power.set.requested', requestId: null,
    record: index === 0 ? {family: 'session', changed: {label: 'Synthetic session'}} : index === 1 ? {family: 'mode', changed: {mode: 'work'}} : index === 2 ? {family: 'device', changed: {label: 'Synthetic lamp'}} : {status: index === 3 ? 'sent' : 'completed', result: index === 3 ? undefined : 'succeeded', evidence: index === 4 ? 'transmitted' : 'observed', diagnostic: 'x'.repeat(600)},
  }));
  let reads = 0, fault = false, malformed = false;
  await page.route('**/api/v2/history*', async route => {
    reads++;const query = new URL(route.request().url()).searchParams;
    const selected = rows.filter(row => (query.get('fromAtMs') === null || row.atMs >= Number(query.get('fromAtMs'))) && (query.get('toAtMs') === null || row.atMs <= Number(query.get('toAtMs'))));
    await route.fulfill({status: fault ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fault ? {error: {code: 'unavailable'}} : malformed ? {rows: [{}]} : {rows: selected})});
  });
  await page.goto(`${world.url}/#/timeline`);await expect(card.getByRole('status')).toContainText('35 history entries.');
  await expect(card.locator('.timeline-read-at')).toContainText('Latest 35');
  await expect(card.getByRole('group', {name: 'Activity filters'})).toHaveAccessibleDescription(/Categories filter only the latest 35 loaded entries/);
  assert.equal(await card.locator('[data-history-row]').count(), 20);
  const beforeMore = reads;
  await card.getByRole('button', {name: 'Show more', exact: true}).click();assert.equal(await card.locator('[data-history-row]').count(), 35);
  assert.equal(reads, beforeMore, 'Show more reveals only the loaded window');
  const readCount = reads;
  for (const [category, expected] of [['Agents', 1], ['Automation', 1], ['Devices', 33]] as const) {
    await card.getByRole('button', {name: category, exact: true}).click();
    assert.equal(await card.locator('[data-history-row]').count(), Math.min(20, expected));
  }
  assert.equal(reads, readCount, 'category filters are local');
  await card.getByRole('button', {name: 'All', exact: true}).click();
  const requested = card.locator('[data-history-row="4"]>details>summary');
  await requested.focus();await page.keyboard.press('Enter');
  await expect(card.locator('[data-history-row="4"]')).toContainText('Completion is not established');
  await card.locator('[data-history-row="4"] .timeline-technical>summary').click();
  await expect(card.locator('[data-history-row="4"] pre')).toContainText('diagnostic');
  await page.keyboard.press('Escape');await expect(requested).toBeFocused();
  await requested.click();await card.locator('[data-history-row="4"]').getByRole('button', {name: 'Close evidence'}).click();await expect(requested).toBeFocused();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('yesterday');
  await expect(card.getByText('No matches in these entries', {exact: true})).toBeVisible();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('recent');
  await expect(card.getByRole('status')).toContainText('35 history entries.');
  fault = true;await card.getByRole('button', {name: 'Refresh history'}).click();
  await expect(card.getByRole('status')).toHaveText('History unavailable · previous results');assert.equal(await card.locator('[data-history-row]').count(), 20);
  fault = false;malformed = true;await card.getByRole('button', {name: 'Refresh history'}).click();await expect(card.getByRole('status')).toHaveText('History unavailable · previous results');
  malformed = false;await card.getByRole('button', {name: 'Refresh history'}).click();await expect(card.getByRole('status')).toContainText('35 history entries.');
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload();await feed(page, 'connected');await expect(card.getByRole('status')).toContainText('35 history entries.');
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'});await page.setViewportSize({width, height: 1000});
    await card.locator('[data-history-row="4"]>details>summary').click();
    await card.locator('[data-history-row="4"] .timeline-technical>summary').click();
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.DASHBOARD_RECEIPTS !== undefined) {await mkdir(process.env.DASHBOARD_RECEIPTS, {recursive: true});await page.evaluate(() => {window.scrollTo(0, 0);});await page.screenshot({path: `${process.env.DASHBOARD_RECEIPTS}/timeline-${theme}-${width}.png`});}
    await card.locator('[data-history-row="4"]').getByRole('button', {name: 'Close evidence'}).click();
  }
  assert.ok(historyRequests.length >= 10, 'entry, exact/date, quick periods, refresh, Home and reload reads were exercised');
  for (const query of historyRequests) assert.deepEqual(query.searchParams.getAll('limit'), ['200'], query.search);
  assert.equal(sent.length, saves, 'filters, evidence, refresh, reload and read-only browsing send no command');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'timeline-card', realHistory: true, homePlacement: true, filters: true, evidence: true, failedReads: true, readOnly: true, passive: true, axe: 'light/dark desktop/390/320 passed'}));
  await context.close();
} finally {await browser.close();await world.close();}
