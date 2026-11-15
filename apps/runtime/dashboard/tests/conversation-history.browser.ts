import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import type * as HistoryReader from '../../../../modules/companions/dist/src/frontend/conversation-history.js';
import {changes, feed, startWorld} from './harness.ts';

export async function conversationHistoryJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const route = '/modules/companions/content/conversation';
    const loader = '/synthetic-conversation-history-reader.js';
    const bundle = await build({entryPoints: [fileURLToPath(new URL('../../../../modules/companions/dist/src/frontend/conversation-history.js', import.meta.url))],
      bundle: true, format: 'esm', platform: 'browser', write: false});
    const script = bundle.outputFiles[0]?.text ?? assert.fail('history reader bundle');
    await page.route(`**${loader}`, route => route.fulfill({contentType: 'text/javascript', body: script}));
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const panel = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await panel.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const draft = panel.getByRole('textbox', {name: 'Message', exact: true});
    const send = panel.getByRole('button', {name: 'Send message', exact: true});
    const cancel = panel.getByRole('button', {name: 'Cancel task', exact: true});
    for (let number = 1; number <= 19; number += 1) {
      await draft.fill(`Synthetic history fixture ${String(number)}`);
      await send.click();
      await panel.getByText('Task status: waiting', {exact: true}).waitFor();
      if (number < 19) {
        await cancel.click();
        await panel.getByText('Task status: cancelled', {exact: true}).waitFor();
      }
    }
    const initialPageReads: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === route) initialPageReads.push(url.search);
    });
    await page.reload();
    await feed(page, 'connected');
    const transcript = panel.getByRole('list', {name: 'Saved conversation messages'});
    await transcript.getByText('Synthetic history fixture 19', {exact: true}).waitFor({timeout: 5000});
    assert.equal(await transcript.getByText('Synthetic history fixture 1', {exact: true}).count(), 0,
      'the Conversation page shows the newest window by default');
    assert.deepEqual(initialPageReads, ['?profile=bunny&view=recent'], 'opening Conversation requests only the latest window');
    const scroller = panel.locator('.conversation-transcript');
    await scroller.evaluate(node => {node.scrollTop = 0;});
    const reading = transcript.getByText('Synthetic history fixture 19', {exact: true});
    const before = await reading.evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0));
    await panel.getByRole('button', {name: 'Load earlier', exact: true}).click();
    await transcript.getByText('Synthetic history fixture 10', {exact: true}).waitFor();
    const after = await reading.evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0));
    assert.ok(Math.abs(after - before) <= 2, 'Load earlier preserves the reading anchor');
    const answerDraft = panel.getByRole('textbox', {name: 'Answer', exact: true});
    await answerDraft.fill('Synthetic answer draft');
    await panel.getByRole('button', {name: 'Reachy', exact: true}).click();
    await panel.getByText('No saved messages for this profile yet.', {exact: true}).waitFor();
    assert.equal(await panel.getByRole('button', {name: 'Send message', exact: true}).isDisabled(), true);
    await panel.getByRole('button', {name: 'Go to B.U.N.N.Y. task', exact: true}).click();
    assert.equal(await answerDraft.inputValue(), 'Synthetic answer draft');
    let release = (): void => {};
    const hold = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/modules/companions/content/conversation?profile=reachy&view=recent', async route => {
      await hold;
      await route.continue();
    }, {times: 1});
    const held = page.waitForRequest(request => request.url().includes('profile=reachy&view=recent'));
    try {
      await panel.getByRole('button', {name: 'Reachy', exact: true}).click();
      await held;
      await panel.getByRole('button', {name: 'Go to B.U.N.N.Y. task', exact: true}).click();
      await answerDraft.waitFor();
      const late = page.waitForEvent('requestfinished', {predicate: request => request.url().includes('profile=reachy&view=recent')});
      release();
      await late;
    } finally {release();}
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await answerDraft.inputValue(), 'Synthetic answer draft', 'a late response cannot overwrite the selected profile');
    await transcript.getByText('Synthetic history fixture 19', {exact: true}).waitFor();
    await page.setViewportSize({width: 390, height: 844});
    await panel.locator('.conversation-profiles-narrow select').waitFor();
    assert.equal(await answerDraft.inputValue(), 'Synthetic answer draft');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const output = process.env.DASHBOARD_RECEIPTS;
    const answer = panel.getByRole('button', {name: 'Save answer and continue', exact: true});
    if (output !== undefined) {
      await page.screenshot({path: `${output}/conversation-narrow.png`, fullPage: true});
      await answer.scrollIntoViewIfNeeded();
      await page.screenshot({path: `${output}/conversation-narrow-composer.png`});
    }
    await page.setViewportSize({width: 1280, height: 900});
    await page.evaluate(() => window.scrollTo(0, 0));
    const action = await answer.boundingBox();
    assert.ok(action !== null && action.y + action.height <= 900, 'the clarification action fits in the normal desktop viewport');
    if (output !== undefined) {
      await page.screenshot({path: `${output}/conversation-desktop-viewport.png`});
      await page.screenshot({path: `${output}/conversation-desktop.png`, fullPage: true});
    }
    const result = await page.evaluate(async ({loader, route}) => {
      const reader = await import(loader) as typeof HistoryReader;
      const requests: string[] = [];
      const signal = new AbortController().signal;
      const read = async (path: string, signal: AbortSignal): Promise<unknown> => {
        requests.push(path);
        const response = await fetch(path, {signal});
        if (!response.ok) throw new Error(`Unexpected history status ${String(response.status)}`);
        return response.json();
      };
      const initial = await reader.refreshConversationHistory(read, 'bunny', signal);
      const initialRows = initial.windows[0]?.messages ?? [];
      const initialRequests = [...requests];
      let history = initial;
      for (let count = 0; count < 10; count += 1) {
        const older = history.windows[0]?.older;
        if (older === null || older === undefined) break;
        history = await reader.loadEarlierConversationHistory(read, history, older, signal);
      }
      const separate = await reader.refreshConversationHistory(read, 'reachy', signal, history);
      const full = history.windows[0]?.messages ?? [];
      const legacy = await fetch(`${route}?profile=bunny&after=0`).then(response => response.text());
      const wrong = await fetch(`${route}?profile=reachy&view=recent&before=${String(initial.windows[0]?.older)}`);
      await wrong.arrayBuffer();
      return {initialRows, initialRequests, requests, full, question: initial.currentTask?.question, finalQuestion: history.currentTask?.question,
        exhausted: history.windows.length === 1 && history.windows[0]?.older === null,
        separate: {profile: separate.profile, rows: separate.windows[0]?.messages.length}, legacy, wrongStatus: wrong.status};
    }, {loader, route});
    assert.deepEqual(result.initialRequests, [`${route}?profile=bunny&view=recent`]);
    assert.equal(result.initialRows.length, 16);
    assert.ok(result.initialRows.some(row => row.text === 'Synthetic history fixture 19'));
    assert.ok(!result.initialRows.some(row => row.text === 'Synthetic history fixture 1'));
    assert.equal(result.question?.kind, 'clarification');
    assert.deepEqual(result.finalQuestion, result.question);
    assert.ok(result.exhausted);
    assert.equal(result.full[0]?.text, 'Synthetic history fixture 1');
    assert.ok(result.full.length > 32);
    assert.deepEqual(result.full.map(row => row.seq), [...new Set(result.full.map(row => row.seq))].sort((a, b) => a - b));
    assert.deepEqual(result.separate, {profile: 'reachy', rows: 0});
    assert.match(result.legacy, /^\{"version":1,/);
    assert.match(result.legacy, /Synthetic history fixture 1"/);
    assert.equal(result.wrongStatus, 400);
    await scroller.evaluate(node => {node.scrollTop = 0;});
    const heldAnchor = await reading.evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0));
    let releaseEarlier = (): void => {};
    const earlierHold = new Promise<void>(resolve => {releaseEarlier = resolve;});
    const isEarlier = (url: URL): boolean => url.pathname === route && url.searchParams.has('before');
    await page.route(isEarlier, async pending => {
      await earlierHold;
      await pending.continue();
    }, {times: 1});
    const heldEarlier = page.waitForRequest(request => isEarlier(new URL(request.url())));
    try {
      await panel.getByRole('button', {name: 'Load earlier', exact: true}).click();
      await heldEarlier;
      await panel.getByRole('button', {name: 'Cancel task', exact: true}).click();
      await panel.getByText('Task status: cancelled', {exact: true}).waitFor();
    } finally {releaseEarlier();}
    await transcript.getByText('Synthetic history fixture 10', {exact: true}).waitFor({timeout: 5000});
    const restoredAnchor = await reading.evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0));
    assert.ok(Math.abs(restoredAnchor - heldAnchor) <= 2, 'a live revision preserves the deliberate earlier read and its reading anchor');
    await draft.fill('合成🙂 ' + 'unbroken'.repeat(70));
    await draft.dispatchEvent('keydown', {key: 'Enter', isComposing: true});
    assert.equal(await panel.getByText('Task status: cancelled', {exact: true}).count(), 1);
    await draft.press('Shift+Enter');
    assert.match(await draft.inputValue(), /\n$/);
    await scroller.evaluate(node => {node.scrollTop = 0;});
    await page.waitForFunction(() => document.querySelector('.conversation-transcript')?.scrollTop === 0);
    await draft.press('Enter');
    await panel.getByText('Task status: waiting', {exact: true}).waitFor();
    const signalNew = panel.getByRole('button', {name: 'New messages', exact: true});
    await signalNew.waitFor();
    assert.ok(await scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop > 24), 'a new message does not move a reader to the tail');
    await signalNew.click();
    await signalNew.waitFor({state: 'hidden'});
    assert.ok(await scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop < 24), 'New messages moves to the newest saved exchange');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await panel.getByRole('button', {name: 'Cancel task', exact: true}).click();
    await panel.getByText('Task status: cancelled', {exact: true}).waitFor();
    const uploads = '**/api/v2/modules/companions/upload?**';
    const sent = changes(page);
    await page.route(uploads, route => route.fulfill({status: 403, json: {error: {code: 'forbidden', retryable: false}}}), {times: 1});
    await draft.fill('Synthetic draft retained through refusal and lost reply');
    await send.click();
    await panel.getByRole('status').filter({hasText: 'Refused (forbidden) without changing state.'}).waitFor();
    assert.equal(await draft.inputValue(), 'Synthetic draft retained through refusal and lost reply');
    await page.route(uploads, route => route.abort('failed'), {times: 1});
    await send.click();
    await panel.getByRole('status').filter({hasText: 'Uncertain result. The command may have taken effect; it was not sent again.'}).waitFor();
    assert.equal(await draft.inputValue(), 'Synthetic draft retained through refusal and lost reply');
    assert.equal(await send.isDisabled(), true);
    await panel.locator('details.conversation-details summary').click();
    await panel.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor();
    assert.deepEqual(sent.filter(path => path.endsWith('/upload')), ['/api/v2/modules/companions/upload', '/api/v2/modules/companions/upload']);
    const denied = await fetch(`${world.url}${route}?profile=bunny&view=recent`);
    assert.equal(denied.status, 401);
    await denied.arrayBuffer();
    process.stdout.write('Conversation history browser: newest request, earlier pages, question preservation, profile isolation and authorization passed.\n');
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationHistoryJourney(browser);}
  finally {await browser.close();}
}
