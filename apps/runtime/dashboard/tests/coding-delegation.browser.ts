import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AxeBuilder} from '@axe-core/playwright';
import type {Browser} from 'playwright';
import {connectRemote} from '@jimmie-potts/sdk/remote';
import type {CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {feed, startWorld} from './harness.ts';

/** A delegation through the real runtime, gateway and page, with a fake worker connected by the coding-worker credential (Hub #502). */
export async function codingDelegationJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, coding: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  const worker = await connectRemote({url: world.url, source: 'bunny/parts/coding-worker', token: world.codingToken});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`); await feed(page, 'connected');
    const assistant = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await assistant.getByText('read_sessions, set_mode, delegate_coding', {exact: true}).waitFor();
    await assistant.getByText('Not connected', {exact: true}).waitFor();
    // The worker declares its endpoint through the real gateway: only its three families are granted.
    const work: CodingWork[] = [];
    const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: command => {work.push(command.data); return {status: 'accepted'};}});
    const enabled = await endpoint.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: randomUUID(), action: 'enable'}}, {timeoutMs: 5000});
    assert.equal(enabled.status, 'accepted');
    await assistant.getByText('Connected and idle', {exact: true}).waitFor();
    const enableAssistant = assistant.getByRole('button', {name: 'Enable conversation', exact: true}); await enableAssistant.focus(); await enableAssistant.press('Enter');
    await assistant.getByRole('button', {name: 'Disable conversation', exact: true}).waitFor();
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill('Please delegate: add a unit test for the readout generator.');
    const send = assistant.getByRole('button', {name: 'Send message', exact: true}); await send.focus(); await send.press('Enter');
    await assistant.getByText('Task status: waiting', {exact: true}).waitFor();
    const proposal = assistant.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText(/Delegation to the coding worker in repository/).waitFor();
    await proposal.getByText('agent-device-hub', {exact: true}).waitFor();
    await proposal.getByText(/Bound to coding worker revision \d+/).waitFor();
    const approve = proposal.getByRole('button', {name: 'Approve proposal', exact: true}); await approve.focus(); await approve.press('Enter');
    await assistant.getByRole('article', {name: 'Delegated work', exact: true}).getByText(/Waiting for the coding worker/).waitFor();
    await page.waitForFunction(() => true); assert.equal(work.length, 1); const started = work[0]; assert.ok(started?.action === 'start');
    assert.equal(started.repository, 'agent-device-hub'); assert.match(started.brief, /^Please delegate: add a unit test/);
    assert.equal(await assistant.getByRole('textbox', {name: 'Answer', exact: true}).count(), 0, 'no answer box while the worker runs');
    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'started'}});
    await assistant.getByText(/Running task [0-9a-f]{8} \(started\)/).waitFor();
    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'completed',
      result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: ['scripts/tests/readout.test.mjs'], checks: [{name: 'node --test', status: 'passed'}],
        findings: [], limitations: ['No browser check applies.'], summary: 'Added the test; it passes.', sessionId: null, usage: {turns: 7, costUsd: 0.21, durationMs: 90000}}}});
    await assistant.getByText('Task status: succeeded', {exact: true}).waitFor();
    const messages = assistant.getByRole('list', {name: 'Saved conversation messages', exact: true});
    await messages.getByRole('article', {name: 'tool message', exact: true}).getByText(/^completed \(tested-candidate\): Added the test; it passes\./).waitFor();
    await messages.getByText(/coding worker: completed/).waitFor();
    await assistant.getByText('Connected and idle', {exact: true}).waitFor();
    assert.deepEqual((await new AxeBuilder({page}).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id), []);
    assert.equal(JSON.stringify(world.logs).includes('readout generator'), false, 'briefs reach no diagnostic record');
    assert.deepEqual(errors, []);
  } finally {await worker.close(); await context.close(); await world.close();}
  process.stdout.write('Coding delegation browser: worker endpoint through the real gateway, proposal with repository and bound revision, approval by keyboard, delegated wait without an answer box, worker status, result as a tool message and axe passed.\n');
}
