// The label journey shared by the full browser suite and its focused source check (Hub #1006).
import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import {turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, type World} from './harness.ts';

export async function labelJourney(page: Page, world: World, sent: string[], axe: (page: Page) => Promise<string[]>): Promise<string> {
  const row = (name: string) => page.locator('article.session').filter({has: page.getByRole('heading', {name, exact: true})});
  const chip = (name: string, text: string) => row(name).locator('.chip', {hasText: text}).waitFor();
  // Label controls send one action per explicit attempt; synced records establish the name.
  await world.observe(turnStarted, {turn: 'turn-label'});
  await chip('Port the wall', 'Working');
  const edit = row('Port the wall').getByRole('button', {name: 'Edit label for Port the wall', exact: true});
  await edit.click();
  assert.equal(await page.getByLabel('Session label', {exact: true}).inputValue(), '', 'the provider title is not an explicit label');
  assert.equal(await page.getByLabel('Session label', {exact: true}).evaluate(input => input === document.activeElement), true);
  await page.getByLabel('Session label', {exact: true}).fill('Review label');
  const labelRequests: {requestId: string; data: {expectedRevision: number}}[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v2/commands/session-label-set') labelRequests.push(request.postDataJSON() as {requestId: string; data: {expectedRevision: number}});
  });
  let labelRouteEntered = false;
  let releaseLabelReply = (): void => {};
  const labelReply = new Promise<void>(resolve => { releaseLabelReply = resolve; });
  let labelReplyFinished = (): void => {};
  const finishedLabelReply = new Promise<void>(resolve => { labelReplyFinished = resolve; });
  await page.route('**/api/v2/commands/session-label-set', async route => {
    labelRouteEntered = true;
    try { const response = await route.fetch(); await labelReply; await route.fulfill({response}); }
    finally { labelReplyFinished(); }
  });
  try {
    await page.getByRole('button', {name: 'Save label', exact: true}).click();
    await row('Review label').waitFor();
    assert.match(await row('Review label').getByRole('status').innerText(), /Requested/);
    assert.equal(await page.getByRole('button', {name: 'Save label', exact: true}).isDisabled(), true);
    releaseLabelReply();
    await row('Review label').getByRole('status').filter({hasText: 'Label confirmed by the synced record.'}).waitFor();
  } finally {
    releaseLabelReply(); if (labelRouteEntered) await finishedLabelReply; await page.unroute('**/api/v2/commands/session-label-set');
  }
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  const sentBeforeReload = sent.length;
  await page.reload();
  await feed(page, 'connected');
  await row('Review label').waitFor();
  assert.equal(sent.length, sentBeforeReload, 'reload reads the persisted label without resending');

  await row('Review label').getByRole('button', {name: 'Edit label for Review label', exact: true}).click();
  await page.getByLabel('Session label', {exact: true}).fill('Updated label');
  const beforeConflict = await page.locator('main#main').getAttribute('data-revision');
  await world.observe(turnStarted, {turn: 'turn-label-conflict'});
  await page.waitForFunction(previous => document.getElementById('main')?.dataset.revision !== previous, beforeConflict);
  await page.getByRole('button', {name: 'Save label', exact: true}).click();
  await row('Review label').getByRole('status').filter({hasText: 'Your draft is kept'}).waitFor();
  assert.equal(await page.getByLabel('Session label', {exact: true}).inputValue(), 'Updated label');
  await page.getByRole('button', {name: 'Save label', exact: true}).click();
  await row('Updated label').getByRole('status').filter({hasText: 'Label confirmed by the synced record.'}).waitFor();
  assert.deepEqual(await axe(page), [], 'the open editor passes axe on desktop');
  await page.setViewportSize({width: 390, height: 844});
  assert.deepEqual(await axe(page), [], 'the open editor passes axe on a phone');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width: 1440, height: 900});
  await page.getByRole('button', {name: 'Clear label', exact: true}).click();
  await row('Port the wall').getByRole('status').filter({hasText: 'Label confirmed by the synced record.'}).waitFor();
  await page.getByLabel('Session label', {exact: true}).press('Escape');
  assert.equal(await row('Port the wall').getByRole('button', {name: 'Edit label for Port the wall', exact: true}).evaluate(button => button === document.activeElement), true);
  assert.equal(sent.length, 4, 'set, refused stale attempt, explicit retry and clear each send once');
  assert.equal(new Set(labelRequests.map(request => request.requestId)).size, 4, 'each explicit attempt has a new identity');
  assert.ok((labelRequests[2]?.data.expectedRevision ?? -1) > (labelRequests[1]?.data.expectedRevision ?? -1), 'the retry uses a fresh guard');
  return 'label set/clear, state before reply, persistence, retained conflict draft, explicit retry, keyboard and open-editor axe';
}
