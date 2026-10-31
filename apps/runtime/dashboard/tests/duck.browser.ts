import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import type {BrowserContext, Page} from 'playwright';
import {expect} from 'playwright/test';
import type {CompanionArchive} from '@jimmie-potts/companions';
import {feed, type World} from './harness.ts';

export async function duckJourney(world: World, page: Page, context: BrowserContext): Promise<void> {
  await page.goto(`${world.url}/#/module/companions/knowledge`); await feed(page, 'connected');
  const region = page.getByRole('region', {name: 'Companion knowledge', exact: true});
  await region.getByRole('button', {name: 'Create synthetic Reachy–Duck exchange', exact: true}).click();
  const select = region.getByLabel('Conversation', {exact: true});
  await page.waitForFunction(() => (document.querySelector<HTMLSelectElement>('#knowledge-conversation'))?.options.length === 3);
  const conversationId = await select.locator('option').last().getAttribute('value'); assert.ok(conversationId !== null);
  await select.selectOption(conversationId);
  const selected = region.getByRole('group', {name: 'Duck Home widget', exact: true});
  await selected.getByText('No Home conversation selected.', {exact: true}).waitFor();
  const choose = selected.getByRole('button', {name: 'Show selected conversation on Home', exact: true});
  await choose.focus(); await choose.press('Enter');
  await selected.getByText(`Selected conversation: Reachy + MicroDuck · ${conversationId}`, {exact: true}).waitFor();
  await page.goto(`${world.url}/#/`); await feed(page, 'connected');
  const editHome = page.getByRole('button', {name: 'Edit Home', exact: true});
  await editHome.click();
  await page.getByRole('button', {name: 'Add card', exact: true}).click();
  await page.getByRole('button', {name: 'Add MicroDuck', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  // The draft card is visible but inert until the save completes and returns focus.
  await expect(editHome).toBeEnabled();
  await expect(editHome).toBeFocused();
  const widget = page.getByRole('article', {name: 'MicroDuck latest meaning', exact: true});
  const legacy = 'SYNTHETIC_LEGACY_'.repeat(64);
  const text = 'Quack: captain of the imaginary pond.';
  await widget.getByText(text, {exact: true}).waitFor();
  assert.equal(await widget.getByText('I claim the imaginary pond.', {exact: true}).count(), 0);
  await widget.getByText(/Playback unknown/).waitFor();
  const commands: string[] = [];
  const count = (request: import('playwright').Request): void => {if (request.method() === 'POST' && /\/commands\/|\/upload\?/.test(request.url())) commands.push(request.url());};
  page.on('request', count);
  const historyLink = widget.getByRole('link', {name: 'View conversation', exact: true}); await historyLink.focus(); await historyLink.press('Enter');
  const history = page.getByRole('region', {name: 'Duck and Reachy conversation', exact: true});
  await history.getByText('I claim the imaginary pond.', {exact: true}).waitFor();
  await history.getByRole('heading', {name: 'Reachy', exact: true}).first().waitFor();
  assert.equal(page.url().includes(conversationId), false, 'selection and private text stay out of browser location');
  await history.getByRole('link', {name: 'Back to Home', exact: true}).click(); await widget.getByText(text, {exact: true}).waitFor();
  await world.restart(); await page.reload(); await feed(page, 'connected'); await widget.getByText(text, {exact: true}).waitFor();
  assert.deepEqual(commands, [], 'widget, history and restart reads send no command');
  page.off('request', count);
  const editor = await context.newPage();
  try {
    await editor.goto(`${world.url}/#/module/companions/knowledge`); await feed(editor, 'connected');
    const editRegion = editor.getByRole('region', {name: 'Companion knowledge', exact: true});
    await editRegion.getByLabel('Companion', {exact: true}).selectOption('reachy');
    await editRegion.getByLabel('Conversation', {exact: true}).selectOption(conversationId);
    const latest = editRegion.getByRole('article', {name: 'microduck message 4', exact: true}); await latest.waitFor();
    let release = (): void => {}, ready = (): void => {};
    const held = new Promise<void>(resolve => {release = resolve;}), fetched = new Promise<void>(resolve => {ready = resolve;});
    let firstRead = true;
    await page.route('**/modules/companions/content/duck-widget?*', async route => {
      if (!firstRead) {await route.continue(); return;}
      firstRead = false;
      const response = await route.fetch(); ready(); await held;
      await route.fulfill({response});
    });
    await page.reload(); await feed(page, 'connected'); await fetched;
    for (const kind of ['emotion', 'unknown'] as const) {
      await latest.getByRole('button', {name: 'Correct message', exact: true}).click();
      await editRegion.getByLabel('Meaning type', {exact: true}).selectOption(kind);
      if (kind === 'emotion') await editRegion.getByRole('textbox', {name: 'Corrected meaning', exact: true}).fill('Delighted');
      await editRegion.getByRole('button', {name: 'Save corrected meaning', exact: true}).click();
      await widget.getByText(kind === 'emotion' ? 'Delighted' : 'Meaning unknown', {exact: true}).waitFor();
      assert.equal(await widget.getByText(text, {exact: true}).count(), 0);
      if (kind === 'emotion') {
        release(); await page.unrouteAll({behavior: 'wait'});
        await widget.getByText('Delighted', {exact: true}).waitFor();
        assert.equal(await widget.getByText(text, {exact: true}).count(), 0, 'late old read cannot restore corrected text');
      }
    }
    await latest.getByRole('button', {name: 'Remove message', exact: true}).click();
    await widget.getByText('I claim the imaginary pond.', {exact: true}).waitFor();
    assert.equal(await widget.getByText('Meaning unknown', {exact: true}).count(), 0);
    const link = widget.getByRole('link', {name: 'View conversation', exact: true}); await link.focus();
    await editRegion.getByRole('article', {name: 'microduck message 2', exact: true}).getByRole('button', {name: 'Remove message', exact: true}).click();
    await widget.getByText('No remaining Duck message.', {exact: true}).waitFor();
    assert.equal(await link.evaluate(element => element === document.activeElement), true, 'update keeps link focus');
    await editRegion.getByRole('button', {name: 'Clear Home conversation', exact: true}).click();
    await widget.getByText('No conversation selected.', {exact: true}).waitFor();
    await editRegion.getByRole('button', {name: 'Show selected conversation on Home', exact: true}).click();
    await widget.getByText('No remaining Duck message.', {exact: true}).waitFor();
    const download = editor.waitForEvent('download'); await editRegion.getByRole('button', {name: 'Export companion archive', exact: true}).click();
    const stream = await (await download).createReadStream(), chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const archive = JSON.parse(Buffer.concat(chunks).toString()) as CompanionArchive;
    const template = archive.messages.find(message => message.conversationId === conversationId); assert.ok(template !== undefined);
    for (let sequence = 5; sequence <= 28; sequence += 1) {
      const speakerId = sequence % 2 === 0 ? 'reachy' : 'microduck';
      archive.messages.push({...template, messageId: `synthetic-widget-${sequence}`, speakerId, recipientIds: [speakerId === 'reachy' ? 'microduck' : 'reachy'],
        ordering: {...template.ordering, sequence}, meaning: {kind: 'literal', text: `Synthetic widget message ${sequence}`, language: 'en'},
        ...(sequence === 27 ? {createdAtMs: Number.MAX_SAFE_INTEGER} : {}),
        ...(sequence === 28 ? {meaning: {kind: 'unknown' as const}, provenance: {kind: 'legacy' as const, imported: false}, legacyText: legacy} : {}),
        deliveryRefs: sequence === 27 ? ['synthetic-uncertain-output'] : []});
    }
    await editRegion.getByLabel('Companion archive file', {exact: true}).setInputFiles({name: 'widget-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive))});
    await editRegion.getByRole('button', {name: 'Import missing companion records', exact: true}).click();
    await widget.getByText('Synthetic widget message 27', {exact: true}).waitFor();
    assert.equal(await widget.getByText('Synthetic widget message 28', {exact: true}).count(), 0, 'later Reachy reply does not replace Duck');
    await widget.getByText('Playback unknown.', {exact: true}).waitFor();
    await widget.getByText(/Delivery reference recorded/).waitFor();
    await widget.getByText(/Time unavailable/).waitFor();
  } finally {await editor.close();}
  await page.route('**/modules/companions/content/duck-widget?*', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected'); await widget.getByRole('button', {name: 'MicroDuck connection notice', exact: true}).click();
  await widget.getByText('Access denied. Private conversation hidden.', {exact: true}).waitFor();
  assert.equal((await widget.innerText()).includes(conversationId), false);
  await page.unroute('**/modules/companions/content/duck-widget?*');
  await widget.getByRole('button', {name: 'Refresh conversation', exact: true}).click(); await widget.getByText('Synthetic widget message 27', {exact: true}).waitFor();
  await context.setOffline(true); world.dropDashboardStreams();
  const warning = widget.getByRole('button', {name: 'MicroDuck connection notice', exact: true});
  if (await warning.getAttribute('aria-expanded') !== 'true') await warning.click();
  await widget.getByText('Disconnected. Conversation is stale and hidden.', {exact: true}).waitFor();
  assert.equal((await widget.innerText()).includes(conversationId), false);
  assert.equal((await widget.innerText()).includes('Synthetic widget message'), false);
  await context.setOffline(false); await page.reload(); await feed(page, 'connected'); await widget.getByText('Synthetic widget message 27', {exact: true}).waitFor();
  const receipts = process.env.DASHBOARD_RECEIPTS;
  if (receipts !== undefined) await page.screenshot({path: `${receipts}/duck-home.png`, fullPage: true});
  assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await widget.getByRole('link', {name: 'View conversation', exact: true}).click();
  await history.getByRole('heading', {name: 'Reachy', exact: true}).first().waitFor();
  const next = history.getByRole('button', {name: 'Next page', exact: true}); await next.focus();
  const updater = await context.newPage();
  try {
    await updater.goto(`${world.url}/#/module/companions/knowledge`); await feed(updater, 'connected');
    const refreshed = page.waitForResponse(response => response.url().includes('/content/duck-widget?') && response.status() === 200);
    await updater.getByRole('button', {name: 'Create synthetic Reachy–Duck exchange', exact: true}).click(); await refreshed;
    await history.getByRole('heading', {name: 'Reachy', exact: true}).first().waitFor();
    assert.equal(await next.evaluate(element => element === document.activeElement), true, 'history update keeps navigation focus');
  } finally {await updater.close();}
  await next.press('Enter');
  await history.getByText(`Retained legacy text (meaning and audience unqualified): ${legacy}`, {exact: true}).waitFor();
  assert.equal(await history.getByText('Synthetic widget message 5', {exact: true}).count(), 0, 'history page replaces rather than accumulates browser copies');
  if (receipts !== undefined) await page.screenshot({path: `${receipts}/duck-history-phone.png`, fullPage: true});
  assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.setViewportSize({width: 1280, height: 1000});
}
