// Standard Home card heights and the shared pager (#1658) on a disposable synthetic runtime: no installed service or device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({inbox: true, lighting: true});
const browser = await chromium.launch({headless: true});
type Box = {id: string; top: number; height: number; inner: number; tall: boolean};
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});});
}
/** Each card's slot and the bordered card inside it; the row is the slot's top edge. */
async function boxes(page: Page): Promise<Box[]> {
  await settle(page);
  return page.locator('.home-layout-grid>[data-home-card]').evaluateAll(nodes => nodes.map(node => {
    const slot = node.getBoundingClientRect();
    let card: Element | null = node.querySelector('.home-card-content');
    while (card !== null && Number.parseFloat(getComputedStyle(card).borderTopWidth) === 0) card = card.firstElementChild;
    return {id: (node as HTMLElement).dataset.homeCard ?? '', top: Math.round(slot.top), height: slot.height, inner: card?.getBoundingClientRect().height ?? 0, tall: node.classList.contains('home-tall')};
  }));
}
function rows(cards: readonly Box[]): Box[][] {
  const result: Box[][] = [];
  for (const card of cards) {const row = result.at(-1);if (row === undefined || Math.abs((row[0]?.top ?? 0) - card.top) > 1) result.push([card]);else row.push(card);}
  return result;
}
const visibleRows = (list: Locator): Locator => list.locator('[data-paged-key]:not([hidden])');
const focusInside = async (page: Page, selector: string): Promise<string> => page.evaluate(value => {
  const active = document.activeElement;
  if (active === null || active === document.body) return 'body';
  return active.closest(value) === null ? `outside:${active.tagName}` : `inside:${active.tagName}`;
}, selector);

try {
  for (let index = 0; index < 6; index += 1) await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: `heights-${String(index)}`}, title: {value: `Synthetic agent ${String(index)}`, source: 'provider'}});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: receipts === undefined ? 1 : 2});
  const page = await context.newPage();page.setDefaultTimeout(15_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  const height = await page.locator('.home-layout-grid').evaluate(node => Number.parseFloat(getComputedStyle(node).getPropertyValue('--home-card-height')));
  assert.ok(height > 0, 'one height token on the Home grid');
  const initial = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const lights = initial.filter(id => id.startsWith('light:')).slice(0, 2);
  assert.equal(lights.length, 2);
  const save = async (desktop: HomePlacement[], phone: HomePlacement[] = desktop): Promise<HomeLayoutRecord> => {
    const record = await page.evaluate(async ({desktop, phone}) => {
      const read = async (): Promise<HomeLayoutRecord> => {
        const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}};
        const value = data.records['home-layout'][0];if (value === undefined) throw new Error('home-record');return value;
      };
      const before = await read();
      const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
        body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: before.revision, layouts: {desktop, phone}}})});
      if (saved.status !== 200) throw new Error(`save ${String(saved.status)}`);
      return read();
    }, {desktop, phone});
    await expect.poll(() => page.locator('.home-layout-grid>[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard))).toEqual(((page.viewportSize()?.width ?? 1440) <= 600 ? phone : desktop).filter(entry => !entry.hidden).map(entry => entry.widget));
    return record;
  };
  const inbox = page.locator('[data-inbox-panel]'), inboxList = inbox.locator('[data-paged-list="Inbox"]');
  const layoutAt = (size: HomePlacement['size']): HomePlacement[] => [
    {widget: 'inbox', size: size === 'large' ? 'medium' : size, hidden: false},
    {widget: 'hub-mode', size: size === 'small' ? 'medium' : size, hidden: false},
    {widget: 'sessions', size: size === 'small' ? 'medium' : size, hidden: false},
    {widget: 'timeline', size: size === 'small' ? 'medium' : size, hidden: false},
    ...lights.map(widget => ({widget, size: size === 'small' ? 'medium' as const : size, hidden: false})),
    {widget: 'music-visualizer', size: size === 'small' ? 'medium' : size, hidden: false},
  ];
  // AC2: every row lines up at each size, with an Inbox of 0, 1 and 13 items.
  const lineUp = async (label: string): Promise<void> => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const placements = layoutAt(size), record = await save(placements);
      // AC5: the saved record keeps its widgets, order and sizes, and Home renders them.
      assert.deepEqual(record.layouts?.desktop, placements, 'the saved layout is unchanged');
      for (const entry of placements) await expect(page.locator(`[data-home-card="${entry.widget}"]`)).toHaveClass(new RegExp(`home-size-${entry.size}`));
      const cards = await boxes(page);
      for (const row of rows(cards)) {
        const tallest = Math.max(...row.map(card => card.height));
        for (const card of row) {
          assert.ok(Math.abs(card.height - tallest) <= 1, `${label} ${size}: ${card.id} lines up with its row (${String(card.height)} vs ${String(tallest)})`);
          assert.ok(Math.abs(card.inner - card.height) <= 1, `${label} ${size}: ${card.id}'s visible card fills its slot`);
        }
        if (row.every(card => !card.tall)) assert.ok(row.every(card => Math.abs(card.height - height) <= 1), `${label} ${size}: a row of standard cards is exactly the standard height (${row.map(card => `${card.id}=${String(card.height)}`).join(', ')})`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  };
  await lineUp('empty Inbox');
  await expect(inbox.getByText('No commands need handling.', {exact: true})).toBeVisible();
  if (receipts !== undefined) {await mkdir(receipts, {recursive: true});await save(layoutAt('medium'));await settle(page);await page.screenshot({path: join(receipts, 'home-wide-inbox-empty.png'), fullPage: true});}
  await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('1');
  await lineUp('one item');
  assert.equal(await inbox.locator('.paged-list-pager').count(), 0, 'one page shows no pager');
  for (let index = 1; index < 13; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  await lineUp('13 items');

  // AC3: the first page, the total count on every page and working previous and next controls.
  await save(layoutAt('medium'));
  const pageSize = await visibleRows(inboxList).count();
  assert.ok(pageSize > 1 && pageSize < 13, `a page holds part of the Inbox (${String(pageSize)})`);
  await expect(inbox.getByText(`Page 1 of ${String(Math.ceil(13 / pageSize))}`, {exact: true})).toBeVisible();
  await expect(inbox.getByRole('button', {name: 'Previous', exact: true})).toBeDisabled();
  if (receipts !== undefined) await page.screenshot({path: join(receipts, 'home-wide-inbox-13-page-1.png'), fullPage: true});
  const firstPage = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  const next = inbox.getByRole('button', {name: 'Next', exact: true});
  await next.focus();await page.keyboard.press('Enter');
  await expect(inbox.getByText(`Page 2 of ${String(Math.ceil(13 / pageSize))}`, {exact: true})).toBeVisible();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  const secondPage = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  assert.equal(secondPage.filter(key => firstPage.includes(key)).length, 0, 'the next page shows other items');
  assert.equal(await focusInside(page, '[data-inbox-panel]'), 'inside:BUTTON', 'focus stays on a pager control');
  if (receipts !== undefined) await page.screenshot({path: join(receipts, 'home-wide-inbox-13-page-2.png'), fullPage: true});
  const card = page.locator('[data-home-card="inbox"]');
  // An expanded item takes the page so Send again and Dismiss stay inside the standard height.
  const expand = async (): Promise<Locator> => {
    const row = visibleRows(inboxList).last();
    await row.locator('summary').first().click();
    await expect(visibleRows(inboxList)).toHaveCount(1);
    await expect(inbox.locator('.paged-list-pager')).toHaveCount(0);
    const [outer, dismiss] = await Promise.all([card.boundingBox(), row.getByRole('button', {name: 'Dismiss', exact: true}).boundingBox()]);
    assert.ok(outer !== null && dismiss !== null && dismiss.y + dismiss.height <= outer.y + outer.height, 'the expanded item\'s controls fit inside the card');
    assert.ok(Math.abs((outer?.height ?? 0) - height) <= 1, 'expanding an item keeps the standard height');
    return row;
  };
  const opened = await expand();
  await opened.locator('summary').first().click();
  await expect(visibleRows(inboxList)).toHaveCount(13 - pageSize >= pageSize ? pageSize : 13 - pageSize);
  // AC3: dismissing the last item on the last page moves to the previous page; focus never lands on the body.
  let movedBack = false;
  while (await inboxList.getAttribute('data-pages') !== '1') {
    const pages = Number(await inboxList.getAttribute('data-pages')), before = Number(await inbox.locator('.inbox-count').innerText());
    while (await inboxList.getAttribute('data-page') !== String(pages)) await inbox.getByRole('button', {name: 'Next', exact: true}).click();
    const lastOnPage = await visibleRows(inboxList).count() === 1;
    const row = await expand();
    const dismiss = row.getByRole('button', {name: 'Dismiss', exact: true});
    await dismiss.focus();await page.keyboard.press('Enter');
    await expect(inbox.locator('.inbox-count')).toHaveText(String(before - 1));
    await expect.poll(() => focusInside(page, '[data-inbox-panel]')).toMatch(/^inside:/);
    if (lastOnPage) {await expect(inboxList).toHaveAttribute('data-page', String(pages - 1));movedBack = true;}
  }
  assert.ok(movedBack, 'the journey dismissed the only item on a page');
  assert.equal(await visibleRows(inboxList).count(), Number(await inbox.locator('.inbox-count').innerText()));

  // AC4: Agent status and Timeline page through the same component.
  for (const [widget, label] of [['sessions', 'Agent sessions'], ['timeline', 'Timeline']] as const) {
    const list = page.locator(`[data-home-card="${widget}"] [data-paged-list="${label}"]`);
    await expect(list).toHaveCount(1);
    if (widget === 'timeline') await page.getByRole('button', {name: 'Refresh history', exact: true}).click();
    await expect.poll(() => list.getAttribute('data-pages')).not.toBe('1');
    const shown = await visibleRows(list).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
    await list.getByRole('button', {name: 'Next', exact: true}).click();
    await expect(list).toHaveAttribute('data-page', '2');
    const after = await visibleRows(list).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
    assert.equal(after.filter(key => shown.includes(key)).length, 0, `${label} shows other rows on page 2`);
    assert.equal(await focusInside(page, `[data-home-card="${widget}"]`), 'inside:BUTTON');
    await list.getByRole('button', {name: 'Previous', exact: true}).click();
    await expect(list).toHaveAttribute('data-page', '1');
  }
  // Large Agent status pages whole rows of tiles.
  await save(layoutAt('large'));
  const sessions = page.locator('[data-paged-list="Agent sessions"]');
  const columns = await page.locator('[data-home-card="sessions"] .agent-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  await expect(visibleRows(sessions)).toHaveCount(Math.min(6, columns * 2));
  assert.ok(columns > 1, 'a Wide card lays tiles out in several columns');

  // D3: stacked on a narrow screen, lists still page and each card is as tall as its content.
  // Back to 13 items for the narrow check.
  const remaining = Number(await inbox.locator('.inbox-count').innerText());
  for (let index = remaining; index < 13; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  await page.setViewportSize({width: 375, height: 812});
  await save(layoutAt('medium'), layoutAt('medium'));
  await expect(inbox.locator('.paged-list-pager')).toBeVisible();
  const narrow = await boxes(page);
  assert.ok(narrow.some(box => box.height < height - 1), 'stacked cards are not held to the standard height');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (receipts !== undefined) await page.screenshot({path: join(receipts, 'home-narrow-inbox-13.png'), fullPage: true});
  const sent = changes(page);
  await inbox.getByRole('button', {name: 'Next', exact: true}).click();await expect(inboxList).toHaveAttribute('data-page', '2');
  assert.deepEqual(sent, [], 'paging sends no command');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'home-card-heights', height, inboxPage: pageSize, inboxCounts: [0, 1, 13], sizes: ['small', 'medium', 'large'], dismissMovesBack: true, narrowContentHeight: true, physical: false}));
  await context.close();
} finally {await browser.close();await world.close();}
