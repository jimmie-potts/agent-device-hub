import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import type {Browser, BrowserContext, Locator, Page} from 'playwright';
import {feed, startWorld, type World} from './harness.ts';

async function stableTabs(card: Locator): Promise<void> {
  const art = await card.locator('.companion-art').elementHandle();
  const geometry = () => card.evaluate(node => {
    const illustration = node.querySelector('.companion-art');
    if (illustration === null) throw new Error('Companion illustration is missing');
    const card = node.getBoundingClientRect(), art = illustration.getBoundingClientRect();
    return {width: card.width, height: card.height, art: {x: art.x - card.x, y: art.y - card.y, width: art.width, height: art.height}};
  });
  const before = await geometry();
  for (const tab of await card.getByRole('tab').all()) {
    await tab.focus(); await tab.press('Enter');
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    assert.deepEqual(await geometry(), before, 'tabs keep card dimensions and artwork position');
    assert.equal(await art.evaluate(node => node.isConnected), true, 'artwork remains mounted');
  }
  await art.dispose();
}

export async function companionCardsJourney(world: World, page: Page, context: BrowserContext): Promise<void> {
  await page.goto(`${world.url}/#/module/companions/reachy`); await feed(page, 'connected');
  const reachy = page.locator('.companion-card[data-companion=reachy]');
  await reachy.waitFor({timeout: 5000});
  await reachy.getByRole('tab', {name: 'Controls', exact: true}).click();
  await reachy.getByRole('button', {name: /^(Enable|Disable) Reachy text cards$/}).waitFor();
  await stableTabs(reachy);
  await reachy.getByRole('tab', {name: 'Latest', exact: true}).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await reachy.getByRole('tab', {name: 'Controls', exact: true}).getAttribute('aria-selected'), 'true');
  const enable = reachy.getByRole('button', {name: /^(Enable|Disable) Reachy text cards$/});
  await enable.waitFor(); assert.equal(await enable.isEnabled(), true);

  await page.goto(`${world.url}/#/module/companions/knowledge`); await feed(page, 'connected');
  const knowledge = page.getByRole('region', {name: 'Companion knowledge', exact: true});
  const conversations = knowledge.getByLabel('Conversation', {exact: true});
  await conversations.waitFor();
  for (let index = 0; index < 17; index++) {
    await knowledge.getByRole('button', {name: 'Create synthetic Reachy–Duck exchange', exact: true}).click();
    await page.waitForFunction(count => (document.querySelector<HTMLSelectElement>('#knowledge-conversation')?.options.length ?? 0) >= count, Math.min(index + 2, 17));
  }
  await knowledge.getByRole('button', {name: 'Load more history', exact: true}).click();
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#knowledge-conversation')?.options.length === 18);
  const id = await conversations.locator('option').last().getAttribute('value'); assert.ok(id !== null && id !== '');

  await page.goto(`${world.url}/#/module/companions/microduck`); await feed(page, 'connected');
  const duck = page.getByRole('article', {name: 'MicroDuck latest meaning', exact: true});
  await duck.waitFor(); await stableTabs(duck);
  await duck.getByRole('tab', {name: 'Conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'Choose conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'More conversations', exact: true}).click();
  await duck.getByRole('combobox', {name: 'Conversation', exact: true}).selectOption(id);
  await duck.getByRole('button', {name: 'Use conversation', exact: true}).click();
  await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
  await duck.getByText('Quack: captain of the imaginary pond.', {exact: true}).waitFor();
  await page.reload(); await feed(page, 'connected');
  await duck.getByText('Quack: captain of the imaginary pond.', {exact: true}).waitFor();
  await duck.getByRole('tab', {name: 'Conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'Choose conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'Cancel', exact: true}).click();
  await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
  await duck.getByText('Quack: captain of the imaginary pond.', {exact: true}).waitFor();
  await duck.getByRole('tab', {name: 'Conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'Clear selection', exact: true}).click();
  await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
  await duck.getByText('No conversation selected.', {exact: true}).waitFor();
  await duck.getByRole('tab', {name: 'Conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'Choose conversation', exact: true}).click();
  await duck.getByRole('button', {name: 'More conversations', exact: true}).click();
  await duck.getByRole('combobox', {name: 'Conversation', exact: true}).selectOption(id);
  await duck.getByRole('button', {name: 'Use conversation', exact: true}).click();
  await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
  await duck.getByText('Quack: captain of the imaginary pond.', {exact: true}).waitFor();
  await duck.getByRole('link', {name: 'View conversation', exact: true}).click();
  await page.getByRole('region', {name: 'Duck and Reachy conversation', exact: true}).waitFor();

  await page.goto(`${world.url}/#/`); await feed(page, 'connected');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
  await page.getByRole('button', {name: 'Add card', exact: true}).click();
  await page.getByRole('button', {name: 'Add Reachy', exact: true}).click();
  await page.getByRole('button', {name: 'Add MicroDuck', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  const effects: string[] = [];
  const observe = (request: import('playwright').Request): void => {if (request.method() === 'POST' && /\/commands\/|\/upload\?/.test(request.url())) effects.push(request.url());};
  page.on('request', observe);
  for (const width of [1280, 390, 320]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({width, height: 1000}); await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
    await stableTabs(reachy); await stableTabs(duck);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const axe = await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(value => ({id: value.id, width, colorScheme, nodes: value.nodes.map(node => ({target: node.target, summary: node.failureSummary}))})), []);
    const output = process.env.DASHBOARD_RECEIPTS;
    if (output !== undefined) {
      await mkdir(output, {recursive: true});
      await reachy.getByRole('tab', {name: 'Latest', exact: true}).click(); await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
      await reachy.screenshot({path: `${output}/reachy-${width}-${colorScheme}.png`}); await duck.screenshot({path: `${output}/duck-${width}-${colorScheme}.png`});
    }
  }
  assert.deepEqual(effects, [], 'mounting, browsing and tabs never enable text or speech'); page.off('request', observe);
  await duck.getByRole('tab', {name: 'Meaning', exact: true}).click();
  await context.setOffline(true); world.dropDashboardStreams();
  await duck.getByText('Conversation unavailable.', {exact: true}).waitFor();
  assert.equal(await duck.getByText('Quack: captain of the imaginary pond.', {exact: true}).count(), 0);
  await context.setOffline(false); await page.reload(); await feed(page, 'connected');
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload(); await feed(page, 'connected');
  await reachy.getByRole('tab', {name: 'Controls', exact: true}).click();
  assert.equal(await reachy.getByRole('button', {name: /^(Enable|Disable) Reachy text cards$/}).isDisabled(), true);
  await duck.getByRole('tab', {name: 'Conversation', exact: true}).click();
  assert.equal(await duck.getByRole('button', {name: 'Choose conversation', exact: true}).isDisabled(), true);
}

export async function companionCardsCheck(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  try {const page = await context.newPage(); page.setDefaultTimeout(12_000); await companionCardsJourney(world, page, context);}
  finally {await context.close(); await world.close();}
}
