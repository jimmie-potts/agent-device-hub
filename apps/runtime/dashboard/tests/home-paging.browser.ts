// Paged Home lists (#1658) on a disposable synthetic runtime: no installed service or device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {approvalPrompt, IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({inbox: true, modeDevices: true});
const browser = await chromium.launch({headless: true});
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});});
}
/** A private PNG of Home, cropped to stay under 8,000 pixels tall at twice the scale. */
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  await page.screenshot({path: join(receipts, `paging-${name}.png`), fullPage: true, clip: {x: 0, y: Math.max(0, box.y - 8), width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
}
const visibleRows = (list: Locator): Locator => list.locator('[data-paged-key]:not([hidden])');
const focusInside = async (page: Page, selector: string): Promise<string> => page.evaluate(value => {
  const active = document.activeElement;
  if (active === null || active === document.body) return 'body';
  return active.closest(value) === null ? `outside:${active.tagName}` : `inside:${active.tagName}`;
}, selector);

try {
  for (let index = 0; index < 6; index += 1) await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: `paging-${String(index)}`}, title: {value: `Synthetic agent ${String(index)}`, source: 'provider'}});
  // One column (#1672): off the unit grid the lists keep their fixed page sizes and open entries in place, which this
  // journey checks; home-shapes.browser.ts checks rows per shape and an opened entry taking the page on the grid.
  const context = await browser.newContext({viewport: {width: 560, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: receipts === undefined ? 1 : 2});
  const page = await context.newPage();page.setDefaultTimeout(15_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  const inbox = page.locator('[data-inbox-panel]'), inboxList = inbox.locator('[data-paged-list="Inbox"]'), inboxCard = page.locator('[data-home-card="inbox"]');
  await expect(inbox.getByText('No commands need handling.', {exact: true})).toBeVisible();
  await shot(page, 'wide-default-inbox-empty');
  const initial = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));

  // AC2/AC3: five items fill one page with no pager; thirteen show the first five, the total and "Page 1 of 3", and the
  // card grows only by its pager.
  for (let index = 0; index < 5; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('5');
  await expect(visibleRows(inboxList)).toHaveCount(5);await expect(inboxList.locator('.paged-list-pager')).toHaveCount(0);
  await settle(page);const five = (await inboxCard.boundingBox())?.height ?? 0;
  for (let index = 5; index < 13; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  await expect(visibleRows(inboxList)).toHaveCount(5);
  await expect(inbox.getByText('Page 1 of 3', {exact: true})).toBeVisible();
  await expect(inbox.getByRole('button', {name: 'Previous', exact: true})).toBeDisabled();
  await settle(page);
  const thirteen = (await inboxCard.boundingBox())?.height ?? 0, pager = await inboxList.locator('.paged-list-pager').evaluate(node => node.getBoundingClientRect().height + Number.parseFloat(getComputedStyle(node).marginTop));
  assert.ok(thirteen <= five + pager + 1, `13 items are no taller than one page plus the pager (${String(thirteen)} vs ${String(five)} + ${String(pager)})`);
  await shot(page, 'wide-default-inbox-13-page-1');

  // Keyboard paging: Next and Previous by Enter; focus stays on a pager control, and the total stays in the heading.
  const first = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  await inbox.getByRole('button', {name: 'Next', exact: true}).focus();await page.keyboard.press('Enter');
  await expect(inbox.getByText('Page 2 of 3', {exact: true})).toBeVisible();
  const second = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  assert.equal(second.filter(key => first.includes(key)).length, 0, 'page 2 shows other items');
  await expect(inbox.getByRole('button', {name: 'Next', exact: true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(inbox.getByText('Page 3 of 3', {exact: true})).toBeVisible();
  await expect(inbox.getByRole('button', {name: 'Previous', exact: true})).toBeFocused();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  await shot(page, 'wide-default-inbox-13-last-page');
  await inbox.getByRole('button', {name: 'Previous', exact: true}).focus();await page.keyboard.press('Enter');await expect(inbox.getByText('Page 2 of 3', {exact: true})).toBeVisible();

  // An item on a later page opens in place, beside the others, and its controls are reachable by keyboard.
  const row = visibleRows(inboxList).last(), summary = row.locator('summary').first();
  await summary.focus();await page.keyboard.press('Enter');
  await expect(row.locator('details').first()).toHaveAttribute('open', '');
  await expect(visibleRows(inboxList)).toHaveCount(5);await expect(inboxList.locator('.paged-list-pager')).toBeVisible();
  await page.keyboard.press('Tab');await expect(row.getByRole('button', {name: 'Send again', exact: true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(row.getByRole('button', {name: 'Dismiss', exact: true})).toBeFocused();
  await summary.focus();await page.keyboard.press('Enter');

  // Dismissing the only item on the last page shows the page before it, with focus on a control in the Inbox.
  let movedBack = false;
  while (await inboxList.getAttribute('data-pages') !== '2' || !movedBack) {
    const pages = Number(await inboxList.getAttribute('data-pages')), before = Number(await inbox.locator('.inbox-count').innerText());
    while (await inboxList.getAttribute('data-page') !== String(pages)) await inbox.getByRole('button', {name: 'Next', exact: true}).click();
    const only = await visibleRows(inboxList).count() === 1, target = visibleRows(inboxList).last();
    await target.locator('summary').first().click();
    const dismiss = target.getByRole('button', {name: 'Dismiss', exact: true});
    await dismiss.focus();await page.keyboard.press('Enter');
    await expect(inbox.locator('.inbox-count')).toHaveText(String(before - 1));
    await expect.poll(() => focusInside(page, '[data-inbox-panel]')).toMatch(/^inside:/);
    if (only) {await expect(inboxList).toHaveAttribute('data-page', String(pages - 1));movedBack = true;}
  }

  // A row removed elsewhere after focus left the list leaves focus and scroll where they are.
  const edit = page.getByRole('button', {name: 'Edit Home', exact: true});
  await visibleRows(inboxList).first().locator('summary').first().focus();await edit.focus();
  const scrolled = await page.evaluate(() => scrollY), gone = await visibleRows(inboxList).first().getAttribute('data-paged-key');
  const count = Number(await inbox.locator('.inbox-count').innerText());
  assert.equal(await page.evaluate(async id => {
    const data = await (await fetch('/api/v2/snapshot?families=inbox-item&owner=bunny/core')).json() as {records: {'inbox-item': {id: string; revision: number}[]}};
    const item = data.records['inbox-item'].find(value => value.id === id);if (item === undefined) return 0;
    return (await fetch('/api/v2/commands/inbox-handle', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: id, requestId: crypto.randomUUID(), data: {action: 'dismiss', expectedRevision: item.revision}})})).status;
  }, gone), 200);
  await expect(inbox.locator('.inbox-count')).toHaveText(String(count - 1));
  await settle(page);await expect(edit).toBeFocused();
  assert.equal(await page.evaluate(() => scrollY), scrolled, 'a row removed elsewhere does not scroll the page');

  // Hub mode's Check Inbox shows the page holding its item, then opens and focuses it.
  const panel = page.locator('[data-widget="hub-mode"]'), warning = panel.getByRole('button', {name: 'Check Inbox', exact: true});
  const work = panel.getByRole('button', {name: 'Work', exact: true});
  await work.focus();await work.press('Enter');await warning.waitFor();
  const wall = inbox.locator('[data-inbox]').filter({hasText: 'wall'}).first();
  await wall.waitFor({state: 'attached'});
  const wallKey = await wall.getAttribute('data-paged-key'), order = await inboxList.locator('[data-paged-key]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  const wallPage = Math.floor(order.indexOf(wallKey ?? '') / 5) + 1;
  assert.ok(wallPage >= 1);
  const away = wallPage === 1 ? 2 : 1;
  while (await inboxList.getAttribute('data-page') !== String(away)) await inbox.getByRole('button', {name: away > wallPage ? 'Next' : 'Previous', exact: true}).click();
  await expect(wall).toBeHidden();
  await warning.click();
  await expect(inboxList).toHaveAttribute('data-page', String(wallPage));
  await expect(wall).toBeVisible();await expect(wall.locator('details.inbox-entry')).toHaveAttribute('open', '');
  await expect(wall.locator('summary').first()).toBeFocused();
  await wall.locator('summary').first().click();

  // Agent sessions: a session that needs the owner, last in record order, is on page 1; several say so on the pager.
  const sessions = page.locator('[data-paged-list="Agent sessions"]');
  await world.observe(approvalPrompt('paging-wait-5'), {identity: {...IDENTITY, sessionId: 'paging-5'}});
  await expect(sessions).toHaveAttribute('data-page', '1');
  await expect(visibleRows(sessions).first().locator('.agent-status-card')).toHaveAttribute('data-attention', 'true');
  const tiles = await visibleRows(sessions).count();
  for (let index = 0; index < tiles; index += 1) if (index !== 5) await world.observe(approvalPrompt(`paging-wait-${String(index)}`), {identity: {...IDENTITY, sessionId: `paging-${String(index)}`}});
  await expect(sessions.locator('.paged-list-position')).toContainText('need you, on the first 2 pages');
  await expect(visibleRows(sessions).locator('.agent-status-card[data-attention=true]')).toHaveCount(tiles);

  // Timeline on Home: a new category returns to the first page. AC5: the saved record keeps its widgets, order and sizes.
  const placements: HomePlacement[] = [...initial.map(widget => ({widget, size: widget === 'inbox' ? 'small' as const : 'medium' as const, hidden: false})), {widget: 'timeline', size: 'medium', hidden: false}];
  const record = await page.evaluate(async layouts => {
    const read = async (): Promise<HomeLayoutRecord> => {
      const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}};
      const value = data.records['home-layout'][0];if (value === undefined) throw new Error('home-record');return value;
    };
    const before = await read();
    const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: before.revision, layouts: {desktop: layouts, phone: layouts}}})});
    if (saved.status !== 200) throw new Error(`save ${String(saved.status)}`);
    return read();
  }, placements);
  assert.deepEqual(record.layouts?.desktop, placements, 'the saved layout is unchanged');
  await expect.poll(() => page.locator('.home-layout-grid>[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard))).toEqual(placements.map(entry => entry.widget));
  const timeline = page.locator('[data-home-card="timeline"]'), timelineList = timeline.locator('[data-paged-list="Timeline"]');
  await timeline.getByRole('button', {name: 'Refresh history', exact: true}).click();
  await expect.poll(() => timelineList.getAttribute('data-pages')).not.toBe('1');
  await expect(visibleRows(timelineList)).toHaveCount(5);
  await timelineList.getByRole('button', {name: 'Next', exact: true}).click();await expect(timelineList).toHaveAttribute('data-page', '2');
  await timeline.getByRole('combobox', {name: 'Activity period'}).selectOption('recent');
  await expect(timelineList).toHaveAttribute('data-page', '1');await expect.poll(() => timelineList.getAttribute('data-pages')).not.toBe('1');

  // 375px: one column, lists still page, nothing overflows.
  await page.setViewportSize({width: 375, height: 812});
  await expect(inboxList.locator('.paged-list-pager')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await shot(page, 'narrow-375-inbox');
  const sent = changes(page);
  const at = await inboxList.getAttribute('data-page');
  await inbox.getByRole('button', {name: at === '1' ? 'Next' : 'Previous', exact: true}).click();
  await expect(inboxList).not.toHaveAttribute('data-page', at ?? '');
  assert.deepEqual(sent, [], 'paging sends no command');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'home-paging', inboxPage: 5, inboxCounts: [0, 5, 13], keyboard: true, dismissMovesBack: true, checkInbox: true, attentionFirst: true, timelineReset: true, narrow: true, physical: false}));
  await context.close();
} finally {await browser.close();await world.close();}
