// Idle stability of Home list cards on the unit grid (#1672 F18), on disposable synthetic runtimes: no installed service
// or device. Once Home has settled at a width, nothing inside the Inbox, Agent sessions or Timeline card changes while
// nobody acts: no attribute, child or text change for two seconds. It runs the built-in layout and two mixed layouts
// at every width from 1100 to 2560 px in 20 px steps, with 0, 1, 5, 6 and 13 Inbox items, one synthetic world each.
// HOME_IDLE_STEP and HOME_IDLE_WIDTHS (comma-separated) narrow a local run.
import assert from 'node:assert/strict';
import {chromium, expect, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement, HomeShape} from '@jimmie-potts/event-contracts/v2/families';
import {feed, startWorld, type World} from './harness.ts';
import {idleChanges} from './list-idle.ts';
import {approvalPrompt, IDENTITY} from '../../dist/tests/fixtures/agents.js';

const step = Number(process.env.HOME_IDLE_STEP ?? 20);
const widths = process.env.HOME_IDLE_WIDTHS?.split(',').map(Number) ?? Array.from({length: Math.floor((2560 - 1100) / step) + 1}, (_, index) => 1100 + index * step);
const counts = [0, 1, 5, 6, 13] as const;
const storedSize = {square: 'small', tall: 'small', wide: 'medium', 'large-square': 'medium'} as const;
const placement = (widget: string, shape: HomeShape): HomePlacement => ({widget, size: storedSize[shape], hidden: false, shape});
const layouts: readonly {name: string; desktop?: HomePlacement[]}[] = [
  {name: 'built-in'},
  {name: 'mixed-a', desktop: [placement('hub-mode', 'wide'), placement('inbox', 'tall'), placement('sessions', 'large-square'), placement('timeline', 'tall')]},
  {name: 'mixed-b', desktop: [placement('inbox', 'large-square'), placement('timeline', 'large-square'), placement('sessions', 'tall'), placement('hub-mode', 'square')]},
];

async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.locator('.home-layout-grid').evaluate(host => host.dataset.packed === 'true' && Number(host.dataset.columns) === Math.max(2, Math.floor((host.clientWidth + 16) / 236)))).toBe(true);
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => {requestAnimationFrame(() => {requestAnimationFrame(() => {resolve();});});});});
  await page.waitForTimeout(250);
}
async function save(page: Page, desktop: HomePlacement[]): Promise<void> {
  assert.equal(await page.evaluate(async desktop => {
    const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-record');
    return (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop, phone: desktop}}})})).status;
  }, desktop), 200);
  await expect.poll(() => page.locator('.home-layout-grid > [data-home-card]:not([data-art-placement=automatic])').evaluateAll(nodes => nodes.map(node => `${(node as HTMLElement).dataset.homeCard ?? ''}=${(node as HTMLElement).dataset.homeShape ?? ''}`)))
    .toEqual(desktop.map(entry => `${entry.widget}=${entry.shape ?? ''}`));
}
const browser = await chromium.launch({headless: true});
const worlds: World[] = [];
try {
  const pages: {count: number; page: Page}[] = [];
  for (const count of counts) {
    const world = await startWorld({lighting: true, inbox: true});worlds.push(world);
    for (let index = 0; index < 5; index += 1) await world.observe({kind: 'session-started'}, {identity: {...IDENTITY, sessionId: `idle-${String(index)}`}, title: {value: `Synthetic agent ${String(index + 1)}`, source: 'provider'}});
    await world.observe(approvalPrompt('idle-attention'));
    for (let index = 0; index < count; index += 1) await world.failCommand();
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    const page = await context.newPage();page.setDefaultTimeout(20_000);
    await page.goto(world.url);await feed(page, 'connected');
    await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
    await expect(page.locator('[data-home-card="inbox"] [data-inbox]')).toHaveCount(count);
    pages.push({count, page});
  }
  const busy: string[] = [];
  for (const layout of layouts) {
    if (layout.desktop !== undefined) await Promise.all(pages.map(({page}) => save(page, layout.desktop ?? [])));
    for (const width of widths) {
      const results = await Promise.all(pages.map(async ({count, page}) => {
        await page.setViewportSize({width, height: 1000});await settle(page);
        // A record that changes once on its own (a session's evidence turning stale minutes into the run) is not a
        // render loop; a second idle window at the same width tells them apart, since a loop changes in both.
        const first = await idleChanges(page);
        return {count, changes: first.length === 0 ? first : await idleChanges(page)};
      }));
      for (const {count, changes} of results) if (changes.length > 0) busy.push(`${layout.name} at ${String(width)} with ${String(count)} items: ${String(changes.length)} changes, first ${changes.slice(0, 3).join(' | ')}`);
    }
    console.log(`${layout.name}: ${String(widths.length)} widths checked, ${String(busy.length)} busy so far`);
  }
  if (busy.length > 0) console.log(busy.join('\n'));
  assert.deepEqual(busy, [], 'list cards stay still while nobody acts');
  console.log(`home idle: ${String(layouts.length)} layouts x ${String(widths.length)} widths x ${String(counts.length)} Inbox counts, no change while idle`);
} finally {
  await browser.close();for (const world of worlds) await world.close();
}
