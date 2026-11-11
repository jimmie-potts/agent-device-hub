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
import {listFit} from '../src/paging.ts';
import {idleChanges} from './list-idle.ts';

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
  // Clear focus and keep the skip link (shown only while focused) out of the picture.
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();document.querySelector<HTMLElement>('.skip')?.style.setProperty('display', 'none');});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  // Focus is cleared above; the skip link is also kept out of the picture in case a browser left it shown.
  await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true, clip: {x: 0, y: Math.max(0, box.y - 8), width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
  await page.evaluate(() => {document.querySelector<HTMLElement>('.skip')?.style.removeProperty('display');});
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

type Box = {id: string; shape: string | null; offers: string[]; left: number; top: number; right: number; bottom: number; overflow: number; empty: number; clipped: string[]; scrollers: string[]};
/**
 * Every card's box and what does not fit inside it: content taller than the card, clipped controls and scroll
 * containers. `empty` is the space between the last visible content (text, controls, images) and the card's inner
 * bottom edge. Content that an overflow-hidden ancestor clips counts only up to that ancestor's edge.
 */
async function measure(page: Page): Promise<{columns: number; gap: number; left: number; right: number; cell: number; cards: Box[]}> {
  // After a resize or save the grid repacks on its next measurement; wait until its columns match its width.
  await expect.poll(() => page.locator('.home-layout-grid').evaluate(host => host.dataset.packed !== 'true' || Number(host.dataset.columns) === Math.max(2, Math.floor((host.clientWidth + 16) / 236)))).toBe(true);
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
      const bottomOf = (node: Element): number => {
        let bottom = node.getBoundingClientRect().bottom;
        for (let parent = node.parentElement; parent !== null && parent !== card; parent = parent.parentElement) {
          const clip = getComputedStyle(parent);
          if (clip.overflowY !== 'visible' || clip.overflowX !== 'visible') bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
        }
        return bottom;
      };
      const nodes = content === null ? [] : [...content.querySelectorAll<HTMLElement>('*')].filter(node => !unseen(node));
      const need = Math.max(0, ...nodes.flatMap(node => {const rect = node.getBoundingClientRect();return rect.width === 0 && rect.height === 0 ? [] : [bottomOf(node) - box.top];}));
      // Content boxes: each line of visible text, each control and image, and each panel (a background or border)
      // that holds some of them. A blank placeholder panel holds none, so it is not content.
      const topOf = (node: Element): number => {
        let top = node.getBoundingClientRect().top;
        for (let parent = node.parentElement; parent !== null && parent !== card; parent = parent.parentElement) {
          const clip = getComputedStyle(parent);
          if (clip.overflowY !== 'visible' || clip.overflowX !== 'visible') top = Math.max(top, parent.getBoundingClientRect().top);
        }
        return top;
      };
      const intervals: [number, number][] = [];
      const media = nodes.filter(node => node.matches('button, input, select, textarea, canvas, svg, img, video') && node.getBoundingClientRect().height > 0);
      for (const node of media) intervals.push([topOf(node), bottomOf(node)]);
      const walker = document.createTreeWalker(content ?? card, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        const parent = text.parentElement;if (parent === null || (text.textContent ?? '').trim() === '' || unseen(parent)) continue;
        const range = document.createRange();range.selectNodeContents(text);
        for (const rect of range.getClientRects()) if (rect.height > 0 && rect.width > 0) intervals.push([Math.max(rect.top, topOf(parent)), Math.min(rect.bottom, bottomOf(parent))]);
      }
      const filled = new Set<Element>();
      for (const node of media) for (let parent = node.parentElement; parent !== null && parent !== card; parent = parent.parentElement) filled.add(parent);
      walker.currentNode = content ?? card;
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) if ((text.textContent ?? '').trim() !== '') for (let parent = text.parentElement; parent !== null && parent !== card; parent = parent.parentElement) filled.add(parent);
      for (const node of nodes) {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const surface = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent' || Number.parseFloat(style.borderTopWidth) > 0 && Number.parseFloat(style.borderBottomWidth) > 0;
        if (surface && filled.has(node) && rect.height > 0 && rect.height < 0.9 * box.height) intervals.push([topOf(node), bottomOf(node)]);
      }
      const frames = nodes.filter(node => node.getBoundingClientRect().height >= 0.9 * box.height);
      const pad = Math.max(0, ...frames.map(node => Number.parseFloat(getComputedStyle(node).paddingTop)));
      const padBottom = Math.max(0, ...frames.map(node => Number.parseFloat(getComputedStyle(node).paddingBottom)));
      const top = box.top + pad, bottom = box.bottom - padBottom;
      const spans = intervals.map(([from, to]) => [Math.max(top, from), Math.min(bottom, to)] as [number, number]).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
      let reach = top, band = 0;
      for (const [from, to] of spans) {band = Math.max(band, from - reach);reach = Math.max(reach, to);}
      band = Math.max(band, bottom - reach);
      // An opened row's list is the card's scroll area (#1672 F22); listScrolls checks that its controls scroll into view.
      const scrolled = (node: Element): boolean => node.closest('.paged-list[data-held=true]') !== null;
      const clipped = [...card.querySelectorAll<HTMLElement>('button, input, select, a[href], summary, canvas')].filter(node => {
        const rect = node.getBoundingClientRect();if (rect.width === 0 || rect.height === 0 || unseen(node) || scrolled(node)) return false;
        return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
      }).map(node => `${node.tagName.toLowerCase()}:${(node.textContent ?? node.getAttribute('aria-label') ?? '').trim().slice(0, 24)}`);
      const scrollers = [...card.querySelectorAll<HTMLElement>('*')].filter(node => {
        if (unseen(node) || node.matches('.paged-list[data-held=true]')) return false;
        const overflow = getComputedStyle(node).overflowY;return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1;
      }).map(node => node.className);
      return {id: card.dataset.homeCard ?? '', shape: card.dataset.homeShape ?? null, offers: (card.dataset.homeOffers ?? '').split(' '), left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        overflow: Math.max(0, Math.round(need - box.height)), empty: Math.max(0, Math.round(band)), clipped, scrollers};
    });
    return {columns: Number(host.dataset.columns), gap, left: grid.left, right: grid.right, cell: Number.parseFloat(style.gridAutoRows), cards};
  });
}
const misfits = (cards: readonly Box[]): string[] => cards.flatMap(card => card.overflow > 1 || card.clipped.length > 0 || card.scrollers.length > 0
  ? [`${card.id}@${String(card.shape)}: +${String(card.overflow)}px ${card.clipped.join(',')} ${card.scrollers.join(',')}`] : []);
/**
 * No half-empty cards (#1672 F2, F11): the largest blank band anywhere in a card (above its first content, between
 * two consecutive content boxes, or below its last) stays under one list row (48px) or 15% of the card, whichever is
 * larger, so no shape leaves an empty band where content could be, and moving space around cannot satisfy it.
 */
const emptyLimit = (card: Box): number => Math.max(48, 0.15 * (card.bottom - card.top));
/** List cards follow listFits instead: their rows keep a fixed height and a short list leaves the rest plain. */
const listCards: readonly string[] = ['inbox', 'timeline', 'sessions'];
const halfEmpty = (cards: readonly Box[]): string[] => cards.flatMap(card => !listCards.includes(card.id) && card.empty > emptyLimit(card) ? [`${card.id}@${String(card.shape)}: ${String(card.empty)}px blank band of ${String(Math.round(card.bottom - card.top))}`] : []);
/**
 * Calculated rows match the rendered card (#1672 owner decision 2026-11-11): every fixed size in paging.ts listFit
 * equals the rendered one (frame, chrome above the rows, row height and pitch, pager), no row overlaps the pager or
 * leaves the card, and a full list (more items than one page shows) leaves less than one row of space above its pager.
 */
async function listFits(page: Page): Promise<string[]> {
  return page.locator('.home-layout-grid').evaluate((host, fit) => {
    const out: string[] = [], near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    for (const card of host.querySelectorAll<HTMLElement>(':scope > .home-layout-card[data-home-shape]')) {
      const id = card.dataset.homeCard ?? '', shape = card.dataset.homeShape ?? '', list = card.querySelector<HTMLElement>('[data-paged-list]');
      if (list === null || list.dataset.held === 'true' || !['inbox', 'timeline', 'sessions'].includes(id)) continue;
      const name = `${id}@${shape}`, box = card.getBoundingClientRect(), widget = card.querySelector<HTMLElement>('.widget');if (widget === null) {out.push(`${name}: no frame`);continue;}
      const style = getComputedStyle(widget), px = (value: string): number => Number.parseFloat(value);
      const top = px(style.paddingTop) + px(style.borderTopWidth), bottom = px(style.paddingBottom) + px(style.borderBottomWidth);
      if (!near(top + bottom, fit.frame)) out.push(`${name}: frame ${String(top + bottom)}px, listFit.frame ${String(fit.frame)}`);
      const inner = {top: box.top + top, bottom: box.bottom - bottom};
      const notices = card.querySelectorAll('.inbox-card>.hub-control-status').length, status = shape === 'square' || shape === 'wide' ? 0 : 1;
      const chrome = id === 'inbox' ? fit.inbox.heading + notices * fit.inbox.notice
        : id === 'timeline' ? (shape === 'tall' ? fit.timeline.tallHeading + fit.timeline.tallLink : shape === 'large-square' ? fit.timeline.heading + fit.timeline.filters : fit.timeline.heading) + status * fit.timeline.status
          : fit.sessions.heading + (shape === 'tall' ? fit.sessions.tallSummary + fit.sessions.tallFilters : fit.sessions.summary + fit.sessions.filters);
      const height = id === 'inbox' ? fit.inbox.row : id === 'timeline' ? fit.timeline.row : fit.sessions.tile, pitch = id === 'sessions' ? fit.sessions.tile + fit.sessions.gap : height;
      const all = [...list.querySelectorAll<HTMLElement>('[data-paged-key]')], rows = all.filter(row => !row.hidden).map(row => row.getBoundingClientRect());
      const pager = list.querySelector('.paged-list-pager')?.getBoundingClientRect(), limit = pager?.top ?? inner.bottom;
      if (pager !== undefined && (!near(pager.height, fit.pager) || !near(pager.bottom, inner.bottom))) out.push(`${name}: pager ${pager.height.toFixed(1)}px ending ${(inner.bottom - pager.bottom).toFixed(1)}px above the frame, listFit.pager ${String(fit.pager)}`);
      const first = rows[0];if (first === undefined) continue;
      if (!near(first.top - inner.top, chrome)) out.push(`${name}: rows start ${(first.top - inner.top).toFixed(1)}px below the frame, listFit chrome ${String(chrome)}`);
      const tops = [...new Set(rows.map(row => Math.round(row.top)))].sort((a, b) => a - b);
      for (const [index, value] of tops.slice(1).entries()) if (!near(value - (tops[index] ?? 0), pitch)) out.push(`${name}: row pitch ${String(value - (tops[index] ?? 0))}px, listFit ${String(pitch)}`);
      // A list row's last entry has no rule below it, so it is one pixel shorter.
      for (const row of rows) if (row.height > height + 0.5 || row.height < height - 1.5) out.push(`${name}: row ${row.height.toFixed(1)}px, listFit ${String(height)}`);
      // Everything a closed row shows stays inside it: a long name is cut short, never pushed below the row (F23).
      for (const row of all.filter(value => !value.hidden)) {
        const outer = row.getBoundingClientRect();
        for (const node of row.querySelectorAll<HTMLElement>('*')) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || !node.checkVisibility() || node.closest('.vh') !== null) continue;
          if (rect.top < outer.top - 1 || rect.bottom > outer.bottom + 1) out.push(`${name}: ${node.tagName.toLowerCase()}.${String(node.className).slice(0, 30)} "${(node.textContent ?? '').trim().slice(0, 20)}" leaves its row`);
        }
      }
      const end = Math.max(...rows.map(row => row.bottom));
      if (end > limit + 0.5) out.push(`${name}: rows end ${(end - limit).toFixed(1)}px past ${pager === undefined ? 'the card' : 'the pager'}`);
      // A full page: more rows than it shows, and not the last page, which may hold fewer.
      const full = all.length > rows.length && (pager === undefined || Number(list.dataset.page) < Number(list.dataset.pages));
      if (full && limit - end >= pitch) out.push(`${name}: a full list leaves ${(limit - end).toFixed(1)}px, one row is ${String(pitch)}`);
    }
    return out;
  }, listFit);
}
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
  // F23: a provider title long enough to wrap four lines in a tile; first in record order, so the first page shows it.
  await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: 'shape-long-title'}, title: {value: 'Rework the Home card shapes so every list fits its card at each window width, then report back', source: 'provider'}});
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
    assert.deepEqual(misfits(value.cards), []);assert.deepEqual(halfEmpty(value.cards), []);assert.deepEqual(await listFits(page), []);
    await shot(page, 'final5-default-1440');
    // F3: automatic art stays in view at every width: trailing empty cells, or a Wide row of its own after the last card.
    // The sweep runs at 1x scale in its own page: 2x screenshots at 2560px exhaust the renderer.
    const sweepContext = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'}), sweep = await sweepContext.newPage();
    const sweepErrors: string[] = [];sweep.on('pageerror', error => {sweepErrors.push(error.message);});sweep.on('console', message => {if (message.type() === 'error') sweepErrors.push(message.text().slice(0, 300));});
    await sweep.goto(world.url);await feed(sweep, 'connected');
    const automatic = sweep.locator('.home-layout-grid > [data-art-placement="automatic"]'), missing: number[] = [];
    for (let width = 620; width <= 2560; width += 60) {
      await sweep.setViewportSize({width, height: 1000});await settle(sweep);
      // Art appears once the grid has repacked for the new width.
      try {await expect(automatic).toHaveCount(1, {timeout: 3000});await expect(automatic).toBeVisible({timeout: 3000});} catch {missing.push(width);}
    }
    // No render loop blanks the page while resizing (React error 185 came from lists that measured themselves).
    assert.deepEqual(sweepErrors, [], 'no page errors while resizing');
    await sweepContext.close();
    assert.deepEqual(missing, [], 'automatic art is present at every width on the built-in layout');
    await page.setViewportSize({width: 1440, height: 1000});await settle(page);
    // F9: the Phone editor preview stays one column on a desktop window, and Cancel leaves the desktop grid.
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();await page.getByRole('button', {name: 'Phone', exact: true}).click();
    assert.equal(await page.locator('.home-layout-grid').getAttribute('data-packed'), 'false');
    const lefts = await page.locator('.home-layout-grid > [data-home-card]').evaluateAll(nodes => [...new Set(nodes.map(node => Math.round(node.getBoundingClientRect().left)))]);
    assert.equal(lefts.length, 1, 'the Phone preview is one column');
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();await expect(page.locator('.home-layout-grid')).toHaveAttribute('data-packed', 'true');
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
        assert.deepEqual(await listFits(page), [], `list rows at ${String(width)}`);
      }
      await page.setViewportSize({width: 1440, height: 1000});
      // Keyboard and DOM order stay the saved order even where a later card fills an earlier hole.
      const saved = layout.map(entry => entry.widget);
      assert.deepEqual((await order()).filter(id => saved.includes(id)), saved);
    }
    assert.deepEqual([...seen].sort(), [...shapes].sort(), 'the mixed layouts use all four shapes');
    // F9: approval text and disclosure controls fit inside the attention tile on the desktop grid.
    await save(page, representative);
    const attention = page.locator('.agent-status-card[data-attention=true]');await expect(attention).toBeVisible();
    assert.deepEqual(await attention.evaluate(host => {
      const bounds = host.getBoundingClientRect();
      return [...host.querySelectorAll('summary, .chip, .agent-caret')].filter(node => {const rect = node.getBoundingClientRect();return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);}).map(node => node.className);
    }), [], 'approval text and disclosure controls fit inside the attention tile');
    // F9: a hidden placement takes no room: the next card packs where it would have been.
    await save(page, [placement('hub-mode', 'wide'), {...placement(lamps[0] ?? '', 'square'), hidden: true}, placement(lamps[1] ?? '', 'square')]);
    const packedHidden = new Map((await measure(page)).cards.map(card => [card.id, card]));
    assert.equal(packedHidden.has(lamps[0] ?? ''), false, 'a hidden card is not shown');
    assert.ok(Math.abs((packedHidden.get(lamps[1] ?? '')?.left ?? 0) - (packedHidden.get('hub-mode')?.right ?? 0) - 16) <= 1, 'the next card takes the hidden card\'s cell');
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
    // F1: each card's bar shows its name; its other controls open below it, one card at a time, by keyboard too.
    const toggle = page.getByRole('button', {name: 'Options for Hub mode', exact: true});
    await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Hub mode is first, so Earlier is disabled and Tab moves straight to Later.
    await page.keyboard.press('Tab');await expect(page.getByRole('button', {name: 'Move Hub mode later', exact: true})).toBeFocused();
    const choice = page.getByRole('group', {name: 'Shape of Hub mode', exact: true});
    await expect(choice.getByRole('button')).toHaveCount(4);
    await expect(choice.getByRole('button', {name: 'Wide', exact: true})).toHaveAttribute('aria-pressed', 'true');
    for (let index = 0; index < 8 && !await choice.getByRole('button', {name: 'Large square', exact: true}).evaluate(node => node === document.activeElement); index += 1) await page.keyboard.press('Tab');
    await expect(choice.getByRole('button', {name: 'Large square', exact: true})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-home-card="hub-mode"]')).toHaveAttribute('data-home-shape', 'large-square');
    await shot(page, 'final5-edit-home-1440');
    // The screenshot clears focus; Escape from a control in the panel closes it and returns focus to its button.
    await choice.getByRole('button', {name: 'Large square', exact: true}).focus();await page.keyboard.press('Escape');await expect(toggle).toBeFocused();await expect(choice).toHaveCount(0);
    await page.getByRole('button', {name: 'Options for Inbox', exact: true}).click();
    await expect(page.getByRole('group', {name: 'Shape of Inbox', exact: true}).getByRole('button')).toHaveCount(3);
    await expect(page.getByRole('group', {name: 'Shape of Hub mode', exact: true})).toHaveCount(0);
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
    await page.getByRole('button', {name: 'Options for Hub mode', exact: true}).click();
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
    await page.reload();await feed(page, 'connected');
    // Home shows the built-in layout until the saved record syncs, so wait for the saved order and shapes.
    await expect.poll(order).toEqual(old.map(entry => entry.widget));
    await expect.poll(async () => Object.fromEntries((await measure(page)).cards.map(card => [card.id, card.shape]))).toEqual({'hub-mode': 'wide', inbox: 'tall', sessions: 'large-square', [lamps[0] ?? '']: 'tall', [lamps[1] ?? '']: 'large-square', [pixoo]: 'square', timeline: 'large-square', art: 'wide'});
    tiles(await measure(page));
    await shot(page, 'final5-converted-old-layout-1440');
    await page.waitForTimeout(500);assert.deepEqual(sent, [], 'loading an old-format layout writes nothing');
  }

  if (part('paging')) {
    // AC5: Inbox rows per page follow its shape; an opened item takes the page and stays reachable; F11 stuck-row case.
    await save(page, [placement('inbox', 'tall'), placement('hub-mode', 'wide')]);
    const inbox = page.locator('[data-home-card="inbox"]'), list = inbox.locator('[data-paged-list="Inbox"]'), rows = list.locator('[data-paged-key]:not([hidden])');
    // Rows per page are calculated from the card's shape and the grid: a Tall Inbox at 1440 holds five rows and its pager.
    await expect(rows).toHaveCount(5);const perPage = 5, pages = Math.ceil(13 / perPage);
    await expect(inbox.getByText(`Page 1 of ${String(pages)}`, {exact: true})).toBeAttached();
    await expect(inbox.locator('.paged-list-position [aria-hidden=true]')).toHaveText(`1 / ${String(pages)}`);
    const label = await inbox.locator('.paged-list-position [aria-hidden=true]').evaluate(node => ({height: node.getBoundingClientRect().height, font: Number.parseFloat(getComputedStyle(node).fontSize), text: node.textContent}));
    assert.ok(label.height <= label.font * 1.6, `F6: the page label fits on one line: ${JSON.stringify(label)}`);
    await inbox.getByRole('button', {name: 'Next', exact: true}).click();await expect(inbox.getByText(`Page 2 of ${String(pages)}`, {exact: true})).toBeAttached();
    const first = rows.first(), key = await first.getAttribute('data-paged-key');
    await first.locator('details.inbox-entry > summary').click();
    await expect(rows).toHaveCount(1);await expect(list.locator('.paged-list-pager')).toHaveCount(0);
    const reachable = async (): Promise<void> => {
      const card = await inbox.boundingBox(), dismiss = await inbox.getByRole('button', {name: 'Dismiss', exact: true}).boundingBox();
      assert.ok(card !== null && dismiss !== null && dismiss.y + dismiss.height <= card.y + card.height + 1, 'Dismiss is inside the card');
    };
    await reachable();assert.deepEqual(misfits((await measure(page)).cards), []);
    await shot(page, 'final5-inbox-opened-item-1440');
    for (const shape of ['wide', 'large-square'] as const) {
      await save(page, [placement('inbox', shape), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(1);await reachable();
      assert.deepEqual(misfits((await measure(page)).cards), [], `opened item in ${shape}`);
    }
    // Open, change the width off the grid, close there, and change back: the page returns with no row stuck open.
    await page.setViewportSize({width: 375, height: 812});await settle(page);
    await expect(rows).not.toHaveCount(1);
    // Off the grid the fixed page size applies; go to the page that holds the open row.
    const openRow = list.locator(`[data-paged-key="${key ?? ''}"]`);
    for (const direction of ['Previous', 'Previous', 'Next', 'Next', 'Next']) {
      if (await openRow.isVisible()) break;
      const button = inbox.getByRole('button', {name: direction, exact: true});if (await button.isEnabled()) await button.click();
    }
    await list.locator(`[data-paged-key="${key ?? ''}"] details.inbox-entry > summary`).click();
    await page.setViewportSize({width: 1440, height: 1000});await settle(page);
    await expect(rows).toHaveCount(perPage);await expect(list.locator('.paged-list-pager')).toHaveCount(1);
    // And with the shape: open in Large square, change to Tall, close, change back.
    await rows.first().locator('details.inbox-entry > summary').click();await expect(rows).toHaveCount(1);
    await save(page, [placement('inbox', 'tall'), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(1);
    await rows.first().locator('details.inbox-entry > summary').click();await expect(rows).toHaveCount(perPage);
    await save(page, [placement('inbox', 'large-square'), placement('hub-mode', 'wide')]);await expect(rows).toHaveCount(perPage);
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
        failures.push(...halfEmpty(value.cards).map(text => `${String(width)} half empty: ${text}`));
        failures.push(...(await listFits(page)).map(text => `${String(width)} list: ${text}`));
        const hub = value.cards.find(card => card.id === 'hub-mode');if (hub !== undefined) console.log(`hub-mode ${String(hub.shape)} at ${String(width)}: largest blank band ${String(hub.empty)}px of ${String(Math.round(hub.bottom - hub.top))}`);
        // F1: in Edit Home every card's name stays visible in a one-row edit bar.
        await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
        const bars = await page.locator('.home-layout-grid > [data-home-card]').evaluateAll(nodes => nodes.map(node => {
          const card = node.getBoundingClientRect(), bar = node.querySelector('.home-card-editor')?.getBoundingClientRect(), name = node.querySelector('.home-card-editor-name');
          const label = name?.getBoundingClientRect();
          return {id: (node as HTMLElement).dataset.homeCard ?? '', name: name?.textContent ?? '', bar: bar?.height ?? 0,
            shown: label !== undefined && label.width > 20 && label.top >= card.top && label.bottom <= card.bottom && label.right <= card.right + 1};
        }));
        for (const bar of bars) if (!bar.shown || bar.name === '' || bar.bar > 56) failures.push(`${String(width)} edit bar: ${JSON.stringify(bar)}`);
        await page.getByRole('button', {name: 'Cancel', exact: true}).click();
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
        if (width === 1440 || process.env.HOME_SHAPES_DEBUG !== undefined) await shot(page, `final5-every-card-${shape}-${String(width)}`);
      }
    }
    await page.setViewportSize({width: 1440, height: 1000});
    assert.deepEqual(failures, [], 'every offered shape fits');
  }

  if (part('results')) {
    // F4: a command's result shows on the face of a Small square and a Wide light card, inside the card.
    await save(page, [placement(lamps[0] ?? '', 'square'), placement(lamps[1] ?? '', 'wide')]);
    const square = page.locator(`[data-home-card="${lamps[0] ?? ''}"]`), wide = page.locator(`[data-home-card="${lamps[1] ?? ''}"]`);
    const inside = async (card: Locator, text: RegExp): Promise<void> => {
      const line = card.locator('.light-attention-line');await expect(line).toHaveText(text);
      const outer = await card.boundingBox(), box = await line.boundingBox();
      assert.ok(outer !== null && box !== null && box.y >= outer.y && box.y + box.height <= outer.y + outer.height + 1 && box.height > 0, 'the result line is inside the card');
    };
    await page.waitForFunction(id => document.querySelector<HTMLButtonElement>(`[data-home-card="${id}"] .light-power button`)?.disabled === false, lamps[0] ?? '');
    world.loseDeviceReply();await square.getByRole('button', {name: 'On', exact: true}).click();await inside(square, /Uncertain/);
    world.restoreDeviceReply();
    await page.route('**/api/v2/commands/power-set', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.waitForFunction(id => document.querySelector<HTMLButtonElement>(`[data-home-card="${id}"] .light-power button`)?.disabled === false, lamps[1] ?? '');
    await wide.getByRole('button', {name: 'Off', exact: true}).click();await inside(wide, /Refused/);
    await page.unroute('**/api/v2/commands/power-set');
    assert.deepEqual(misfits((await measure(page)).cards), []);
    await shot(page, 'final5-light-results-1440');
    // F15: the art card keeps its element, image and focused control across the one-column threshold and back.
    await save(page, representative);
    const unpin = page.locator('[data-home-card="art"]').getByRole('button', {name: 'Unpin art', exact: true});
    const artNode = await page.locator('[data-home-card="art"] .home-art-content').elementHandle();assert.ok(artNode !== null);
    await unpin.focus();
    for (const width of [375, 1440]) {
      await page.setViewportSize({width, height: width === 375 ? 812 : 1000});
      await expect(page.locator('.home-layout-grid')).toHaveAttribute('data-packed', width === 375 ? 'false' : 'true');await settle(page);
      assert.equal(await artNode.evaluate(node => node.isConnected), true, `the art stays mounted at ${String(width)}`);
      assert.equal(await unpin.evaluate(node => node === document.activeElement), true, `focus stays on Unpin art at ${String(width)}`);
    }
    await artNode.dispose();
    // F17: Agent sessions calculates tile columns and rows together, so a resize shows no intermediate page count.
    await save(page, [placement('sessions', 'large-square'), placement('hub-mode', 'wide')]);
    const sessionsList = page.locator('[data-home-card="sessions"] [data-paged-list="Agent sessions"]');
    const settled = async (): Promise<string | null> => {await settle(page);return sessionsList.getAttribute('data-pages');};
    const at1440 = await settled();
    await sessionsList.evaluate(node => {
      const seen: string[] = [];(window as unknown as {sessionPages: string[]}).sessionPages = seen;
      new MutationObserver(() => {seen.push(node.getAttribute('data-pages') ?? '');}).observe(node, {attributes: true, attributeFilter: ['data-pages']});
    });
    await page.setViewportSize({width: 1100, height: 1000});const at1100 = await settled();
    await page.setViewportSize({width: 1440, height: 1000});await settled();
    const seenPages = await page.evaluate(() => (window as unknown as {sessionPages: string[]}).sessionPages);
    assert.ok(seenPages.every(value => value === at1100 || value === at1440), `page counts during resize: ${seenPages.join(', ')} (settled ${String(at1440)} and ${String(at1100)})`);
    // F8: a category chosen in Large square does not stay applied in a shape that hides the category buttons.
    await save(page, [placement('timeline', 'large-square')]);
    const timeline = page.locator('[data-home-card="timeline"]');
    await timeline.getByRole('button', {name: 'Devices', exact: true}).click();await expect(timeline.getByRole('button', {name: 'Devices', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await save(page, [placement('timeline', 'tall')]);await expect(timeline.getByRole('button', {name: 'Devices', exact: true})).toHaveCount(0);
    await save(page, [placement('timeline', 'large-square')]);await expect(timeline.getByRole('button', {name: 'All', exact: true})).toHaveAttribute('aria-pressed', 'true');
    // F25: the status line's height is reserved, so a refresh keeps the page size (rows a page) while it reads.
    const history = timeline.locator('[data-paged-list="Timeline"]'), shownRows = history.locator('[data-paged-key]:not([hidden])');
    const perPage = await shownRows.count();
    // The read is held for a moment so the refreshing state is on screen long enough to check.
    await page.route('**/api/v2/history**', async route => {await new Promise(resolve => setTimeout(resolve, 800));await route.continue();});
    await timeline.getByRole('button', {name: 'Refresh history', exact: true}).click();
    await expect(timeline.locator('.timeline-status')).toHaveText(/Refreshing/);assert.equal(await shownRows.count(), perPage, 'the page size holds while the refresh reads');
    await expect(timeline.locator('.timeline-status')).not.toHaveText(/Refreshing/);assert.equal(await shownRows.count(), perPage, 'and after it');
    await page.unroute('**/api/v2/history**');
  }

  /** Card pictures side by side in one private PNG, at half their 2x size. */
  const sheet = async (name: string, pictures: readonly string[]): Promise<void> => {
    if (receipts === undefined) return;
    const view = await context.newPage();await view.setViewportSize({width: 1440, height: 1000});
    await view.setContent(`<body style="margin:16px;background:#eef1f6;display:flex;gap:16px;align-items:flex-start">${pictures.map(data => `<img src="data:image/png;base64,${data}" style="width:auto;height:auto;max-width:none;zoom:0.5">`).join('')}</body>`);
    await view.screenshot({path: join(receipts, `${name}.png`), fullPage: true});await view.close();
  };
  const picture = async (target: Page, id: string): Promise<string> => {
    if (receipts === undefined) return '';
    await target.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(target);
    return (await target.locator(`[data-home-card="${id}"]`).screenshot()).toString('base64');
  };

  /**
   * F22: an opened row's detail scrolls inside the card. Every control in it scrolls into view inside the list's scroll
   * area and the card, takes focus and is the element a pointer would hit there; the chrome keeps its fixed heights.
   */
  const listScrolls = async (id: string): Promise<string[]> => page.locator(`[data-home-card="${id}"]`).evaluate((card, {fit, id}) => {
    const out: string[] = [], list = card.querySelector<HTMLElement>('[data-paged-list]');
    if (list?.dataset.held !== 'true') return ['no opened row'];
    const style = getComputedStyle(list);if (style.overflowY !== 'auto') out.push(`list overflow ${style.overflowY}`);
    const shape = card.getAttribute('data-home-shape') ?? '';
    const chrome: [string, number][] = id === 'sessions' ? [['.widget-head', 44], ['.agent-summary', shape === 'tall' ? fit.sessions.tallSummary - 8 : fit.sessions.summary - 8], ['.agent-sessions .filters', shape === 'tall' ? fit.sessions.tallFilters - 8 : fit.sessions.filters - 8]]
      : id === 'timeline' ? [['.timeline-heading', shape === 'tall' ? fit.timeline.tallHeading - 8 : fit.timeline.heading - 8], ['.timeline-card>.timeline-status', fit.timeline.status - 8]] : [];
    for (const [selector, height] of chrome) {const node = card.querySelector(selector);if (node === null || Math.abs(node.getBoundingClientRect().height - height) > 1) out.push(`${selector} ${String(node?.getBoundingClientRect().height)}px, expected ${String(height)}`);}
    const outer = card.getBoundingClientRect(), controls = [...list.querySelectorAll<HTMLElement>('button, a[href], summary, input, select, textarea')]
      .filter(node => node.checkVisibility());
    for (const node of controls) {
      node.scrollIntoView({block: 'nearest'});node.focus();
      const rect = node.getBoundingClientRect(), area = list.getBoundingClientRect(), x = rect.left + Math.min(rect.width / 2, 8), y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const name = `${node.tagName.toLowerCase()} "${(node.textContent ?? node.getAttribute('aria-label') ?? '').trim().slice(0, 24)}"`;
      if (rect.top < area.top - 1 || rect.bottom > area.bottom + 1 || rect.bottom > outer.bottom + 1) out.push(`${name} not inside the scroll area`);
      if (document.activeElement !== node && !node.matches(':disabled')) out.push(`${name} does not take focus`);
      if (hit === null || !(hit === node || node.contains(hit))) out.push(`${name} is covered`);
    }
    list.scrollTop = 0;
    return out;
  }, {fit: listFit, id});

  if (part('opened')) {
    // F22: an opened session or Inbox item scrolls inside its card; nothing outside the scroll area is clipped.
    for (const shape of ['large-square', 'tall'] as const) {
      await save(page, [placement('sessions', shape), placement('hub-mode', 'wide')]);
      for (const width of [1100, 1440]) {
        await page.setViewportSize({width, height: 1000});await measure(page);
        const tile = page.locator('[data-home-card="sessions"] [data-paged-key]:not([hidden])').first();
        await tile.locator('summary.agent-face').click();await expect(page.locator('[data-home-card="sessions"] [data-paged-list]')).toHaveAttribute('data-held', 'true');
        assert.deepEqual(await listScrolls('sessions'), [], `opened session in ${shape} at ${String(width)}`);
        assert.deepEqual(misfits((await measure(page)).cards), [], `nothing outside the scroll area clipped in ${shape} at ${String(width)}`);
        if (width === 1440) await shot(page, `final5-opened-session-${shape}-1440`);
        await tile.locator('summary.agent-face').click();await expect(page.locator('[data-home-card="sessions"] [data-paged-list]')).toHaveAttribute('data-held', 'false');
      }
    }
    // An Inbox item with its command evidence open, longer than a Wide card.
    await save(page, [placement('inbox', 'wide'), placement('hub-mode', 'wide')]);
    for (const width of [1100, 1440]) {
      await page.setViewportSize({width, height: 1000});await measure(page);
      const item = page.locator('[data-home-card="inbox"] [data-paged-key]:not([hidden])').first();
      await item.locator('details.inbox-entry > summary').click();await item.locator('details.inbox-evidence > summary').click();
      assert.deepEqual(await listScrolls('inbox'), [], `opened Inbox item at ${String(width)}`);
      assert.deepEqual(misfits((await measure(page)).cards), [], `opened Inbox item at ${String(width)}`);
      await item.locator('details.inbox-evidence > summary').click();await item.locator('details.inbox-entry > summary').click();
    }
    await page.setViewportSize({width: 1440, height: 1000});
  }

  if (part('long')) {
    // F23: long names stay inside their fixed rows. The long session title comes from the synthetic world; for Inbox and
    // Timeline rows this check puts a long name into the first rows' text, then reloads.
    await save(page, [placement('sessions', 'large-square'), placement('inbox', 'tall'), placement('timeline', 'tall'), placement('hub-mode', 'wide')]);
    const long = 'A very long name that would wrap to several lines in a narrow card if it were allowed to';
    for (const width of [1100, 1440, 1920]) {
      await page.setViewportSize({width, height: 1000});await measure(page);
      await expect(page.locator('[data-home-card="sessions"] h3[title^="Rework the Home card shapes"]')).toBeVisible();
      await page.evaluate(text => {
        for (const node of document.querySelectorAll('[data-home-card] :is(.inbox-item-name,.inbox-item-sub,.timeline-title,.timeline-context)')) node.textContent = text;
      }, long);
      assert.deepEqual(await listFits(page), [], `long names at ${String(width)}`);
      if (width === 1440) await shot(page, 'final5-long-title-session-1440');
    }
    await page.reload();await feed(page, 'connected');await page.setViewportSize({width: 1440, height: 1000});
  }

  if (part('short')) {
    // A short or empty Inbox in each shape (#1672 owner decision 2026-11-11): one item sits at the top at its normal
    // height with no pager and the rest of the card plain; an empty Inbox centres its short message. Fresh synthetic
    // world and browser context, since browser sessions are cookies on the shared loopback host.
    const quiet = await startWorld({inbox: true}), quietContext = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: receipts === undefined ? 1 : 2});
    try {
      const fresh = await quietContext.newPage();fresh.setDefaultTimeout(20_000);await fresh.goto(quiet.url);await feed(fresh, 'connected');
      await expect(fresh.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
      const inbox = fresh.locator('[data-home-card="inbox"]'), pictures: string[] = [];
      for (const count of [0, 1]) {
        if (count === 1) {await quiet.failCommand();await expect(inbox.locator('[data-inbox]')).toHaveCount(1);}
        for (const shape of ['wide', 'tall', 'large-square'] as const) {
          await save(fresh, [placement('inbox', shape)]);await expect(inbox).toHaveAttribute('data-home-shape', shape);
          for (const width of [1100, 1440, 1920]) {
            await fresh.setViewportSize({width, height: 1000});await measure(fresh);
            assert.deepEqual(await listFits(fresh), [], `${String(count)} items in ${shape} at ${String(width)}`);
            await expect(inbox.locator('.paged-list-pager')).toHaveCount(0);
            if (count === 0) {
              const centre = await inbox.evaluate(card => {
                const message = card.querySelector('.inbox-empty'), entries = card.querySelector('.inbox-entries'), frame = card.querySelector('.inbox-card');
                if (message === null || entries === null || frame === null) return undefined;
                const range = document.createRange();range.selectNodeContents(message);
                const text = range.getBoundingClientRect(), room = {top: entries.getBoundingClientRect().bottom, bottom: frame.getBoundingClientRect().bottom, left: frame.getBoundingClientRect().left, right: frame.getBoundingClientRect().right};
                return {vertical: (text.top + text.bottom) / 2 - (room.top + room.bottom) / 2, horizontal: (text.left + text.right) / 2 - (room.left + room.right) / 2};
              });
              assert.ok(centre !== undefined && Math.abs(centre.vertical) <= 2 && Math.abs(centre.horizontal) <= 2, `the empty message is centred in ${shape} at ${String(width)}: ${JSON.stringify(centre)}`);
            } else {
              const row = await inbox.locator('[data-paged-key]').first().boundingBox(), card = await inbox.boundingBox();
              assert.ok(row !== null && card !== null && row.height <= listFit.inbox.row && Math.abs(row.y - card.y - listFit.frame / 2 - listFit.inbox.heading) <= 1, `one item sits at the top at its own height in ${shape} at ${String(width)}`);
            }
          }
          await fresh.setViewportSize({width: 1440, height: 1000});await measure(fresh);
          pictures.push(await picture(fresh, 'inbox'));
        }
      }
      await sheet('final5-inbox-one-item-and-empty-1440', pictures);
    } finally {await quietContext.close();await quiet.close();}
  }

  if (part('idle')) {
    // F18: once Home has settled, nothing inside a list card changes while nobody acts, at widths where measured rows
    // used to re-render every frame. home-idle.browser.ts sweeps every 20 px with 0 to 13 Inbox items.
    await save(page, representative);
    const busy: string[] = [];
    for (const width of [1100, 1380, 1520, 1780, 2060, 2560]) {
      await page.setViewportSize({width, height: 1000});await measure(page);await page.waitForTimeout(250);
      // A second window tells a one-off record change (such as session evidence turning stale) from a render loop.
      let changes = await idleChanges(page);if (changes.length > 0) changes = await idleChanges(page);
      if (changes.length > 0) busy.push(`${String(width)}: ${String(changes.length)} changes, first ${changes.slice(0, 3).join(' | ')}`);
    }
    await page.setViewportSize({width: 1440, height: 1000});
    assert.deepEqual(busy, [], 'list cards stay still while nobody acts');
  }

  if (receipts !== undefined && part('shots')) {
    await save(page, [placement(lamps[0] ?? '', 'large-square'), placement(lamps[1] ?? '', 'wide'), placement(lamps[2] ?? '', 'tall'), placement('light:room:studio', 'square')]);
    await shot(page, 'final5-lights-four-shapes-1440');
    // Hub mode in its four shapes, the Inbox's three shapes with a full list, and Agent sessions in its two.
    const hubShots: string[] = [];
    for (const shape of shapes) {await save(page, [placement('hub-mode', shape)]);hubShots.push(await picture(page, 'hub-mode'));}
    await sheet('final5-hub-mode-four-shapes-1440', hubShots);
    const inboxShots: string[] = [];
    for (const shape of ['wide', 'tall', 'large-square'] as const) {await save(page, [placement('inbox', shape)]);await expect(page.locator('[data-home-card="inbox"]')).toHaveAttribute('data-home-shape', shape);inboxShots.push(await picture(page, 'inbox'));}
    await sheet('final5-inbox-three-shapes-full-1440', inboxShots);
    const sessionShots: string[] = [];
    for (const shape of ['tall', 'large-square'] as const) {await save(page, [placement('sessions', shape)]);await expect(page.locator('[data-home-card="sessions"]')).toHaveAttribute('data-home-shape', shape);sessionShots.push(await picture(page, 'sessions'));}
    await sheet('final5-agent-sessions-1440', sessionShots);
    await save(page, representative);
    for (const width of [1100, 1440, 1920]) {await page.setViewportSize({width, height: 1000});await settle(page);await shot(page, `final5-home-${String(width)}`);}
    await page.setViewportSize({width: 375, height: 812});await settle(page);await shot(page, 'final5-home-375');
    await page.setViewportSize({width: 1440, height: 1000});
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();await world.close();
}
void changes;void ({} as Locator);
