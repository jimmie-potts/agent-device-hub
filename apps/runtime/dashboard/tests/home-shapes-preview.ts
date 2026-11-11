// Stage A size preview for Home card shapes (#1672) on a disposable synthetic runtime: no installed service or device.
// Writes private PNGs and a metrics JSON to DASHBOARD_RECEIPTS; it asserts only that the page renders without errors.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Page} from 'playwright/test';
import type {HomeLayoutRecord} from '@jimmie-potts/event-contracts/v2/families';
import {feed, startWorld} from './harness.ts';
import {approvalPrompt, IDENTITY} from '../../dist/tests/fixtures/agents.js';

const receipts = process.env.DASHBOARD_RECEIPTS ?? '.local/evidence/gh-1672';
const units = (process.env.HOME_UNITS ?? '180,220,280').split(',').map(Number);
const middle = units[Math.floor(units.length / 2)] ?? 240;
const world = await startWorld({lighting: true, pixooPages: true, tidbyt: true, art: true, inbox: true, wispr: {exposeToDashboard: true}});
const browser = await chromium.launch({headless: true});
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});});
}
type Metric = {id: string; shape: string | null; width: number; height: number; content: number; overflow: boolean};
/** Marks cards whose content is taller than their shape, so the owner can see which shapes do not fit yet. */
async function measure(page: Page): Promise<{columns: string | null; gridWidth: number; cell: number; gap: number; cards: Metric[]}> {
  return page.locator('.home-layout-grid').evaluate(host => {
    const cards = [...host.querySelectorAll<HTMLElement>(':scope > .home-layout-card')].map(card => {
      const content = card.querySelector<HTMLElement>('.home-card-content'), box = card.getBoundingClientRect();
      const inner = content?.firstElementChild as HTMLElement | null, need = Math.max(content?.scrollHeight ?? 0, inner?.scrollHeight ?? 0);
      const overflow = need > box.height + 1;
      card.dataset.previewOverflow = String(overflow);
      // The page's CSP admits no injected stylesheet; a style property set through the DOM is allowed.
      card.style.setProperty('outline', overflow ? '3px dashed #d33' : '');card.style.setProperty('outline-offset', '-3px');
      return {id: card.dataset.homeCard ?? '', shape: card.dataset.homeShape ?? null, width: Math.round(box.width), height: Math.round(box.height), content: need, overflow};
    });
    const style = getComputedStyle(host);
    return {columns: host.dataset.columns ?? null, gridWidth: host.clientWidth, cell: Number.parseFloat(style.gridAutoRows), gap: Number.parseFloat(style.columnGap), cards};
  });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});await settle(page);
  const box = await page.locator('.home-layout').boundingBox();if (box === null) throw new Error('home-box');
  await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true, clip: {x: 0, y: Math.max(0, box.y - 8), width: page.viewportSize()?.width ?? 1440, height: Math.min(box.height + 16, 3_990)}});
}
const shapes: Record<string, string> = {};
try {
  await mkdir(receipts, {recursive: true});
  for (let index = 0; index < 5; index += 1) await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: `shapes-${String(index)}`}, title: {value: `Synthetic agent ${String(index + 1)}`, source: 'provider'}});
  await world.observe(approvalPrompt('shapes-attention'));
  for (let index = 0; index < 13; index += 1) await world.failCommand();
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: 2});
  const page = await context.newPage();page.setDefaultTimeout(20_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  for (const selector of ['.pixoo-card', '.tidbyt-card', '.wispr-card']) await page.locator(selector).first().waitFor();
  const initial = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const pixoo = initial.find(id => id.startsWith('device:bunny/modules/pixoo:')), tidbyt = initial.find(id => id.startsWith('device:bunny/modules/tidbyt:'));
  const lights = initial.filter(id => id.startsWith('light:device:')).slice(0, 2);
  assert.ok(pixoo !== undefined && tidbyt !== undefined && lights.length === 2, `cards: ${initial.join(', ')}`);
  // A representative Home in all four shapes, in saved order.
  const plan: [string, string][] = [['hub-mode', 'wide'], ['inbox', 'tall'], ['sessions', 'large-square'], ['wispr', 'square'], [lights[0] ?? '', 'tall'], [pixoo, 'tall'],
    [lights[1] ?? '', 'square'], ['timeline', 'tall'], [tidbyt, 'square'], ['music-visualizer', 'wide'], ['art', 'large-square']];
  for (const [id, shape] of plan) shapes[id] = shape;
  assert.equal(await page.evaluate(async ({plan}) => {
    const response = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
    const data = await response.json() as {records: {'home-layout': HomeLayoutRecord[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');
    const desktop = plan.map(([widget]) => ({widget, size: 'medium', hidden: false, ...(widget === 'art' ? {art: {format: 'square', pinned: true}} : {})}));
    const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop, phone: desktop}}})});
    return saved.status;
  }, {plan}), 200);
  await page.evaluate(value => {localStorage.setItem('bunny.home-shapes.prototype', JSON.stringify(value));}, shapes);
  const metrics: Record<string, unknown> = {};
  const view = async (name: string, width: number, unit: number): Promise<void> => {
    await page.setViewportSize({width, height: 1000});
    await page.reload();await feed(page, 'connected');
    await page.locator('.home-layout-grid').evaluate((host, value) => {host.style.setProperty('--home-unit', `${String(value)}px`);}, unit);
    // A size change makes the grid measure again and pick up the candidate unit.
    await page.setViewportSize({width: width - 40, height: 1000});await settle(page);await page.setViewportSize({width, height: 1000});await settle(page);
    await expect(page.locator('[data-home-card]')).toHaveCount(plan.length);
    await page.locator('.pixoo-card').first().waitFor();await settle(page);
    metrics[name] = await measure(page);await shot(page, name);
  };
  for (const unit of units) await view(`home-shapes-1440-unit-${String(unit)}`, 1440, unit);
  await view(`home-shapes-1920-unit-${String(middle)}`, 1920, middle);
  await view(`home-shapes-1100-unit-${String(middle)}`, 1100, middle);
  await view(`home-shapes-375-unit-${String(middle)}`, 375, middle);
  // Every card in its smallest offered shape, to show which ones have useful content at one unit.
  await page.evaluate(value => {localStorage.setItem('bunny.home-shapes.prototype', JSON.stringify(value));}, Object.fromEntries(plan.map(([id]) => [id, 'square'])));
  for (const unit of units) await view(`home-shapes-1440-unit-${String(unit)}-all-square`, 1440, unit);
  await writeFile(join(receipts, 'home-shapes-metrics.json'), JSON.stringify(metrics, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([key, value]) => {
    const v = value as {columns: string; gridWidth: number; cell: number; cards: Metric[]};
    return [key, {columns: v.columns, gridWidth: v.gridWidth, cell: v.cell, overflow: v.cards.filter(card => card.overflow).map(card => `${card.id}@${String(card.shape)}:${String(card.content)}>${String(card.height)}`)}];
  })), null, 1));
} finally {
  await browser.close();await world.close();
}
