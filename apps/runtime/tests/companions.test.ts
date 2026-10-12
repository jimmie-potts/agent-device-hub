import type {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {createCompanionsModule} from '@jimmie-potts/companions';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Draft, SendOptions} from '@jimmie-potts/sdk';
import type {CoreHandle} from '../src/core/core.js';
import {createCoreModule} from '../src/core/core.js';
import {approvalPrompt, approvalResolved, observation, sessionStarted, turnEnded, turnStarted} from './fixtures/agents.js';
import {contextOf, fixture, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

const START = Date.parse('2026-10-11T12:00:00Z');
async function setup(context: Parameters<Parameters<typeof it>[1]>[0], output: 'normal' | 'fail' | 'hang' = 'normal') {
  const clock = manualClock(START), module = createCompanionsModule();
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: value => {handle = value; return Promise.resolve();}}]});
  const realStart = module.start.bind(module);
  let database: DatabaseSync | undefined;
  module.start = context => {database = context.database(); return realStart({...context, sdk: {...context.sdk,
    publish<T extends object>(key: string, draft: Draft<T>, options?: SendOptions): Promise<Message<T>> {
      if (key === 'bunny.state.companion-state.reachy' && (draft.data as CompanionState).decision === 'awaiting-publication') {
        if (output === 'fail') return Promise.reject(new Error('synthetic-publication-failure'));
        if (output === 'hang') return new Promise(() => {});
      }
      return context.sdk.publish(key, draft, options);
    },
  }});};
  const watcher = fixture('companions-test');
  const directory = await stateDir(context);
  const {runtime} = await run(context, {stateDir: directory, modules: [core, module, watcher], clock: {now: clock.now}, scheduler: clock.scheduler});
  let count = 0;
  const command = (family: string, data: object) => core.actions.dispatch({key: `bunny.cmd.${family}.reachy`, requestedBy: 'bunny/parts/operator',
    requestId: `reachy-request-${++count}`, draft: {type: `org.bunny.${family.slice(0, family.lastIndexOf('-'))}.${family.slice(family.lastIndexOf('-') + 1)}.requested`,
      subject: 'reachy', dataschema: `https://bunny.invalid/events/${family}/2.0`, data}});
  const settings = async (enabled = true, muted: string[] = [], snooze = 'keep') => {
    const answer = await command('companion-settings-set', {expectedRevision: module.inspect()?.revision, enabled, muted, snooze});
    assert.ok(!('error' in answer), JSON.stringify(answer)); await flush();
  };
  let sequence = 0;
  const observe = async (event: Parameters<typeof observation>[0], turn: string | null = 'turn-1') => {
    const value = observation(event, clock.now(), {sequence: ++sequence, turn, nativeEventId: `reachy-native-${sequence}`});
    await contextOf(watcher).sdk.publish(value.key, value.draft); await flush(); await flush();
  };
  const advance = async (ms = 26) => {clock.advance(ms); for (let i = 0; i < 8; i += 1) await flush();};
  const attention = async () => {await observe(sessionStarted); await observe(turnStarted); await observe(approvalPrompt('attention-one')); await waitFor(() => module.pending() === 1);};
  const stored = (): {allowances: {live: {count: number}; scenario: {count: number}}; admissions: unknown[]; received: unknown[]} => {
    const row = database?.prepare('SELECT record FROM companion_state WHERE id=1').get() as {record: string};
    return JSON.parse(row.record) as ReturnType<typeof stored>;
  };
  return {stored, directory, clock, module, core, runtime, settings, observe, advance, attention, command, watcher, handle: () => handle};
}

it('optional Reachy leaves core attention usable when disabled, then presents one qualified quiet card', async context => {
  const w = await setup(context);
  await w.observe(sessionStarted); await w.observe(turnStarted); await w.observe(approvalPrompt('off-request'));
  assert.equal(w.module.inspect()?.presentation, null);
  assert.equal(w.module.inspect()?.decision, 'disabled');
  await w.settings(); await w.advance();
  assert.equal(w.module.inspect()?.presentation, null, 'enablement never replays the missed request');
  await w.observe(approvalResolved('off-request'));
  await w.observe(approvalPrompt('current-request')); await w.advance();
  const card = w.module.inspect()?.presentation;
  assert.equal(card?.opportunity.attention?.id.status === 'known' && card.opportunity.attention.id.id, 'current-request');
  assert.equal(card?.opportunity.evidence, 'lifecycle-metadata');
  assert.equal(card?.opportunity.identity?.provider, 'claude');
  assert.match(card?.text ?? '', /review|decision/);
  const states = await contextOf(w.watcher).sdk.sync<CompanionState>(['companion-state'], () => {}, {owner: 'bunny/modules/companions', timeoutMs: 2000});
  assert.equal(states.status, 'synced'); if (states.status === 'synced') await states.copy.close();
  assert.equal(w.module.inspect()?.presentation?.presentedAtMs, card?.presentedAtMs, 'sync never reacts');
  await w.observe(approvalResolved('current-request')); await w.observe(turnEnded); await w.advance();
  assert.equal(w.module.inspect()?.presentation?.opportunity.cue, 'turn-ended');
  assert.equal(w.module.inspect()?.presentation?.content, 'unavailable');
  assert.match(w.module.inspect()?.presentation?.text ?? '', /turn.*ended|turn has ended/);
  assert.doesNotMatch(w.module.inspect()?.presentation?.text ?? '', /success|tests passed|complete|next prompt/);
});

for (const race of ['clear', 'turn', 'disable', 'mute', 'expire'] as const) it(`final presentation rejects ${race} after the actual scheduler handoff`, async context => {
  const w = await setup(context); await w.settings(); await w.attention();
  if (race === 'clear') await w.observe(approvalResolved('attention-one'));
  if (race === 'turn') await w.observe(turnStarted, 'turn-2');
  if (race === 'disable') await w.settings(false);
  if (race === 'mute') await w.settings(true, ['coding-attention']);
  await w.advance(race === 'expire' ? 30_001 : 26);
  assert.equal(w.module.inspect()?.presentation, null, 'stale pending attention is never presented');
  assert.equal(w.module.pending(), 0);
  assert.notEqual(w.module.inspect()?.decision, 'presented');
});

it('social mode is rechecked after waiting, and mixed fixtures stay isolated while coding attention wins', async context => {
  const w = await setup(context); await w.settings();
  await w.command('companion-fixture-run', {scenario: 'arrival', busy: false, media: false});
  assert.equal(w.module.pending(), 1);
  await w.core.actions.dispatch({key: 'bunny.cmd.mode-set.hub', requestedBy: 'bunny/parts/operator', requestId: 'reachy-mode-work',
    draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: 'work'}}});
  await w.advance(); assert.equal(w.module.inspect()?.presentation, null); assert.equal(w.module.inspect()?.decision, 'restrictive-mode');
  await w.command('companion-fixture-run', {scenario: 'question-and-arrival', busy: false, media: false});
  await w.advance();
  const card = w.module.inspect()?.presentation; assert.equal(card?.opportunity.category, 'coding-attention');
  assert.equal(card?.opportunity.context, 'scenario'); assert.equal(card?.opportunity.identity, null); assert.equal(card?.opportunity.location, null);
  // A synthetic question cannot block a subsequent real coding notice or become a core session.
  await w.observe(sessionStarted); await w.observe(turnStarted); await w.observe(turnEnded); await w.advance();
  assert.equal(w.module.inspect()?.presentation?.opportunity.context, 'live');
});

for (const output of ['fail', 'hang'] as const) it(`a ${output} at the actual SDK publication boundary reports unavailable without hiding core attention`, async context => {
  const w = await setup(context, output); await w.settings(); await w.attention(); await w.advance();
  if (output === 'hang') await w.advance(5001);
  await waitFor(() => w.module.inspect()?.availability === 'unavailable');
  assert.equal(w.module.inspect()?.presentation?.history, true);
  const held = await contextOf(w.watcher).sdk.sync<{attention: unknown[]}>(['session'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
  assert.equal(held.status, 'synced');
  if (held.status === 'synced') {assert.equal(held.copy.states()[0]?.data.attention.length, 1); await held.copy.close();}
  assert.equal(w.module.pending(), 0);
});

it('input boundary rejects malformed and foreign opportunities; commands stay with the core dispatcher', async context => {
  const w = await setup(context); await w.settings();
  const sdk = contextOf(w.watcher).sdk;
  const forged = {kind: 'occurrence' as const, type: 'org.bunny.companion-opportunity.raised', subject: 'reachy',
    dataschema: 'https://bunny.invalid/events/companion-opportunity/2.0', data: {content: 'SYNTHETIC_MALFORMED'}};
  await sdk.publish('bunny.event.companion-opportunity.reachy', forged);
  await w.handle()?.sdk.publish('bunny.event.companion-opportunity.reachy', forged);
  await flush(); assert.equal(w.module.pending(), 0); assert.equal(w.module.inspect()?.presentation, null);
  const raw = await sdk.request('bunny.cmd.companion-fixture-run.reachy', {type: 'org.bunny.companion-fixture.run.requested', subject: 'reachy',
    dataschema: 'https://bunny.invalid/events/companion-fixture-run/2.0', data: {requestId: 'forged-fixture', scenario: 'arrival', busy: false, media: false}}, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
});

it('load coalesces to one active plus three pending categories without persisting candidates', async context => {
  const w = await setup(context); await w.settings();
  for (let i = 0; i < 20; i += 1) await w.command('companion-fixture-run', {scenario: 'arrival', busy: false, media: false});
  assert.ok(w.module.pending() <= 4); await w.advance();
  assert.ok(w.stored().admissions.length <= 128); assert.ok(w.stored().received.length <= 4096);
  assert.deepEqual(Object.keys(w.stored()).sort(), ['admissions', 'allowances', 'received', 'state']);
  assert.equal(w.module.pending(), 0); assert.equal(w.module.inspect()?.presentation?.opportunity.context, 'scenario');
  await w.command('companion-fixture-run', {scenario: 'visit', busy: false, media: false}); await w.advance();
  assert.equal(w.module.inspect()?.decision, 'social-spacing');
  await pause(1);
});

it('restart preserves a historical card and controls but discards pending social candidates and Free never replays', async context => {
  const w = await setup(context); await w.settings(); await w.attention(); await w.advance();
  const before = w.module.inspect()?.presentation; assert.ok(before !== null && before !== undefined);
  await w.observe(approvalResolved('attention-one'));
  await w.command('companion-fixture-run', {scenario: 'arrival', busy: false, media: false});
  assert.equal(w.module.pending(), 1);
  await w.runtime.stop();
  const companion = createCompanionsModule(), core = createCoreModule();
  await run(context, {stateDir: w.directory, modules: [core, companion], clock: {now: w.clock.now}, scheduler: w.clock.scheduler});
  assert.equal(companion.inspect()?.settings.enabled, true); assert.equal(companion.inspect()?.presentation?.history, true);
  assert.equal(companion.inspect()?.presentation?.presentedAtMs, before.presentedAtMs); assert.equal(companion.pending(), 0);
  for (const mode of ['quiet', 'free'] as const) await core.actions.dispatch({key: 'bunny.cmd.mode-set.hub', requestedBy: 'bunny/parts/operator', requestId: `restart-${mode}`,
    draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode}}});
  w.clock.advance(100); await flush();
  assert.equal(companion.inspect()?.presentation?.presentedAtMs, before.presentedAtMs); assert.equal(companion.inspect()?.presentation?.history, true);
});

for (const kind of ['question-continuing', 'attention-input'] as const) it(`${kind} uses normal core reduction and attributes fixed human-attention text`, async context => {
  const w = await setup(context); await w.settings(); await w.observe(sessionStarted); await w.observe(turnStarted);
  await w.observe({kind, attention: {status: 'known', id: 'human-input'}}); await w.advance();
  const card = w.module.inspect()?.presentation;
  assert.equal(card?.opportunity.category, 'coding-attention');
  assert.equal(card?.opportunity.cue, kind === 'question-continuing' ? 'question' : 'input');
  assert.equal(card?.opportunity.identity?.sessionId, 'session-sim-1');
  assert.match(card?.text ?? '', kind === 'question-continuing' ? /question/ : /input/);
});

it('actual fixed-clock fixture admission shares its persisted daily budget and leaves live allowance untouched', async context => {
  const w = await setup(context); await w.settings();
  const shown: number[] = [];
  for (let episode = 0; episode < 4; episode += 1) {
    if (episode > 0) await w.advance(10_800_000);
    await w.command('companion-fixture-run', {scenario: episode % 2 === 0 ? 'arrival' : 'visit', busy: false, media: false}); await w.advance();
    const at = w.module.inspect()?.presentation?.presentedAtMs;
    if (at !== undefined && !shown.includes(at)) shown.push(at);
  }
  assert.equal(shown.length, 3, 'arrival and visit share the same three-episode allowance');
  assert.equal(w.stored().allowances.live.count, 0, 'synthetic cards cannot spend a live social slot');
  assert.equal(w.stored().allowances.scenario.count, 3);
  assert.equal(w.module.inspect()?.decision, 'social-budget');
  await w.runtime.stop();
  const companion = createCompanionsModule(), core = createCoreModule();
  await run(context, {stateDir: w.directory, modules: [core, companion], clock: {now: w.clock.now}, scheduler: w.clock.scheduler});
  const attempt = (id: string) => core.actions.dispatch({key: 'bunny.cmd.companion-fixture-run.reachy', requestedBy: 'bunny/parts/operator', requestId: id,
    draft: {type: 'org.bunny.companion-fixture.run.requested', subject: 'reachy', dataschema: 'https://bunny.invalid/events/companion-fixture-run/2.0',
      data: {scenario: 'arrival', busy: false, media: false}}});
  await attempt('budget-after-restart'); w.clock.advance(26); await flush();
  assert.equal(companion.inspect()?.decision, 'social-budget', 'restart does not reset the used scenario allowance');
  w.clock.advance(86_400_000); await flush(); await attempt('budget-next-day'); w.clock.advance(26);
  await waitFor(() => companion.inspect()?.presentation?.presentedAtMs === w.clock.now());
  assert.equal(companion.inspect()?.presentation?.opportunity.context, 'scenario');
});

it('unknown turn identity is never reused to admit a card after the session changes', async context => {
  const w = await setup(context); await w.settings();
  await w.observe(sessionStarted, null); await w.observe(turnStarted, null); await w.observe(approvalPrompt('unknown-turn'), null);
  await waitFor(() => w.module.pending() === 1);
  await w.observe({kind: 'activity-observed'}, null); await w.advance();
  assert.equal(w.module.inspect()?.presentation, null);
  assert.equal(w.module.inspect()?.decision, 'source-changed');
});
