// Two standard Home card heights, their packing and the shared pager (#1658) on a disposable synthetic runtime:
// no installed service or device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({inbox: true, lighting: true, pixooPages: true, wispr: {exposeToDashboard: true}});
const browser = await chromium.launch({headless: true});
type Box = {id: string; top: number; bottom: number; left: number; height: number; inner: number; tall: boolean; kind: string; track: number; rows: number};
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
    const data = (node as HTMLElement).dataset;
    return {id: data.homeCard ?? '', top: slot.top, bottom: slot.bottom, left: Math.round(slot.left), height: slot.height, inner: card?.getBoundingClientRect().height ?? 0,
      tall: node.classList.contains('home-tall'), kind: data.homeHeight ?? '', track: Number(data.homeTrack), rows: Number(data.homeRows)};
  }));
}
/** A private PNG of the Home grid, cropped to stay under 8,000 pixels tall at twice the scale. */
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  const top = Math.max(0, box.y - 8);
  await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true, clip: {x: 0, y: top, width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
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
  await expect(page.locator('.wispr-card')).toBeVisible();
  await shot(page, 'b-wide-default-inbox-empty');
  const [short, gap] = await page.locator('.home-layout-grid').evaluate(node => [Number.parseFloat(getComputedStyle(node).getPropertyValue('--home-short-height')), Number.parseFloat(getComputedStyle(node).rowGap)]);
  const height = 2 * short + gap;
  assert.ok(short > 0 && gap > 0, 'one short height token and the grid gap on the Home grid');
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
    {widget: 'wispr', size: size === 'large' ? 'medium' : size, hidden: false},
    {widget: 'sessions', size: size === 'small' ? 'medium' : size, hidden: false},
    {widget: 'timeline', size: size === 'small' ? 'medium' : size, hidden: false},
    ...lights.map(widget => ({widget, size: size === 'small' ? 'medium' as const : size, hidden: false})),
    {widget: 'music-visualizer', size: size === 'small' ? 'medium' : size, hidden: false},
  ];
  // AC2: long is two short heights plus the gap, cards in a track line up, and two short cards stack beside a long one,
  // at each size with an Inbox of 0, 1 and 13 items.
  const lineUp = async (label: string): Promise<void> => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const placements = layoutAt(size), record = await save(placements);
      // AC5: the saved record keeps its widgets, order and sizes, and Home renders them.
      assert.deepEqual(record.layouts?.desktop, placements, 'the saved layout is unchanged');
      for (const entry of placements) await expect(page.locator(`[data-home-card="${entry.widget}"]`)).toHaveClass(new RegExp(`home-size-${entry.size}`));
      const cards = await boxes(page);
      for (const card of cards) {
        const expected = card.rows === 2 ? height : short;
        assert.ok(Math.abs(card.height - expected) <= 1, `${label} ${size}: ${card.id} (${card.kind}, ${String(card.rows)} tracks) is ${String(expected)}px, not ${String(card.height)}`);
        assert.ok(Math.abs(card.inner - card.height) <= 1, `${label} ${size}: ${card.id}'s visible card fills its slot`);
        assert.ok(card.kind === 'short' || card.rows === 2, `${label} ${size}: long ${card.id} spans two tracks`);
        for (const other of cards) {
          if (other.track === card.track) assert.ok(Math.abs(other.top - card.top) <= 1, `${label} ${size}: ${card.id} and ${other.id} start their track together`);
          if (other.track + other.rows === card.track + card.rows) assert.ok(Math.abs(other.bottom - card.bottom) <= 1, `${label} ${size}: ${card.id} and ${other.id} end their track together`);
        }
      }
      const hub = cards.find(card => card.id === 'hub-mode'), wispr = cards.find(card => card.id === 'wispr'), list = cards.find(card => card.id === 'inbox');
      assert.ok(hub !== undefined && wispr !== undefined && list !== undefined);
      if (size !== 'large') {
        assert.ok(hub.left === wispr.left && Math.abs(wispr.top - hub.bottom - gap) <= 1 && Math.abs(wispr.bottom - list.bottom) <= 1, `${label} ${size}: Hub mode and Wispr stack beside the Inbox`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  };
  await lineUp('empty Inbox');
  await expect(inbox.getByText('No commands need handling.', {exact: true})).toBeVisible();
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
  await shot(page, 'a-wide-long-beside-two-short-inbox-13');
  const firstPage = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  const next = inbox.getByRole('button', {name: 'Next', exact: true});
  await next.focus();await page.keyboard.press('Enter');
  await expect(inbox.getByText(`Page 2 of ${String(Math.ceil(13 / pageSize))}`, {exact: true})).toBeVisible();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  const secondPage = await visibleRows(inboxList).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.pagedKey));
  assert.equal(secondPage.filter(key => firstPage.includes(key)).length, 0, 'the next page shows other items');
  assert.equal(await focusInside(page, '[data-inbox-panel]'), 'inside:BUTTON', 'focus stays on a pager control');
  const card = page.locator('[data-home-card="inbox"]');
  // An expanded item takes the page so Send again and Dismiss stay inside the long height.
  const expand = async (): Promise<Locator> => {
    const row = visibleRows(inboxList).last();
    await row.locator('summary').first().click();
    await expect(visibleRows(inboxList)).toHaveCount(1);
    await expect(inbox.locator('.paged-list-pager')).toHaveCount(0);
    const [outer, dismiss] = await Promise.all([card.boundingBox(), row.getByRole('button', {name: 'Dismiss', exact: true}).boundingBox()]);
    assert.ok(outer !== null && dismiss !== null && dismiss.y + dismiss.height <= outer.y + outer.height, 'the expanded item\'s controls fit inside the card');
    assert.ok(Math.abs((outer?.height ?? 0) - height) <= 1, 'expanding an item keeps the long height');
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

  // A Pixoo and a light beside short cards: the long cards take two tracks and the short cards stack between them.
  const pixoo = initial.find(id => id.startsWith('device:bunny/modules/pixoo:'));assert.ok(pixoo !== undefined);
  const lamp = lights[0];assert.ok(lamp !== undefined);
  await save([{widget: pixoo, size: 'medium', hidden: false}, {widget: 'hub-mode', size: 'medium', hidden: false}, {widget: 'wispr', size: 'small', hidden: false}, {widget: lamp, size: 'medium', hidden: false}, {widget: 'inbox', size: 'medium', hidden: false}]);
  await expect(page.locator('.pixoo-card')).toBeVisible();
  const mixed = await boxes(page);
  for (const card of mixed) assert.ok(Math.abs(card.height - (card.rows === 2 ? height : short)) <= 1, `mixed: ${card.id} keeps its standard height (${String(card.height)})`);
  assert.equal(new Set(mixed.slice(0, 4).map(card => Math.round(card.top))).size, 2, 'mixed: Pixoo, two short cards and a light share one row of two tracks');
  await shot(page, 'c-wide-pixoo-light-beside-short');

  // D3: stacked on a narrow screen, lists still page and each card is as tall as its content.
  // Back to 13 items for the narrow check.
  const remaining = Number(await inbox.locator('.inbox-count').innerText());
  for (let index = remaining; index < 13; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  await page.setViewportSize({width: 375, height: 812});
  await save(layoutAt('medium'), layoutAt('medium'));
  await expect(inbox.locator('.paged-list-pager')).toBeVisible();
  const narrow = await boxes(page);
  assert.ok(narrow.some(box => box.height < short - 1), 'stacked cards are not held to a standard height');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot(page, 'd-narrow-375-inbox-13');
  const sent = changes(page);
  await inbox.getByRole('button', {name: 'Next', exact: true}).click();await expect(inboxList).toHaveAttribute('data-page', '2');
  assert.deepEqual(sent, [], 'paging sends no command');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'home-card-heights', short, long: height, gap, inboxPage: pageSize, inboxCounts: [0, 1, 13], sizes: ['small', 'medium', 'large'], dismissMovesBack: true, narrowContentHeight: true, physical: false}));
  await context.close();
} finally {await browser.close();await world.close();}
