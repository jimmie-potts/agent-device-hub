import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
    const details = assistant.getByRole('dialog', {name: 'Conversation details', exact: true});
    const detailsToggle = assistant.getByRole('button', {name: 'Details', exact: true});
    const closeDetails = details.getByRole('button', {name: 'Close details', exact: true});
    await detailsToggle.click();
    await details.getByText('Capabilities', {exact: true}).click();
    await assistant.getByText('read_sessions, set_mode, delegate_coding', {exact: true}).waitFor();
    await assistant.getByText('Not connected', {exact: true}).waitFor();
    // The worker declares its endpoint through the real gateway: only its three families are granted.
    const work: CodingWork[] = [];
    const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: command => {work.push(command.data); return {status: 'accepted'};}});
    const enabled = await endpoint.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: randomUUID(), action: 'enable'}}, {timeoutMs: 5000});
    assert.equal(enabled.status, 'accepted');
    await assistant.getByText('Connected and idle', {exact: true}).waitFor();
    const enableAssistant = assistant.getByRole('button', {name: 'Enable conversation', exact: true}); await enableAssistant.focus(); await enableAssistant.press('Enter');
    await details.getByText('Conversation settings', {exact: true}).click();
    await details.getByRole('button', {name: 'Disable conversation', exact: true}).waitFor();
    await closeDetails.click();
    const briefEnd = 'End of the synthetic brief.';
    const brief = ['Please delegate: add a unit test for the readout generator.',
      ...Array.from({length: 10}, () => 'Keep the test fixture deterministic.'), briefEnd].join('\n');
    await assistant.getByRole('textbox', {name: 'Message', exact: true}).fill(brief);
    const send = assistant.getByRole('button', {name: 'Send', exact: true}); await send.focus(); await send.press('Enter');
    const proposal = assistant.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText(/Delegation to the coding worker in repository/).waitFor();
    await proposal.getByText('agent-device-hub', {exact: true}).waitFor();
    await proposal.getByText(/Bound to coding worker revision \d+/).waitFor();
    // The rail marks a conversation that needs the owner (Hub #1890): an approval does, the wait on the worker does not.
    const railMarker = page.getByRole('navigation', {name: 'Conversations', exact: true}).locator('a[data-profile="bunny"] .rail-attention');
    await railMarker.waitFor();
    assert.equal(await send.count(), 0, 'a proposal has only explicit decision actions');
    await assistant.getByRole('button', {name: /^Voice /}).waitFor();
    const approve = proposal.getByRole('button', {name: 'Approve proposal', exact: true});
    await page.setViewportSize({width: 640, height: 700});
    await page.locator('html').evaluate(node => {node.style.zoom = '2';});
    await proposal.getByText(brief, {exact: true}).waitFor();
    const actions = [proposal.getByRole('button', {name: 'Decline proposal', exact: true}),
      assistant.getByRole('button', {name: 'Cancel task', exact: true}), approve];
    for (const action of actions) {
      await action.focus();
      const bounds = await action.boundingBox();
      assert.ok(bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 641 && bounds.y >= 0 && bounds.y + bounds.height <= 700,
        'every proposal action can be focused and scrolled into view at 200% zoom');
    }
    assert.ok(await proposal.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'the full proposal wraps inside the composer');
    await approve.press('Enter');
    await page.locator('html').evaluate(node => {node.style.zoom = '';});
    await page.setViewportSize({width: 1280, height: 1000});
    const messages = assistant.getByRole('list', {name: 'Saved conversation messages', exact: true});
    const receipt = messages.locator('[data-role="assistant"]').getByText(/^Coding job .* was queued/);
    await receipt.waitFor();
    await assistant.getByText('Task completed', {exact: true}).waitFor();
    assert.equal(await railMarker.count(), 0, 'a background job does not mark a chat as needing the owner');
    for (let waited = 0; work.length === 0 && waited < 100; waited += 1) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(work.length, 1); const started = work[0]; assert.ok(started?.action === 'start');
    assert.equal(started.repository, 'agent-device-hub'); assert.equal(started.brief, brief);
    assert.equal(await assistant.getByRole('textbox', {name: 'Answer', exact: true}).count(), 0, 'no answer box while the worker runs');
    assert.equal(await send.count(), 1, 'Send is available while the worker runs');
    assert.equal(await send.isDisabled(), true, 'with nothing typed, nothing is sent');
    await assistant.getByRole('button', {name: /^Voice /}).waitFor();
    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'started'}});
    await detailsToggle.click();
    await details.getByText(/Running task [0-9a-f]{8} \(started\)/).waitFor();
    await endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data: {operationId: started.operationId, status: 'completed',
      result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: ['scripts/tests/readout.test.mjs'], checks: [{name: 'node --test', status: 'passed'}],
        findings: [], limitations: ['No browser check applies.'], summary: 'Added the test; it passes.', sessionId: null, usage: {turns: 7, costUsd: 0.21, durationMs: 90000}}}});
    const result = messages.locator('[data-role="assistant"]').filter({hasText: /completed \(tested-candidate\): Added the test; it passes\./});
    await result.getByText('Update to earlier reply').waitFor();
    await result.getByRole('link', {name: 'Update to earlier reply'}).click();
    assert.equal(await page.locator(':focus').getAttribute('data-message'), `${started.operationId}-job`);
    await details.getByText('Connected and idle', {exact: true}).waitFor();
    assert.equal(JSON.stringify(world.logs).includes('readout generator'), false, 'briefs reach no diagnostic record');
    assert.deepEqual(errors, []);
  } finally {await worker.close(); await context.close(); await world.close();}
  process.stdout.write('Coding delegation browser: worker endpoint through the real gateway, proposal with repository and bound revision, approval by keyboard, background job receipt, free composer, worker status and result linked to the original receipt passed.\n');
}
