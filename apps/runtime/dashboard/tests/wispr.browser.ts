// Wispr's actual file reader and authenticated dashboard, using explicitly selected synthetic files only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const hidden = await startWorld({wispr: {}});
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const reads: string[] = [];
      page.on('request', request => { if (request.url().includes('/modules/wispr/content/')) reads.push(request.url()); });
      await page.goto(`${hidden.url}/#/home`); await feed(page, 'connected');
      assert.equal(await page.locator('[data-widget="wispr-summary"]').count(), 0);
      assert.equal(await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: 'Wispr', exact: true}).count(), 0);
      await page.goto(`${hidden.url}/#/module/wispr/analytics`);
      await page.getByRole('heading', {name: 'Nothing at this address'}).waitFor();
      assert.deepEqual(reads, [], 'disabled browser exposure never starts analytics reads');
      const status = await page.evaluate(async () => (await fetch('/modules/wispr/content/status')).status);
      assert.equal(status, 403, 'an authenticated browser cannot bypass exposure');
      const machine = await hidden.readonlyWispr('summary');
      assert.equal(machine.status, 200, 'a read-scoped machine needs no source-specific grant');
      assert.equal((JSON.parse(machine.text) as {data: {totals: {words: number}}}).data.totals.words, 120);
    } finally { await context.close(); }
  } finally { await hidden.close(); }

  const world = await startWorld({wispr: {exposeToDashboard: true, shareTextAggregates: true}});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    try {
      const errors: string[] = []; context.on('weberror', error => { errors.push(error.error().name); });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const sent = changes(page);
      await page.goto(`${world.url}/#/home`); await feed(page, 'connected');
      const widget = page.locator('[data-widget="wispr-summary"]');
      await widget.getByText('120', {exact: true}).first().waitFor();
      assert.equal(await widget.getByText('=SUM(1,2)', {exact: true}).count(), 0, 'home remains numeric');
      assert.deepEqual(sent, []);
      await widget.getByRole('link', {name: 'Open Wispr'}).click();
      const analytics = page.getByRole('region', {name: 'Wispr analytics', exact: true});
      await analytics.getByRole('heading', {name: 'Overview', exact: true}).waitFor();
      await analytics.getByRole('combobox', {name: 'Period', exact: true}).selectOption('today');
      await analytics.getByRole('combobox', {name: 'Text stage', exact: true}).selectOption('cleaned');
      await analytics.getByRole('combobox', {name: 'Word list', exact: true}).selectOption('all');
      await analytics.getByRole('cell', {name: '=SUM(1,2)', exact: true}).waitFor();
      await analytics.getByRole('combobox', {name: 'App', exact: true}).selectOption('chatgpt');
      await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
      await widget.getByText('120', {exact: true}).first().waitFor();
      await widget.getByRole('link', {name: 'Open Wispr'}).click();
      assert.equal(await analytics.getByRole('combobox', {name: 'Period', exact: true}).inputValue(), 'today');
      assert.equal(await analytics.getByRole('combobox', {name: 'App', exact: true}).inputValue(), 'chatgpt');
      await analytics.getByRole('combobox', {name: 'App', exact: true}).selectOption('all');
      const refresh = analytics.getByRole('button', {name: 'Refresh Wispr', exact: true});
      await refresh.focus(); await refresh.press('Enter');
      await analytics.getByRole('heading', {name: 'Overview', exact: true}).waitFor();
      for (const format of ['CSV', 'JSON'] as const) {
        const waiting = page.waitForEvent('download');
        await analytics.getByRole('button', {name: `Download numeric ${format}`}).click();
        const download = await waiting; const path = await download.path(); assert.ok(path !== null);
        const text = await readFile(path, 'utf8'); assert.match(text, /120/); assert.equal(text.includes('=SUM(1,2)'), false);
        assert.equal(text.includes(world.stateDir), false);
        if (format === 'JSON') assert.equal((JSON.parse(text) as {schema: string}).schema, 'wispr-analytics/2.0');
      }
      await analytics.getByRole('combobox', {name: 'Text stage', exact: true}).selectOption('cleaned');
      await analytics.getByRole('combobox', {name: 'Word list', exact: true}).selectOption('all');
      await analytics.getByRole('cell', {name: '=SUM(1,2)', exact: true}).waitFor();
      world.wisprPrivacy(true, false);
      await refresh.click();
      await analytics.getByText('Language collection or sharing is off.', {exact: true}).first().waitFor();
      assert.equal(await analytics.getByRole('cell', {name: '=SUM(1,2)', exact: true}).count(), 0);
      assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
      world.wisprPrivacy(false, false);
      await refresh.click(); await analytics.getByRole('status').filter({hasText: '(forbidden)'}).waitFor();
      assert.equal(await analytics.getByRole('heading', {name: 'Overview', exact: true}).count(), 0, 'refused exposure clears the retained numeric view');
      await page.reload(); await feed(page, 'connected');
      await page.getByRole('heading', {name: 'Nothing at this address'}).waitFor();
      assert.equal((await world.readonlyWispr('summary')).status, 200, 'browser opt-out preserves machine read access');
      assert.deepEqual(sent, []); assert.deepEqual(errors, []);
      process.stdout.write(`${JSON.stringify({passed: true, journey: 'wispr', source: 'synthetic selected files', machineReadWithoutExtraGrant: true,
        browserExposure: true, numericWidget: true, filtersSurviveNavigation: true, numericDownloads: ['CSV', 'JSON'], textRetiredOnOptOut: true,
        inspectionCommands: 0, keyboard: true, axe: 'passed'})}\n`);
    } finally { await context.close(); }
  } finally { await world.close(); }
} finally { await browser?.close(); }
