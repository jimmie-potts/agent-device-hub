import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {Browser} from 'playwright';

/** Mount the real page with copy events and saved-question reads that a healthy runtime cannot manufacture. */
export async function conversationStateJourney(browser: Browser): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AssistantPage} from '../../../../modules/companions/src/frontend/assistant.tsx';
    import {Command} from '../src/command-control.tsx';
    import {Facts, Select} from '../src/ui.tsx';
    const fixture = window.conversationFixture = {commands: [], reads: 0};
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
      if (variant === 'uncertain') task = {...task, status: 'uncertain', questionId: null, code: 'uncertain-result'};
      state.revision += 1;
      state.tasks = [task];
      notify({type: 'updated', message: {data: {...state}}});
    };
    const api = {
      read: async () => {
        fixture.reads += 1;
        return {version: 2, profile: 'bunny', conversationId: 'saved-conversation', older: null,
          currentTask: {taskId: task.taskId, question}, messages: [{id: 'saved-message', seq: 1, taskId: task.taskId, role: 'owner', text: 'Synthetic retained message', atMs: 0}]};
      },
      sync: async (families, callback) => {
        if (!families.includes('assistant-state')) return {status: 'rejected'};
        notify = callback;
        return {status: 'synced', copy: {states: () => [{data: {...state}}], close: async () => {}}};
      },
      command: accepted, upload: accepted,
    };
    createRoot(document.getElementById('root')).render(React.createElement(AssistantPage, {
      context: {api, ui: {Command, Facts, Select}, connected: true, control: true, operations: [], operationsLive: true},
    }));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'conversation-state-entry.js'},
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, loader: {'.css': 'empty'}});
  const context = await browser.newContext();
  try {
    const script = bundle.outputFiles[0]?.text ?? assert.fail('conversation state bundle');
    await context.route('https://conversation-state.invalid/**', route => route.fulfill(new URL(route.request().url()).pathname === '/bundle.js'
      ? {contentType: 'text/javascript', body: script}
      : {contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic Conversation state</title><div id="root"></div><script type="module" src="/bundle.js"></script>'}));
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto('https://conversation-state.invalid/');
    const approve = page.getByRole('button', {name: 'Approve proposal', exact: true});
    const resume = page.getByRole('button', {name: 'Resume task', exact: true});
    const retained = page.getByRole('list', {name: 'Saved conversation messages'}).getByText('Synthetic retained message', {exact: true});
    await approve.waitFor();
    assert.equal(await approve.isEnabled(), true);
    await page.evaluate("window.conversationFixture.update('removed')");
    await page.getByRole('status').filter({hasText: 'Stale.'}).waitFor();
    assert.equal(await approve.isDisabled(), true);
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
    await page.getByText('Task status: paused', {exact: true}).waitFor();
    assert.equal(await resume.count(), 0, 'paused with an unanswered question cannot resume');
    await page.evaluate("window.conversationFixture.update('uncertain')");
    await page.getByText('Task status: Uncertain outcome', {exact: true}).waitFor();
    assert.equal(await resume.isEnabled(), true);
    assert.equal(await page.evaluate<number>('window.conversationFixture.commands.length'), 0, 'state changes never send a command');
    await resume.click();
    assert.deepEqual(await page.evaluate('window.conversationFixture.commands.map(command => [command.family, command.data.action, command.data.taskId])'),
      [['assistant-control', 'resume', 'saved-task']], 'Resume sends only the existing explicit control');
  } finally {
    await context.close();
  }
  process.stdout.write('Conversation state browser: stale removal, missing or mismatched current question, and guarded explicit Resume passed.\n');
}
