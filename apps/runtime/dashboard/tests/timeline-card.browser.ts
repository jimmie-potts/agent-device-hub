// Real retained history and Home persistence; all data/devices belong to this disposable test world.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, expect} from 'playwright/test';
import {changes, feed, startWorld} from './harness.ts';
import {cardOptions} from './home-editor.ts';
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

  // Add the identical card through the existing editor and persist its shape and order.
  await page.getByRole('link', {name: /^Home/}).first().click();
  assert.equal(await card.count(), 0, 'Timeline is opt-in');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await page.getByRole('button', {name: 'Add card', exact: true}).click();
  await page.getByRole('button', {name: 'Add Timeline', exact: true}).click();
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await cardOptions(page, 'Timeline');await page.getByRole('button', {name: 'Move Timeline earlier', exact: true}).click();
  await page.getByRole('group', {name: 'Shape of Timeline', exact: true}).getByRole('button', {name: 'Large square', exact: true}).click();
  const order = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card')));
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  assert.equal(sent.length, 1);assert.equal(sent[0]?.endsWith('/home-layout-set'), true);
  await page.reload();await feed(page, 'connected');await expect(card).toBeVisible();
  assert.deepEqual(await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card'))), order);
  await expect(page.locator('[data-home-card="timeline"]')).toHaveAttribute('data-home-shape', 'large-square');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await cardOptions(page, 'Timeline');await page.getByRole('button', {name: 'Hide Timeline', exact: true}).click();
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
  const shown = () => card.locator('[data-history-row]:not([hidden])');
  assert.equal(await shown().count(), 20);await expect(card.getByText('Page 1 of 2', {exact: true})).toBeVisible();
  const beforeMore = reads;
  // The shared pager (#1658) replaces Show more; the dedicated page shows 20 entries a page.
  await card.getByRole('button', {name: 'Next', exact: true}).click();assert.equal(await shown().count(), 15);
  await expect(card.getByRole('button', {name: 'Previous', exact: true})).toBeFocused();
  await card.getByRole('button', {name: 'Previous', exact: true}).press('Enter');assert.equal(await shown().count(), 20);
  await expect(card.getByRole('button', {name: 'Next', exact: true})).toBeFocused();
  assert.equal(reads, beforeMore, 'paging reveals only the loaded window');
  // A new category or period starts again at the first page.
  await card.getByRole('button', {name: 'Next', exact: true}).click();await expect(card.getByText('Page 2 of 2', {exact: true})).toBeVisible();
  await card.getByRole('button', {name: 'Devices', exact: true}).click();await expect(card.getByText('Page 1 of 2', {exact: true})).toBeVisible();
  await card.getByRole('button', {name: 'All', exact: true}).click();
  await card.getByRole('button', {name: 'Next', exact: true}).click();await expect(card.getByText('Page 2 of 2', {exact: true})).toBeVisible();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('yesterday');
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('today');
  await expect(card.getByRole('status')).toContainText('35 history entries.');await expect(card.getByText('Page 1 of 2', {exact: true})).toBeVisible();
  const readCount = reads;
  for (const [category, expected] of [['Agents', 1], ['Automation', 1], ['Devices', 33]] as const) {
    await card.getByRole('button', {name: category, exact: true}).click();
    assert.equal(await shown().count(), Math.min(20, expected));
  }
  assert.equal(reads, readCount, 'category filters are local');
  await card.getByRole('button', {name: 'All', exact: true}).click();
  const requested = card.locator('[data-history-row="4"]>details>summary');
  await requested.focus();await page.keyboard.press('Enter');
  await expect(card.locator('[data-history-row="4"]')).toContainText('Completion is not established');
  // The dedicated page is off the Home grid, so an opened entry stays beside the others and the pager stays.
  assert.equal(await shown().count(), 20);await expect(card.getByText('Page 1 of 2', {exact: true})).toBeVisible();
  await card.locator('[data-history-row="4"] .timeline-technical>summary').click();
  await expect(card.locator('[data-history-row="4"] pre')).toContainText('diagnostic');
  await page.keyboard.press('Escape');await expect(requested).toBeFocused();
  await requested.click();await card.locator('[data-history-row="4"]').getByRole('button', {name: 'Close evidence'}).click();await expect(requested).toBeFocused();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('yesterday');
  await expect(card.getByText('No matches in these entries', {exact: true})).toBeVisible();
  await card.getByRole('combobox', {name: 'Activity period'}).selectOption('recent');
  await expect(card.getByRole('status')).toContainText('35 history entries.');
  fault = true;await card.getByRole('button', {name: 'Refresh history'}).click();
  await expect(card.getByRole('status')).toHaveText('History unavailable · previous results');assert.equal(await shown().count(), 20);
  fault = false;malformed = true;await card.getByRole('button', {name: 'Refresh history'}).click();await expect(card.getByRole('status')).toHaveText('History unavailable · previous results');
  malformed = false;await card.getByRole('button', {name: 'Refresh history'}).click();await expect(card.getByRole('status')).toContainText('35 history entries.');
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload();await feed(page, 'connected');await expect(card.getByRole('status')).toContainText('35 history entries.');
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'});await page.setViewportSize({width, height: 1000});
    await card.locator('[data-history-row="4"]>details>summary').click();
    await card.locator('[data-history-row="4"] .timeline-technical>summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.DASHBOARD_RECEIPTS !== undefined) {await mkdir(process.env.DASHBOARD_RECEIPTS, {recursive: true});await page.evaluate(() => {window.scrollTo(0, 0);});await page.screenshot({path: `${process.env.DASHBOARD_RECEIPTS}/timeline-${theme}-${width}.png`});}
    await card.locator('[data-history-row="4"]').getByRole('button', {name: 'Close evidence'}).click();
  }
  assert.ok(historyRequests.length >= 10, 'entry, exact/date, quick periods, refresh, Home and reload reads were exercised');
  for (const query of historyRequests) assert.deepEqual(query.searchParams.getAll('limit'), ['200'], query.search);
  assert.equal(sent.length, saves, 'filters, evidence, refresh, reload and read-only browsing send no command');
  assert.deepEqual(errors, []);
  await context.close();

  // Spans, a gap, a closing row and an open span (#1773), on a fixed page clock, in UTC, at twice the pixel density.
  const fixed = Date.UTC(2026, 10, 12, 15, 0), H = 3_600_000, M = 60_000;
  const spanContext = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2, timezoneId: 'UTC', locale: 'en-US', reducedMotion: 'reduce'});
  const spanPage = await spanContext.newPage();spanPage.setDefaultTimeout(12_000);await spanPage.clock.setFixedTime(fixed);
  const spanErrors: string[] = [];spanContext.on('weberror', error => {spanErrors.push(error.error().message);});
  const spanSent = changes(spanPage), spanCard = spanPage.locator('[data-timeline-card]');
  const device = (seq: number, id: string, atMs: number, record: Record<string, unknown>): HistoryRow => ({seq, atMs, kind: 'change', source: 'bunny/modules/wemo', subject: id,
    type: 'org.bunny.device.updated', requestId: null, record: {family: 'device', id, revision: seq, previous: seq - 1, changed: {}, removed: [], ...record}});
  const spanRows: HistoryRow[] = [
    device(1, 'synthetic-clock', fixed - 5 * H, {changed: {label: 'Synthetic clock'}}),
    device(2, 'synthetic-heater', fixed - 4 * H, {changed: {label: 'Synthetic heater'}, revision: 2, previous: 2, closedBy: 'removal',
      span: {sinceAtMs: fixed - 8 * H - 29 * M, lastConfirmedAtMs: fixed - 4 * H - M, confirmations: 3300}}),
    {seq: 3, atMs: fixed - 4 * H, kind: 'removal', source: 'bunny/modules/wemo', subject: 'synthetic-heater', type: 'org.bunny.device.removed', requestId: null, record: {data: {entity: {family: 'device', id: 'synthetic-heater'}, revision: 3}}},
    device(4, 'synthetic-fan', fixed - 2 * H, {changed: {label: 'Synthetic fan'}, gapMs: H + 12 * M, span: {sinceAtMs: fixed - 6 * H, lastConfirmedAtMs: fixed - 3 * H - 12 * M, confirmations: 40}}),
    device(6, 'synthetic-clock', fixed - 30 * M, {revision: 1, changed: {label: 'Synthetic clock'}}),
    device(5, 'synthetic-lamp', fixed - H, {changed: {label: 'Synthetic lamp', observed: {power: {status: 'known', value: false}}},
      span: {sinceAtMs: fixed - 5 * H - 29 * M, lastConfirmedAtMs: fixed - H - M, confirmations: 3300}}),
  ];
  const spanOpen = [
    {source: 'bunny/modules/wemo', family: 'device', id: 'synthetic-lamp', revision: 5, sinceAtMs: fixed - H, lastConfirmedAtMs: fixed - 5 * M, confirmations: 660},
    {source: 'bunny/modules/wemo', family: 'device', id: 'synthetic-fan', revision: 4, sinceAtMs: fixed - 2 * H, lastConfirmedAtMs: fixed - 2 * H - M, confirmations: 2},
    {source: 'bunny/modules/wemo', family: 'device', id: 'synthetic-clock', revision: 1, sinceAtMs: null, lastConfirmedAtMs: fixed - 20 * M, confirmations: 2},
  ];
  let spanFault = false;
  await spanPage.route('**/api/v2/history*', route => {
    const query = new URL(route.request().url()).searchParams;
    const rows = spanRows.filter(row => (query.get('fromAtMs') === null || row.atMs >= Number(query.get('fromAtMs'))) &&
      (query.get('toAtMs') === null || row.atMs <= Number(query.get('toAtMs'))));
    const open = spanOpen.filter(span => rows.some(row => row.kind === 'change' && row.source === span.source && row.record.family === span.family && row.record.id === span.id));
    return route.fulfill({status: spanFault ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(spanFault ? {error: {code: 'unavailable'}} : {schema: 'history/2.0', rows, open})});
  });
  await spanPage.goto(`${world.url}/#/timeline`);await feed(spanPage, 'connected');
  await expect(spanCard.getByRole('status')).toContainText('6 history entries.');
  const notes = (seq: number) => spanCard.locator(`[data-history-row="${seq}"] .timeline-note`).allTextContents();
  const title = (seq: number) => spanCard.locator(`[data-history-row="${seq}"] .timeline-title`).innerText();
  assert.deepEqual(await notes(5), ['After 4 h 28 min unchanged, 3,300 readings', 'Unchanged since Nov 12, 2:00 PM, last reading at Nov 12, 2:55 PM, 660 readings']);
  assert.equal(await title(5), 'Device updated');
  assert.deepEqual(await notes(4), ['After 2 h 48 min unchanged, 40 readings', 'No reading for 1 h 12 min, then the same state',
    'First reading at Nov 12, 1:00 PM, last reading at Nov 12, 12:59 PM, 2 readings. The recorded times run backward.']);
  assert.equal(await title(4), 'Readings resumed');
  assert.deepEqual(await notes(2), ['4 h 28 min unchanged, 3,300 readings']);assert.equal(await title(2), 'Last readings before removal');
  assert.equal(await title(3), 'Record removed');assert.deepEqual(await notes(3), []);
  assert.equal(await title(1), 'Device updated');assert.deepEqual(await notes(1), [], 'a row without a span reads as before');
  assert.deepEqual(await notes(6), [], 'same-revision legacy rows do not anchor an unknown start');
  const unknown = spanCard.getByRole('region', {name: 'Open spans with unknown starts'});
  await expect(unknown.getByRole('listitem')).toHaveCount(1);
  await expect(unknown).toContainText('Synthetic clock · wemo · device');
  await expect(unknown).toContainText('Unchanged from an unknown start, last reading at Nov 12, 2:40 PM, 2 readings');
  assert.equal(await spanCard.locator('.timeline-note').filter({hasText: /\bnow\b/i}).count(), 0);
  const gap = spanCard.locator('[data-history-row="4"]>details>summary');
  await gap.focus();await spanPage.keyboard.press('Enter');
  await expect(spanCard.locator('[data-history-row="4"]')).toContainText('The recorded times show readings stopped and resumed. This entry does not say why.');
  await spanPage.keyboard.press('Escape');await expect(gap).toBeFocused();
  for (const width of [1440, 390]) {
    await spanPage.setViewportSize({width, height: 1000});
    assert.equal(await spanPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.DASHBOARD_RECEIPTS !== undefined) {
      await mkdir(process.env.DASHBOARD_RECEIPTS, {recursive: true});
      for (const [seq, shape] of [[5, 'span-and-open'], [4, 'gap'], [2, 'closing'], [3, 'removal'], [1, 'plain']] as const) {
        await spanCard.locator(`[data-history-row="${seq}"]`).screenshot({path: `${process.env.DASHBOARD_RECEIPTS}/timeline-${shape}-${width}.png`});
      }
      await unknown.screenshot({path: `${process.env.DASHBOARD_RECEIPTS}/timeline-unknown-start-${width}.png`});
      await spanCard.screenshot({path: `${process.env.DASHBOARD_RECEIPTS}/timeline-spans-${width}.png`});
    }
  }
  await spanCard.getByRole('button', {name: 'Automation', exact: true}).click();
  await expect(unknown).toHaveCount(0);
  await spanCard.getByRole('button', {name: 'Devices', exact: true}).click();
  await expect(unknown).toBeVisible();
  await spanCard.locator('.timeline-advanced>summary').click();
  await spanCard.getByLabel('To', {exact: true}).fill('2026-11-12T10:00');
  await spanCard.getByRole('button', {name: 'Apply filters'}).click();
  await expect(spanCard.getByRole('status')).toHaveText('1 history entries.');
  await expect(unknown).toBeVisible();
  assert.deepEqual(await notes(1), [], 'a filtered page cannot lend its only legacy row the unknown-start span');
  spanFault = true;
  await spanCard.getByRole('button', {name: 'Refresh history'}).click();
  await expect(spanCard.getByRole('status')).toHaveText('History unavailable · previous results');
  await expect(unknown).toBeVisible();
  spanFault = false;
  await spanCard.getByLabel('To', {exact: true}).fill('2026-11-12T09:59');
  await spanCard.getByRole('button', {name: 'Apply filters'}).click();
  await expect(spanCard.getByText('No matches in these entries', {exact: true})).toBeVisible();
  await expect(unknown).toHaveCount(0);
  assert.equal(spanSent.length, 0, 'reading spans sends nothing');
  assert.deepEqual(spanErrors, []);
  await spanContext.close();
  console.log(JSON.stringify({journey: 'timeline-card', realHistory: true, homePlacement: true, filters: true, evidence: true, failedReads: true, readOnly: true, passive: true, spans: true}));
} finally {await browser.close();await world.close();}
