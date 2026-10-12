import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId, type Identity, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import {observation, sessionStarted, turnStarted, approvalPrompt} from './fixtures/agents.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

for (const provider of ['codex', 'claude'] as const) it(`${provider} core publishes one first-live attributed companion opportunity`, async context => {
  const opportunities: Message<{session: string; origin: {id: string; source: string}; generation: number; occurredAtMs: number | null; observedAtMs: number}>[] = [];
  const watcher = fixture('companion-watcher', async ({sdk}) => {
    await sdk.subscribe('bunny.event.companion-opportunity.*', message => {opportunities.push(message as typeof opportunities[number]);});
  });
  const core = createCoreModule();
  await run(context, {modules: [core, watcher]});
  const identity: Identity = {provider, client: provider === 'codex' ? 'cli' : 'code', hostId: 'host-companion-test', sourceId: `${provider}-test`, sessionId: 'session-test'};
  const sdk = contextOf(watcher).sdk;
  const send = async (event: Parameters<typeof observation>[0], sequence: number) => {
    const value = observation(event, Date.now(), {identity, sequence, nativeEventId: `native-${sequence}`});
    return sdk.publish(value.key, value.draft);
  };
  await send(sessionStarted, 1); await send(turnStarted, 2);
  const raised = await send(approvalPrompt('approval-test'), 3);
  await waitFor(async () => {
    const copy = await sdk.sync<SessionRecord>(['session'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
    if (copy.status !== 'synced') return false;
    const ready = copy.copy.states().some(state => state.data.attention.length === 1);
    await copy.copy.close(); return ready;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(opportunities.length, 1, 'normal core reduction creates one Reachy opportunity');
  assert.equal(opportunities[0]?.data.session, sessionEntityId(identity));
  assert.equal(opportunities[0]?.data.origin.source, 'bunny/core');
  assert.equal(opportunities[0]?.data.occurredAtMs, null, 'observation time never invents an occurrence time');
  assert.ok((opportunities[0]?.data.observedAtMs ?? 0) > 0);
  assert.ok((opportunities[0]?.data.generation ?? 0) > 0);
  await sdk.publishMessage(`bunny.event.lifecycle.${sessionEntityId(identity)}`, raised);
  await send(approvalPrompt('approval-test'), 3);
  const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
  if (synced.status === 'synced') await synced.copy.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(opportunities.length, 1, 'duplicates, stale ordering and snapshot cannot mint another opportunity');
});

it('a recovered core outbox occurrence is observable history but never a new companion opportunity', async context => {
  const opportunities: Message<unknown>[] = [], raisedMessages: Message<unknown>[] = [];
  const watcher = fixture('companion-recovery', async ({sdk}) => {
    await sdk.subscribe('bunny.event.companion-opportunity.*', message => {opportunities.push(message);});
    await sdk.subscribe('bunny.event.attention-raised.*', message => {raisedMessages.push(message);});
  });
  const core = createCoreModule();
  const start = core.start.bind(core);
  let failed = false;
  core.start = context => start({...context, sdk: {...context.sdk, publishMessage(key, message) {
    if (!failed && message.type === 'org.bunny.attention.raised') {failed = true; return Promise.reject(new Error('synthetic-first-publication-refused'));}
    return context.sdk.publishMessage(key, message);
  }}});
  await run(context, {modules: [core, watcher]});
  const sdk = contextOf(watcher).sdk;
  const send = async (event: Parameters<typeof observation>[0], sequence: number, turn = 'turn-1') => {
    const value = observation(event, Date.now(), {sequence, turn}); await sdk.publish(value.key, value.draft);
    await new Promise(resolve => setTimeout(resolve, 30));
  };
  await send(sessionStarted, 1); await send(turnStarted, 2); await send(approvalPrompt('outbox-approval'), 3);
  assert.equal(failed, true); assert.equal(opportunities.length, 0); assert.equal(raisedMessages.length, 0);
  await send(turnStarted, 4, 'turn-2');
  await waitFor(() => raisedMessages.length === 1);
  assert.equal(opportunities.length, 0, 'the recovered publication has no first-live eligibility');
});
