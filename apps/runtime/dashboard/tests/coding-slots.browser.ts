import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {Browser, Page} from 'playwright';
import {connectRemote, type RemoteEndpoint} from '@jimmie-potts/sdk/remote';
import type {CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {feed, startWorld} from './harness.ts';

/**
 * Coding-worker slots through the real runtime, gateway and page (Hub #2028), with fake workers on the coding-worker
 * credential. A three-slot worker runs B.U.N.N.Y.'s and Reachy's hand-offs at once, tagged, and the details show its
 * slots and plan usage windows. An older worker that declares no slots holds one run for every companion, so Reachy's
 * approved hand-off waits, worded as busy, and is sent by itself when B.U.N.N.Y.'s run ends. `shots` names a directory
 * for screenshots of each state; the suite passes none.
 */
export async function codingSlotsJourney(browser: Browser, shots?: string): Promise<void> {
  const world = await startWorld({companions: true, coding: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().message);});
  const worker = await connectRemote({url: world.url, source: 'bunny/parts/coding-worker', token: world.codingToken});
  const shot = async (page: Page, name: string): Promise<void> => {if (shots !== undefined) await page.screenshot({path: join(shots, `${name}.png`), fullPage: false});};
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`); await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const details = conversation.getByRole('dialog', {name: 'Conversation details', exact: true});
    const detailsToggle = conversation.getByRole('button', {name: 'Details', exact: true});
    const closeDetails = details.getByRole('button', {name: 'Close details', exact: true});
    const navigation = page.getByRole('navigation', {name: 'Conversations', exact: true});
    const work: CodingWork[] = [];
    const open = async (dataschema: string, data: Record<string, unknown>): Promise<RemoteEndpoint> => {
      const endpoint = await worker.openEndpoint<CodingWork>({family: 'coding-work', respond: command => {work.push(command.data); return {status: 'accepted'};}});
      const enabled = await endpoint.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema, data: {requestId: randomUUID(), action: 'enable', ...data}}, {timeoutMs: 5000});
      assert.equal(enabled.status, 'accepted');
      return endpoint;
    };
    const report = (endpoint: RemoteEndpoint, data: object) => endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.1', data});
    const result = (summary: string) => ({outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: [], checks: [], findings: [], limitations: [], summary, sessionId: null, usage: null});
    const starts = (): Extract<CodingWork, {action: 'start'}>[] => work.flatMap(entry => entry.action === 'start' ? [entry] : []);
    const waitFor = async (check: () => boolean, what: string): Promise<void> => {
      for (let waited = 0; !check() && waited < 100; waited += 1) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(check(), what);
    };
    const select = async (profile: 'bunny' | 'reachy', heading: string): Promise<void> => {
      await navigation.locator(`a[data-profile="${profile}"]`).click();
      await conversation.getByRole('heading', {name: heading, exact: true}).waitFor();
    };
    const delegate = async (text: string): Promise<void> => {
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
      const send = conversation.getByRole('button', {name: 'Send', exact: true}); await send.focus(); await send.press('Enter');
      await conversation.getByRole('article', {name: 'Proposed command', exact: true}).getByText(/Delegation to the coding worker in repository/).waitFor();
    };
    const approve = async (): Promise<void> => {
      const button = conversation.getByRole('article', {name: 'Proposed command', exact: true}).getByRole('button', {name: 'Approve proposal', exact: true});
      await button.focus(); await button.press('Enter');
      await conversation.getByRole('article', {name: 'Delegated work', exact: true}).waitFor();
    };

    // A three-slot worker that reported plan usage after an earlier run.
    const slotted = await open('https://bunny.invalid/events/coding-endpoint/2.2', {slots: 3, readiness: {tool: 'claude-code', installed: 'yes', version: '2.1.292', signedIn: 'yes', plan: 'max',
      limits: [{window: 'five-hour', status: 'allowed', resetsAtMs: Date.parse('2026-11-24T20:00:00Z'), utilization: 42}, {window: 'seven-day', status: 'allowed-warning', resetsAtMs: Date.parse('2026-11-28T09:00:00Z'), utilization: 81}],
      limitsObservedAtMs: Date.parse('2026-11-24T15:00:00Z'), checkedAtMs: Date.parse('2026-11-24T15:00:00Z')}});
    await detailsToggle.click();
    await details.getByText('Capabilities', {exact: true}).click();
    await details.getByText('Connected and idle', {exact: true}).waitFor();
    await details.getByText(/^five-hour: 42% used, resets [^;]+; seven-day: 81% used \(warning\), resets [^;]+; as of [^;]+$/).waitFor();
    await details.getByText('Conversation settings', {exact: true}).click();
    await details.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await details.getByRole('button', {name: 'Disable conversation', exact: true}).waitFor();
    await shot(page, '01-three-slot-worker-plan-usage');
    await closeDetails.click();
    await delegate('Please delegate: add a synthetic test for B.U.N.N.Y.'); await approve();
    await waitFor(() => starts().length === 1, 'B.U.N.N.Y.\'s start reached the worker');
    await select('reachy', 'Reachy');
    await delegate('Please delegate: add a synthetic test for Reachy.');
    assert.equal(await conversation.getByText(/slot is taken/).count(), 0, 'Reachy\'s own slot is free');
    await approve();
    await waitFor(() => starts().length === 2, 'Reachy\'s start reached the worker at once');
    assert.deepEqual(starts().map(entry => entry.companion), ['bunny', 'reachy'], 'each run is tagged with its companion');
    await detailsToggle.click();
    await details.getByText('Connected, 2 of 3 slots busy', {exact: true}).waitFor();
    await details.getByText(/^Running task [0-9a-f]{8} \(dispatching\)$/).waitFor();
    await shot(page, '02-two-companions-running');
    await closeDetails.click();
    for (const [index, entry] of starts().entries()) {
      await report(slotted, {operationId: entry.operationId, status: 'started'});
      await report(slotted, {operationId: entry.operationId, status: 'completed', result: result(`Synthetic result ${String(index + 1)}.`)});
    }
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    await select('bunny', 'B.U.N.N.Y.');
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    const off = await slotted.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.2', data: {requestId: randomUUID(), action: 'disable'}}, {timeoutMs: 5000});
    assert.equal(off.status, 'accepted'); await slotted.close();

    // An older worker declares no slots: one run at a time for every companion.
    const older = await open('https://bunny.invalid/events/coding-endpoint/2.0', {});
    await delegate('Please delegate: another synthetic test for B.U.N.N.Y.'); await approve();
    await waitFor(() => starts().length === 3, 'B.U.N.N.Y.\'s start reached the older worker');
    assert.equal(starts()[2]?.companion, undefined, 'an older worker gets an untagged start');
    await select('reachy', 'Reachy');
    await delegate('Please delegate: another synthetic test for Reachy.');
    const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText(/The coding worker is busy: Reachy's slot is taken, so if you approve, this hand-off waits/).waitFor();
    await proposal.getByText(/Brief: Please delegate: another synthetic test for Reachy\. Bound to/).waitFor();
    assert.equal(await conversation.getByText(/No coding worker is connected/).count(), 0);
    await shot(page, '03-busy-slot-approval');
    await approve();
    const delegated = conversation.getByRole('article', {name: 'Delegated work', exact: true});
    await delegated.getByText(/^Waiting for the coding worker: it is busy, and this hand-off starts when Reachy's slot frees\. Nothing has been sent yet; Cancel task removes it\.$/).waitFor();
    await conversation.getByRole('button', {name: 'Cancel task', exact: true}).waitFor();
    await detailsToggle.click();
    await details.getByText('Connected, 1 of 1 slot busy; 1 hand-off waiting', {exact: true}).waitFor();
    await shot(page, '04-hand-off-waiting');
    await closeDetails.click();
    assert.equal(starts().length, 3, 'nothing was sent for the waiting hand-off');
    // B.U.N.N.Y.'s run ends: Reachy's waiting hand-off is sent by itself.
    const bunnyRun = starts()[2] ?? assert.fail('B.U.N.N.Y. start');
    await report(older, {operationId: bunnyRun.operationId, status: 'started'});
    await report(older, {operationId: bunnyRun.operationId, status: 'completed', result: result('Synthetic older-worker result.')});
    await waitFor(() => starts().length === 4, 'the waiting hand-off was sent when the slot freed');
    await delegated.getByText(/^Waiting for the coding worker on your computer\./).waitFor();
    const reachyRun = starts()[3] ?? assert.fail('Reachy start');
    assert.equal(reachyRun.brief, 'Please delegate: another synthetic test for Reachy.');
    await report(older, {operationId: reachyRun.operationId, status: 'started'});
    await report(older, {operationId: reachyRun.operationId, status: 'completed', result: result('Synthetic waited result.')});
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    await shot(page, '05-waited-hand-off-completed');
    assert.equal(starts().filter(entry => entry.operationId === reachyRun.operationId).length, 1, 'sent once');
    assert.equal(JSON.stringify(world.logs).includes('synthetic test for Reachy'), false, 'briefs reach no diagnostic record');
    assert.deepEqual(errors, []);
  } finally {await worker.close(); await context.close(); await world.close();}
  process.stdout.write('Coding slots browser: three-slot worker with plan usage, two companions running at once with tagged starts, an older worker\'s one slot making an approved hand-off wait worded as busy, and its automatic single send when the slot freed passed.\n');
}
