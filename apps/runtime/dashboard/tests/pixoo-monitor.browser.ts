// Existing Monitor controls through authenticated content and tracked Pixoo commands; synthetic sessions only (Hub #932).
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {sessionStarted, turnStarted, turnEnded} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => { errors.push(error.error().name); });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page), requests = (): number => sent.length;
    await page.goto(`${world.url}/#/module/pixoo/playlists`); await feed(page, 'connected');
    await world.observe(sessionStarted, {title: {value: 'Synthetic monitor task', source: 'provider'}});
    await world.observe(turnStarted); await world.observe(turnEnded);
    await page.getByRole('link', {name: 'Monitor', exact: true}).click();
    await page.getByRole('heading', {name: 'Agent monitor', exact: true, level: 2}).waitFor();
    assert.equal(await page.getByRole('link', {name: 'Edit session labels', exact: true}).getAttribute('href'), '#/sessions');
    await page.getByRole('heading', {name: 'Synthetic monitor task', exact: true, level: 3}).waitFor();
    const readCoarseState = () => page.evaluate(async () => {
      const responses = await Promise.all([fetch('/modules/pixoo/content/monitor'), fetch('/modules/pixoo/content/monitor-sessions')]);
      const values: unknown[] = [];
      for (const response of responses) {
        const text = await response.text();
        if (!response.ok || new TextEncoder().encode(text).byteLength > 256 * 1024) throw new Error('invalid bounded monitor response');
        values.push(JSON.parse(text) as unknown);
      }
      const summary = values[0] as {status: {configuration: {mode: string}; participating: boolean}};
      const sessions = values[1] as {total: number; items: {activity: string; notices: unknown[]}[]};
      return {mode: summary.status.configuration.mode, participating: summary.status.participating, count: sessions.total,
        activity: sessions.items[0]?.activity, notices: sessions.items[0]?.notices.length};
    });
    const beforeTitle = await readCoarseState();
    await world.observe({kind: 'metadata-observed'}, {title: {value: 'Synthetic monitor renamed', source: 'provider'}});
    await page.getByRole('heading', {name: 'Synthetic monitor renamed', exact: true, level: 3}).waitFor();
    assert.equal(await page.getByRole('heading', {name: 'Synthetic monitor task', exact: true, level: 3}).count(), 0, 'title-only owner update refreshes without Refresh');
    assert.deepEqual(await readCoarseState(), beforeTitle, 'title-only update preserves activity, count, mode and notice count');
    assert.equal(requests(), 0, 'opening and cached reads send no command');
    assert.equal(world.pixooState().sent, 0, 'opening does not activate Monitor');
    await page.getByRole('textbox', {name: 'Session search', exact: true}).fill('Synthetic');
    await page.getByRole('spinbutton', {name: 'Monitor cadence', exact: true}).fill('2000');
    assert.equal(requests(), 0, 'drafting filter and cadence sends nothing');
    await page.getByRole('button', {name: 'Apply monitor view', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(requests(), 1); assert.equal(world.pixooState().sent, 0);
    await page.getByRole('button', {name: 'Show monitor', exact: true}).click();
    await page.getByText('Monitor presentation active', {exact: true}).waitFor();
    await page.getByRole('img', {name: 'Exact monitor preview', exact: true}).waitFor();
    for (let attempt = 0; world.pixooState().sent === 0 && attempt < 100; attempt++) await delay(20);
    assert.equal(requests(), 2); assert.ok(world.pixooState().sent > 0);
    await page.getByRole('button', {name: 'Select Media', exact: true}).click();
    await page.getByText('Monitor presentation inactive', {exact: true}).waitFor();
    await page.getByRole('combobox', {name: 'Now playing in Media', exact: true}).selectOption('popup');
    assert.equal(requests(), 3, 'choosing an option is a draft');
    await page.getByRole('button', {name: 'Set now playing', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    await page.getByText(/Media option: popup\./).waitFor();
    assert.equal(requests(), 4);
    const readSessions = () => page.evaluate(async () => {
      const response = await fetch('/modules/pixoo/content/monitor-sessions');
      assertResponse(response);
      return await response.json() as {items: {id: string; notices: {id: string; acknowledgedBy: string[]}[]}[]};
      function assertResponse(response: Response): void { if (!response.ok) throw new Error('monitor read refused'); }
    });
    const prior = (await readSessions()).items[0]; assert.ok(prior); assert.ok(prior.notices[0]);
    await page.getByRole('button', {name: 'Dismiss notice for Synthetic monitor renamed', exact: true}).click();
    await page.getByText('Notice dismissed on Pixoo.', {exact: true}).waitFor();
    const acknowledged = (await readSessions()).items.find(item => item.id === prior.id)?.notices.find(notice => notice.id === prior.notices[0]?.id);
    assert.deepEqual(acknowledged?.acknowledgedBy, ['pixoo'], 'dismissal affects only this consumer');
    assert.equal(requests(), 5);
    await page.reload(); await feed(page, 'connected');
    await page.getByText('Notice dismissed on Pixoo.', {exact: true}).waitFor();
    assert.equal(requests(), 5, 'reload never replays');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await page.getByText('Read-only access.', {exact: true}).waitFor();
    for (const label of ['Show monitor', 'Select Media', 'Apply monitor view', 'Set now playing']) assert.equal(await page.getByRole('button', {name: label, exact: true}).count(), 0);
    assert.equal(requests(), 5); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-monitor', requests: requests(), consumerOnlyDismissal: true, noOpenEffect: true, axe: 'passed'})}\n`);
  } finally { await context.close(); }
} finally { try { await browser?.close(); } finally { await world.close(); } }
