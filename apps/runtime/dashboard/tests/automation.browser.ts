// Hub #925: real gateway and module, synthetic hook and Lines; no installed service or physical device.
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {LINES_ADDRESS} from '@jimmie-potts/nanoleaf';
import {chromium, type Browser, type Page} from 'playwright';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, startWorld} from './harness.ts';

const world = await startWorld({nanoleaf: true});
let browser: Browser | undefined;
const waitFor = async (check: () => boolean, label: string, ms = 12_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await pause(20);
  assert.equal(check(), true, label);
};
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => { errors.push(error.error().name); });
    const writes: {method: string; path: string; header: string | undefined}[] = [];
    const watch = (page: Page): void => { page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && path.startsWith('/api/v2/automation/')) writes.push({method: request.method(), path, header: request.headers()['bunny-request']});
    }); };
    let page = await context.newPage(); page.setDefaultTimeout(12_000); watch(page);
    const automation = () => page.getByRole('region', {name: 'Automation', exact: true});
    const loaded = async (): Promise<void> => {
      await feed(page, 'connected'); await automation().getByRole('status').filter({hasText: 'Current rules and settings loaded.'}).waitFor();
    };
    const save = async (name: string): Promise<void> => {
      const reply = page.waitForResponse(response => response.request().method() !== 'GET' && response.url().includes('/api/v2/automation/') && response.status() < 300);
      await automation().getByRole('button', {name, exact: true}).click(); await reply; await loaded();
    };
    await page.goto(`${world.url}/#/automation`); await loaded();
    await automation().getByLabel('wall', {exact: true}).waitFor();
    assert.equal(writes.length, 0, 'opening and reading the page performs no mutation');
    await automation().getByLabel('Rule name', {exact: true}).fill('Turn end Celebrate');
    await automation().getByLabel('wall', {exact: true}).check();
    const create = automation().getByRole('button', {name: 'Create disabled rule', exact: true});
    await create.focus(); assert.equal(await create.evaluate(button => button === document.activeElement), true); await create.press('Enter');
    await automation().getByRole('heading', {name: 'Turn end Celebrate Disabled', exact: true}).waitFor(); await loaded();
    assert.equal(writes.length, 1, 'keyboard creation is one explicit mutation');
    await save('Enable Turn end Celebrate');
    await automation().getByRole('heading', {name: 'Turn end Celebrate Enabled', exact: true}).waitFor();
    await automation().getByLabel('Interrupt kinds', {exact: true}).fill('turn-ended'); await save('Save interrupt set');
    await automation().getByLabel('Per agent task', {exact: true}).fill('2'); await save('Save settings');
    await page.reload(); await loaded(); assert.equal(await automation().getByLabel('Per agent task', {exact: true}).inputValue(), '2');
    const explicit = writes.length;
    await automation().getByLabel('Rule name', {exact: true}).fill('Unsaved draft');
    await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).fill('#112233,');
    world.dropDashboardStreams(); await feed(page, 'connected'); await pause(400);
    assert.equal(await automation().getByLabel('Rule name', {exact: true}).inputValue(), 'Unsaved draft');
    assert.equal(await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).inputValue(), '#112233,');
    assert.equal(writes.length, explicit, 'draft typing and reconnect do not mutate or replay');
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /Home/}).click();
    const mode = page.locator('[data-widget="hub-mode"]');
    await mode.getByRole('button', {name: 'Work', exact: true}).click();
    await mode.getByText('Selection completion: completed.', {exact: true}).waitFor();
    await world.observe(sessionStarted, {title: {value: 'Automation fixture', source: 'provider'}}); await world.observe(turnStarted);
    await world.observe(approvalPrompt('approval-925-browser'));
    await page.locator('[data-widget=attention]').getByText('Waiting for approval', {exact: false}).waitFor();
    assert.equal(world.logs.some(record => record.event_name === 'command.executing' && record.attributes['bunny.operation'] === 'moment-play'), false,
      'the approval has priority; no live turn end has been observed');
    await world.observe(approvalResolved('approval-925-browser'));
    await page.getByText('No attention needed.', {exact: true}).waitFor();
    await mode.getByRole('button', {name: 'Free', exact: true}).click();
    await mode.getByText('Selection completion: completed.', {exact: true}).waitFor();
    await waitFor(() => {
      const device = world.nanoleafState().devices[LINES_ADDRESS];
      return device !== undefined && !device.select.startsWith('*') && device.scenes.includes(device.select);
    }, 'the simulated Lines have a named Free base');
    const base = world.nanoleafState().devices[LINES_ADDRESS]; assert.ok(base);
    const baseline = {name: base.select, brightness: base.brightness, writes: base.writes};
    await page.close(); await world.observe(turnEnded);
    await waitFor(() => world.nanoleafState().devices[LINES_ADDRESS]?.select === '*Dynamic*', 'the moment runs with the page closed');
    await waitFor(() => world.nanoleafState().devices[LINES_ADDRESS]?.select === baseline.name, 'the worker restores the named Free scene');
    const restored = world.nanoleafState().devices[LINES_ADDRESS]; assert.ok(restored);
    const recent = restored.recent.slice(-(restored.writes - baseline.writes));
    const effects = recent.filter(write => write.endpoint === '/effects' && write.animType === 'custom');
    assert.equal(effects.length, 1, 'one actual simulator effect write');
    const restore = recent.find(write => write.endpoint === '/effects' && write.select === baseline.name); assert.ok(restore);
    assert.ok(restore.atMs - (effects[0]?.atMs ?? Infinity) >= 1000, 'the temporary effect lasts the configured second');
    assert.equal(restored.brightness, baseline.brightness);
    page = await context.newPage(); page.setDefaultTimeout(12_000); watch(page); await page.goto(`${world.url}/#/automation`); await loaded();
    await automation().getByRole('listitem').filter({hasText: 'completed · succeeded · transmitted'}).waitFor();
    const log = automation().getByRole('listitem'); assert.equal(await log.count(), 1);
    assert.match(await log.innerText(), /Admission.*accepted/s, 'admission and completion are shown separately');
    await automation().getByRole('button', {name: 'Edit Turn end Celebrate', exact: true}).click();
    // Edit only changes the definition; the already enabled state remains enabled.
    await automation().getByLabel('Rule name', {exact: true}).fill('Edited Celebrate');
    await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).fill('#112233, #445566'); await save('Save rule');
    await automation().getByRole('heading', {name: 'Edited Celebrate Enabled', exact: true}).waitFor();
    await save('Disable Edited Celebrate'); await automation().getByRole('heading', {name: 'Edited Celebrate Disabled', exact: true}).waitFor();
    const violations = (await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(violations.map(item => item.id), []);
    await save('Delete Edited Celebrate'); await automation().getByText('No rules yet. Create a rule, then enable it explicitly.', {exact: true}).waitFor();
    assert.ok(writes.every(write => write.header === '1'), 'every mutation, including DELETE, carries bunny-request:1');
    assert.equal(writes.filter(write => write.method === 'DELETE').length, 1);
    const beforeReadonly = writes.length;
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await loaded(); await automation().getByText('Your session is read-only.', {exact: true}).waitFor();
    for (const button of ['Create disabled rule', 'Save settings', 'Save interrupt set']) assert.equal(await automation().getByRole('button', {name: button, exact: true}).isDisabled(), true);
    assert.equal(writes.length, beforeReadonly); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'automation', checks: ['explicit disabled-create/enable', 'interrupt and settings persisted', 'passive drafts and reconnect',
      'approval resolved before turn end', 'page-closed single effect and restoration', 'separate tracked outcome', 'edit/disable/delete', 'keyboard', 'axe', 'read-only UI interception only'], mutations: writes.length})}\n`);
  } finally { await context.close(); }
} finally { try { await browser?.close(); } finally { await world.close(); } }
