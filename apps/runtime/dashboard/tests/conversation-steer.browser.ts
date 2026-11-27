// Steering a companion's running task (Hub #2031), on the built runtime with the real companions module, a fake coding
// worker on the real gateway and a gated scripted provider whose calls wait until the journey answers them. Send while
// a task works saves a steer at once, shows it above the composer, and the task's next model call reads it after the
// last call's tool results. A steer forces one more call when the model was about to finish; one that reaches its turn
// after the turn ended starts as the next message. Skip question and send and Decline with message settle a question
// and steer in one step; a background delegation leaves the next Hub turn steerable; Stop returns unread steers to the
// queue, which may pass its limit; a restart starts no work and keeps the steer. Desktop and phone widths, no horizontal
// page scroll. No device is contacted and no paid call is made.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Locator, type Page, type Route} from 'playwright';
import {openJourneyContext} from './browser-context.ts';
import {connectRemote} from '@jimmie-potts/sdk/remote';
import type {CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {feed, startWorld, type WorldOptions} from './harness.ts';

type Provider = NonNullable<WorldOptions['assistantProvider']>;
type Input = Parameters<Provider['turn']>[0];
type Reply = Awaited<ReturnType<Provider['turn']>>;
type Waiting = {input: Input; resolve: (reply: Reply) => void};
type Item = Input['transcript'][number];
const end = (text: string): Reply => ({text, calls: [], stop: 'end', units: 1});
const tool = (id: string, name: string, input: Record<string, unknown>, text: string | null = null): Reply => ({text, calls: [{id, name, input}], stop: 'tool', units: 1});
/** A transcript item as the journey compares it: role and the text a person would read. */
const brief = (item: Item): string => item.role === 'owner' ? `owner: ${item.text}` : item.role === 'tool' ? `tool ${item.name}: ${item.result.slice(0, 40)}` : `assistant: ${item.text ?? item.calls[0]?.name ?? ''}`;
const toolLine = (name: string, result: string): string => `tool ${name}: ${result.slice(0, 40)}`;
const FIXTURE = 'Read-only fixture: blue is the selected synthetic sample.';
const SKIPPED = 'The owner skipped this question and sent a new message instead; it follows.';
const DECLINED = 'The owner declined the proposal; nothing was changed.';

export async function conversationSteerJourney(browser: Browser): Promise<void> {
  const waiting: Waiting[] = [];
  let arrived: (() => void) | undefined;
  const provider: Provider = {name: 'synthetic', model: 'synthetic', turn: input => new Promise<Reply>(resolve => {waiting.push({input, resolve}); arrived?.();})};
  const world = await startWorld({companions: true, coding: true, assistantProvider: provider, assistantCatalog: ['create_artwork']});
  /** The model call that waits next, once it arrives. */
  const call = async (what: string): Promise<Waiting> => {
    if (waiting.length === 0) {
      let bound: NodeJS.Timeout | undefined;
      await Promise.race([new Promise<void>(resolve => {arrived = resolve;}),
        new Promise<never>((_resolve, reject) => {bound = setTimeout(() => {reject(new Error(`no model call arrived: ${what}`));}, 12_000);})]).finally(() => {clearTimeout(bound);});
    }
    arrived = undefined;
    return waiting.shift() ?? assert.fail(`no model call waits: ${what}`);
  };
  const output = process.env.DASHBOARD_RECEIPTS;
  if (output !== undefined) await mkdir(output, {recursive: true});
  const shot = async (page: Page, name: string): Promise<void> => {if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: false});};
  const context = await openJourneyContext(browser, {viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors: string[] = [];
  context.on('weberror', error => {errors.push(error.error().name);});
  const worker = await connectRemote({url: world.url, source: 'bunny/parts/coding-worker', token: world.codingToken});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const message = conversation.getByRole('textbox', {name: 'Message', exact: true});
    const answerBox = conversation.getByRole('textbox', {name: 'Answer', exact: true});
    const send = conversation.getByRole('button', {name: 'Send', exact: true}), queueButton = conversation.getByRole('button', {name: 'Queue', exact: true});
    const steering = conversation.getByRole('region', {name: 'Messages for the next step', exact: true});
    const queued = conversation.getByRole('region', {name: 'Queued messages', exact: true});
    const owner = (text: string): Locator => conversation.locator('li[data-role="owner"]').filter({hasText: text});
    const assistantLine = (text: string): Locator => conversation.locator('li[data-role="assistant"]').filter({hasText: text});
    const completed = async (): Promise<void> => {await conversation.getByText('Task completed', {exact: true}).waitFor();};
    const cleared = async (): Promise<void> => {await page.waitForFunction(() => {const box = document.querySelector<HTMLTextAreaElement>('#assistant-input'); return box !== null && box.value === '' && !box.disabled;});};
    const start = async (text: string): Promise<Waiting> => {await message.fill(text); await send.click(); await conversation.getByText('Working', {exact: true}).waitFor(); return call(text);};
    const steer = async (text: string, count: number): Promise<void> => {
      await message.fill(text); await send.click();
      await steering.getByRole('listitem').nth(count - 1).waitFor();
      await cleared();
    };
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    /** Queues eight messages and sends eight steers to the running task, the most a task and its queue hold. */
    const fill = async (prefix: string): Promise<void> => {
      for (let index = 1; index <= 8; index += 1) {
        await message.fill(`${prefix} queued ${String(index)}`); await queueButton.click();
        await queued.getByRole('listitem').nth(index - 1).waitFor(); await cleared();
      }
      for (const [index, word] of words.entries()) {
        await steer(`${prefix} returned steer ${word}`, index + 1);
        // The steer just sent is in view inside the shared box, ahead of the full queue.
        const shown = await page.evaluate(text => {
          const box = document.querySelector('.conversation-queue-stack')?.getBoundingClientRect();
          const row = [...document.querySelectorAll('.conversation-steers li')].find(item => item.textContent.endsWith(text))?.getBoundingClientRect();
          return box !== undefined && row !== undefined && row.top >= box.top - 1 && row.bottom <= box.bottom + 1 && row.bottom <= window.innerHeight;
        }, `${prefix} returned steer ${word}`);
        assert.equal(shown, true, `the new steer ${word} is in view`);
      }
    };
    /** The queue and the steers share one bound: the page does not scroll, and the header and transcript stay in view. */
    const bounded = async (width: number, fits = true): Promise<void> => {
      await conversation.locator('.conversation-transcript').evaluate(node => {node.scrollTop = node.scrollHeight;});
      const measured = await page.evaluate(() => {
        const transcript = document.querySelector('.conversation-transcript')?.getBoundingClientRect(), header = document.querySelector('.conversation-header')?.getBoundingClientRect();
        const stack = document.querySelector('.conversation-queue-stack');
        return {overflow: document.documentElement.scrollHeight - window.innerHeight, scrolled: window.scrollY,
          transcript: transcript === undefined ? 0 : Math.min(transcript.bottom, window.innerHeight) - Math.max(transcript.top, 0),
          header: header === undefined ? -1 : header.top, stack: stack === null ? 0 : stack.getBoundingClientRect().height, scrolls: stack !== null && stack.scrollHeight > stack.clientHeight};
      });
      process.stderr.write(`steer layout ${String(width)}: ${JSON.stringify(measured)}\n`);
      if (fits) assert.ok(measured.overflow <= 1 && measured.scrolled === 0, `the page does not scroll at ${String(width)} px`);
      assert.ok(measured.header >= 0, 'the header stays in view');
      assert.ok(measured.transcript >= 80, `the transcript stays in view at ${String(width)} px`);
      assert.ok(measured.scrolls, 'the shared box scrolls inside itself');
      assert.ok(measured.stack <= Math.max(96, (width <= 760 ? 0.2 : 0.4) * (await page.evaluate(() => window.innerHeight))) + 1, 'the shared box keeps to its bound');
    };
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await send.waitFor();

    // 1. A steer during tool use: saved at once above the composer, read after the tool result in the same turn.
    const reading = await start('Synthetic read the sample');
    await conversation.getByText('This task is working. Send steers it at its next step; Queue saves a message for after it.', {exact: true}).waitFor();
    await conversation.getByText('Enter to send: the task reads it at its next step. Shift+Enter for a new line.', {exact: true}).waitFor();
    await steer('Synthetic steer: name the color too', 1);
    await steering.getByText('The task reads these at its next step. Cancel task moves them to the queue.', {exact: true}).waitFor();
    const [steerBox, composerBox] = await Promise.all([steering.boundingBox(), message.boundingBox()]);
    assert.ok(steerBox !== null && composerBox !== null && steerBox.y + steerBox.height <= composerBox.y, 'the steer shows above the composer');
    await shot(page, '01-steer-during-tool-use');
    reading.resolve(tool('call-read', 'read_fixture', {}, 'Synthetic reading the sample.'));
    const afterTool = await call('the call after the tool');
    assert.deepEqual(afterTool.input.transcript.slice(-2).map(brief), [toolLine('read_fixture', FIXTURE), 'owner: Synthetic steer: name the color too'],
      'the steer follows the tool result');
    await owner('Synthetic steer: name the color too').getByText('Sent while working', {exact: true}).waitFor();
    await steering.waitFor({state: 'detached'});
    afterTool.resolve(end('Synthetic: the sample is blue.'));
    await completed();
    await shot(page, '02-steer-read-after-tool');

    // 2. A steer that forces one more call: the early answer is kept as an earlier reply, and the turn goes on.
    const finishing = await start('Synthetic short request');
    await steer('Synthetic steer: and say goodbye', 1);
    finishing.resolve(end('Synthetic early answer'));
    const forced = await call('the forced call');
    assert.deepEqual(forced.input.transcript.slice(-2).map(brief), ['assistant: Synthetic early answer', 'owner: Synthetic steer: and say goodbye']);
    await assistantLine('Synthetic early answer').getByText('Earlier reply, before your next message', {exact: true}).waitFor();
    await conversation.getByText('Working', {exact: true}).waitFor();
    await shot(page, '03-forced-call');
    forced.resolve(end('Synthetic final answer. Goodbye.'));
    await completed();

    // 3. A steer that reaches its turn after the turn ended becomes the next queued message and starts as its own turn.
    // The journey holds the steer's upload until the turn has ended, as a slow network would.
    const ending = await start('Synthetic request that ends first');
    let held: Route | undefined;
    await page.route('**/api/v2/modules/companions/upload*', route => {held = route;});
    await message.fill('Synthetic late steer');
    await send.click();
    for (let waited = 0; held === undefined && waited < 100; waited += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(held !== undefined, 'the steer\'s upload was held');
    ending.resolve(end('Synthetic answer before the late steer'));
    await assistantLine('Synthetic answer before the late steer').waitFor();
    await held.continue();
    await page.unroute('**/api/v2/modules/companions/upload*');
    const lateTurn = await call('the late steer as a new turn');
    assert.deepEqual(lateTurn.input.transcript.map(brief), ['owner: Synthetic late steer'], 'its own turn');
    await owner('Synthetic late steer').waitFor();
    assert.equal(await owner('Synthetic late steer').getByText('Sent while working', {exact: true}).count(), 0, 'it started its own turn');
    await shot(page, '04-late-steer-queued-and-started');
    lateTurn.resolve(end('Synthetic answer to the late steer'));
    await completed();

    // 4. Skip question and send: the composer answers a clarification, and the skip steers instead.
    const asking = await start('Synthetic request that asks');
    asking.resolve(tool('call-ask', 'ask_owner', {text: 'Which synthetic sample?'}));
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    const skip = conversation.getByRole('button', {name: 'Skip question and send', exact: true});
    assert.equal(await skip.isDisabled(), true, 'nothing to send yet');
    await answerBox.fill('Synthetic never mind, list the sessions');
    await shot(page, '05-skip-question');
    await skip.click();
    const skipped = await call('after the skip');
    assert.deepEqual(skipped.input.transcript.slice(-2).map(brief), [toolLine('ask_owner', SKIPPED), 'owner: Synthetic never mind, list the sessions']);
    await owner('Synthetic never mind, list the sessions').waitFor();
    skipped.resolve(end('Synthetic: no sessions are open.'));
    await completed();

    // 5. Decline with message: free text during an approval only queues, and the decline steers in one step.
    const proposing = await start('Synthetic request that proposes');
    proposing.resolve(tool('call-mode', 'create_artwork', {format: 'still', showTargets: [], description: 'Blue synthetic fixture'}));
    const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText('Create a still image for this reply? This may use the art allowance. Blue synthetic fixture', {exact: true}).waitFor();
    assert.equal(await send.count(), 0, 'during an approval free text only queues');
    const decline = conversation.getByRole('button', {name: 'Decline with message', exact: true});
    await message.fill('Synthetic keep the current mode and explain why');
    await shot(page, '06-decline-with-message');
    await decline.click();
    const declined = await call('after the decline');
    assert.deepEqual(declined.input.transcript.slice(-2).map(brief), [toolLine('create_artwork', DECLINED), 'owner: Synthetic keep the current mode and explain why']);
    declined.resolve(end('Synthetic: the mode stays work.'));
    await completed();

    // 6. A background coding job leaves the next conversation turn free to read its own steer.
    const work: CodingWork[] = [];
    const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: command => {work.push(command.data); return {status: 'accepted'};}});
    assert.equal((await endpoint.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0',
      data: {requestId: randomUUID(), action: 'enable'}}, {timeoutMs: 5000})).status, 'accepted');
    const delegating = await start('Synthetic request that delegates');
    delegating.resolve(tool('call-delegate', 'delegate_coding', {repository: 'agent-device-hub', brief: 'Add a synthetic test.'}));
    await proposal.getByText(/Delegation to the coding worker in repository/).waitFor();
    await proposal.getByRole('button', {name: 'Approve proposal', exact: true}).click();
    const queuedJob = await call('after the background job was queued');
    for (let waited = 0; work.length === 0 && waited < 100; waited += 1) await new Promise(resolve => setTimeout(resolve, 50));
    const started = work[0]; assert.ok(started?.action === 'start', 'the hand-off reached the worker');
    const jobId = `${started.operationId}-job`;
    const receipt = queuedJob.input.transcript.at(-1);
    assert.ok(receipt?.role === 'tool' && receipt.name === 'delegate_coding');
    assert.match(receipt.result, /^accepted: Coding job /);
    assert.ok(receipt.result.includes(jobId));
    const jobMessage = conversation.locator(`[data-message="${jobId}"]`);
    await jobMessage.getByText(/^Coding job .* was queued/).waitFor();
    queuedJob.resolve(end('Synthetic: the coding job is queued.'));
    await completed();

    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'started'}});
    const hub = await start('Synthetic separate Hub status check');
    await steer('Synthetic steer: explain the current Hub mode instead', 1);
    await shot(page, '07-steer-with-background-job');
    hub.resolve(end('Synthetic superseded status draft.'));
    const steered = await call('after steering the independent Hub turn');
    assert.equal(brief(steered.input.transcript.at(-1) ?? assert.fail('missing steer')), 'owner: Synthetic steer: explain the current Hub mode instead');
    steered.resolve(end('Synthetic: the Hub stays in work mode.'));
    await assistantLine('Synthetic: the Hub stays in work mode.').waitFor();
    await completed();
    assert.equal(await conversation.getByText(/Added the synthetic test/).count(), 0);

    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'completed',
      result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: [], checks: [], findings: [], limitations: [], summary: 'Added the synthetic test.', sessionId: null, usage: null}}});
    const update = conversation.locator(`[data-message="${jobId}-result"]`);
    await update.getByText(/Added the synthetic test/).waitFor();
    assert.equal(await update.getByRole('link', {name: 'Update to earlier reply', exact: true}).getAttribute('href'), `#conversation-message-${jobId}`);
    assert.equal(waiting.length, 0, 'the background result does not reopen the completed turn');

    // 7. Stop returns unread steers to the head of the queue, which may pass its limit of 8.
    const stopping = await start('Synthetic long task');
    await fill('Synthetic');
    await bounded(1280);
    await shot(page, '08-steers-and-full-queue');
    await page.setViewportSize({width: 1024, height: 768});
    await bounded(1024);
    await shot(page, '08b-steers-and-full-queue-1024');
    await page.setViewportSize({width: 1280, height: 900});
    await conversation.getByRole('button', {name: 'Cancel task', exact: true}).click();
    await conversation.getByText('Task cancelled', {exact: true}).waitFor();
    stopping.resolve(end('Synthetic reply after the stop'));
    await queued.getByText('16, over the limit of 8', {exact: true}).waitFor();
    await queued.getByText('The queue is held because you stopped the task. Nothing in it starts until you resume it.', {exact: true}).waitFor();
    await queued.getByText('Your unread messages came back from the stopped task. Queue takes a new message once fewer than 8 wait.', {exact: true}).waitFor();
    const order = async (): Promise<string[]> => (await queued.locator('.conversation-queue-text').allTextContents()).map(text => text.replace(/^Queued message \d+: /, ''));
    assert.deepEqual((await order()).slice(7, 9), ['Synthetic returned steer eight', 'Synthetic queued 1'], 'the steers come back first, in order');
    assert.deepEqual((await order()).slice(0, 2), ['Synthetic returned steer one', 'Synthetic returned steer two']);
    await message.fill('Synthetic refused while over the limit');
    assert.equal(await queueButton.isDisabled(), true, 'Queue waits until the queue is below its limit');
    await conversation.getByText('The queue is full. Withdraw a message or wait for one to start.', {exact: true}).waitFor();
    await queued.scrollIntoViewIfNeeded();
    await shot(page, '09-stop-returns-steers-past-limit');
    // Withdraw the eight queued messages: at 8 Queue still waits. Then withdraw six steers, so two run next.
    const withdraw = async (position: number, left: number): Promise<void> => {
      await queued.getByRole('button', {name: `Withdraw queued message ${String(position)}`, exact: true}).click();
      await page.waitForFunction(count => document.querySelectorAll('.conversation-queue .conversation-queue-text').length === count, left - 1);
    };
    for (let left = 16; left > 8; left -= 1) await withdraw(9, left);
    assert.equal(await queueButton.isDisabled(), true, 'at the limit Queue still waits');
    for (let left = 8; left > 2; left -= 1) await withdraw(3, left);
    assert.equal(await queueButton.isDisabled(), false, 'below the limit Queue takes a message again');
    await message.fill('');
    await queued.getByRole('button', {name: 'Resume queue', exact: true}).click();
    const one = await call('the first returned steer');
    assert.deepEqual(one.input.transcript.map(brief), ['owner: Synthetic returned steer one']);
    one.resolve(end('Synthetic answer one'));
    const two = await call('the second returned steer');
    assert.deepEqual(two.input.transcript.map(brief), ['owner: Synthetic returned steer two']);
    two.resolve(end('Synthetic answer two'));
    await completed();

    // 8. A restart starts no work: a steer that waits behind a question stays with its task and is read after the answer.
    const restarting = await start('Synthetic request across a restart');
    await steer('Synthetic steer across the restart', 1);
    restarting.resolve(tool('call-ask-2', 'ask_owner', {text: 'Which synthetic detail?'}));
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    await world.restart(); await page.reload(); await feed(page, 'connected');
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    await steering.getByText('Synthetic steer across the restart').waitFor();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(waiting.length, 0, 'the start ran nothing');
    await shot(page, '10-steer-kept-across-restart');
    await answerBox.fill('The synthetic detail.');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    const answered = await call('after the answer');
    assert.deepEqual(answered.input.transcript.slice(-2).map(brief), [toolLine('ask_owner', 'The synthetic detail.'), 'owner: Synthetic steer across the restart']);
    answered.resolve(end('Synthetic answer after the restart'));
    await completed();

    // 9. Phone width: the steer list, the composer and the question's three actions fit without horizontal scroll.
    await page.setViewportSize({width: 390, height: 844});
    const phone = await start('Synthetic phone request');
    await steer('Synthetic phone steer with enough words to wrap across the narrow width of a phone screen', 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll');
    const [queueRect, sendRect] = await Promise.all([queueButton.boundingBox(), send.boundingBox()]);
    assert.ok(queueRect !== null && sendRect !== null && Math.abs(queueRect.y - sendRect.y) <= 1, 'Queue sits beside Send');
    await steering.scrollIntoViewIfNeeded();
    await shot(page, '11-phone-steer');
    phone.resolve(tool('call-ask-3', 'ask_owner', {text: 'Which phone detail?'}));
    await conversation.getByText('Needs your answer', {exact: true}).waitFor();
    await answerBox.fill('Synthetic phone skip');
    const fits = await conversation.evaluate(node => {
      const box = node.getBoundingClientRect();
      return [...node.querySelectorAll('.conversation-task-actions button, .conversation-composer-actions button')]
        .every(button => {const rect = button.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1;});
    });
    assert.equal(fits, true, 'the task\'s and the composer\'s buttons stay inside the page');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll with the question');
    await shot(page, '12-phone-skip-question');
    await conversation.getByRole('button', {name: 'Skip question and send', exact: true}).click();
    const phoneSkipped = await call('the phone skip');
    assert.deepEqual(phoneSkipped.input.transcript.slice(-3).map(brief), [toolLine('ask_owner', SKIPPED),
      'owner: Synthetic phone steer with enough words to wrap across the narrow width of a phone screen', 'owner: Synthetic phone skip']);
    phoneSkipped.resolve(end('Synthetic phone answer'));
    await completed();
    await shot(page, '13-phone-completed');
    // A full queue and a full set of steers at phone width share the same bound.
    const crowded = await start('Synthetic crowded phone request');
    await fill('Synthetic phone');
    await bounded(390);
    await shot(page, '14-phone-queue-and-steers');
    // At 320x640 a working task's composer, its help and the page's own header already pass the window's height with
    // nothing queued, so the page scrolls there; the shared box keeps to its bound and adds no more than that.
    await page.setViewportSize({width: 320, height: 640});
    await bounded(320, false);
    await shot(page, '15-small-phone-queue-and-steers');
    await page.setViewportSize({width: 390, height: 844});
    await conversation.getByRole('button', {name: 'Cancel task', exact: true}).click();
    await conversation.getByText('Task cancelled', {exact: true}).waitFor();
    crowded.resolve(end('Synthetic reply after the stop'));
    for (let left = 16; left > 0; left -= 1) {
      await queued.getByRole('button', {name: 'Withdraw queued message 1', exact: true}).click();
      if (left > 1) await page.waitForFunction(count => document.querySelectorAll('.conversation-queue .conversation-queue-text').length === count, left - 1);
    }
    await queued.waitFor({state: 'detached'});
    assert.deepEqual(errors, []);
    assert.equal(JSON.stringify(world.logs).includes('Synthetic steer'), false, 'no steer text reaches the logs');
    process.stdout.write('Conversation steer: steer during tool use, forced call, late steer as the next turn, Skip question and send, Decline with message, steering alongside a background job, Stop returning steers past the queue limit, restart and the phone layout passed.\n');
  } finally {
    for (const pending of waiting.splice(0)) pending.resolve(end('Synthetic closing reply'));
    await worker.close();
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationSteerJourney(browser);} finally {await browser.close();}
}
