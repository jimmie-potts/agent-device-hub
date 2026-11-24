// Recent conversation context and New conversation (Hub #2029), on the built runtime with the real companions module and
// a scripted provider that says how many earlier messages its context held. A follow-up's context holds the earlier
// exchange; New conversation is disabled while a task waits on the owner, then starts an empty conversation whose next
// call holds none; the earlier conversation stays readable from Details, read only; and the Knowledge page's model
// context preview shows the builder's sections. Desktop and phone widths, no horizontal page scroll. No device is
// contacted and no paid call is made.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Page} from 'playwright';
import {feed, startWorld} from './harness.ts';

type Section = {name: string; state: string; included: number; text: string | null};
const recentOf = (input: {context: {sections: readonly Section[]}}): Section | undefined => input.context.sections.find(section => section.name === 'recent');

export async function conversationContextJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, assistantProvider: {name: 'synthetic', model: 'synthetic', turn: input => {
    const owner = input.transcript.find(item => item.role === 'owner');
    const answered = input.transcript.some(item => item.role === 'tool');
    if (owner?.role === 'owner' && owner.text.includes('ASK') && !answered) {
      return Promise.resolve({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text: 'Which synthetic detail?'}}], stop: 'tool', units: 1});
    }
    const recent = recentOf(input);
    return Promise.resolve({text: `Synthetic reply. Earlier messages in context: ${String(recent?.included ?? 0)}.`, calls: [], stop: 'end', units: 1});
  }}});
  const output = process.env.DASHBOARD_RECEIPTS;
  if (output !== undefined) await mkdir(output, {recursive: true});
  const shot = async (page: Page, name: string): Promise<void> => {if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: false});};
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors: string[] = [];
  context.on('weberror', error => {errors.push(error.error().name);});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const message = conversation.getByRole('textbox', {name: 'Message', exact: true});
    const send = async (text: string, reply: string): Promise<void> => {
      await message.fill(text);
      await conversation.getByRole('button', {name: 'Send', exact: true}).click();
      await conversation.getByText(reply, {exact: true}).last().waitFor();
    };
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await send('Synthetic first topic', 'Synthetic reply. Earlier messages in context: 0.');
    // The follow-up's context holds the first exchange: the owner's message and the reply.
    await send('Synthetic follow-up', 'Synthetic reply. Earlier messages in context: 2.');
    // While a task waits on the owner, New conversation is disabled and says why.
    const fresh = conversation.getByRole('button', {name: 'New conversation', exact: true});
    await message.fill('ASK a synthetic question');
    await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    assert.equal(await fresh.isDisabled(), true);
    const held = conversation.getByText('Finish or cancel this conversation\'s task first.', {exact: true});
    await held.waitFor();
    assert.equal(await fresh.getAttribute('aria-describedby'), await held.getAttribute('id'));
    await shot(page, 'new-conversation-held');
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('The synthetic detail.');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await conversation.getByText('Synthetic reply. Earlier messages in context: 4.', {exact: true}).waitFor();
    // New conversation starts empty, and its first call's context holds no earlier message.
    await fresh.click();
    await conversation.getByRole('heading', {name: 'What’s on your mind?', exact: true}).waitFor();
    assert.equal(await conversation.getByText('Synthetic first topic', {exact: true}).count(), 0);
    await send('Synthetic fresh topic', 'Synthetic reply. Earlier messages in context: 0.');
    await shot(page, 'new-conversation-fresh');
    // The earlier conversation stays readable from Details, read only.
    await conversation.getByRole('button', {name: 'Details', exact: true}).click();
    const details = page.getByRole('dialog', {name: 'Conversation details'});
    await details.getByText('Conversations', {exact: true}).click();
    const list = details.getByRole('list', {name: 'B.U.N.N.Y. conversations', exact: true});
    await list.getByRole('listitem').nth(1).waitFor();
    assert.equal(await list.getByRole('listitem').count(), 2);
    await list.getByRole('listitem').first().getByText('Shown now', {exact: true}).waitFor();
    await shot(page, 'conversation-list');
    await list.getByRole('listitem').nth(1).getByRole('button', {name: 'Open', exact: true}).click();
    await conversation.getByText('Synthetic first topic', {exact: true}).waitFor();
    await conversation.getByText(/Earlier conversation, read only\./).waitFor();
    assert.equal(await message.count(), 0, 'an earlier conversation has no composer');
    assert.equal(await fresh.isDisabled(), true);
    await conversation.getByRole('button', {name: 'Close details', exact: true}).click().catch(() => undefined);
    await shot(page, 'earlier-conversation');
    await conversation.getByRole('button', {name: 'Back to current conversation', exact: true}).click();
    await conversation.getByText('Synthetic fresh topic', {exact: true}).waitFor();
    assert.equal(await conversation.getByText('Synthetic first topic', {exact: true}).count(), 0);
    // Phone width: the header keeps New conversation and Details without horizontal page scroll.
    await page.setViewportSize({width: 390, height: 844});
    await fresh.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll');
    const header = await conversation.locator('.conversation-header').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return [...node.querySelectorAll('button')].every(button => {const box = button.getBoundingClientRect(); return box.left >= rect.left - 1 && box.right <= rect.right + 1;});
    });
    assert.equal(header, true, 'the header buttons stay inside it');
    await shot(page, 'new-conversation-phone');
    await page.setViewportSize({width: 1280, height: 900});
    // The Knowledge page's model context preview shows the builder's sections for the current conversation.
    await page.goto(`${world.url}/#/module/companions/knowledge`);
    await feed(page, 'connected');
    const knowledge = page.getByRole('region', {name: 'Companion knowledge', exact: true});
    await knowledge.getByRole('button', {name: 'Preview model context', exact: true}).click();
    const sections = knowledge.getByRole('list', {name: 'Context sections', exact: true});
    await sections.waitFor();
    assert.deepEqual(await sections.getByRole('heading').allTextContents(), ['Personality', 'Knowledge notes', 'Active preferences', 'Long-term memory', 'Recent conversation']);
    await sections.getByText('Off for this companion. 0 of 32,768 bytes.', {exact: true}).waitFor();
    await sections.getByText(/^2 sent\. /).waitFor();
    await sections.getByText(/Synthetic fresh topic/).waitFor();
    assert.equal(await sections.getByText(/Synthetic first topic/).count(), 0, 'the earlier conversation stays out of the context');
    // The switch shows the saved setting, so it turns on once the command is saved and the page reads it back.
    const notes = knowledge.getByRole('checkbox', {name: 'Send active knowledge notes to B.U.N.N.Y.\'s model', exact: true});
    await notes.click();
    await notes.and(page.locator(':checked')).waitFor();
    await knowledge.getByRole('button', {name: 'Preview model context', exact: true}).click();
    await sections.getByText('Nothing to send. 0 of 32,768 bytes.', {exact: true}).waitFor();
    await knowledge.getByRole('region', {name: 'Model context', exact: true}).scrollIntoViewIfNeeded();
    await shot(page, 'model-context-preview');
    assert.deepEqual(errors, []);
    assert.equal(JSON.stringify(world.logs).includes('Synthetic first topic'), false, 'no message text reaches the logs');
    process.stdout.write('Conversation context: follow-up context, New conversation held while a task waits, a fresh empty conversation, the earlier one read only from Details, phone header and the model context preview passed.\n');
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationContextJourney(browser);} finally {await browser.close();}
}
