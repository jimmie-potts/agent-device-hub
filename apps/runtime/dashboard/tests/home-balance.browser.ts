// Exercise real Home cards and saved metadata in a disposable synthetic runtime.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect} from 'playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {changes, feed, startWorld} from './harness.ts';
import {approvalPrompt, approvalResolved} from '../../dist/tests/fixtures/agents.js';

const world = await startWorld({lighting: true, wemo: true, roborock: true});
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();page.setDefaultTimeout(12_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  const sent = changes(page), grid = page.locator('.home-layout-grid');
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  const initial = await grid.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const ids = [...new Set(['hub-mode', 'sessions', 'inbox', ...initial])].slice(0, 8);
  assert.equal(ids.length, 8);
  const place = async (desktop: HomePlacement[]): Promise<void> => {
    const phone = [...desktop].reverse();
    assert.equal(await page.evaluate(async ({desktop, phone}) => {
      const response = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
      const data = await response.json() as {records: {'home-layout': HomeLayoutRecord[]}};
      const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');
      const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'}, body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop, phone}}})});
      return saved.status;
    }, {desktop, phone}), 200);
    await expect(grid.locator('[data-home-card]')).toHaveCount(desktop.filter(entry => !entry.hidden).length);
    await expect.poll(() => grid.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard))).toEqual((page.viewportSize()?.width ?? 1440) <= 600 ? phone.filter(entry => !entry.hidden).map(entry => entry.widget) : desktop.filter(entry => !entry.hidden).map(entry => entry.widget));
  };
  const geometry = async () => grid.evaluate(async host => {
    await document.fonts.ready;
    await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});
    const box = host.getBoundingClientRect(), gap = Number.parseFloat(getComputedStyle(host).gap);
    return {left: box.left, right: box.right, gap, overflow: document.documentElement.scrollWidth > innerWidth,
      cards: [...host.children].map(node => {const rect = node.getBoundingClientRect();return {id: (node as HTMLElement).dataset.homeCard, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width};})};
  });
  const balanced = async (): Promise<void> => {
    const value = await geometry();assert.equal(value.overflow, false, 'Home must fit the viewport');
    const rows: typeof value.cards[] = [];
    for (const card of value.cards) {
      const row = rows.at(-1);if (row === undefined || Math.abs((row[0]?.top ?? 0) - card.top) > 1) rows.push([card]);else row.push(card);
    }
    for (const row of rows) {
      assert.ok(Math.abs((row[0]?.left ?? 0) - value.left) <= 1, 'each row starts at the content edge');
      assert.ok(Math.abs((row.at(-1)?.right ?? 0) - value.right) <= 1, 'each row fills available width without an empty trailing slot');
      for (let index = 1; index < row.length; index += 1) assert.ok(Math.abs((row[index]?.left ?? 0) - (row[index - 1]?.right ?? 0) - value.gap) <= 1, 'cards use the shared gap');
    }
  };
  const screenshot = async (name: string): Promise<void> => {
    const dir = process.env.DASHBOARD_RECEIPTS;if (dir === undefined) return;
    await mkdir(dir, {recursive: true});await page.screenshot({path: join(dir, name + '.png'), fullPage: true});
  };
  // The reported three-card shape must share a row at desktop width, rather than leaving one stranded.
  const three = ids.slice(0, 3).map(widget => ({widget, size: 'medium' as const, hidden: false}));
  await place(three);await screenshot('home-three-desktop');
  await balanced();
  const first = await geometry();assert.ok(first.cards.every(card => Math.abs(card.top - (first.cards[0]?.top ?? 0)) <= 1), 'three Standard cards fit together on desktop');
  await world.observe({kind: 'session-started'});await world.observe(approvalPrompt('home-row-attention'));
  const attention = page.locator('.agent-status-card[data-attention=true]');await expect(attention).toBeVisible();
  await screenshot('home-three-attention');
  const clipped = await attention.evaluate(host => {
    const boundary = host.getBoundingClientRect();
    return [...host.querySelectorAll('summary, .chip, .agent-caret')].filter(node => {
      const rect = node.getBoundingClientRect();return rect.width > 0 && rect.height > 0 && (rect.left < boundary.left - 1 || rect.right > boundary.right + 1);
    }).map(node => node.className);
  });
  assert.deepEqual(clipped, [], 'approval text and disclosure controls fit inside the agent tile');
  await world.observe(approvalResolved('home-row-attention'));await expect(attention).toHaveCount(0);
  for (const count of [1, 2, 3, 5, 8]) {
    const placements = ids.slice(0, count).map(widget => ({widget, size: 'medium' as const, hidden: false}));
    await place(placements);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      await expect.poll(() => grid.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard))).toEqual((width <= 600 ? [...placements].reverse() : placements).map(entry => entry.widget));
      await balanced();
    }
    await page.setViewportSize({width: 1440, height: 1000});
  }
  await place(three.map((entry, index) => ({...entry, size: index === 2 ? 'small' : 'medium'})));
  const mixed = await geometry();assert.ok((mixed.cards[0]?.width ?? 0) > (mixed.cards[2]?.width ?? 0), 'Small remains narrower than Standard when they share a row');await balanced();
  await place(three.map((entry, index) => ({...entry, size: index === 1 ? 'large' : 'medium'})));
  const wide = await geometry();assert.ok(Math.abs((wide.cards[1]?.width ?? 0) - (wide.right - wide.left)) <= 1, 'Wide occupies its own full row');await balanced();
  // Hidden entries consume no space; editor-only Phone preview stays one column even on desktop.
  await place([...three, ...ids.slice(3, 5).map(widget => ({widget, size: 'medium' as const, hidden: true}))]);await balanced();
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await page.getByRole('button', {name: 'Phone', exact: true}).click();
  const preview = await geometry();assert.ok(preview.cards.every(card => Math.abs(card.width - (preview.right - preview.left)) <= 1));
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeFocused();await balanced();
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: theme});await page.setViewportSize({width, height: 1000});await balanced();
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();assert.deepEqual(axe.violations.map(item => item.id), []);
    if (width !== 320) await screenshot(`home-three-${theme}-${width}`);
  }
  assert.ok(sent.every(path => path.endsWith('/home-layout-set')), 'fixture setup and layout browsing send no device command');assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'home-balance', counts: [1, 2, 3, 5, 8], widths: [1440, 1024, 768, 390, 320], mixedSizes: true, independentPhoneOrder: true, phonePreview: true, accessibility: 'light/dark', physical: false}));
  await context.close();
} finally {await browser.close();await world.close();}
