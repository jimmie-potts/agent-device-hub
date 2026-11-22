import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {feed, startWorld} from './harness.ts';

export async function failedTurnJourney(browser: Browser): Promise<void> {
  let calls = 0;
  const world = await startWorld({companions: true, assistantProvider: {name: 'synthetic', model: 'synthetic', turn: () => {
    calls += 1;
    return Promise.resolve(calls === 1
      ? {text: null, calls: [{name: 'ask_owner', id: 'question', input: {text: 'Which synthetic fixture?'}}], stop: 'tool', units: 1}
      : {text: null, calls: [], stop: 'truncated', units: 1});
  }}});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill('Inspect the fixture.');
    await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('The blue fixture.');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    const reply = conversation.getByText(/I received your answer.*model reached its output limit/);
    await reply.waitFor();
    await page.reload();
    await feed(page, 'connected');
    await reply.waitFor();
    assert.equal(await reply.count(), 1);
    assert.equal(calls, 2);
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await failedTurnJourney(browser);} finally {await browser.close();}
}
