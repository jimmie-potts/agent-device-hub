// HTTP-only uncertainty must lock every mounted control for the same target.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
const browser = await chromium.launch({headless: true});
const results: {surface: string; direction: string; passed: boolean; reason?: string}[] = [];
try {
  for (const surface of ['player', 'device']) for (const direction of ['card-to-advanced', 'advanced-to-card']) {
    const world = await startWorld({pixooPages: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
    try {
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const sent = changes(page);
      await page.goto(`${world.url}/${surface === 'player' ? '#/module/pixoo/player' : '#/component/pixoo-1'}`); await feed(page, 'connected');
      const card = page.getByRole('article', {name: 'Pixoo display', exact: true});
      await card.getByRole('tab', {name: 'Display', exact: true}).waitFor();
      await page.getByText(surface === 'player' ? 'Advanced player' : 'Advanced device controls', {exact: true}).click();
      const advanced = surface === 'player' ? page.getByRole('region', {name: 'Pixoo player', exact: true}) : page.locator('[data-device="pixoo-1"]');
      if (direction === 'card-to-advanced') {
        // Give the sibling an older completed attempt before testing a newer HTTP-only unknown.
        if (surface === 'player') {
          await advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('monitor');
          await advanced.getByRole('button', {name: 'Set display mode', exact: true}).click();
          await advanced.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
          await advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('media');
        } else {
          await advanced.getByRole('combobox', {name: 'Device mode', exact: true}).selectOption('monitor');
          await advanced.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
        }
        await page.route('**/api/v2/commands/brightness-set', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"uncertain-result","retryable":false}}'}));
        await card.getByRole('slider').fill('42');
        await card.getByRole('button', {name: 'Apply brightness', exact: true}).click();
        await card.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
      } else {
        await card.getByRole('button', {name: 'Screen on', exact: true}).click();
        await card.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
        await page.route('**/api/v2/commands/device-mode-set', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"uncertain-result","retryable":false}}'}));
        if (surface === 'player') {
          await advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('monitor');
          await advanced.getByRole('button', {name: 'Set display mode', exact: true}).click();
        } else await advanced.getByRole('combobox', {name: 'Device mode', exact: true}).selectOption('monitor');
        await advanced.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
      }
      const retained = await page.evaluate(() => sessionStorage.getItem('bunny-device-attempts'));
      assert.ok(retained !== null && retained.includes(direction === 'card-to-advanced' ? 'brightness-set' : 'device-mode-set'));
      const count = sent.length;
      assert.equal(await card.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true, 'card shares the target lock');
      if (surface === 'player') assert.equal(await advanced.getByRole('button', {name: 'Set display mode', exact: true}).isDisabled(), true, 'advanced player shares the target lock');
      else assert.equal(await advanced.getByRole('combobox', {name: 'Device mode', exact: true}).isDisabled(), true, 'advanced device controls share the target lock');
      // Opening the same target on another surface, then reloading, must retain the unknown identity.
      await page.goto(`${world.url}/${surface === 'player' ? '#/component/pixoo-1' : '#/module/pixoo/player'}`);
      await card.getByRole('button', {name: 'Screen on', exact: true}).waitFor();
      assert.equal(await card.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true);
      await page.reload(); await feed(page, 'connected');
      await card.getByRole('status').filter({hasText: 'Previous request has no confirmed result yet.'}).waitFor();
      assert.equal(await card.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('bunny-device-attempts')), retained);
      assert.equal(sent.length, count, 'navigation and reload neither clear nor replay the unknown request');
      results.push({surface, direction, passed: true});
    } catch (error) { results.push({surface, direction, passed: false, reason: error instanceof Error ? (error.message.split('\n')[0] ?? 'failed') : 'failed'}); }
    finally { await context.close(); await world.close(); }
  }
} finally { await browser.close(); }
process.stdout.write(JSON.stringify(results)+'\n');
assert.equal(results.every(result => result.passed), true);
