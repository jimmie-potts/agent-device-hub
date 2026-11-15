import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {Browser} from 'playwright';

/** Mount the real page with copy events and saved-question reads that a healthy runtime cannot manufacture. */
export async function conversationStateJourney(browser: Browser): Promise<void> {
  const toolPath = 'agent-device-hub/modules/companions/assistant/conversation/qualification/browser-playback-recovery-notes.html?fixture=';
  const fixtureId = '3327540ab52e3da567548eb1e6278a9e1e5bbe25';
  const toolText = ['<button data-fixture-tool>literal button</button>',
    ...Array.from({length: 18}, (_, index) => `${toolPath}${fixtureId.repeat(3)}&part=${String(index)}`),
    'Résumé · 東京 · 작은 대화 · نهاية'].join('\n');
  const bundle = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AssistantPage} from '../../../../modules/companions/src/frontend/assistant.tsx';
    import {Command} from '../src/command-control.tsx';
    import {Facts, Select} from '../src/ui.tsx';
    const fixture = window.conversationFixture = {commands: [], reads: 0};
    const toolText = ${JSON.stringify(toolText)};
    const coding = {id: 'coding', revision: 1, availability: 'available', endpointId: 'worker', active: null};
    let notifyWorker;
    fixture.removeWorker = () => {notifyWorker({type: 'removed', entity: {id: 'coding'}});};
    const state = {id: 'assistant', revision: 1, enabled: true, available: true, provider: 'synthetic', model: 'synthetic', tools: ['set_mode'], tasks: []};
    const approval = {id: 'saved-question', text: 'Allow synthetic mode change?', answer: null, kind: 'approval',
      proposal: {family: 'mode-set', target: 'hub', data: {mode: 'quiet'}, expectedRevision: 2}};
    let question = approval;
    fixture.restoreQuestion = () => {question = approval;};
    let task = {taskId: 'saved-task', conversationId: 'saved-conversation', profile: 'bunny', status: 'waiting', runId: null,
      questionId: 'saved-question', hasAnswer: false, code: null, modelCalls: 1, toolCalls: 1, questions: 1, activeMs: 0, usageUnits: null, reservedUnits: 0};
    state.tasks = [task];
    let notify;
    const accepted = action => {fixture.commands.push(action); return Promise.resolve({status: 'accepted', requestId: action.requestId});};
    fixture.update = (variant) => {
      if (variant === 'removed') {notify({type: 'removed', entity: {id: 'assistant'}}); return;}
      if (variant === 'missing') question = null;
      if (variant === 'missing-proposal') question = {...approval, proposal: null};
      if (variant === 'mismatched') question = {id: 'other-question', text: 'Unrelated question', answer: null, kind: 'clarification', proposal: null};
      if (variant === 'paused') task = {...task, status: 'paused'};
      if (variant === 'hosted') {state.provider = 'anthropic'; state.model = 'claude-example-hosted-model'; task = {...task, usageUnits: 0, reservedUnits: 16384};}
      if (variant === 'uncertain') task = {...task, status: 'uncertain', questionId: null, code: 'uncertain-result'};
      state.revision += 1;
      state.tasks = [task];
      notify({type: 'updated', message: {data: {...state}}});
    };
    const api = {
      read: async () => {
        fixture.reads += 1;
        return {version: 2, profile: 'bunny', conversationId: 'saved-conversation', older: null,
          currentTask: {taskId: task.taskId, question}, messages: [
            {id: 'saved-message', seq: 1, taskId: task.taskId, role: 'owner', text: 'Synthetic retained message', atMs: 0},
            {id: 'saved-context', seq: 2, taskId: task.taskId, role: 'owner', atMs: 1,
              text: 'Inspect the complete saved result for the conversation layout. Keep the earlier messages in place so each detail can be checked in context.'},
            {id: 'saved-tool', seq: 3, taskId: task.taskId, role: 'tool', text: toolText, atMs: 2},
            {id: 'saved-reply', seq: 4, taskId: task.taskId, role: 'assistant', text: 'Synthetic retained reply', atMs: 3},
          ]};
      },
      sync: async (families, callback) => {
        if (families.includes('coding-state')) {
          notifyWorker = callback;
          return {status: 'synced', copy: {states: () => [{data: coding}], close: async () => {}}};
        }
        if (!families.includes('assistant-state')) return {status: 'rejected'};
        notify = callback;
        return {status: 'synced', copy: {states: () => [{data: {...state}}], close: async () => {}}};
      },
      command: accepted, upload: accepted,
    };
    const root = createRoot(document.getElementById('root'));
    const context = {api, ui: {Command, Facts, Select}, connected: true, control: true, operations: [], operationsLive: true};
    const render = () => {root.render(React.createElement(AssistantPage, {context: {...context}}));};
    fixture.control = value => {context.control = value; render();};
    fixture.settle = () => {
      const command = fixture.commands.at(-1);
      context.operations = [{target: command.target, family: command.family, requestId: command.requestId,
        status: 'completed', result: 'succeeded', revision: 1, sentAtMs: 0}];
      render();
    };
    render();
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'conversation-state-entry.js'},
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, outdir: '.'});
  const context = await browser.newContext();
  try {
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? assert.fail('conversation state bundle');
    const style = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? assert.fail('conversation state stylesheet');
    await context.route('https://conversation-state.invalid/**', route => {
      switch (new URL(route.request().url()).pathname) {
        case '/bundle.js': return route.fulfill({contentType: 'text/javascript', body: script});
        case '/bundle.css': return route.fulfill({contentType: 'text/css', body: style});
        default: return route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic Conversation state</title><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script>'});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto('https://conversation-state.invalid/');
    const approve = page.getByRole('button', {name: 'Approve proposal', exact: true});
    const resume = page.getByRole('button', {name: 'Resume task', exact: true});
    const retained = page.getByRole('list', {name: 'Saved conversation messages'}).getByText('Synthetic retained message', {exact: true});
    await approve.waitFor();
    assert.equal(await approve.isEnabled(), true);
    const details = page.locator('.conversation-details');
    await details.locator(':scope > summary').click();
    assert.deepEqual(await details.locator('details > summary').allTextContents(), ['Capabilities', 'Task activity', 'Usage', 'Conversation settings']);
    assert.equal(await details.locator('details[open]').count(), 0, 'routine sections start collapsed');
    const section = (label: string) => details.locator('.conversation-details-sections > details').filter({has: page.locator('summary', {hasText: label})});
    const capabilities = section('Capabilities');
    const activity = section('Task activity');
    const usage = section('Usage');
    const settings = section('Conversation settings');
    const disable = settings.getByRole('button', {name: 'Disable conversation'});
    const fact = async (panel: ReturnType<typeof section>, label: string, value: string): Promise<void> => {
      const field = panel.locator('dl > div').filter({has: page.getByText(label, {exact: true})}).locator('dd');
      await field.filter({hasText: value}).waitFor();
      assert.equal(await field.textContent(), value);
    };
    const readsBeforeDetails = await page.evaluate<number>('window.conversationFixture.reads');
    await capabilities.locator('summary').press('Enter');
    await fact(capabilities, 'Provider', 'Synthetic (no paid calls)');
    await fact(capabilities, 'Model', 'synthetic');
    await fact(capabilities, 'Allowed tools', 'set_mode');
    await fact(capabilities, 'Unavailable tools', 'read_sessions, delegate_coding');
    await fact(capabilities, 'Coding worker', 'Connected and idle');
    await activity.locator('summary').click();
    await fact(activity, 'Task', 'saved-task');
    await fact(activity, 'Conversation', 'saved-conversation');
    await fact(activity, 'Run', 'Not active');
    await fact(activity, 'Status', 'waiting');
    await fact(activity, 'Model calls', '1 / 6');
    await fact(activity, 'Tool calls', '1 / 4');
    await fact(activity, 'Questions', '1 / 2');
    await fact(activity, 'Active time', '0.0 / 300 seconds');
    await fact(activity, 'Command receipt', 'No command sent from this page.');
    await usage.locator('summary').click();
    await fact(usage, 'Synthetic model usage', 'Unknown');
    await fact(usage, 'Reserved usage', '0 / 65536 units');
    await fact(usage, 'Paid cost', '0 (synthetic calls)');
    await settings.locator('summary').click();
    assert.equal(await disable.isDisabled(), true, 'unfinished tasks prevent disabling Conversation');
    assert.equal(await settings.getByRole('link', {name: 'Preferences', exact: true}).getAttribute('href'), '#/module/companions/preferences');
    assert.equal(await settings.getByRole('link', {name: 'Companion knowledge', exact: true}).getAttribute('href'), '#/module/companions/knowledge');
    assert.equal(await page.evaluate<number>('window.conversationFixture.reads'), readsBeforeDetails, 'opening Details performs no read');
    assert.equal(await approve.isEnabled(), true, 'the active approval remains available outside Details');

    await page.evaluate("window.conversationFixture.update('hosted')");
    await fact(capabilities, 'Provider', 'Anthropic');
    await fact(capabilities, 'Model', 'claude-example-hosted-model');
    await fact(usage, 'Model usage', '0 tokens');
    await fact(usage, 'Reserved usage', '16384 / 65536 tokens');
    await fact(usage, 'Paid cost', 'Unknown (provider billing)');
    await page.evaluate('window.conversationFixture.removeWorker()');
    await fact(capabilities, 'Coding worker', 'Unknown');
    const composer = page.locator('.conversation-compose');
    const top = (selector: string) => page.locator(selector).evaluate(node => node.getBoundingClientRect().top);
    assert.equal(await top('.conversation-details'), await top('.conversation-main'), 'wide Details sits beside the transcript and composer');
    const transcript = page.locator('.conversation-transcript');
    const tool = transcript.getByRole('article', {name: 'tool message'});
    const toolBody = tool.locator('p');
    await tool.locator('summary').waitFor();
    assert.equal(await toolBody.isVisible(), false);
    const readsBeforeTool = await page.evaluate<number>('window.conversationFixture.reads');
    await tool.locator('summary').click();
    assert.equal(await toolBody.isVisible(), true);
    await transcript.evaluate(node => {
      const result = node.querySelector('[data-message="saved-tool"]');
      if (result === null) throw new Error('Missing saved result');
      node.scrollTop += result.getBoundingClientRect().top - node.getBoundingClientRect().top + 20;
    });
    const readingAnchor = () => transcript.evaluate(node => {
      const {top, width} = node.getBoundingClientRect();
      const row = Array.from(node.querySelectorAll('[data-message]')).find(value => value.getBoundingClientRect().bottom > top);
      return {id: row?.getAttribute('data-message'), offset: (row?.getBoundingClientRect().top ?? top) - top, width};
    });
    const wideAnchor = await readingAnchor();
    assert.equal(wideAnchor.id, 'saved-tool');
    assert.ok(await transcript.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop > 24), 'reading older saved text above the tail');
    const detailsToggle = details.locator(':scope > summary');
    const afterReflow = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await detailsToggle.click();
    await afterReflow();
    const closedAnchor = await readingAnchor();
    assert.ok(closedAnchor.width > wideAnchor.width, 'closing wide Details gives space back to the transcript');
    assert.equal(closedAnchor.id, wideAnchor.id, 'closing wide Details preserves the above-tail saved row');
    assert.ok(Math.abs(closedAnchor.offset - wideAnchor.offset) <= 2, 'closing wide Details preserves the saved row offset');
    await detailsToggle.click();
    await afterReflow();
    assert.deepEqual(await readingAnchor(), wideAnchor, 'reopening wide Details preserves the above-tail reading anchor');
    await page.setViewportSize({width: 320, height: 768});
    await afterReflow();
    const narrowAnchor = await readingAnchor();
    assert.equal(narrowAnchor.id, wideAnchor.id, 'resizing keeps the first visible saved row');
    assert.ok(Math.abs(narrowAnchor.offset - wideAnchor.offset) <= 2, 'resizing preserves the saved row offset');
    assert.ok(await top('.conversation-details') > await top('.conversation-compose'), 'narrow Details follows the composer');
    assert.equal(await capabilities.getByText('Anthropic', {exact: true}).isVisible(), true, 'resize preserves the open section');
    assert.equal(await toolBody.textContent(), toolText, 'the entire saved result remains literal, including newlines');
    assert.equal(await tool.locator('[data-fixture-tool]').count(), 0);
    assert.equal(await tool.getByRole('button').count(), 0, 'tool text gains no command or speech control');
    assert.equal(await transcript.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(await transcript.locator('[data-message]').evaluateAll(rows => rows.map(row => row.getAttribute('data-message'))), ['saved-message', 'saved-context', 'saved-tool', 'saved-reply']);
    const toolOffset = await tool.locator('summary').evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0));
    await details.locator(':scope > summary').click();
    assert.equal(await tool.locator('summary').evaluate(node => node.getBoundingClientRect().top - (node.closest('.conversation-transcript')?.getBoundingClientRect().top ?? 0)), toolOffset);
    await tool.locator('summary').press('Enter');
    assert.equal(await toolBody.isVisible(), false);
    assert.equal(await page.evaluate<number>('window.conversationFixture.reads'), readsBeforeTool, 'disclosing tool text performs no read');
    await details.locator(':scope > summary').click();
    await page.evaluate("window.conversationFixture.update('removed')");
    await page.getByRole('status').filter({hasText: 'Stale.'}).waitFor();
    assert.equal(await approve.isDisabled(), true);
    await capabilities.getByText('Last known provider and tools.', {exact: true}).waitFor();
    await usage.getByText('Last known usage.', {exact: true}).waitFor();
    await retained.waitFor();
    for (const variant of ['missing', 'mismatched']) {
      const reads = await page.evaluate<number>('window.conversationFixture.reads');
      await page.evaluate(`window.conversationFixture.update(${JSON.stringify(variant)})`);
      await page.waitForFunction(`window.conversationFixture.reads > ${String(reads)}`);
      await page.getByText('The saved question is unavailable. Refresh history to continue.', {exact: true}).waitFor();
      assert.equal(await approve.count(), 0);
      assert.equal(await page.getByRole('textbox', {name: 'Answer', exact: true}).count(), 0);
      await retained.waitFor();
    }
    await page.evaluate("window.conversationFixture.update('missing-proposal')");
    await page.getByText('The saved proposal is unavailable. Refresh history to continue.', {exact: true}).waitFor();
    const readsBeforeRefresh = await page.evaluate<number>('window.conversationFixture.reads');
    await page.evaluate('window.conversationFixture.restoreQuestion()');
    await page.getByRole('button', {name: 'Refresh history', exact: true}).click({timeout: 3500});
    await approve.waitFor();
    assert.equal(await approve.isEnabled(), true, 'explicit refresh recovers a question without a new state revision');
    assert.equal(await page.evaluate<number>('window.conversationFixture.reads'), readsBeforeRefresh + 1);
    await page.evaluate("window.conversationFixture.update('paused')");
    await composer.getByText('Paused', {exact: true}).waitFor();
    assert.equal(await resume.count(), 0, 'paused with an unanswered question cannot resume');
    await page.evaluate("window.conversationFixture.update('uncertain')");
    await composer.getByText('Uncertain outcome', {exact: true}).waitFor();
    await fact(activity, 'Task code', 'uncertain-result');
    assert.equal(await resume.isEnabled(), true);
    assert.equal(await page.evaluate<number>('window.conversationFixture.commands.length'), 0, 'state changes never send a command');
    await resume.click();
    assert.deepEqual(await page.evaluate('window.conversationFixture.commands.map(command => [command.family, command.data.action, command.data.taskId])'),
      [['assistant-control', 'resume', 'saved-task']], 'Resume sends only the existing explicit control');
    await composer.getByText('Command receipt: Accepted. Waiting for completion.', {exact: true}).waitFor();
    await page.evaluate('window.conversationFixture.settle()');
    await fact(activity, 'Command receipt', 'Completed: succeeded. No evidence of a device effect.');
    assert.equal(await composer.getByText('Command receipt:', {exact: false}).count(), 0);
    await page.evaluate('window.conversationFixture.control(false)');
    await page.getByText('Read-only access. Controls require operator authority.', {exact: true}).waitFor();
    assert.equal(await disable.isDisabled(), true);
    await tool.locator('summary').click();
    assert.equal(await toolBody.isVisible(), true, 'read-only permits reading full saved tool text');
  } finally {
    await context.close();
  }
  process.stdout.write('Conversation state browser: labelled Details, usage, inert tool text, narrow layout, stale and reader state, and guarded explicit Resume passed.\n');
}
