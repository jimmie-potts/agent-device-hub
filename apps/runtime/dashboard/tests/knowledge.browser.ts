import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import type {BrowserContext, Page} from 'playwright';
import type {CompanionArchive, ContextDocument} from '@jimmie-potts/companions';
import {feed, type World} from './harness.ts';
export async function knowledgeJourney(world: World, page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${world.url}/#/module/companions/knowledge`); await feed(page, 'connected');
  const region = page.getByRole('region', {name: 'Companion knowledge', exact: true});
  const title = region.getByRole('textbox', {name: 'Title', exact: true}), text = region.getByRole('textbox', {name: 'Knowledge text', exact: true});
  const add = region.getByRole('button', {name: 'Add knowledge entry', exact: true});
  for (const [name, value] of [['Synthetic Frank', 'SYNTHETIC_KNOWLEDGE_PERSON'], ['Synthetic relationship', 'SYNTHETIC_KNOWLEDGE_RELATIONSHIP'],
    ['Synthetic event', 'SYNTHETIC_KNOWLEDGE_EVENT'], ['Stated routine', 'SYNTHETIC_KNOWLEDGE_ROUTINE']] as const) {
    await title.fill(name); await text.fill(value); await add.focus(); await add.press('Enter');
    await region.getByRole('article', {name, exact: true}).getByText(value, {exact: true}).waitFor();
  }
  const entry = region.getByRole('article', {name: 'Synthetic Frank', exact: true});
  await entry.getByRole('button', {name: 'Stop using', exact: true}).click(); await entry.getByText('Inactive', {exact: true}).waitFor();
  await entry.getByRole('button', {name: 'Edit', exact: true}).click(); await text.fill('SYNTHETIC_KNOWLEDGE_CURRENT');
  await region.getByRole('button', {name: 'Save changes', exact: true}).click(); await entry.getByText('SYNTHETIC_KNOWLEDGE_CURRENT', {exact: true}).waitFor();
  await region.getByRole('button', {name: 'Copy current context', exact: true}).click(); await region.getByText('Copied current companion context.', {exact: true}).waitFor();
  let copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as ContextDocument;
  assert.equal(copied.knowledge.length, 3); assert.equal(copied.preferences.length, 1); assert.equal(copied.messages.length, 0);
  assert.equal(copied.knowledge.some(value => value.text.includes('CURRENT')), false);
  await entry.getByRole('button', {name: 'Reactivate', exact: true}).click(); await entry.getByText('Active', {exact: true}).waitFor();
  for (const id of ['bunny', 'reachy', 'microduck']) {
    await region.getByLabel('Companion', {exact: true}).selectOption(id);
    await region.getByRole('button', {name: 'Preview current context', exact: true}).click();
    await region.getByRole('textbox', {name: 'Current context', exact: true}).waitFor();
    copied = JSON.parse(await region.getByRole('textbox', {name: 'Current context', exact: true}).inputValue()) as ContextDocument;
    assert.equal(copied.persona.id, id); assert.equal(copied.knowledge.length, 4); assert.equal(copied.persona.voiceRef, null);
  }
  await region.getByRole('button', {name: 'Create synthetic Reachy–Duck exchange', exact: true}).click();
  const select = region.getByLabel('Conversation', {exact: true});
  await page.waitForFunction(() => (document.querySelector<HTMLSelectElement>('#knowledge-conversation'))?.options.length === 2);
  const conversationId = await select.locator('option').nth(1).getAttribute('value'); assert.ok(conversationId !== null); await select.selectOption(conversationId);
  const older = region.getByRole('article', {name: 'microduck message 2', exact: true}), latest = region.getByRole('article', {name: 'microduck message 4', exact: true});
  await latest.waitFor(); await older.getByRole('checkbox').check();
  await older.getByRole('button', {name: 'Correct message', exact: true}).click();
  await region.getByRole('textbox', {name: 'Corrected meaning', exact: true}).fill('SYNTHETIC_KNOWLEDGE_CORRECTED');
  await region.getByRole('button', {name: 'Save corrected meaning', exact: true}).click(); await older.getByText('SYNTHETIC_KNOWLEDGE_CORRECTED', {exact: true}).waitFor();
  const download = page.waitForEvent('download'); await region.getByRole('button', {name: 'Export companion archive', exact: true}).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  const exported = JSON.parse(Buffer.concat(chunks).toString()) as CompanionArchive; assert.equal(exported.schema, 'companion-archive/1.0');
  await latest.getByRole('button', {name: 'Remove message', exact: true}).click(); await latest.waitFor({state: 'detached'});
  await world.restart(); await page.reload(); await feed(page, 'connected');
  await region.getByLabel('Companion', {exact: true}).selectOption('microduck'); await select.selectOption(conversationId);
  await older.getByText('SYNTHETIC_KNOWLEDGE_CORRECTED', {exact: true}).waitFor(); assert.equal(await latest.count(), 0);
  await older.getByText('Intended meaning / translation. MicroDuck audio is quacks only.', {exact: true}).waitFor();
  await region.getByLabel('Companion archive file', {exact: true}).setInputFiles({name: 'archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
  await region.getByRole('button', {name: 'Import missing companion records', exact: true}).click();
  await region.getByText('Completed: succeeded.', {exact: false}).waitFor();
  await page.reload(); await feed(page, 'connected');
  await region.getByLabel('Companion', {exact: true}).selectOption('microduck'); await select.selectOption(conversationId);
  await older.waitFor(); assert.equal(await latest.count(), 0);
  await older.getByRole('button', {name: 'Correct message', exact: true}).click(); await region.getByLabel('Meaning type', {exact: true}).selectOption('unknown');
  await region.getByRole('button', {name: 'Save corrected meaning', exact: true}).click(); await older.getByText('Meaning unknown', {exact: true}).waitFor();
  await older.getByRole('checkbox').check(); await region.getByRole('button', {name: 'Copy current context', exact: true}).click();
  await region.getByText('Copied current companion context.', {exact: true}).waitFor();
  copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as ContextDocument;
  assert.deepEqual(copied.messages[0]?.meaning, {kind: 'unknown'}); assert.equal(copied.messages.length, 1);
  const template = exported.messages[0]; assert.ok(template);
  const selectedIds = Array.from({length: 16}, (_, index) => `bounded-${index}-`.padEnd(128, 'x'));
  const expanded = {...exported, messages: [...exported.messages, ...selectedIds.map((messageId, index) => ({...template, messageId,
    ordering: {...template.ordering, sequence: index + 5}}))]};
  await region.getByLabel('Companion archive file', {exact: true}).setInputFiles({name: 'bounded-archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(expanded))});
  await region.getByRole('button', {name: 'Import missing companion records', exact: true}).click();
  await region.getByRole('article', {name: 'reachy message 5', exact: true}).waitFor();
  await region.getByRole('button', {name: 'Load more history', exact: true}).click();
  await region.getByRole('article', {name: 'reachy message 20', exact: true}).waitFor();
  await older.getByRole('checkbox').uncheck();
  for (let index = 0; index < 16; index += 1) await region.getByRole('article', {name: `reachy message ${index + 5}`, exact: true}).getByRole('checkbox').check();
  for (const action of ['Preview current context', 'Copy current context']) {
    await region.getByRole('button', {name: action, exact: true}).click();
    await region.getByRole('textbox', {name: 'Current context', exact: true}).waitFor();
    copied = JSON.parse(await region.getByRole('textbox', {name: 'Current context', exact: true}).inputValue()) as ContextDocument;
    assert.deepEqual(copied.messages.map(value => value.messageId), selectedIds);
    if (action === 'Copy current context') {
      await region.getByText('Copied current companion context.', {exact: true}).waitFor();
      assert.deepEqual((JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as ContextDocument).messages.map(value => value.messageId), selectedIds);
    }
  }
  assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
  await page.setViewportSize({width: 390, height: 844}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const evidence = process.env.BUNNY_KNOWLEDGE_SCREENSHOTS;
  if (evidence !== undefined) await page.screenshot({path: `${evidence}/knowledge-phone.png`, fullPage: true});
  await title.fill('Unsent synthetic'); await text.fill('UNSENT_KNOWLEDGE'); await context.setOffline(true); world.dropDashboardStreams();
  await region.getByText('Disconnected. Saved knowledge may be out of date.', {exact: true}).waitFor();
  assert.equal(await add.isDisabled(), true); assert.equal(await text.inputValue(), 'UNSENT_KNOWLEDGE');
  assert.equal(await region.getByRole('button', {name: 'Copy current context', exact: true}).isDisabled(), true);
  await context.setOffline(false); await page.reload(); await feed(page, 'connected');
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected'); await region.getByText('Read-only access. Controls require operator authority.', {exact: true}).waitFor();
  assert.equal(await add.isDisabled(), true); assert.equal(await region.getByRole('button', {name: 'Create synthetic Reachy–Duck exchange', exact: true}).isDisabled(), true);
  await page.unroute('**/api/v2/authority?scope=control'); await page.reload(); await feed(page, 'connected'); await page.setViewportSize({width: 1280, height: 1000});
  await title.waitFor(); await region.getByText('Knowledge unavailable or loading.', {exact: true}).waitFor({state: 'hidden'});
  if (evidence !== undefined) await page.screenshot({path: `${evidence}/knowledge-desktop.png`, fullPage: true});
  assert.equal(JSON.stringify(world.logs).includes('SYNTHETIC_KNOWLEDGE_'), false);
}
