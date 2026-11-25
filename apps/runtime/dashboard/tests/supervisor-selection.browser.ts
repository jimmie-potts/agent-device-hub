import assert from 'node:assert/strict';
import type {Browser} from 'playwright';
import {feed, startWorld, type WorldOptions} from './harness.ts';

export async function supervisorSelectionJourney(browser: Browser): Promise<void> {
  const seen: string[] = [];
  const provider = (name: 'anthropic' | 'openai', model: string): WorldOptions['assistantProvider'] =>
    ({name, model, turn: input => {
      const owner = input.transcript.find(item => item.role === 'owner');
      seen.push(`${name}:${owner?.text ?? ''}`);
      return Promise.resolve({text: `${name} fixture replied.`, calls: [], stop: 'end', units: 30,
        usage: {input: 20, output: 10, cacheRead: 0, cacheWrite: 0}});
    }});
  const anthropic = provider('anthropic', 'claude-opus-5-5'), openai = provider('openai', 'gpt-6.2-sol');
  assert.ok(anthropic && openai);
  const world = await startWorld({companions: true, assistantProvider: anthropic, assistantAlternateProvider: openai});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const select = conversation.getByRole('combobox', {name: 'Supervisor for new tasks'});
    const composer = conversation.getByRole('textbox', {name: 'Message', exact: true});
    const send = conversation.getByRole('button', {name: 'Send', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await select.selectOption('openai');
    await composer.fill('First synthetic supervisor request');
    await send.click();
    await conversation.getByText('openai fixture replied.', {exact: true}).waitFor();
    await select.selectOption('anthropic');
    await composer.fill('Second synthetic supervisor request');
    await send.click();
    await conversation.getByText('anthropic fixture replied.', {exact: true}).waitFor();
    assert.deepEqual(seen, ['openai:First synthetic supervisor request', 'anthropic:Second synthetic supervisor request']);
    process.stdout.write('Companion supervisor selection passed with both fixture providers.\n');
  } finally {
    await context.close();
    await world.close();
  }
}
