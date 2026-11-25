import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Browser} from 'playwright';
import {connectRemote} from '@jimmie-potts/sdk/remote';
import type {CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {feed, startWorld} from './harness.ts';

export async function codingJobsJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, coding: true, assistantProvider: {
    name: 'synthetic', model: 'synthetic', turn: input => {
      const owner = input.transcript.find(item => item.role === 'owner');
      if (owner?.text.startsWith('Please delegate') === true && input.transcript.length === 1) {
        return Promise.resolve({text: null, calls: [{id: 'delegate', name: 'delegate_coding',
          input: {repository: 'agent-device-hub', brief: owner.text}}], stop: 'tool', units: 20});
      }
      return Promise.resolve({text: 'Hub fixture answered.', calls: [], stop: 'end', units: 20});
    },
  }});
  const context = await browser.newContext();
  const worker = await connectRemote({url: world.url, source: 'bunny/parts/coding-worker', token: world.codingToken});
  const commands: CodingWork[] = [];
  let acceptMessage = (): void => {};
  const pendingMessage = new Promise<void>(resolve => {acceptMessage = resolve;});
  const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: async command => {
    commands.push(command.data);
    if (command.data.action === 'message') await pendingMessage;
    return {status: 'accepted'};
  }});
  try {
    const enabled = await endpoint.request('coding-endpoint', {
      type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.4',
      data: {requestId: randomUUID(), action: 'enable', capacity: 'uncapped', harnesses: [{
        harness: 'claude-code', capabilities: {steering: 'live', resume: 'unsupported', review: true},
        installed: 'yes', version: 'synthetic', signedIn: 'yes', plan: null, limits: null, limitsObservedAtMs: null, checkedAtMs: Date.now(),
      }]},
    }, {timeoutMs: 5000});
    assert.equal(enabled.status, 'accepted', JSON.stringify(enabled));
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation'});
    const send = async (text: string) => {
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
      await conversation.locator('.conversation-composer-actions').getByRole('button', {name: text.startsWith('Tell the') ? 'Message job' : 'Send', exact: true}).click();
    };
    const approve = async (name: string) => {
      await send(`Please delegate the ${name} logging check.`);
      const approval = conversation.getByRole('button', {name: 'Approve proposal', exact: true});
      await approval.press('Enter');
      await conversation.getByText('Task completed', {exact: true}).waitFor();
    };
    const waitFor = async (check: () => boolean) => {
      for (let tries = 0; !check() && tries < 100; tries += 1) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(check());
    };
    const progress = (data: object, version = '2.3') => endpoint.publish('coding-progress', {
      kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: `https://bunny.invalid/events/coding-progress/${version}`, data,
    });
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await approve('alpha');
    await waitFor(() => commands.length === 1);
    const first = commands[0] ?? assert.fail('first job missing');
    await progress({operationId: first.operationId, status: 'started', setup: 'ready', harness: 'claude-code', sessionId: 'fixture-alpha-session'});
    const newConversation = conversation.getByRole('button', {name: 'New conversation', exact: true});
    await newConversation.click();
    await approve('beta');
    await waitFor(() => commands.length === 2);
    const second = commands[1] ?? assert.fail('second job missing');
    await progress({operationId: second.operationId, status: 'started', setup: 'ready', harness: 'claude-code', sessionId: 'fixture-beta-session'});
    await progress({operationId: second.operationId, status: 'attempt-context', branch: null, worktreeRef: 'bunny-fixture-beta', model: 'fixture-model'}, '2.5');

    await send('Tell the logging check job to retain the fixtures.');
    await conversation.getByText('Which job should receive this message?', {exact: true}).waitFor();
    assert.equal(commands.length, 2, 'an ambiguous instruction is local only');
    await send('Tell the beta logging check job to retain the fixtures.');
    await waitFor(() => commands.length === 3);
    const instruction = commands[2];
    assert.ok(instruction?.action === 'message');
    assert.equal(instruction.operationId, second.operationId);
    assert.equal(instruction.text, 'retain the fixtures.');
    await page.goto(`${world.url}/#/module/companions/jobs`);
    const jobs = page.getByRole('region', {name: 'Jobs', exact: true});
    const card = (run: CodingWork) => jobs.getByRole('article', {name: `Coding job ${run.operationId}-job`, exact: true});
    await card(first).getByText('fixture-alpha-session', {exact: true}).waitFor();
    await card(first).getByText('Attempts and results', {exact: true}).click();
    await card(first).getByText(/Continuation from Claude Code is unavailable/).waitFor();
    await card(second).getByText('fixture-beta-session', {exact: true}).waitFor();
    await card(second).getByText('fixture-model', {exact: true}).waitFor();
    await card(second).getByText('bunny-fixture-beta', {exact: true}).waitFor();
    await card(second).getByText('Queued in the Hub', {exact: true}).waitFor();
    acceptMessage();
    await card(second).getByText('Accepted by the harness', {exact: true}).waitFor();
    await progress({operationId: second.operationId, sessionId: 'fixture-beta-session', messageId: instruction.requestId, status: 'message-observed'}, '2.5');
    await card(second).getByText(/Input observed in the native turn/).waitFor();
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await send('What is the current Hub mode?');
    await conversation.getByText('What is the current Hub mode?', {exact: true}).waitFor();
    await conversation.getByText('Hub fixture answered.', {exact: true}).last().waitFor();
    assert.equal(commands.length, 3, 'ordinary chat sends no worker command');
    await send('Please delegate a third logging check.');
    await conversation.getByRole('button', {name: 'Approve proposal', exact: true}).waitFor();
    await page.goto(`${world.url}/#/module/companions/jobs`);
    await card(first).getByRole('button', {name: /Stop coding job/}).press('Enter');
    await waitFor(() => commands.length === 4);
    assert.deepEqual(commands.slice(3).map(command => [command.action, command.operationId]), [['cancel', first.operationId]]);
    await progress({operationId: first.operationId, status: 'cancelled', reason: 'cancelled', result: null, harness: 'claude-code'}, '2.3');
    await card(first).getByText(/ · cancelled$/).waitFor();
    await page.reload();
    await card(first).getByText(/ · cancelled$/).waitFor();
    await card(first).getByText('Attempts and results', {exact: true}).click();
    await card(first).getByText(/Continuation from Claude Code is unavailable/).waitFor();
    await card(second).getByText('fixture-beta-session', {exact: true}).waitFor();
    await card(second).getByText('fixture-model', {exact: true}).waitFor();
    await card(second).getByText('bunny-fixture-beta', {exact: true}).waitFor();
    await card(second).getByText(/Input observed in the native turn/).waitFor();
    await card(first).getByRole('link', {name: 'Open original conversation'}).click();
    await conversation.locator('.conversation-message-text').filter({hasText: /^Please delegate the alpha logging check\.$/}).waitFor();
    await conversation.getByText(/Earlier conversation, read only/).waitFor();
    await conversation.getByRole('button', {name: 'Back to current conversation'}).click();
    await conversation.getByRole('button', {name: 'Approve proposal', exact: true}).waitFor();
    assert.equal(commands.length, 4, 'pending approval stayed in Conversation');
  } finally {acceptMessage(); await worker.close(); await context.close(); await world.close();}
}
