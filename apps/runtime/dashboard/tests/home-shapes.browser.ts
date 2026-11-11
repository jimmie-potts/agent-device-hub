// Home card shapes on the unit grid (#1672), on a disposable synthetic runtime: no installed service or device.
// AC1 tiling, AC2 the shape picker, AC3 an old-format layout, AC4 every card in every offered shape, AC5 paged lists
// by shape and keyboard order. With DASHBOARD_RECEIPTS set it also writes private screenshots.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement, HomeShape} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {approvalPrompt, IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS;
const only = process.env.HOME_SHAPES_ONLY?.split(',');
const part = (name: string): boolean => only === undefined || only.includes(name);
const world = await startWorld({lighting: true, pixooPages: true, tidbyt: true, wemo: true, roborock: true, volcano: true, companions: true, art: true, inbox: true,
  wispr: {exposeToDashboard: true}});
const browser = await chromium.launch({headless: true});
const shapes: readonly HomeShape[] = ['square', 'wide', 'tall', 'large-square'];
const storedSize = {square: 'small', tall: 'small', wide: 'medium', 'large-square': 'medium'} as const;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});});
}
/** A private PNG of Home, cropped to stay under 8,000 pixels tall at twice the scale. */
async function shot(page: Page, name: string): Promise<void> {
  if (receipts === undefined) return;
  await mkdir(receipts, {recursive: true});
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true, clip: {x: 0, y: Math.max(0, box.y - 8), width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
}
async function save(page: Page, desktop: HomePlacement[], phone: HomePlacement[] = desktop): Promise<void> {
  assert.equal(await page.evaluate(async ({desktop, phone}) => {
    const response = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
    const data = await response.json() as {records: {'home-layout': HomeLayoutRecord[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');
    const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop, phone}}})});
    return saved.status;
  }, {desktop, phone}), 200);
  // Inbox and Agent sessions stay on Home while they hold items or attention, saved or not.
  const wanted = desktop.filter(entry => !entry.hidden && !['inbox', 'sessions'].includes(entry.widget)).map(entry => `${entry.widget}=${entry.shape ?? '?'}`);
  await expect.poll(() => page.locator('.home-layout-grid > [data-home-card]:not([data-art-placement=automatic])').evaluateAll((nodes, wanted) => nodes.flatMap(node => {
    const id = (node as HTMLElement).dataset.homeCard ?? '', shape = (node as HTMLElement).dataset.homeShape ?? '?';
    return id === 'inbox' || id === 'sessions' ? [] : [`${id}=${wanted.some(value => value.startsWith(`${id}=`) && value.endsWith('=?')) ? '?' : shape}`];
  }), wanted)).toEqual(wanted);
  await settle(page);
}
const placement = (widget: string, shape: HomeShape): HomePlacement => ({widget, size: storedSize[shape], hidden: false, shape, ...(widget === 'art' ? {art: {format: shape === 'wide' ? 'banner' : shape === 'tall' ? 'tall' : 'square', pinned: true}} : {})});

type Box = {id: string; shape: string | null; offers: string[]; left: number; top: number; right: number; bottom: number; overflow: number; clipped: string[]; scrollers: string[]};
/** Every card's box and what does not fit inside it: content taller than the card, clipped controls and scroll containers. */
async function measure(page: Page): Promise<{columns: number; gap: number; left: number; right: number; cell: number; cards: Box[]}> {
  await settle(page);
  return page.locator('.home-layout-grid').evaluate(host => {
    const style = getComputedStyle(host), gap = Number.parseFloat(style.columnGap);
    const grid = host.getBoundingClientRect();
    const cards = [...host.querySelectorAll<HTMLElement>(':scope > .home-layout-card')].map(card => {
      const box = card.getBoundingClientRect(), content = card.querySelector<HTMLElement>('.home-card-content');
      // A closed disclosure's content and visually hidden text take no room on screen.
      const unseen = (node: Element): boolean => {
        const closed = node.closest('details:not([open])');
        return closed !== null && node.closest('summary') === null || node.closest('.vh, [hidden]') !== null || node.checkVisibility() === false;
      };
      const need = Math.max(...[content, ...(content === null ? [] : [...content.querySelectorAll<HTMLElement>('*')])].flatMap(node => {
        if (node === null || unseen(node)) return [];const rect = node.getBoundingClientRect();return rect.width === 0 && rect.height === 0 ? [] : [rect.bottom - box.top];
      }), 0);
      const clipped = [...card.querySelectorAll<HTMLElement>('button, input, select, a[href], summary, canvas')].filter(node => {
        const rect = node.getBoundingClientRect();if (rect.width === 0 || rect.height === 0 || unseen(node)) return false;
        return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
      }).map(node => `${node.tagName.toLowerCase()}:${(node.textContent ?? node.getAttribute('aria-label') ?? '').trim().slice(0, 24)}`);
      const scrollers = [...card.querySelectorAll<HTMLElement>('*')].filter(node => {
        if (unseen(node)) return false;
        const overflow = getComputedStyle(node).overflowY;return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1;
      }).map(node => node.className);
      return {id: card.dataset.homeCard ?? '', shape: card.dataset.homeShape ?? null, offers: (card.dataset.homeOffers ?? '').split(' '), left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        overflow: Math.max(0, Math.round(need - box.height)), clipped, scrollers};
    });
    return {columns: Number(host.dataset.columns), gap, left: grid.left, right: grid.right, cell: Number.parseFloat(style.gridAutoRows), cards};
  });
}
const misfits = (cards: readonly Box[]): string[] => cards.flatMap(card => card.overflow > 1 || card.clipped.length > 0 || card.scrollers.length > 0
  ? [`${card.id}@${String(card.shape)}: +${String(card.overflow)}px ${card.clipped.join(',')} ${card.scrollers.join(',')}`] : []);
/** Equal gaps, whole units and no overlap: every card's edges sit on the unit grid. */
function tiles(value: Awaited<ReturnType<typeof measure>>): void {
  const unit = value.cell + value.gap, span = {square: [1, 1], wide: [2, 1], tall: [1, 2], 'large-square': [2, 2]} as const;
  for (const card of value.cards) {
    const shape = card.shape as HomeShape | null;assert.ok(shape !== null, `${card.id} has a shape`);
    const [columns, rows] = span[shape];
    assert.ok(Math.abs(card.right - card.left - (columns * unit - value.gap)) <= 1, `${card.id} is ${String(columns)} units wide`);
    assert.ok(Math.abs(card.bottom - card.top - (rows * unit - value.gap)) <= 1, `${card.id} is ${String(rows)} units tall`);
    assert.ok(Math.abs((card.left - value.left) / unit - Math.round((card.left - value.left) / unit)) < 0.01, `${card.id} starts on a column`);
  }
  for (const [index, a] of value.cards.entries()) for (const b of value.cards.slice(index + 1)) {
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${a.id} and ${b.id} do not overlap`);
  }
}

try {
  for (let index = 0; index < 5; index += 1) await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: `shape-${String(index)}`}, title: {value: `Synthetic agent ${String(index + 1)}`, source: 'provider'}});
  await world.observe(approvalPrompt('shapes-attention'));
  for (let index = 0; index < 13; index += 1) await world.failCommand();
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: receipts === undefined ? 1 : 2});
  const page = await context.newPage();page.setDefaultTimeout(20_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  for (const prefix of ['device:bunny/modules/pixoo:', 'device:bunny/modules/tidbyt:', 'light:device:']) await page.locator(`[data-home-card^="${prefix}"]`).first().waitFor();
  // Setup only: a room for the room card, through the existing lighting metadata command.
  assert.equal(await page.evaluate(async () => (await fetch('/api/v2/commands/lighting-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
    body: JSON.stringify({target: 'lighting', requestId: 'shapes-room', data: {expectedRevision: 0, layout: {rooms: [{id: 'studio', name: 'Studio'}], assignments: [], groups: [], home: null}}})})).status), 200);
  const initial = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const find = (prefix: string): string => {const id = initial.find(value => value.startsWith(prefix));assert.ok(id !== undefined, `${prefix} in ${initial.join(', ')}`);return id;};
  const pixoo = find('device:bunny/modules/pixoo:'), tidbyt = find('device:bunny/modules/tidbyt:'), lamps = initial.filter(id => id.startsWith('light:device:'));
  const all = [...new Set([...initial, 'timeline', 'duck-latest', 'reachy', 'music-visualizer', 'art', 'light:room:studio', 'wispr'])];
  const representative: HomePlacement[] = [placement('hub-mode', 'wide'), placement('inbox', 'tall'), placement('sessions', 'large-square'), placement('wispr', 'square'),
    placement(lamps[0] ?? '', 'tall'), placement(pixoo, 'square'), placement(lamps[1] ?? '', 'square'), placement('timeline', 'tall'), placement(tidbyt, 'square'),
    placement('music-visualizer', 'wide'), placement('light:room:studio', 'wide'), placement('art', 'large-square')];

  const order = async (): Promise<string[]> => page.locator('.home-layout-grid > [data-home-card]:not([data-art-placement=automatic])').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  if (part('tiles')) {
    // AC1: the built-in layout, before any save, tiles on the unit grid; so do three mixed layouts with all four shapes.
    const value = await measure(page);assert.equal(value.columns, 5);assert.ok(Math.abs(value.cell - 225.6) < 1, String(value.cell));tiles(value);
    assert.deepEqual(misfits(value.cards), []);
    await shot(page, 'final-default-1440');
    const mixed: HomePlacement[][] = [representative,
      [placement('sessions', 'large-square'), placement('hub-mode', 'large-square'), placement(lamps[0] ?? '', 'square'), placement(lamps[1] ?? '', 'square'), placement(lamps[2] ?? '', 'square'), placement('timeline', 'large-square'), placement(pixoo, 'square')],
      [placement('inbox', 'tall'), placement('timeline', 'tall'), placement(lamps[0] ?? '', 'tall'), placement(lamps[1] ?? '', 'tall'), placement('hub-mode', 'wide'), placement(lamps[2] ?? '', 'wide'), placement(tidbyt, 'square'), placement('light:room:studio', 'square')]];
    const seen = new Set<string>();
    for (const layout of mixed) {
      await save(page, layout);
      for (const width of [1100, 1440, 1920]) {
        await page.setViewportSize({width, height: 1000});const result = await measure(page);tiles(result);
        for (const card of result.cards) seen.add(card.shape ?? '');
        assert.deepEqual(misfits(result.cards), [], `layout at ${String(width)}`);
      }
      await page.setViewportSize({width: 1440, height: 1000});
      // Keyboard and DOM order stay the saved order even where a later card fills an earlier hole.
      const saved = layout.map(entry => entry.widget);
      assert.deepEqual((await order()).filter(id => saved.includes(id)), saved);
    }
    assert.deepEqual([...seen].sort(), [...shapes].sort(), 'the mixed layouts use all four shapes');
    // Dense first fit: a square saved after a large square fills the hole an earlier row left; the DOM keeps saved order.
    const backfill = [placement(lamps[0] ?? '', 'square'), placement('sessions', 'large-square'), placement('hub-mode', 'large-square'), placement('timeline', 'large-square'), placement(pixoo, 'square')];
    await save(page, backfill);
    const filled = new Map((await measure(page)).cards.map(card => [card.id, card]));
    assert.ok((filled.get(pixoo)?.top ?? 0) < (filled.get('timeline')?.top ?? 0), 'the later square is placed above the large square saved before it');
    assert.deepEqual((await order()).filter(id => id !== 'inbox'), backfill.map(entry => entry.widget));
    // Narrow screens keep one column at content height with full content.
    await page.setViewportSize({width: 375, height: 812});await settle(page);
    assert.equal(await page.locator('.home-layout-grid').getAttribute('data-packed'), 'false');
    assert.equal(await page.locator('[data-home-shape]').count(), 0, 'no shape applies on a narrow screen');
    await page.setViewportSize({width: 1440, height: 1000});await settle(page);
  }

  if (part('picker')) {
    // AC2: the owner changes a shape in Edit Home; it saves, reloads and sends no device command.
    await save(page, representative);
    const sent = changes(page);
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await expect(page.locator('.home-hole').first()).toBeVisible();
    const choice = page.getByRole('group', {name: 'Shape of Hub mode', exact: true});
    await expect(choice.getByRole('button')).toHaveCount(4);
    await expect(choice.getByRole('button', {name: 'Wide', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', {name: 'Shape of Inbox', exact: true}).getByRole('button')).toHaveCount(3);
    await choice.getByRole('button', {name: 'Large square', exact: true}).click();
    await expect(page.locator('[data-home-card="hub-mode"]')).toHaveAttribute('data-home-shape', 'large-square');
    await shot(page, 'final-edit-home-picker-1440');
    // The Phone arrangement is one column: no shape choice there.
    await page.getByRole('button', {name: 'Phone', exact: true}).click();
    await expect(page.locator('.home-shape-choice')).toHaveCount(0);
    await page.getByRole('button', {name: 'Desktop', exact: true}).click();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(page.getByText('Home layout saved.', {exact: true})).toBeVisible();
    assert.deepEqual(sent, ['/api/v2/commands/home-layout-set'], 'only the layout save is sent');
    await page.reload();await feed(page, 'connected');
    await expect(page.locator('[data-home-card="hub-mode"]')).toHaveAttribute('data-home-shape', 'large-square');
    const stored = await page.evaluate(async () => {
      const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}};
      return data.records['home-layout'][0]?.layouts;
    });
    assert.deepEqual(stored?.desktop.find(entry => entry.widget === 'hub-mode'), {widget: 'hub-mode', size: 'medium', hidden: false, shape: 'large-square'});
    assert.ok(stored?.desktop.every(entry => entry.shape !== undefined) === true && stored.phone.every(entry => entry.shape !== undefined), 'the save stores a shape for every placement');
    // Cancel discards a shape change.
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await page.getByRole('group', {name: 'Shape of Hub mode', exact: true}).getByRole('button', {name: 'Small square', exact: true}).click();
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(page.locator('[data-home-card="hub-mode"]')).toHaveAttribute('data-home-shape', 'large-square');
  }

  if (part('convert')) {
    // AC3: a layout saved with Small / Standard / Wide only loads with the same widgets and order in stated shapes,
    // and loading writes nothing.
    const old: HomePlacement[] = [{widget: 'hub-mode', size: 'medium', hidden: false}, {widget: 'inbox', size: 'small', hidden: false}, {widget: 'sessions', size: 'medium', hidden: false},
      {widget: lamps[0] ?? '', size: 'medium', hidden: false}, {widget: lamps[1] ?? '', size: 'large', hidden: false}, {widget: pixoo, size: 'medium', hidden: false},
      {widget: 'timeline', size: 'large', hidden: false}, {widget: 'art', size: 'medium', hidden: false, art: {format: 'banner', pinned: true}}];
    // An empty save first, so the core carries no earlier shape onto these width-only placements.
    await save(page, []);await save(page, old);
    const sent = changes(page);
    await page.reload();await feed(page, 'connected');await settle(page);
    assert.deepEqual(await order(), old.map(entry => entry.widget));
    const shown = Object.fromEntries((await measure(page)).cards.map(card => [card.id, card.shape]));
    assert.deepEqual(shown, {'hub-mode': 'wide', inbox: 'tall', sessions: 'large-square', [lamps[0] ?? '']: 'tall', [lamps[1] ?? '']: 'large-square', [pixoo]: 'square', timeline: 'large-square', art: 'wide'});
    tiles(await measure(page));
    await shot(page, 'final-converted-old-layout-1440');
    await page.waitForTimeout(500);assert.deepEqual(sent, [], 'loading an old-format layout writes nothing');
  }

  if (part('paging')) {
    // AC5: Inbox rows per page follow its shape; an opened item takes the page and stays reachable; F11 stuck-row case.
    await save(page, [placement('inbox', 'tall'), placement('hub-mode', 'wide')]);
    const inbox = page.locator('[data-home-card="inbox"]'), list = inbox.locator('[data-paged-list="Inbox"]'), rows = list.locator('[data-paged-key]:not([hidden])');
    await expect(rows).toHaveCount(4);await expect(inbox.getByText('Page 1 of 4', {exact: true})).toBeVisible();
    await inbox.getByRole('button', {name: 'Next', exact: true}).click();await expect(inbox.getByText('Page 2 of 4', {exact: true})).toBeVisible();
    const first = rows.first(), key = await first.getAttribute('data-paged-key');
    await first.locator('details.inbox-entry > summary').click();
    await expect(rows).toHaveCount(1);await expect(list.locator('.paged-list-pager')).toHaveCount(0);
    const reachable = async (): Promise<void> => {
      const card = await inbox.boundingBox(), dismiss = await inbox.getByRole('button', {name: 'Dismiss', exact: true}).boundingBox();
      assert.ok(card !== null && dismiss !== null && dismiss.y + dismiss.height <= card.y + card.height + 1, 'Dismiss is inside the card');
    };
    await reachable();assert.deepEqual(misfits((await measure(page)).cards), []);
    await shot(page, 'final-inbox-opened-item-1440');
    for (const shape of ['wide', 'large-square'] as const) {
      await save(page, [placement('inbox', shape), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(1);await reachable();
      assert.deepEqual(misfits((await measure(page)).cards), [], `opened item in ${shape}`);
    }
    // Open, change the width off the grid, close there, and change back: the page returns with no row stuck open.
    await page.setViewportSize({width: 375, height: 812});await settle(page);
    await expect(rows).not.toHaveCount(1);
    // Off the grid five rows make a page, so the open row (the fifth) is on the first page there.
    const previous = inbox.getByRole('button', {name: 'Previous', exact: true});if (await previous.isEnabled()) await previous.click();
    await list.locator(`[data-paged-key="${key ?? ''}"] details.inbox-entry > summary`).click();
    await page.setViewportSize({width: 1440, height: 1000});await settle(page);
    await expect(rows).toHaveCount(4);await expect(list.locator('.paged-list-pager')).toHaveCount(1);
    // And with the shape: open in Large square, change to Tall, close, change back.
    await rows.first().locator('details.inbox-entry > summary').click();await expect(rows).toHaveCount(1);
    await save(page, [placement('inbox', 'tall'), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(1);
    await rows.first().locator('details.inbox-entry > summary').click();await expect(rows).toHaveCount(4);
    await save(page, [placement('inbox', 'large-square'), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(4);
    await expect(list.locator('details[open]')).toHaveCount(0);
    // Timeline in one row shows its latest entries and Open Timeline, with no pager.
    await save(page, [placement('timeline', 'square')]);
    const timeline = page.locator('[data-home-card="timeline"]');
    await expect(timeline.getByRole('link', {name: 'Open Timeline', exact: true})).toHaveAttribute('href', '#/timeline');
    await expect(timeline.locator('[data-paged-key]:not([hidden])')).toHaveCount(2);await expect(timeline.locator('.paged-list-pager')).toHaveCount(0);
  }

  if (part('fit')) {
    // AC4: every card in every shape it offers fits at 1100, 1440 and 1920 px: no overflow, clipped control or scrolling.
    await save(page, all.map(widget => ({widget, size: 'medium', hidden: false})));
    const offers = new Map((await measure(page)).cards.map(card => [card.id, card.offers as HomeShape[]]));
    const failures: string[] = [];
    for (const shape of shapes) {
      const cards = all.filter(id => offers.get(id)?.includes(shape) === true);
      await save(page, cards.map(widget => placement(widget, shape)));
      for (const width of [1100, 1440, 1920]) {
        await page.setViewportSize({width, height: 1000});await settle(page);
        const value = await measure(page);
        const placed = value.cards.filter(card => cards.includes(card.id));
        assert.ok(placed.length === cards.length && placed.every(card => card.shape === shape), `${shape} at ${String(width)}: ${placed.map(card => `${card.id}=${String(card.shape)}`).join(', ')}`);
        failures.push(...misfits(value.cards).map(text => `${String(width)}: ${text}`));
        // Every control face fits too: switch each tab of each card and measure again.
        const tabbed = page.locator('.home-layout-grid > [data-home-card]').filter({has: page.getByRole('tab')});
        for (let index = 0; index < await tabbed.count(); index += 1) {
          const tabs = tabbed.nth(index).getByRole('tab');
          for (let tab = 1; tab < await tabs.count(); tab += 1) {
            await tabs.nth(tab).click();const label = await tabs.nth(tab).innerText();
            failures.push(...misfits((await measure(page)).cards).map(text => `${String(width)} tab ${label}: ${text}`));
          }
          await tabs.first().click();
        }
        if (width === 1440) await shot(page, `final-every-card-${shape}-1440`);
      }
    }
    await page.setViewportSize({width: 1440, height: 1000});
    assert.deepEqual(failures, [], 'every offered shape fits');
  }

  if (receipts !== undefined && part('shots')) {
    await save(page, representative);
    for (const width of [1100, 1440, 1920]) {await page.setViewportSize({width, height: 1000});await settle(page);await shot(page, `final-home-${String(width)}`);}
    await page.setViewportSize({width: 375, height: 812});await settle(page);await shot(page, 'final-home-375');
    await page.setViewportSize({width: 1440, height: 1000});
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();await world.close();
}
void changes;void ({} as Locator);
