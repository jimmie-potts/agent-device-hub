// The real core and existing device modules over synthetic transports; no installed or physical evidence.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {AxeBuilder} from '@axe-core/playwright';
import type {Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

export async function checkModeOverrides(browser: Browser, evidence?: string): Promise<void> {
  const world = await startWorld({nanoleaf: true, pixooPages: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
    const sent = changes(page), commands = (): number => sent.filter(path => path.startsWith('/api/v2/commands/')).length;
    await page.goto(world.url); await feed(page, 'connected');
    const read = async <T,>(family: string): Promise<T[]> => {
      const response = await page.request.get(`${world.url}/api/v2/families/${family}`); assert.equal(response.status(), 200);
      return (await response.json() as {records: T[]}).records;
    };
    const mode = async (): Promise<ModeState> => {const state = (await read<ModeState>('mode'))[0]; assert.ok(state); return state;};
    const settled = async (count: number): Promise<void> => {
      for (let i = 0; i < 200; i++) {
        const records = (await read<OperationRecord>('operation')).filter(item => item.family === 'device-mode-set' && item.requestedBy === 'bunny/core');
        if (records.length === count && records.every(item => item.status === 'completed' && item.result === 'succeeded')) return;
        await page.waitForTimeout(30);
      }
      assert.fail(`expected ${count} completed native requests`);
    };
    const hub = page.locator('[data-widget="hub-mode"]');
    const wall = page.locator('[data-light-card="wall"]');
    const pixoo = page.getByRole('article', {name: 'Pixoo display', exact: true});
    const wallChoice = wall.locator('[data-mode-target="wall"]');
    const pixooChoice = pixoo.locator('[data-mode-target="pixoo-1"]');
    await wallChoice.getByText('Following Hub Free', {exact: true}).waitFor();
    await pixooChoice.getByText('Following Hub Free', {exact: true}).waitFor();
    const artwork = await wall.locator('[data-light-artwork]').elementHandle();
    await hub.getByRole('button', {name: 'Work', exact: true}).click(); await settled(2);
    await wallChoice.getByText('Following Hub Work', {exact: true}).waitFor();
    await wallChoice.getByRole('button', {name: 'Free', exact: true}).focus(); await page.keyboard.press('Enter'); await settled(3);
    await wallChoice.getByText('Free · individual exception', {exact: true}).waitFor();
    await pixooChoice.getByText('Following Hub Work', {exact: true}).waitFor();
    assert.notEqual(artwork, null); assert.equal(await wall.locator('[data-light-artwork]').evaluate((node, previous) => node === previous, artwork), true, 'mode choices retain the existing artwork node');
    const details = hub.locator('details.hub-mode-exceptions');
    await details.getByText('1 exception', {exact: true}).waitFor(); assert.equal(await details.getAttribute('open'), null);
    const beforeInspect = commands(); await details.locator('summary').focus(); await page.keyboard.press('Enter');
    await details.getByText('Free · saved exception', {exact: true}).waitFor();
    assert.equal(commands(), beforeInspect, 'expansion sends nothing');
    assert.equal(await hub.getByRole('button', {name: 'Check Inbox', exact: true}).count(), 0, 'a saved exception is not a failure');
    await details.getByRole('link').click();
    await page.locator('[data-mode-target="wall"]').getByText('Free · individual exception', {exact: true}).waitFor();
    assert.equal(commands(), beforeInspect, 'device navigation sends nothing');
    await page.getByRole('link', {name: /^Home/}).click();
    // Work and Quiet both map to Monitor on Pixoo; only this explicit choice records Quiet.
    await pixooChoice.getByRole('button', {name: 'Quiet', exact: true}).click(); await settled(4);
    assert.deepEqual((await mode()).overrides?.map(item => [item.target, item.mode]), [['wall', 'free'], ['pixoo-1', 'quiet']]);
    // The existing native control remains independent and cannot manufacture or clear saved intent.
    await pixoo.getByRole('button', {name: 'Select Media', exact: true}).click();
    await pixoo.getByRole('button', {name: 'Show monitor', exact: true}).waitFor();
    assert.equal((await mode()).overrides?.find(item => item.target === 'pixoo-1')?.mode, 'quiet');
    await wallChoice.getByRole('button', {name: 'Work', exact: true}).click(); await settled(5);
    assert.deepEqual((await mode()).overrides?.map(item => item.target), ['pixoo-1']);
    await page.route('**/api/v2/commands/mode-override-set', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await wallChoice.getByRole('button', {name: 'Quiet', exact: true}).click(); await settled(6);
    const beforeReload = commands();
    world.dropDashboardStreams(); await feed(page, 'connected'); await page.reload(); await feed(page, 'connected');
    await wallChoice.getByText('Quiet · individual exception', {exact: true}).waitFor(); assert.equal(commands(), beforeReload);
    await world.restart(); await page.reload(); await feed(page, 'connected'); await settled(6);
    await wallChoice.getByText('Quiet · individual exception', {exact: true}).waitFor(); assert.equal(commands(), beforeReload, 'restart/read never replay');
    for (const width of [1440, 390, 320]) for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({width, height: 1000}); await page.emulateMedia({colorScheme});
      await details.locator('summary').click();
      const violations = (await new AxeBuilder({page}).include('[data-widget="hub-mode"]').include('[data-light-card="wall"]').include('.pixoo-card').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(violations.map(item => item.id), []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (evidence !== undefined) {await mkdir(evidence, {recursive: true}); await page.screenshot({path: join(evidence, `mode-overrides-${width}-${colorScheme}.png`), fullPage: true});}
    }
    await hub.getByRole('button', {name: 'Work', exact: true}).click(); await settled(8);
    assert.deepEqual((await mode()).overrides, []); await details.waitFor({state: 'detached'});
    const beforeReadonly = commands();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.reload(); await feed(page, 'connected'); await hub.getByText('Read only', {exact: true}).waitFor();
    assert.equal(await wallChoice.getByRole('button').count(), 0); assert.equal(await pixooChoice.getByRole('button').count(), 0);
    assert.equal(commands(), beforeReadonly); assert.deepEqual(errors, []);
    process.stdout.write(JSON.stringify({passed: true, journey: 'existing cards and individual mode exceptions', checks: ['keyboard selection', 'isolated targets', 'passive collapsed summary and navigation', 'Pixoo explicit Quiet', 'native controls independent', 'individual/global reset', 'lost reply and restart without replay', 'read-only', 'desktop/phone light/dark axe']})+'\n');
  } finally {await context.close(); await world.close();}
}
