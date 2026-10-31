// Real core storage and existing reusable cards; synthetic devices only.
import assert from 'node:assert/strict';
import {chromium, expect} from 'playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {changes, feed, startWorld} from './harness.ts';
import {approvalPrompt, approvalResolved} from '../../dist/tests/fixtures/agents.js';

const world = await startWorld({lighting: true, pixooPages: true});
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();page.setDefaultTimeout(12_000);
  const errors: string[] = [];context.on('weberror', error => {errors.push(error.error().message);});
  const sent = changes(page), grid = page.locator('.home-layout-grid');
  const order = async (): Promise<string[]> => grid.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const edit = async (): Promise<void> => {await page.getByRole('button', {name: 'Edit Home', exact: true}).click();};
  const done = async (): Promise<void> => {await page.getByRole('button', {name: 'Done', exact: true}).click();await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeFocused();};
  await page.goto(`${world.url}/#/rooms`);await feed(page, 'connected');
  await page.getByText('Manage rooms', {exact: true}).click();await page.getByLabel('New room name', {exact: true}).fill('Studio');
  await page.getByRole('button', {name: 'Create room', exact: true}).click();await page.getByRole('heading', {name: 'Studio', exact: true}).waitFor();
  await page.getByRole('link', {name: /^Home/}).first().click();await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  sent.length = 0;
  assert.equal(await page.getByText('YOUR SPACE', {exact: true}).count(), 0);assert.equal(await page.getByText('Desktop layout', {exact: true}).count(), 0);
  const original = await order();
  const dragTarget = original[1];assert.ok(dragTarget !== undefined);
  await edit();
  await page.locator('[data-home-move="hub-mode"]').dragTo(page.locator(`[data-home-card="${dragTarget}"]`), {targetPosition: {x: 20, y: 20}});
  await expect(grid.locator('[data-home-card]').nth(1)).toHaveAttribute('data-home-card', 'hub-mode');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();assert.deepEqual(await order(), original);assert.equal(sent.length, 0);
  await edit();await page.getByRole('button', {name: 'Add card', exact: true}).click();await page.getByRole('button', {name: 'Rooms', exact: true}).click();
  await page.getByRole('button', {name: 'Add Studio', exact: true}).click();await page.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Move Studio earlier', exact: true}).click();
  await page.getByRole('button', {name: 'Move Studio; use arrow keys', exact: true}).press('ArrowUp');
  await page.getByRole('combobox', {name: 'Size of Studio', exact: true}).selectOption('large');
  const roomId = (await order()).find(id => id.startsWith('light:room:'));assert.ok(roomId !== undefined && roomId !== '');
  const room = page.locator('[data-home-card]').filter({has: page.getByRole('heading', {name: 'Studio', exact: true})});
  await page.getByRole('button', {name: 'Phone', exact: true}).click();assert.equal((await order()).at(-1), roomId, 'adding appends to independent phone order');
  await page.getByRole('button', {name: 'Desktop', exact: true}).click();
  assert.notEqual((await order()).at(-1), roomId);assert.equal(sent.length, 0, 'all draft edits send nothing');
  const before = await order();await done();assert.equal(sent.length, 1);assert.equal(sent[0]?.endsWith('/home-layout-set'), true);
  await page.reload();await feed(page, 'connected');await expect(room).toBeVisible();assert.deepEqual(await order(), before);
  const secondContext = await browser.newContext({viewport: {width: 390, height: 844}});
  try {
    const second = await secondContext.newPage();await second.goto(world.url);await feed(second, 'connected');
    await second.getByRole('heading', {name: 'Studio', exact: true}).waitFor();
    assert.equal(await second.locator('[data-home-card]').last().getAttribute('data-home-card'), roomId);
  } finally {await secondContext.close();}
  await world.restart();await page.reload();await feed(page, 'connected');await room.waitFor();assert.deepEqual(await order(), before);
  await edit();await page.getByRole('button', {name: 'Remove Hub mode', exact: true}).press('Enter');assert(!(await order()).includes('hub-mode'));
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-home-move], [data-home-add]')), true);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();await expect(page.locator('[data-home-card="hub-mode"]')).toBeVisible();
  assert.equal(sent.length, 1, 'Cancel sends nothing');
  await edit();await page.getByRole('button', {name: 'Hide Agent status', exact: true}).press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-home-move], [data-home-add]')), true);await done();
  assert.equal(await page.locator('[data-home-card="sessions"]').count(), 0);
  await world.observe({kind: 'session-started'});await world.observe(approvalPrompt('layout-attention'));
  await page.locator('[data-home-card="sessions"]').waitFor();
  await edit();assert.equal(await page.getByRole('button', {name: 'Hide Agent status', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();await world.observe(approvalResolved('layout-attention'));
  await expect(page.locator('[data-home-card="sessions"]')).toHaveCount(0);
  await edit();const retained = await order();await page.getByRole('button', {name: 'Reset', exact: true}).click();
  assert.notDeepEqual(await order(), retained);await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.deepEqual(await order(), retained);
  // A second browser's save invalidates the draft without silently replacing it.
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();await other.goto(world.url);await feed(other, 'connected');
    await edit();await other.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await other.getByRole('button', {name: 'Remove Hub mode', exact: true}).click();await other.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(other.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
    await page.getByText('Home changed in another browser.', {exact: false}).waitFor();assert.equal(await page.getByRole('button', {name: 'Done', exact: true}).isDisabled(), true);
    await page.getByRole('button', {name: 'Load saved layout', exact: true}).click();assert(!(await order()).includes('hub-mode'));
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  } finally {await otherContext.close();}
  // Retired definitions are omitted; a missing instance remains an unavailable card.
  const injected = await page.evaluate(async () => {
    const response = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
    const snapshot = await response.json() as {records: {'home-layout': {revision: number; layouts: {desktop: {widget: string; size: string; hidden: boolean}[]; phone: {widget: string; size: string; hidden: boolean}[]}}[]}};
    const record = snapshot.records['home-layout'][0];if (record === undefined) throw new Error('snapshot-missing');
    record.layouts.desktop.push({widget: 'wispr', size: 'medium', hidden: false}, {widget: 'retired-widget', size: 'small', hidden: false}, {widget: 'device:bunny/modules/wemo:missing-plug', size: 'medium', hidden: false});
    const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'}, body: JSON.stringify({target: 'home', requestId: 'unknown-definition-fixture', data: {expectedRevision: record.revision, layouts: record.layouts}})});
    return saved.status;
  });
  assert.equal(injected, 200);await page.getByText('Some saved cards are no longer registered and were omitted. Review the layout before saving.', {exact: true}).waitFor();
  assert.equal(await page.locator('[data-home-card="retired-widget"]').count(), 0);
  await expect(page.locator('[data-home-card="wispr"]')).toContainText('Wispr browser exposure is not available.');
  await page.locator('[data-home-card="device:bunny/modules/wemo:missing-plug"]').getByText('This saved source is unavailable.', {exact: true}).waitFor();
  const injectedCount = sent.length;await page.reload();await feed(page, 'connected');
  await page.getByText('Some saved cards are no longer registered and were omitted. Review the layout before saving.', {exact: true}).waitFor();assert.equal(sent.length, injectedCount, 'reading an unknown definition never repairs the store automatically');
  const faultContext = await browser.newContext();
  try {
    const faultPage = await faultContext.newPage(), faultSends = changes(faultPage);faultPage.setDefaultTimeout(12_000);
    await faultPage.goto(world.url);await feed(faultPage, 'connected');await faultPage.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await faultPage.getByRole('button', {name: 'Reset', exact: true}).click();
    await faultPage.route('**/api/sdk/v1/stream', route => route.abort());
    await faultPage.route('**/api/v2/commands/home-layout-set', async route => {world.dropDashboardStreams();const response = await route.fetch();assert.equal(response.status(), 200);await response.dispose();await route.abort();});
    await faultPage.getByRole('button', {name: 'Done', exact: true}).click();
    await faultPage.locator('.home-layout-feedback').filter({hasText: /Uncertain/}).waitFor();assert.equal(faultSends.length, 1);
    await faultPage.reload();await expect(faultPage.getByRole('button', {name: 'Edit Home', exact: true})).toBeDisabled();assert.equal(faultSends.length, 1);
    await faultPage.unroute('**/api/sdk/v1/stream');await faultPage.reload();await feed(faultPage, 'connected');
    await expect(faultPage.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();assert.equal(faultSends.length, 1, 'reconnect and reload never replay the committed save');
  } finally {await faultContext.close();}
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'});await page.setViewportSize({width, height: 1000});
    await edit();await page.getByRole('button', {name: 'Add card', exact: true}).click();
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();assert.deepEqual(axe.violations.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  }
  // Protected attention can reappear without a saved placement or enabled move handle.
  assert.equal(await page.evaluate(async () => {
    const response = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
    const data = await response.json() as {records: {'home-layout': {revision: number}[]}};
    const record = data.records['home-layout'][0];if (record === undefined) throw new Error('home-focus-snapshot');
    const placements = [{widget: 'hub-mode', size: 'medium', hidden: false}];
    const answer = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'}, body: JSON.stringify({target: 'home', requestId: 'protected-neighbor-fixture', data: {expectedRevision: record.revision, layouts: {desktop: placements, phone: placements}}})});
    return answer.status;
  }), 200);
  await expect(page.locator('[data-home-card="hub-mode"]')).toBeVisible();
  await world.observe(approvalPrompt('layout-forced-focus'));await page.locator('[data-home-card="sessions"]').waitFor();
  await edit();await expect(page.locator('[data-home-move="sessions"]')).toBeDisabled();
  await page.getByRole('button', {name: 'Remove Hub mode', exact: true}).press('Enter');
  await expect(page.getByRole('button', {name: 'Add card', exact: true})).toBeFocused();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await world.observe(approvalResolved('layout-forced-focus'));
  assert.ok(sent.every(path => path.endsWith('/home-layout-set')), 'layout editing sent no device or lighting command');assert.deepEqual(errors, []);
  assert.ok(original.length > 4);console.log(JSON.stringify({journey: 'home-layout', restartAndSecondBrowser: true, independentBreakpoints: true, draftNoEffects: true, attentionProtected: true, conflictGuard: true, unknownDefinitions: true, lostReplyNoReplay: true, accessibility: 'light/dark 1440/390/320', physical: false}));
  await context.close();
} finally {await browser.close();await world.close();}

await import('./home-balance.browser.ts');
