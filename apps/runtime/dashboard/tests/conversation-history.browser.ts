import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import type * as HistoryReader from '../../../../modules/companions/dist/src/frontend/conversation-history.js';
import {feed, startWorld} from './harness.ts';

export async function conversationHistoryJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
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
