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
          input: {repository: 'agent-device-hub', brief: owner.text,
            ...(owner.text.includes('source fixture') ? {destination: 'pc', harness: 'claude-code'} : {})}}], stop: 'tool', units: 20});
      }
      return Promise.resolve({text: 'Hub fixture answered.', calls: [], stop: 'end', units: 20});
    },
  }});
  const context = await browser.newContext();
  const worker = await connectRemote({url: world.url, source: 'bunny/parts/coding-worker', token: world.codingToken});
  const commands: CodingWork[] = [], prepared: Extract<CodingWork, {action: 'prepare-native-client'}>[] = [];
  let acceptMessage = (): void => {};
  const pendingMessage = new Promise<void>(resolve => {acceptMessage = resolve;});
  const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: async command => {
    if (command.data.action === 'prepare-native-client') {prepared.push(command.data); return {status: 'accepted'};}
    commands.push(command.data);
    if (command.data.action === 'message') await pendingMessage;
    return {status: 'accepted'};
  }});
  try {
    const enabled = await endpoint.request('coding-endpoint', {
      type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.4',
      data: {requestId: randomUUID(), action: 'enable', capacity: 'uncapped', harnesses: [{
        harness: 'claude-code', capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
        installed: 'yes', version: 'synthetic', signedIn: 'yes', plan: 'max', limits: null, limitsObservedAtMs: null, checkedAtMs: Date.now(),
      }, {
        harness: 'codex', capabilities: {steering: 'live', resume: 'unsupported', review: true},
        installed: 'yes', version: 'synthetic', signedIn: 'yes', plan: 'plus', limits: null, limitsObservedAtMs: null, checkedAtMs: Date.now(),
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
    const approve = async (name: string, harness: 'auto' | 'codex' = 'auto', destination: 'auto' | 'mac' = 'auto') => {
      await send(`Please delegate the ${name} logging check.`);
      const approval = conversation.getByRole('button', {name: 'Approve proposal', exact: true});
      const choices = conversation.getByRole('combobox', {name: 'Coding harness'});
      await choices.waitFor();
      assert.equal(await choices.inputValue(), 'auto');
      assert.deepEqual(await choices.getByRole('option').allTextContents(), ['Auto', 'Claude Code', 'Codex']);
      const destinations = conversation.getByRole('combobox', {name: 'Execution destination'});
      assert.equal(await destinations.inputValue(), 'auto');
      assert.deepEqual(await destinations.getByRole('option').allTextContents(), ['Auto', 'Mac', 'PC', 'Cloud']);
      if (harness !== 'auto') await choices.selectOption(harness);
      if (destination !== 'auto') await destinations.selectOption(destination);
      assert.equal(await choices.inputValue(), harness);
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
    assert.ok(first.action === 'start' && first.harness === 'claude-code');
    await progress({operationId: first.operationId, status: 'started', setup: 'ready', harness: 'claude-code', sessionId: 'fixture-alpha-session'});
    const newConversation = conversation.getByRole('button', {name: 'New conversation', exact: true});
    await newConversation.click();
    await approve('beta', 'codex', 'mac');
    await waitFor(() => commands.length === 2);
    const second = commands[1] ?? assert.fail('second job missing');
    assert.ok(second.action === 'start' && second.harness === 'codex');
    await progress({operationId: second.operationId, status: 'started', setup: 'ready', harness: 'codex', sessionId: 'fixture-beta-session'});
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
    await card(second).getByText('fixture-beta-session', {exact: true}).waitFor();
    await card(second).getByText('fixture-model', {exact: true}).waitFor();
    await card(second).getByText('bunny-fixture-beta', {exact: true}).waitFor();
    const fact = (name: string) => card(second).locator('dt').filter({hasText: new RegExp(`^${name}$`)}).locator('xpath=following-sibling::dd[1]');
    assert.equal(await fact('Requested harness').innerText(), 'Codex');
    assert.equal(await fact('Requested destination').innerText(), 'Mac');
    assert.equal(await fact('Actual destination').innerText(), 'Mac');
    assert.notEqual(await fact('Selection reason').innerText(), '');
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
    await progress({operationId: first.operationId, status: 'native-client', clients: ['terminal', 'claude-desktop'], state: 'available', observedAtMs: Date.now()}, '2.6');
    await card(first).getByText('Native clients', {exact: true}).click();
    await card(second).getByText('Native clients', {exact: true}).click();
    const native = 'Continue saved session in terminal';
    assert.equal(await card(second).getByRole('button', {name: native}).count(), 0);
    await card(first).getByRole('button', {name: 'Hand off saved session to Claude Desktop'}).click();
    await waitFor(() => commands.length === 5);
    assert.deepEqual(commands.slice(4).map(command => [command.action, command.operationId]), [['open-claude-desktop', first.operationId]]);
    await progress({operationId: first.operationId, status: 'native-client', clients: ['terminal', 'claude-desktop'], state: 'desktop', observedAtMs: Date.now()}, '2.6');
    await card(first).getByText('Claude Desktop, activity unobserved', {exact: true}).waitFor();
    await page.reload();
    await card(first).getByText(/ · cancelled$/).waitFor();
    await card(first).getByText('Attempts and results', {exact: true}).click();
    await card(first).getByText(/Continuation requires a stopped, confined writer/).waitFor();
    await card(second).getByText('fixture-beta-session', {exact: true}).waitFor();
    await card(second).getByText('fixture-model', {exact: true}).waitFor();
    await card(second).getByText('bunny-fixture-beta', {exact: true}).waitFor();
    assert.equal(await fact('Requested destination').innerText(), 'Mac');
    assert.equal(await fact('Actual destination').innerText(), 'Mac');
    await card(second).getByText(/Input observed in the native turn/).waitFor();
    await card(first).getByRole('link', {name: 'Open original conversation'}).click();
    await conversation.locator('.conversation-message-text').filter({hasText: /^Please delegate the alpha logging check\.$/}).waitFor();
    await conversation.getByText(/Earlier conversation, read only/).waitFor();
    await conversation.getByRole('button', {name: 'Back to current conversation'}).click();
    await conversation.getByRole('button', {name: 'Approve proposal', exact: true}).waitFor();
    assert.equal(commands.length, 5, 'pending approval stayed in Conversation');
    await page.goto(`${world.url}/#/module/companions/jobs`);
    await card(first).getByText('Attempts and results', {exact: true}).click();
    assert.equal(await card(first).getByRole('button', {name: /^Continue with/}).count(), 0);
    await card(second).getByRole('button', {name: /Stop coding job/}).click();
    await waitFor(() => commands.length === 6);
    const handoffToken = randomUUID();
    const revision = 'a'.repeat(40);
    await progress({operationId: second.operationId, status: 'cancelled', reason: 'cancelled', harness: 'codex',
      sessionId: 'fixture-beta-session', handoffToken, result: {outcome: 'incomplete', repository: 'agent-device-hub',
        base: revision, head: revision, changedFiles: ['fixture.ts'], checks: [], findings: [], limitations: [],
        summary: 'Synthetic partial work.', sessionId: 'fixture-beta-session', usage: null}}, '2.4');
    await card(second).getByText('Attempts and results', {exact: true}).click();
    await progress({operationId: second.operationId, status: 'native-client', clients: ['terminal'], state: 'available', observedAtMs: Date.now()}, '2.6');
    await card(second).getByText('Native clients', {exact: true}).click();
    await card(second).getByRole('button', {name: native}).waitFor();
    await card(second).getByRole('button', {name: 'Continue with Claude Code', exact: true}).press('Enter');
    await waitFor(() => commands.length === 7);
    const continuation = commands[6];
    assert.ok(continuation?.action === 'start' && continuation.harness === 'claude-code');
    assert.deepEqual(continuation.continuation, {fromOperationId: second.operationId, token: handoffToken});
    assert.notEqual(continuation.operationId, second.operationId);
    await card(second).locator('dd').filter({hasText: continuation.operationId}).waitFor();
    await card(second).locator('code').filter({hasText: second.operationId}).waitFor();
    assert.equal(await card(second).getByRole('button', {name: /^Continue with/}).count(), 0);
    assert.equal(await card(second).getByRole('button', {name: native}).count(), 0);
    const nativeSession = 'fixture-continued-native';
    await progress({operationId: continuation.operationId, status: 'started', setup: 'ready', harness: 'claude-code', sessionId: nativeSession});
    await progress({operationId: continuation.operationId, status: 'completed', harness: 'claude-code', sessionId: nativeSession,
      result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: revision, head: revision,
        changedFiles: ['fixture.ts'], checks: [], findings: [], limitations: [],
        summary: 'Synthetic continued work.', sessionId: nativeSession, usage: null}});
    await card(second).getByText(/ · completed$/).waitFor();
    await page.reload();
    await card(second).getByText(/ · completed$/).waitFor();
    await card(second).locator('dd').filter({hasText: nativeSession}).waitFor();
    await card(second).locator('dd').filter({hasText: 'claude-code'}).waitFor();

    const successor = continuation.operationId;
    await progress({operationId: successor, status: 'native-client', clients: ['terminal'], state: 'available', observedAtMs: Date.now()}, '2.6');
    const nativeDetails = card(second).locator('details').filter({has: page.getByText('Native clients', {exact: true})});
    if (!await nativeDetails.evaluate(element => element.hasAttribute('open'))) await card(second).getByText('Native clients', {exact: true}).click();
    await card(second).getByRole('button', {name: native}).click();
    await waitFor(() => commands.length === 8);
    const nativeLaunch = commands[7];
    assert.ok(nativeLaunch?.action === 'open-native-terminal');
    assert.equal(nativeLaunch.operationId, successor);
    assert.deepEqual(prepared.at(-1), {requestId: nativeLaunch.intentId, operationId: successor, action: 'prepare-native-client', client: 'terminal'});
    await progress({operationId: successor, status: 'native-client', clients: ['terminal'], state: 'terminal-pending', observedAtMs: Date.now()}, '2.6');
    await card(second).getByText('Reserved for terminal, launch unconfirmed', {exact: true}).waitFor();
    assert.equal(await card(second).getByText('Native terminal', {exact: true}).count(), 0);
    await progress({operationId: successor, status: 'native-client', clients: ['terminal'], state: 'terminal', observedAtMs: Date.now()}, '2.6');
    await card(second).getByText('Native terminal', {exact: true}).waitFor();
    await progress({operationId: successor, status: 'native-client', clients: ['terminal'], state: 'terminal-closed', observedAtMs: Date.now()}, '2.6');
    await card(second).getByText('Terminal exited, writer release unverified', {exact: true}).waitFor();
    assert.equal(await card(second).getByRole('button', {name: native}).count(), 0);

    await jobs.locator('summary').filter({hasText: /^New coding job$/u}).click();
    await jobs.getByRole('combobox', {name: 'Companion'}).selectOption('reachy');
    await jobs.getByRole('combobox', {name: 'Coding harness'}).selectOption('codex');
    await jobs.getByRole('combobox', {name: 'Execution destination'}).selectOption('cloud');
    await jobs.getByRole('link', {name: 'Continue in Conversation'}).press('Enter');
    const reachy = page.getByRole('region', {name: 'B.U.N.N.Y. conversation'});
    await reachy.getByRole('heading', {name: 'Reachy', exact: true}).waitFor();
    const draft = reachy.getByRole('form', {name: 'New coding job'});
    assert.equal(await draft.getByRole('combobox', {name: 'Coding harness'}).inputValue(), 'codex');
    assert.equal(await draft.getByRole('combobox', {name: 'Execution destination'}).inputValue(), 'cloud');
    await draft.getByRole('textbox', {name: 'Job brief'}).fill('Check the source fixture in agent-device-hub.');
    await draft.getByRole('button', {name: 'Request coding job'}).click();
    const proposed = reachy.getByRole('article', {name: 'Proposed command'});
    assert.equal(await proposed.getByRole('combobox', {name: 'Coding harness'}).inputValue(), 'codex');
    assert.equal(await proposed.getByRole('combobox', {name: 'Execution destination'}).inputValue(), 'cloud');
    assert.equal(commands.length, 8, 'a request originating in Jobs still waits for owner approval');
    await proposed.getByRole('button', {name: 'Approve proposal'}).click();
    await reachy.getByText(/refused: unavailable.*cloud.*eligible alternatives: mac/i).waitFor();
    assert.equal(commands.length, 8, 'an unavailable explicit Cloud request sends nothing to the Mac');
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await page.locator('.rail-conversations').getByRole('link', {name: /B\.U\.N\.N\.Y\./u}).click();
    await conversation.getByRole('button', {name: 'Approve proposal', exact: true}).waitFor();
  } finally {acceptMessage(); await worker.close(); await context.close(); await world.close();}
}
