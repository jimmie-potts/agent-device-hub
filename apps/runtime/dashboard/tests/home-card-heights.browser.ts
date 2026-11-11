// Two standard Home card heights, their packing and the shared pager (#1658) on a disposable synthetic runtime:
// no installed service or device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {approvalPrompt, IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const world = await startWorld({inbox: true, lighting: true, pixooPages: true, wispr: {exposeToDashboard: true}});
const browser = await chromium.launch({headless: true});
type Box = {id: string; size: string; top: number; bottom: number; left: number; width: number; height: number; inner: number; tall: boolean; free: boolean; wide: boolean; minimum: string; kind: string; track: number; rows: number};
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
      size: [...node.classList].find(name => name.startsWith('home-size-')) ?? '', tall: node.classList.contains('home-tall'), free: node.classList.contains('home-free'), wide: node.classList.contains('home-size-large'), width: slot.width,
      minimum: getComputedStyle(node.querySelector('.home-card-content') ?? node).minHeight, kind: data.homeHeight ?? '', track: Number(data.homeTrack), rows: Number(data.homeRows)};
  }));
}
/** A private PNG of the Home grid, cropped to stay under 8,000 pixels tall at twice the scale. */
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  const top = Math.max(0, box.y - 8);
  await page.screenshot({path: join(receipts, `round3-${name}.png`), fullPage: true, clip: {x: 0, y: top, width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
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
      standard(cards, `${label} ${size}`);
      const hub = cards.find(card => card.id === 'hub-mode'), wispr = cards.find(card => card.id === 'wispr'), list = cards.find(card => card.id === 'inbox');
      assert.ok(hub !== undefined && wispr !== undefined && list !== undefined);
      if (size !== 'large') {
        assert.ok(hub.left === wispr.left && Math.abs(wispr.top - hub.bottom - gap) <= 1 && Math.abs(wispr.bottom - list.bottom) <= 1, `${label} ${size}: Hub mode and Wispr stack beside the Inbox`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  };
  /**
   * Cards sharing a row keep their standard heights and line up; a card alone in its row that is not Wide by choice
   * takes its content height (F1, D3); Wide cards and stacks keep the standard height.
   */
  function standard(cards: readonly Box[], label: string): void {
      for (const card of cards) {
        const alone = !cards.some(other => other !== card && other.track < card.track + card.rows && card.track < other.track + other.rows) && !card.wide;
        if (alone || card.tall) {
          assert.ok(card.free && card.minimum === '0px', `${label}: ${card.id} alone in its row takes its content height`);
          continue;
        }
        assert.ok(!card.free, `${label}: ${card.id} shares its row and keeps a standard height`);
        const expected = card.rows === 2 ? height : short;
        assert.ok(Math.abs(card.height - expected) <= 1, `${label}: ${card.id} (${card.kind}, ${String(card.rows)} tracks) is ${String(expected)}px, not ${String(card.height)}`);
        assert.ok(Math.abs(card.inner - card.height) <= 1, `${label}: ${card.id}'s visible card fills its slot`);
        assert.ok(card.kind === 'short' || card.rows === 2, `${label}: long ${card.id} spans two tracks`);
        for (const other of cards) {
          if (other.track === card.track) assert.ok(Math.abs(other.top - card.top) <= 1, `${label}: ${card.id} and ${other.id} start their track together`);
          if (other.track + other.rows === card.track + card.rows) assert.ok(Math.abs(other.bottom - card.bottom) <= 1, `${label}: ${card.id} and ${other.id} end their track together`);
        }
      }
      // Same-size cards sharing a track are equally wide (F6).
      for (const card of cards) for (const other of cards) {
        if (other.track === card.track && other.kind === card.kind && !card.wide && !other.wide && Math.abs(other.width - card.width) > 1 && card.size === other.size) assert.fail(`${label}: ${card.id} (${String(card.width)}) and ${other.id} (${String(other.width)}) differ`);
      }
  }
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
  // F3: sessions that need the owner come first, so the last one in record order is on page 1; when they fill more than
  // a page, the page label says so.
  const sessionsList = page.locator('[data-home-card="sessions"] [data-paged-list="Agent sessions"]');
  await world.observe(approvalPrompt('heights-wait-5'), {identity: {...IDENTITY, sessionId: 'heights-5'}});
  await expect(page.locator('.agent-summary')).toContainText('1Needs you');
  await expect(sessionsList).toHaveAttribute('data-page', '1');
  await expect(sessionsList.locator('.agent-status-card[data-attention=true]')).toBeVisible();
  await expect(visibleRows(sessionsList).first().locator('.agent-status-card')).toHaveAttribute('data-attention', 'true');
  for (const index of [3, 4]) await world.observe(approvalPrompt(`heights-wait-${String(index)}`), {identity: {...IDENTITY, sessionId: `heights-${String(index)}`}});
  await expect(sessionsList.locator('.paged-list-position')).toContainText('3 need you, on the first 2 pages');
  await expect(visibleRows(sessionsList).locator('.agent-status-card[data-attention=true]')).toHaveCount(2);

  // F2: a row removed after focus has left the list leaves focus and scroll where they are.
  const edit = page.getByRole('button', {name: 'Edit Home', exact: true});
  await visibleRows(inboxList).first().locator('summary').first().focus();
  await edit.focus();
  const scrolled = await page.evaluate(() => scrollY), gone = await visibleRows(inboxList).first().getAttribute('data-paged-key');
  const count = Number(await inbox.locator('.inbox-count').innerText());
  assert.equal(await page.evaluate(async id => {
    const data = await (await fetch('/api/v2/snapshot?families=inbox-item&owner=bunny/core')).json() as {records: {'inbox-item': {id: string; revision: number}[]}};
    const item = data.records['inbox-item'].find(value => value.id === id);if (item === undefined) return 0;
    return (await fetch('/api/v2/commands/inbox-handle', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: id, requestId: crypto.randomUUID(), data: {action: 'dismiss', expectedRevision: item.revision}})})).status;
  }, gone), 200);
  await expect(inbox.locator('.inbox-count')).toHaveText(String(count - 1));
  await settle(page);
  await expect(edit).toBeFocused();
  assert.equal(await page.evaluate(() => scrollY), scrolled, 'removing a row elsewhere does not scroll the page');

  // Large Agent status pages whole rows of tiles.
  await save(layoutAt('large'));
  const sessions = page.locator('[data-paged-list="Agent sessions"]');
  const columns = await page.locator('[data-home-card="sessions"] .agent-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  await expect(visibleRows(sessions)).toHaveCount(Math.min(6, columns * 2));
  assert.ok(columns > 1, 'a Wide card lays tiles out in several columns');

  // A Pixoo and a light beside short cards: the long cards take two tracks and the short cards stack between them.
  const pixoo = initial.find(id => id.startsWith('device:bunny/modules/pixoo:'));assert.ok(pixoo !== undefined);
  const lamp = lights[0];assert.ok(lamp !== undefined);
  await save([{widget: pixoo, size: 'medium', hidden: false}, {widget: 'hub-mode', size: 'medium', hidden: false}, {widget: 'wispr', size: 'small', hidden: false}, {widget: lamp, size: 'medium', hidden: false}, {widget: 'inbox', size: 'medium', hidden: false}, {widget: 'sessions', size: 'medium', hidden: false}]);
  await expect(page.locator('.pixoo-card')).toBeVisible();
  const mixed = await boxes(page);
  standard(mixed, 'mixed');
  assert.equal(new Set(mixed.slice(0, 4).map(card => Math.round(card.top))).size, 2, 'mixed: Pixoo, two short cards and a light share one row of two tracks');
  await shot(page, 'c-wide-pixoo-light-beside-short');

  // Back to 13 items for the remaining checks.
  const remaining = Number(await inbox.locator('.inbox-count').innerText());
  for (let index = remaining; index < 13; index += 1) await world.failCommand();
  await expect(inbox.locator('.inbox-count')).toHaveText('13');
  // F1: between the phone rule and the wide layout, a card alone in its row takes its content height; cards that share
  // a row keep their standard heights.
  for (const width of [700, 820, 900, 1100]) {
    await page.setViewportSize({width, height: 1000});
    await expect.poll(() => page.locator('.home-layout-grid').evaluate(node => node.clientWidth)).toBeLessThan(width);
    await save(layoutAt('medium'));
    const cards = await boxes(page);
    standard(cards, `width ${String(width)}`);
    if (width <= 900) assert.ok(cards.some(card => card.free && card.kind === 'long' && card.height < height - 1), `width ${String(width)}: a long card alone in its row is not held to the long height`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await expect(inboxList.locator('.paged-list-pager')).toBeVisible();
    if (width === 820) await shot(page, 'e-820-content-height');
  }
  await page.setViewportSize({width: 1440, height: 1000});

  // F11: a card moving between a standard height and its content height, by window width or by a layout saved
  // elsewhere, always shows the rows it actually has open, and the pager whenever none takes the page.
  await save(layoutAt('medium'));
  const inboxCard = page.locator('[data-home-card="inbox"]'), timelineCard = page.locator('[data-home-card="timeline"]');
  const held = async (card: Locator, value: boolean): Promise<void> => {
    if (value) await expect(card).not.toHaveClass(/home-free/);else await expect(card).toHaveClass(/home-free/);
  };
  const fullPage = async (list: Locator, label: string): Promise<void> => {
    await expect(list.locator('.paged-list-pager')).toBeVisible();
    assert.ok(await visibleRows(list).count() > 1, `${label}: the page is shown`);
    assert.equal(await list.locator('[data-paged-key] details[open]').count(), 0, `${label}: no row is open`);
  };
  const openRow = async (list: Locator, index: number): Promise<Locator> => {
    const row = visibleRows(list).nth(index), key = await row.getAttribute('data-paged-key');
    await row.locator('summary').first().click();
    return list.locator(`[data-paged-key="${key ?? ''}"]`);
  };
  const takesPage = async (list: Locator, row: Locator, label: string): Promise<void> => {
    await expect(visibleRows(list)).toHaveCount(1);await expect(row).toBeVisible();
    await expect(list.locator('.paged-list-pager')).toHaveCount(0);
    assert.equal(await row.locator('details').first().getAttribute('open'), '', `${label}: the row that takes the page is open`);
  };
  // Case 1: open while held, narrow so the card takes its content height, close, widen.
  await held(inboxCard, true);
  let item = await openRow(inboxList, 0);await takesPage(inboxList, item, 'case 1 held');
  await page.setViewportSize({width: 700, height: 1000});await held(inboxCard, false);
  await expect(inboxList.locator('.paged-list-pager')).toBeVisible();assert.ok(await visibleRows(inboxList).count() > 1, 'case 1: the open item stays in place among the page');
  await item.locator('summary').first().click();
  await page.setViewportSize({width: 1440, height: 1000});await held(inboxCard, true);await fullPage(inboxList, 'case 1 widened');
  // Case 2: open while the card takes its content height, widen with it still open, then close.
  await page.setViewportSize({width: 700, height: 1000});await held(inboxCard, false);
  item = await openRow(inboxList, 1);await expect(inboxList.locator('.paged-list-pager')).toBeVisible();
  await page.setViewportSize({width: 1440, height: 1000});await held(inboxCard, true);await takesPage(inboxList, item, 'case 2 widened');
  await item.locator('summary').first().click();await fullPage(inboxList, 'case 2 closed');
  // The same transition from a layout saved elsewhere: the Inbox alone in the last row, then sharing a row again.
  const lone: HomePlacement[] = [{widget: 'hub-mode', size: 'medium', hidden: false}, {widget: 'sessions', size: 'medium', hidden: false}, {widget: 'timeline', size: 'medium', hidden: false}, {widget: 'inbox', size: 'medium', hidden: false}];
  item = await openRow(inboxList, 0);await takesPage(inboxList, item, 'saved layout held');
  await save(lone);await held(inboxCard, false);
  await expect(inboxList.locator('.paged-list-pager')).toBeVisible();assert.ok(await visibleRows(inboxList).count() > 1, 'saved layout: the open item stays in place');
  await item.locator('summary').first().click();await fullPage(inboxList, 'saved layout closed');
  item = await openRow(inboxList, 2);
  await save(layoutAt('medium'));await held(inboxCard, true);await takesPage(inboxList, item, 'saved layout shared again');
  await item.locator('summary').first().click();await fullPage(inboxList, 'saved layout shared and closed');
  // Case 4: two Timeline entries open in place in a content-height card, then the card becomes held.
  const timelineList = timelineCard.locator('[data-paged-list="Timeline"]');
  await page.setViewportSize({width: 820, height: 1000});await held(timelineCard, false);
  await openRow(timelineList, 0);const second = await openRow(timelineList, 2);
  assert.equal(await timelineList.locator('[data-paged-key] details[open]').count() >= 2, true, 'case 4: two entries open in place');
  await expect(timelineList.locator('.paged-list-pager')).toBeVisible();
  await page.setViewportSize({width: 1440, height: 1000});await held(timelineCard, true);await takesPage(timelineList, second, 'case 4 held');
  await second.locator('summary').first().click();await fullPage(timelineList, 'case 4 closed');

  // D3: stacked on a narrow screen, lists still page and each card is as tall as its content.
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
