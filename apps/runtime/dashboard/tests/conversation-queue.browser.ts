// The conversation message queue (Hub #2030), on the built runtime with the real companions module and a gated scripted
// provider whose calls wait until the journey answers them. While a task works, Queue saves messages above the
// composer; the owner edits, moves and withdraws them; each starts as a new turn when the task before it ends; Stop
// holds the queue until Resume queue; and after a restart a waiting queue stays held until Start. Desktop and phone
// widths, no horizontal page scroll. No device is contacted and no paid call is made.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Locator, type Page} from 'playwright';
import {feed, startWorld, type WorldOptions} from './harness.ts';

type Provider = NonNullable<WorldOptions['assistantProvider']>;
type Reply = Awaited<ReturnType<Provider['turn']>>;
type Waiting = {text: string; resolve: (reply: Reply) => void};

export async function conversationQueueJourney(browser: Browser): Promise<void> {
  // Each call waits for the journey; a message that says ASK asks one question first.
  const waiting: Waiting[] = [];
  let arrived: (() => void) | undefined;
  const provider: Provider = {name: 'synthetic', model: 'synthetic', turn: input => {
    const owner = input.transcript[0], text = owner?.role === 'owner' ? owner.text : '';
    if (text.includes('ASK') && !input.transcript.some(item => item.role === 'tool')) {
      return Promise.resolve({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text: 'Which synthetic detail?'}}], stop: 'tool', units: 1});
    }
    if (text.includes('PROPOSE') && !input.transcript.some(item => item.role === 'tool')) {
      return Promise.resolve({text: null, calls: [{id: 'call-art', name: 'create_artwork', input: {format: 'still', showTargets: [], description: 'Blue synthetic fixture'}}], stop: 'tool', units: 1});
    }
    return new Promise<Reply>(resolve => {waiting.push({text, resolve}); arrived?.();});
  }};
  const world = await startWorld({companions: true, assistantProvider: provider, assistantCatalog: ['create_artwork']});
  /** Answers the model call that waits, once it arrives, after checking which message it is for. */
  const answer = async (expected: string): Promise<void> => {
    if (waiting.length === 0) {
      let bound: NodeJS.Timeout | undefined;
      await Promise.race([new Promise<void>(resolve => {arrived = resolve;}),
        new Promise<never>((_resolve, reject) => {bound = setTimeout(() => {reject(new Error(`no model call arrived for ${expected}`));}, 12_000);})]).finally(() => {clearTimeout(bound);});
    }
    arrived = undefined;
    const call = waiting.shift() ?? assert.fail(`no model call waits for ${expected}`);
    assert.equal(call.text, expected, 'the call that waits is the expected message');
    call.resolve({text: `Synthetic reply to: ${call.text}`, calls: [], stop: 'end', units: 1});
  };
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
    const send = conversation.getByRole('button', {name: 'Send', exact: true}), queueButton = conversation.getByRole('button', {name: 'Queue', exact: true});
    const queued = conversation.getByRole('region', {name: 'Queued messages', exact: true});
    const items = queued.getByRole('listitem');
    const texts = async (): Promise<string[]> => (await queued.locator('.conversation-queue-text').allTextContents()).map(text => text.replace(/^Queued message \d+: /, ''));
    const queue = async (text: string, count: number): Promise<void> => {
      await message.fill(text);
      await queueButton.click();
      await items.nth(count - 1).waitFor();
      await page.waitForFunction(value => document.querySelector<HTMLTextAreaElement>('#assistant-input')?.value === value, '');
    };
    const transcript = (text: string): Locator => conversation.getByText(text, {exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    // No task runs: Send alone shows.
    await send.waitFor();
    assert.equal(await queueButton.count(), 0, 'with nothing to wait behind, Queue does not show');
    await message.fill('Synthetic first task');
    await send.click();
    await conversation.getByText('Working', {exact: true}).waitFor();
    // The composer stays available while the task works: Send steers it (Hub #2031), Queue saves the message for after it.
    await queueButton.waitFor();
    assert.equal(await send.isDisabled(), true, 'nothing to send yet');
    assert.equal(await message.isDisabled(), false);
    await queue('Synthetic queued one', 1);
    await queue('Synthetic queued two', 2);
    // Enter sends a steer while the task works (Hub #2031), so this message is queued with Queue.
    await queue('Synthetic queued three', 3);
    assert.deepEqual(await texts(), ['Synthetic queued one', 'Synthetic queued two', 'Synthetic queued three']);
    await queued.getByText('Each starts as its own turn, in this order, after the current task ends.', {exact: true}).waitFor();
    const [queueBox, composerBox] = await Promise.all([queued.boundingBox(), message.boundingBox()]);
    assert.ok(queueBox !== null && composerBox !== null && queueBox.y + queueBox.height <= composerBox.y, 'the queue shows above the composer');
    await shot(page, 'queue-while-running');
    // An open edit moves on with the queue while its message keeps its text: queuing another message meanwhile does not
    // refuse the Save.
    await queued.getByRole('button', {name: 'Edit queued message 1', exact: true}).click();
    await queued.getByRole('textbox', {name: 'Edit queued message 1', exact: true}).fill('Synthetic queued one, edited here');
    await queue('Synthetic queued four', 4);
    await queued.getByRole('button', {name: 'Save', exact: true}).click();
    await queued.getByRole('textbox', {name: 'Edit queued message 1', exact: true}).waitFor({state: 'detached'});
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[0]?.textContent?.endsWith('Synthetic queued one, edited here') === true);
    // Another page's edit of the same message is never written over: this page's edit closes and offers its text back.
    await queued.getByRole('button', {name: 'Edit queued message 1', exact: true}).click();
    await queued.getByRole('textbox', {name: 'Edit queued message 1', exact: true}).fill('Synthetic queued one, edited twice here');
    const other = await context.newPage();
    other.setDefaultTimeout(12_000);
    await other.goto(`${world.url}/#/module/companions/assistant`);
    await feed(other, 'connected');
    const otherQueue = other.getByRole('region', {name: 'Queued messages', exact: true});
    await otherQueue.getByRole('button', {name: 'Edit queued message 1', exact: true}).click();
    await otherQueue.getByRole('textbox', {name: 'Edit queued message 1', exact: true}).fill('Synthetic queued one, from another page');
    await otherQueue.getByRole('button', {name: 'Save', exact: true}).click();
    await other.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[0]?.textContent?.endsWith('from another page') === true);
    await other.close();
    // Save while this page may not have read the other edit yet: either it is refused or the editor has already closed.
    const save = queued.getByRole('button', {name: 'Save', exact: true});
    if (await save.count() > 0) await save.click({timeout: 2000}).catch(() => undefined);
    const changed = conversation.getByRole('status').filter({hasText: 'The message was changed on another page before your edit was saved'});
    await changed.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[0]?.textContent?.endsWith('from another page') === true);
    await shot(page, 'queue-edit-changed-elsewhere');
    await changed.getByRole('button', {name: 'Use in composer', exact: true}).click();
    assert.equal(await message.inputValue(), 'Synthetic queued one, edited twice here', 'the edit that was not saved comes back to the composer');
    await message.fill('');
    await queued.getByRole('button', {name: 'Withdraw queued message 4', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text').length === 3);
    // Edit the second, move the third up and withdraw the first.
    await queued.getByRole('button', {name: 'Edit queued message 2', exact: true}).click();
    const editor = queued.getByRole('textbox', {name: 'Edit queued message 2', exact: true});
    await editor.fill('Synthetic queued two, edited');
    await queued.getByRole('button', {name: 'Save', exact: true}).click();
    await editor.waitFor({state: 'detached'});
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[1]?.textContent?.endsWith('Synthetic queued two, edited') === true);
    await queued.getByRole('button', {name: 'Move queued message 3 up', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[1]?.textContent?.endsWith('Synthetic queued three') === true);
    assert.equal(await queued.getByRole('button', {name: 'Move queued message 1 up', exact: true}).isDisabled(), true);
    await queued.getByRole('button', {name: 'Withdraw queued message 1', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text').length === 2);
    assert.deepEqual(await texts(), ['Synthetic queued three', 'Synthetic queued two, edited']);
    await shot(page, 'queue-edited');
    // The task ends, and the first queued message starts as its own turn.
    await answer('Synthetic first task');
    await transcript('Synthetic reply to: Synthetic first task').waitFor();
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued three'}).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text').length === 1);
    assert.deepEqual(await texts(), ['Synthetic queued two, edited']);
    await conversation.getByText('Working', {exact: true}).waitFor();
    await shot(page, 'queue-auto-start');
    // Stop: the task ends and the queue holds until Resume queue.
    await conversation.getByRole('button', {name: 'Cancel task', exact: true}).click();
    await conversation.getByText('Task cancelled', {exact: true}).waitFor();
    await queued.getByText('The queue is held because you stopped the task. Nothing in it starts until you resume it.', {exact: true}).waitFor();
    waiting.length = 0;
    assert.equal(await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued two, edited'}).count(), 0, 'nothing started after Stop');
    await shot(page, 'queue-held-stop');
    await queued.getByRole('button', {name: 'Resume queue', exact: true}).click();
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued two, edited'}).waitFor();
    await queued.waitFor({state: 'detached'});
    await answer('Synthetic queued two, edited');
    await transcript('Synthetic reply to: Synthetic queued two, edited').waitFor();
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    // Answering a question with a message queued keeps the transcript on its latest message through the reply and the
    // queued message's start.
    await message.fill('ASK before a queued message');
    await send.click();
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('Synthetic queued behind an answer');
    await queueButton.click();
    await items.first().waitFor();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('The synthetic detail.');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await answer('ASK before a queued message');
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued behind an answer'}).waitFor();
    await answer('Synthetic queued behind an answer');
    await transcript('Synthetic reply to: Synthetic queued behind an answer').waitFor();
    await page.waitForFunction(() => {const node = document.querySelector('.conversation-transcript'); return node !== null && node.scrollHeight - node.scrollTop - node.clientHeight <= 2;});
    assert.equal(await conversation.getByRole('button', {name: 'New messages', exact: true}).count(), 0, 'the transcript still follows the latest message');
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    // So does approving a proposal with a message queued: only Queue shows during the approval.
    await message.fill('PROPOSE synthetic artwork');
    await send.click();
    const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText('Create a still image for this reply? This may use the art allowance. Blue synthetic fixture', {exact: true}).waitFor();
    assert.equal(await send.count(), 0, 'during an approval only Queue shows');
    await message.fill('Synthetic queued behind an approval');
    await queueButton.click();
    await items.first().waitFor();
    await proposal.getByRole('button', {name: 'Approve proposal', exact: true}).click();
    await answer('PROPOSE synthetic artwork');
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued behind an approval'}).waitFor();
    await answer('Synthetic queued behind an approval');
    await transcript('Synthetic reply to: Synthetic queued behind an approval').waitFor();
    await page.waitForFunction(() => {const node = document.querySelector('.conversation-transcript'); return node !== null && node.scrollHeight - node.scrollTop - node.clientHeight <= 2;});
    assert.equal(await conversation.getByRole('button', {name: 'New messages', exact: true}).count(), 0, 'the transcript still follows the latest message');
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    // A queued message waits behind a question across a restart, held until Start.
    await message.fill('ASK a synthetic question');
    await send.click();
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('Synthetic queued across restart');
    await queueButton.click();
    await items.first().waitFor();
    await world.restart(); await page.reload(); await feed(page, 'connected');
    await queued.getByText('The queue is held because B.U.N.N.Y. restarted. Nothing in it starts until you start it.', {exact: true}).waitFor();
    await shot(page, 'queue-held-restart');
    // The queue loads after the history and grows the composer; the transcript still shows its latest message.
    await page.waitForFunction(() => {const node = document.querySelector('.conversation-transcript'); return node !== null && node.scrollHeight - node.scrollTop - node.clientHeight <= 2;});
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('The synthetic detail.');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await answer('ASK a synthetic question');
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    assert.deepEqual(await texts(), ['Synthetic queued across restart'], 'the held queue waits after the task ends');
    assert.equal(waiting.length, 0);
    await queued.getByRole('button', {name: 'Start', exact: true}).click();
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic queued across restart'}).waitFor();
    await answer('Synthetic queued across restart');
    await transcript('Synthetic reply to: Synthetic queued across restart').waitFor();
    await shot(page, 'queue-started-after-restart');
    // Phone width: the queued list and the composer's Queue and Send fit without horizontal page scroll.
    await page.setViewportSize({width: 390, height: 844});
    await message.fill('Synthetic phone task');
    await send.click();
    await conversation.getByText('Working', {exact: true}).waitFor();
    await queue('Synthetic phone queued message with enough words to wrap across the narrow width of a phone', 1);
    await queue('Synthetic second phone message', 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll');
    const fits = await queued.evaluate(node => {
      const box = node.getBoundingClientRect();
      return [...node.querySelectorAll('button')].every(button => {const rect = button.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1;});
    });
    assert.equal(fits, true, 'the queue\'s buttons stay inside it');
    const [queueRect, sendRect] = await Promise.all([queueButton.boundingBox(), send.boundingBox()]);
    assert.ok(queueRect !== null && sendRect !== null && Math.abs(queueRect.y - sendRect.y) <= 1, 'Queue sits beside Send');
    await queued.scrollIntoViewIfNeeded();
    await shot(page, 'queue-phone');
    await queued.getByRole('button', {name: 'Move queued message 2 up', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-queue-text')[0]?.textContent?.endsWith('Synthetic second phone message') === true);
    // An edit whose message starts before it is saved keeps its text for the owner.
    await queued.getByRole('button', {name: 'Edit queued message 1', exact: true}).click();
    await queued.getByRole('textbox', {name: 'Edit queued message 1', exact: true}).fill('Synthetic second phone message, edited too late');
    await answer('Synthetic phone task');
    const lost = conversation.getByRole('status').filter({hasText: 'The message started before your edit was saved.'});
    await lost.waitFor();
    await shot(page, 'queue-edit-outran');
    await lost.getByRole('button', {name: 'Use in composer', exact: true}).click();
    assert.equal(await message.inputValue(), 'Synthetic second phone message, edited too late');
    await message.fill('');
    await conversation.locator('li[data-role="owner"]').filter({hasText: 'Synthetic second phone message'}).waitFor();
    await shot(page, 'queue-phone-auto-start');
    assert.deepEqual(errors, []);
    assert.equal(JSON.stringify(world.logs).includes('Synthetic queued'), false, 'no queued text reaches the logs');
    process.stdout.write('Conversation queue: queue while running, edit, move and withdraw, start after a task ends, Stop and Resume queue, restart and Start, and the phone layout passed.\n');
  } finally {
    for (const call of waiting.splice(0)) call.resolve({text: 'Synthetic closing reply', calls: [], stop: 'end', units: 1});
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationQueueJourney(browser);} finally {await browser.close();}
}
