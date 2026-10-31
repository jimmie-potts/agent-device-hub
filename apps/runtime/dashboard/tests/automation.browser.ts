// Hub #925: real gateway and module, synthetic hook and Lines; no installed service or physical device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {LINES_ADDRESS} from '@jimmie-potts/nanoleaf';
import {chromium, type Browser, type Page} from 'playwright';
import {expect} from 'playwright/test';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, startWorld} from './harness.ts';

const world = await startWorld({nanoleaf: true,devices:true});
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
      await feed(page, 'connected'); await automation().getByRole('status').filter({hasText: 'Up to date.'}).waitFor();
    };
    const save = async (name: string): Promise<void> => {
      const reply = page.waitForResponse(response => response.request().method() !== 'GET' && response.url().includes('/api/v2/automation/') && response.status() < 300);
      await automation().getByRole('button', {name, exact: true}).click(); await reply; await loaded();
    };
    await page.goto(`${world.url}/#/automation`); await loaded();
    await expect(automation().getByRole('tablist', {name: 'Automation views'})).toBeVisible();
    await expect(automation().getByRole('tab', {name: 'Routines', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(automation().getByRole('textbox', {name: 'Routine name', exact: true})).toBeHidden();
    await expect(automation().getByRole('textbox', {name: 'Rule name', exact: true})).toBeHidden();
    const tab = (name: string) => automation().getByRole('tab', {name, exact: true});
    await tab('Routines').focus();
    for (const [key, name] of [['End', 'Settings'], ['ArrowRight', 'Routines'], ['ArrowLeft', 'Settings'], ['Home', 'Routines']] as const) {
      await page.keyboard.press(key); await expect(tab(name)).toBeFocused();
      await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect(automation().getByRole('tabpanel')).toHaveCount(1);
    }
    await tab('Rules').click(); await automation().getByRole('button', {name: 'New rule', exact: true}).click();
    await expect(automation().getByLabel('Rule name', {exact: true})).toBeFocused();
    await automation().getByLabel('Rule name', {exact: true}).fill('Discard me');
    await automation().getByRole('button', {name: 'Cancel edit', exact: true}).click();
    await expect(automation().getByRole('button', {name: 'New rule', exact: true})).toBeFocused();
    await expect(automation().getByLabel('Rule name', {exact: true})).toBeHidden();
    await automation().getByRole('button', {name: 'New rule', exact: true}).click();
    await expect(automation().getByLabel('Rule name', {exact: true})).toHaveValue('');
    await automation().getByLabel('wall', {exact: true}).waitFor();
    assert.equal(writes.length, 0, 'opening and reading the page performs no mutation');
    await automation().getByLabel('Rule name', {exact: true}).fill('Turn end Celebrate');
    await automation().getByLabel('wall', {exact: true}).check();
    const create = automation().getByRole('button', {name: 'Create disabled rule', exact: true});
    await create.focus(); assert.equal(await create.evaluate(button => button === document.activeElement), true); await create.press('Enter');
    await automation().getByRole('heading', {name: 'Turn end Celebrate Disabled', exact: true}).waitFor(); await loaded();
    assert.equal(writes.length, 1, 'keyboard creation is one explicit mutation');
    await expect(automation().getByLabel('Rule name', {exact: true})).toBeHidden();
    await expect(automation().getByRole('button', {name: 'New rule', exact: true})).toBeFocused();
    await save('Enable Turn end Celebrate');
    await automation().getByRole('heading', {name: 'Turn end Celebrate Enabled', exact: true}).waitFor();
    await tab('Settings').click();
    await automation().getByLabel('Interrupt kinds', {exact: true}).fill('turn-ended'); await save('Save interrupt set');
    await automation().getByLabel('Per agent task', {exact: true}).fill('2'); await save('Save settings');
    await page.reload(); await loaded(); await tab('Settings').click(); assert.equal(await automation().getByLabel('Per agent task', {exact: true}).inputValue(), '2');
    const explicit = writes.length;
    await tab('Rules').click(); await automation().getByRole('button', {name: 'New rule', exact: true}).click();
    await automation().getByLabel('Rule name', {exact: true}).fill('Unsaved draft');
    await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).fill('#112233,');
    await tab('Settings').click(); await automation().getByLabel('Per agent task', {exact: true}).fill('3');
    await tab('Routines').click(); await automation().getByRole('button', {name: 'New routine', exact: true}).click();
    const draftName = automation().getByLabel('Routine name', {exact: true});
    await expect(draftName).toBeFocused(); await draftName.fill('Routine draft');
    await tab('Rules').click();
    world.dropDashboardStreams(); await feed(page, 'connected'); await pause(400);
    assert.equal(await automation().getByLabel('Rule name', {exact: true}).inputValue(), 'Unsaved draft');
    assert.equal(await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).inputValue(), '#112233,');
    await tab('Settings').click(); await expect(automation().getByLabel('Per agent task', {exact: true})).toHaveValue('3');
    await tab('Routines').click(); await expect(draftName).toHaveValue('Routine draft');
    await automation().getByRole('button', {name: 'Cancel routine edit', exact: true}).click();
    await expect(automation().getByRole('button', {name: 'New routine', exact: true})).toBeFocused();
    await expect(draftName).toBeHidden();
    assert.equal(writes.length, explicit, 'draft typing, tabs, cancel and reconnect do not mutate or replay');
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /Home/}).click();
    const mode = page.locator('[data-widget="hub-mode"]');
    await mode.getByRole('button', {name: 'Work', exact: true}).click();
    await mode.getByText('Selection completed. Device results are separate.', {exact: true}).waitFor();
    await world.observe(sessionStarted, {title: {value: 'Automation fixture', source: 'provider'}}); await world.observe(turnStarted);
    await world.observe(approvalPrompt('approval-925-browser'));
    await page.locator('.agent-status-card[data-attention=true] .chip').waitFor();
    assert.equal(world.logs.some(record => record.event_name === 'command.executing' && record.attributes['bunny.operation'] === 'moment-play'), false,
      'the approval has priority; no live turn end has been observed');
    await world.observe(approvalResolved('approval-925-browser'));
    await page.locator('.agent-status-card[data-attention=false] .chip', {hasText: 'Working'}).waitFor();
    await mode.getByRole('button', {name: 'Free', exact: true}).click();
    await mode.getByText('Selection completed. Device results are separate.', {exact: true}).waitFor();
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
    await automation().getByText('Recent attempts', {exact: true}).click();
    await automation().getByRole('listitem').filter({hasText: 'completed · succeeded · transmitted'}).waitFor();
    const attempts = () => automation().getByRole('article', {name: 'Recent automation attempts', exact: true});
    const log = attempts().getByRole('listitem'); assert.equal(await log.count(), 1);
    assert.match(await log.innerText(), /Admission.*accepted/s, 'admission and completion are shown separately');
    await tab('Rules').click();
    await automation().getByRole('button', {name: 'Edit Turn end Celebrate', exact: true}).click();
    // Edit only changes the definition; the already enabled state remains enabled.
    await automation().getByLabel('Rule name', {exact: true}).fill('Edited Celebrate');
    await automation().getByLabel('Palette (optional, comma-separated #rrggbb)', {exact: true}).fill('#112233, #445566'); await save('Save rule');
    await automation().getByRole('heading', {name: 'Edited Celebrate Enabled', exact: true}).waitFor();
    await save('Disable Edited Celebrate'); await automation().getByRole('heading', {name: 'Edited Celebrate Disabled', exact: true}).waitFor();
    const violations = (await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(violations.map(item => item.id), []);
    await save('Delete Edited Celebrate'); await automation().getByText('No rules yet.', {exact: true}).waitFor();
    assert.ok(writes.every(write => write.header === '1'), 'every mutation, including DELETE, carries bunny-request:1');
    assert.equal(writes.filter(write => write.method === 'DELETE').length, 1);
    const routines = () => automation().getByRole('region', {name: 'Weekly routines', exact: true});
    const step = (position: number) => routines().getByRole('group', {name: `Action ${String(position)}`, exact: true});
    const submit = (name: string) => routines().getByRole('button', {name, exact: true});
    await tab('Routines').click(); await automation().getByRole('button', {name: 'New routine', exact: true}).click();
    const choices = await step(1).getByLabel('Device', {exact: true}).locator('option')
      .evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    // The simulated LIFX `beam` is unqualified and offers no power: every configured device is a target, whatever its capabilities.
    assert.ok(choices.includes('pendant-1') && choices.includes('beam'), `every configured device is a target: ${choices.join()}`);
    const offered = async (target: string): Promise<string[]> => {
      await step(1).getByLabel('Device', {exact: true}).selectOption(target);
      return step(1).getByLabel('Action', {exact: true}).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    };
    assert.equal((await offered('beam')).includes('power-set'), false);
    const firstTarget = 'pendant-1';
    let secondTarget: string | undefined;
    for (const target of choices.filter(value => value !== firstTarget)) if ((await offered(target)).includes('power-set')) { secondTarget = target; break; }
    assert.ok(secondTarget !== undefined, 'a second configured power target is available');
    await step(1).getByLabel('Device', {exact: true}).selectOption('');
    await routines().getByLabel('Routine name', {exact: true}).fill('Weekday desk');
    assert.equal(await submit('Create disabled routine').isDisabled(), true, 'an action without a device is incomplete');
    await routines().getByRole('button', {name: 'Remove action 1', exact: true}).click();
    await routines().getByText('Add at least one action.', {exact: true}).waitFor();
    assert.equal(await submit('Create disabled routine').isDisabled(), true, 'a routine needs an action');
    await routines().getByRole('button', {name: 'Add action', exact: true}).click();
    assert.equal(await submit('Create disabled routine').isDisabled(), true);
    const routine = async (name: string, target: string): Promise<void> => {
      await routines().getByLabel('Routine name', {exact: true}).fill(name); await routines().getByLabel('Time', {exact: true}).fill('00:00');
      await step(1).getByLabel('Device', {exact: true}).selectOption(target);
      assert.equal(await step(1).getByLabel('Action', {exact: true}).inputValue(), 'power-set');
      assert.equal(await step(1).getByLabel('Required mode', {exact: true}).inputValue(), '', 'power has no precondition by default');
      await step(1).getByLabel('Power', {exact: true}).selectOption('on');
      await save('Create disabled routine');
      await routines().getByRole('heading', {name: `${name} Disabled`, exact: true}).waitFor();
    };
    await routine('Weekday desk', firstTarget);
    await expect(automation().getByRole('button', {name: 'New routine', exact: true})).toBeFocused();
    await automation().getByRole('button', {name: 'New routine', exact: true}).click();
    await expect(routines().getByLabel('Routine name', {exact: true})).toHaveValue('');
    await routine('Weekend reading', secondTarget);
    await save('Enable routine Weekday desk');
    await routines().getByRole('heading', {name: 'Weekday desk Enabled', exact: true}).waitFor();
    await routines().getByRole('heading', {name: 'Weekend reading Disabled', exact: true}).waitFor();
    await routines().getByRole('button', {name: 'Edit routine Weekday desk', exact: true}).click();
    await routines().getByRole('heading', {name: 'Edit routine', exact: true}).waitFor();
    await routines().getByLabel('Time', {exact: true}).fill('00:02');
    await routines().getByRole('button', {name: 'Add action', exact: true}).click();
    assert.equal(await submit('Save routine').isDisabled(), true, 'an incomplete second action blocks saving');
    await step(2).getByLabel('Device', {exact: true}).selectOption(firstTarget);
    await step(2).getByLabel('Action', {exact: true}).selectOption('lifx-color-set');
    await step(2).getByLabel('Hue', {exact: true}).fill('120'); await step(2).getByLabel('Saturation', {exact: true}).fill('50');
    await routines().getByRole('button', {name: 'Move action 2 up', exact: true}).click();
    assert.equal(await step(1).getByLabel('Action', {exact: true}).inputValue(), 'lifx-color-set');
    await routines().getByRole('button', {name: 'Move action 1 down', exact: true}).click();
    assert.equal(await step(1).getByLabel('Action', {exact: true}).inputValue(), 'power-set');
    await save('Save routine');
    await routines().getByRole('heading', {name: 'Weekday desk Enabled', exact: true}).waitFor();
    await routines().getByText(/color hue 120 \/ saturation 50$/).waitFor();
    await save('Run now: Weekday desk');
    const ran = attempts().getByRole('listitem').filter({hasText: 'Weekday desk'}).filter({hasText: 'Action 1'}).first();
    await ran.waitFor();
    assert.match(await ran.innerText(), /Action 1 · power-set/);
    assert.match(await ran.innerText(), /Admission\s*accepted/, 'the simulated LIFX admits the routine power action');
    const routineWrites = writes.length;
    world.dropDashboardStreams(); await feed(page, 'connected'); await pause(300);
    assert.equal(writes.length, routineWrites, 'routines are not resent or run after reconnect');
    const labelViolations = (await new AxeBuilder({page}).include('main').withRules(['label-content-name-mismatch']).analyze()).violations;
    assert.deepEqual(labelViolations.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})), []);
    const routineViolations = (await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(routineViolations.map(item => item.id), []);
    await save('Disable routine Weekday desk');
    await page.route('**/api/v2/automation/routines', async route => {
      if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed'); } else await route.continue();
    });
    await automation().getByRole('button', {name: 'New routine', exact: true}).click();
    await routines().getByLabel('Routine name', {exact: true}).fill('Reply lost');
    await step(1).getByLabel('Device', {exact: true}).selectOption(firstTarget);
    const beforeLost = Number(writes.length);
    await submit('Create disabled routine').click();
    await automation().getByRole('alert').filter({hasText: 'The last change has no reliable reply.'}).waitFor();
    await pause(200); assert.equal(writes.length, beforeLost + 1, 'a lost mutation reply is not retried');
    assert.equal(await submit('Create disabled routine').isDisabled(), true);
    await tab('Settings').click();
    await expect(automation().getByRole('alert')).toContainText('The last change has no reliable reply.');
    await expect(automation().getByRole('button', {name: 'Save settings', exact: true})).toBeDisabled();
    await tab('Routines').click(); await expect(routines().getByLabel('Routine name', {exact: true})).toHaveValue('Reply lost');
    await page.unroute('**/api/v2/automation/routines');
    await automation().getByRole('button', {name: 'Refresh rules and logs', exact: true}).click(); await loaded();
    await routines().getByRole('heading', {name: 'Reply lost Disabled', exact: true}).waitFor();
    await automation().getByText('Recent attempts', {exact: true}).click();
    const beforeViews = writes.length;
    const output = process.env.DASHBOARD_RECEIPTS;
    if (output !== undefined) await mkdir(output, {recursive: true});
    for (const theme of ['dark', 'light'] as const) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({colorScheme: theme, reducedMotion: width === 390 ? 'no-preference' : 'reduce'});
      await page.setViewportSize({width, height: 1000});
      for (const name of ['Routines', 'Rules', 'Settings']) {
        await tab(name).click();
        if (output !== undefined) await page.screenshot({path: `${output}/automation-${theme}-${String(width)}-${name.toLowerCase()}-list.png`, fullPage: true});
        if (name !== 'Settings') await automation().getByRole('button', {name: name === 'Routines' ? 'New routine' : 'New rule', exact: true}).click();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const failures = (await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        assert.deepEqual(failures.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})), [], `${theme}/${String(width)}/${name}`);
        if (output !== undefined) await page.screenshot({path: `${output}/automation-${theme}-${String(width)}-${name.toLowerCase()}.png`, fullPage: true});
        if (name !== 'Settings') await automation().getByRole('button', {name: name === 'Routines' ? 'Cancel routine edit' : 'Cancel edit', exact: true}).click();
      }
    }
    assert.equal(writes.length, beforeViews, 'responsive inspection, editors and tabs send no mutation');
    await tab('Routines').click();
    for (const name of ['Weekday desk', 'Weekend reading', 'Reply lost']) await save(`Delete routine ${name}`);
    await routines().getByText('No routines yet.', {exact: true}).waitFor();
    const beforeReadonly = writes.length;
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await loaded(); await automation().getByText('Your session is read-only.', {exact: true}).waitFor();
    await expect(automation().getByRole('button', {name: 'New routine', exact: true})).toBeDisabled();
    await tab('Rules').click(); await expect(automation().getByRole('button', {name: 'New rule', exact: true})).toBeDisabled();
    await tab('Settings').click();
    for (const button of ['Save settings', 'Save interrupt set']) await expect(automation().getByRole('button', {name: button, exact: true})).toBeDisabled();
    assert.equal(writes.length, beforeReadonly); assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'automation', checks: ['explicit disabled-create/enable', 'interrupt and settings persisted', 'passive drafts and reconnect',
      'approval resolved before turn end', 'page-closed single effect and restoration', 'separate tracked outcome', 'edit/disable/delete', 'tab keyboard and focus restoration', 'preserved cross-tab drafts', 'light/dark 320/390/1440px axe and overflow', 'axe', 'read-only UI interception only','independent routines', 'incomplete routine actions', 'ordered action edit', 'run now logged', 'routine reconnect passive', 'lost routine mutation reply', 'routine axe'], mutations: writes.length})}\n`);
  } finally { await context.close(); }
} finally { try { await browser?.close(); } finally { await world.close(); } }
