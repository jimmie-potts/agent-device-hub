import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtAuto21} from '@jimmie-potts/event-contracts/v2/art';
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {BunnyModule, Command, ModuleContext} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import type {ArtPlan} from '../src/core/art-plans.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {edgeConfig, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

const PIXOO = 'a'.repeat(64), TIDBYT = 'b'.repeat(64), BROWSER = 'c'.repeat(64);

async function world(t: TestContext) {
  const clock = manualClock(1_700_000_000_000), preparations: Command<ArtAuto21>[] = [], moments: Command<MomentPlayRequest>[] = [];
  let artContext: ModuleContext | undefined, handle: CoreHandle | undefined, database: DatabaseSync | undefined;
  const makeCore = () => createCoreModule({parts: [{open: db => {database = db;}, start: given => {handle = given; return Promise.resolve();}}]});
  let core = makeCore();
  const art: BunnyModule = {manifest: {name: 'art', apiVersion: '1.3'}, start: async context => {
    artContext = context;
    await context.sdk.respond<ArtAuto21>('bunny.cmd.art-auto.art', command => {preparations.push(command); return {status: 'accepted'};});
  }, stop() {}};
  const displays = (['pixoo', 'tidbyt'] as const).map(kind => {
    const id = kind === 'pixoo' ? 'desk-display' : 'shelf-display', record = deviceRecord(id, 1, kind, 'available');
    record.capabilities.moments = {supported: true, moods: ['celebrate', 'reminder'], maxDurationMs: kind === 'pixoo' ? 10_000 : 60_000,
      coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840}};
    let context: ModuleContext | undefined, syncs = 0;
    const module: BunnyModule = {manifest: {name: kind, apiVersion: '1.3', configure: section => ({config: section, devices: [id]})},
      start: async given => {
        context = given;
        await given.sdk.serveSync(['device'], () => {syncs++; return {revision: record.revision, states: [{...deviceState(record), dataschema: record.capabilities.moments.supported&&record.capabilities.moments.art?.notices!==undefined?'https://bunny.invalid/events/device/2.3':'https://bunny.invalid/events/device/2.2'}]};});
        await given.sdk.respond<MomentPlayRequest>(`bunny.cmd.moment-play.${id}`, command => {moments.push(command); return {status: 'accepted'};});
      }, stop() {}};
    return {id, record, module, syncs: () => syncs, publish: async () => {
      assert.ok(context); record.revision++;
      await context.sdk.publish(`bunny.state.device.${id}`, {kind: 'state', ...deviceState(record), dataschema: record.capabilities.moments.supported&&record.capabilities.moments.art?.notices!==undefined?'https://bunny.invalid/events/device/2.3':'https://bunny.invalid/events/device/2.2'});
    }};
  });
  const files = await edgeConfig(t, [], {modules: {pixoo: {}, tidbyt: {}}});
  const directory = await stateDir(t);
  const launch = () => run(t, {modules: [core, art, ...displays.map(display => display.module)], configFile: files.config, stateDir: directory,
    clock: {now: clock.now}, scheduler: clock.scheduler});
  let {runtime} = await launch();
  await waitFor(() => displays.every(display => display.syncs() > 0)); await flush();
  assert.ok(handle); assert.ok(artContext);
  return {get core() {return core;}, get runtime() {return runtime;}, get handle() {assert.ok(handle);return handle;}, clock, preparations, moments, displays,
    get database() {assert.ok(database);return database;},
    restart: async () => {await runtime.stop();core = makeCore();({runtime} = await launch());await flush();},
    complete: async (requestId: string, result: 'succeeded' | 'failed' = 'succeeded') => {
      assert.ok(artContext);
      await artContext.sdk.publish('bunny.event.art-auto.art', {kind: 'outcome', type: 'org.bunny.art.auto.completed', subject: 'art',
        dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId, result, evidence: result === 'succeeded' ? 'observed' : 'none',
          ...(result === 'failed' ? errorBody('unavailable', {detail: 'synthetic preparation refusal'}) : {})}});
      await waitFor(() => handle?.operation(requestId)?.result === result);
    },
  };
}

function oneDisplay(now: number, id = 'single-plan'): ArtPlan {
  return {id, artworkId: 'art-1', startAtMs: now + 5000, prepareUntilMs: now + 4000, toleranceMs: 1000,
    mood: 'celebrate', priorityClass: 'event', coversStatus: true,
    displays: [{target: 'desk-display', compositionId: PIXOO, durationMs: 8000}]};
}

for (const restarted of [false, true]) it(`an expired art plan cannot borrow late preparation with changed timing${restarted ? ' after restart' : ''}`, async t => {
  const w = await world(t), plan = oneDisplay(w.clock.now());assert.ok(w.core.automation.art);
  const completion = w.core.automation.art.present(plan, () => undefined);
  await waitFor(() => w.preparations.length === 1);const prepare = w.preparations[0];assert.ok(prepare);
  w.clock.advance(4001);await flush();const expired = await completion;
  assert.ok(!('error' in expired));assert.equal(expired.displays[0]?.moment.status, 'not-requested');
  await w.complete(prepare.data.requestId);
  if (restarted) await w.restart();
  const changed = await w.core.automation.art.present({...plan, startAtMs: w.clock.now() + 5000, prepareUntilMs: w.clock.now() + 4000}, () => undefined);
  assert.ok('error' in changed, 'the plan ID retains its original complete intent');assert.equal(changed.error.code, 'duplicate-conflict');
  assert.equal(w.preparations.length, 1);assert.equal(w.moments.length, 0);
});

it('a policy callback cannot make a display handoff late', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  const display = w.core.automation.art.present(oneDisplay(w.clock.now()), () => {w.clock.advance(6001);return undefined;});
  await waitFor(() => w.preparations.length === 1);const prepare = w.preparations[0];assert.ok(prepare);await w.complete(prepare.data.requestId);
  const result = await display;assert.ok(!('error' in result));assert.equal(result.displays[0]?.moment.status, 'not-requested');
  assert.equal(w.moments.length, 0);
});

it('a policy callback cannot make browser selection late', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  const browser = await w.core.automation.art.present({...oneDisplay(w.clock.now(), 'late-browser'), displays: [], startAtMs: w.clock.now(), prepareUntilMs: w.clock.now(), browser: {compositionId: BROWSER}},
    () => {w.clock.advance(1001);return undefined;});
  assert.ok(!('error' in browser));assert.equal(browser.browser?.status, 'not-requested');
  assert.equal(w.preparations.length, 0, 'late browser choice sends no present command');
});

it('duplicate art plans never replay effects and conflicting content cannot borrow an earlier preparation', async t => {
  const w = await world(t), plan = oneDisplay(w.clock.now());assert.ok(w.core.automation.art);
  const first = w.core.automation.art.present(plan, () => undefined);
  await waitFor(() => w.preparations.length === 1);const prepare = w.preparations[0];assert.ok(prepare);
  await w.complete(prepare.data.requestId);const result = await first;assert.ok(!('error' in result));
  assert.equal(w.moments.length, 1);
  assert.deepEqual(await w.core.automation.art.present(plan, () => undefined), result);
  assert.equal(w.preparations.length, 1);assert.equal(w.moments.length, 1);
  const conflict = await w.core.automation.art.present({...plan, displays: [{...plan.displays[0], target: 'desk-display', compositionId: TIDBYT, durationMs: 8000}]}, () => undefined);
  assert.ok('error' in conflict, 'a prior plan belongs only to the same complete immutable intent');
  assert.equal(conflict.error.code, 'duplicate-conflict');
  assert.equal(w.preparations.length, 1);assert.equal(w.moments.length, 1);
});

it('a failed plan identity commit sends nothing and leaves no claimed identity', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  w.database.exec("CREATE TRIGGER synthetic_plan_failure BEFORE INSERT ON automation_art_plans BEGIN SELECT RAISE(FAIL,'synthetic plan storage failure'); END");
  const plan = oneDisplay(w.clock.now()), refused = await w.core.automation.art.present(plan, () => undefined);
  assert.ok('error' in refused);assert.equal(refused.error.code, 'unavailable');
  assert.equal(w.database.prepare('SELECT COUNT(*) AS n FROM automation_art_plans').get()?.n, 0);
  assert.equal(w.preparations.length, 0);assert.equal(w.moments.length, 0);
  w.database.exec('DROP TRIGGER synthetic_plan_failure');
  const completion = w.core.automation.art.present(plan, () => undefined);
  await waitFor(() => w.preparations.length === 1);const prepare = w.preparations[0];assert.ok(prepare);await w.complete(prepare.data.requestId);
  const result = await completion;assert.ok(!('error' in result));assert.equal(w.moments.length, 1);
});

it('art rechecks the configured generation and policy immediately before a display handoff', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  let permitted = true, checks = 0;
  const first = w.core.automation.art.present(oneDisplay(w.clock.now()), () => {checks++;return permitted ? undefined : errorBody('invalid-state', {detail: 'opportunity withdrawn'});});
  await waitFor(() => w.preparations.length === 1);permitted = false;
  const prepare = w.preparations[0];assert.ok(prepare);await w.complete(prepare.data.requestId);
  const refused = await first;assert.ok(!('error' in refused));assert.equal(checks, 1);
  assert.deepEqual(refused.displays[0]?.moment, {status: 'not-requested', error: errorBody('invalid-state', {detail: 'opportunity withdrawn'})});
  const second = w.core.automation.art.present(oneDisplay(w.clock.now(), 'changed-owner'), () => {checks++;return undefined;});
  await waitFor(() => w.preparations.length === 2);const display = w.displays[0];assert.ok(display);
  display.record.generation.sequence++;await display.publish();await flush();
  const next = w.preparations[1];assert.ok(next);await w.complete(next.data.requestId);
  const changed = await second;assert.ok(!('error' in changed));assert.equal(checks, 1, 'changed owner refuses before final policy');
  assert.deepEqual(changed.displays[0]?.moment, {status: 'not-requested', error: errorBody('invalid-state', {detail: 'the art target changed while preparing'})});
  assert.equal(w.moments.length, 0);
});

it('art refuses unqualified capabilities and a preparation failure never falls back to a mood', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  const target = w.displays[0];assert.ok(target);target.record.capabilities.moments = {supported: true, moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true};
  await target.publish();await flush();
  const unsupported = await w.core.automation.art.present(oneDisplay(w.clock.now()), () => undefined);
  assert.ok(!('error' in unsupported));assert.deepEqual(unsupported.displays[0]?.prepare, {status: 'not-requested', error: errorBody('unsupported-capability')});
  assert.equal(w.preparations.length, 0);assert.equal(w.moments.length, 0);
  target.record.capabilities.moments = {supported: true, moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840}};
  await target.publish();await flush();
  const completion = w.core.automation.art.present(oneDisplay(w.clock.now(), 'failed-prepare'), () => undefined);
  await waitFor(() => w.preparations.length === 1);const prepare = w.preparations[0];assert.ok(prepare);
  await w.complete(prepare.data.requestId, 'failed');const failed = await completion;assert.ok(!('error' in failed));
  assert.ok(failed.displays[0]?.moment.status === 'not-requested');assert.equal(failed.displays[0].moment.error.error.code, 'unavailable');
  assert.equal(w.moments.length, 0);
});

it('both displays retain one intent and start with their own supported hold durations', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  const plan = oneDisplay(w.clock.now());plan.displays = [...plan.displays, {target: 'shelf-display', compositionId: TIDBYT, durationMs: 45000}];
  const completion = w.core.automation.art.present(plan, () => undefined);
  await waitFor(() => w.preparations.length === 2);
  for (const prepare of w.preparations) await w.complete(prepare.data.requestId);
  await completion;assert.equal(w.moments.length, 2);
  assert.equal(w.moments[0]?.data.momentId, w.moments[1]?.data.momentId);
  assert.deepEqual(w.moments.map(command => command.data.startAtMs), [plan.startAtMs, plan.startAtMs]);
  assert.deepEqual(w.moments.map(command => command.data.durationMs).sort((a, b) => a - b), [8000, 45000]);
  assert.deepEqual(w.core.automation.art.targets(), [{target: 'desk-display', kind: 'pixoo'}, {target: 'shelf-display', kind: 'tidbyt'}]);
});

it('stopping the core cancels pending preparation and browser selection without catch-up', async t => {
  const w = await world(t);assert.ok(w.core.automation.art);
  const completion = w.core.automation.art.present({...oneDisplay(w.clock.now()), browser: {compositionId: BROWSER}}, () => undefined);
  await waitFor(() => w.preparations.length === 1);await w.runtime.stop();
  const result = await completion;assert.ok(!('error' in result));
  assert.ok(result.displays[0]?.moment.status === 'not-requested');assert.equal(result.displays[0].moment.error.error.code, 'cancelled');
  assert.ok(result.browser?.status === 'not-requested');assert.equal(result.browser.error.error.code, 'cancelled');
  w.clock.advance(10_000);await flush();assert.equal(w.preparations.length, 1);assert.equal(w.moments.length, 0);
});

it('shared art uses configured IDs and hands a ready display off while another preparation is pending', async t => {
  const w = await world(t), startAtMs = w.clock.now() + 5000;
  const plan = {id: 'one-idea', artworkId: 'art-1', startAtMs, prepareUntilMs: startAtMs - 1000, toleranceMs: 1000,
    mood: 'celebrate', priorityClass: 'event' as const, coversStatus: true,
    displays: [{target: 'desk-display', compositionId: PIXOO, durationMs: 8000}, {target: 'shelf-display', compositionId: TIDBYT, durationMs: 45000}],
    browser: {compositionId: BROWSER}};
  const controls: typeof w.core.automation & {art?: {present(input: typeof plan, permit: () => undefined): Promise<unknown>}} = w.core.automation;
  assert.ok(controls.art, 'the automation owner supplies saved-art presentation');
  const completion = controls.art.present(plan, () => undefined);
  await waitFor(() => w.preparations.length === 2);
  const pixoo = w.preparations.find(command => command.data.action === 'prepare' && command.data.target === 'desk-display');
  const tidbyt = w.preparations.find(command => command.data.action === 'prepare' && command.data.target === 'shelf-display');
  assert.ok(pixoo); assert.ok(tidbyt);
  assert.equal(w.moments.length, 0, 'durable admission alone is not staging success');
  await w.complete(pixoo.data.requestId);
  await waitFor(() => w.moments.length === 1);
  assert.equal(w.handle.operation(tidbyt.data.requestId)?.status, 'accepted', 'the slow target remains independent');
  assert.equal(w.moments[0]?.subject, 'desk-display');
  assert.equal(w.moments[0]?.source, 'bunny/core');
  assert.equal(w.moments[0]?.dataschema, 'https://bunny.invalid/events/moment-play/2.1');
  assert.deepEqual(w.moments[0]?.data.art, {compositionId: PIXOO});
  assert.equal(w.moments[0]?.data.startAtMs, startAtMs);
  assert.equal(w.moments[0]?.data.durationMs, 8000);
  assert.equal(w.preparations.some(command => command.data.action === 'present'), false, 'browser selection waits for the common start');
  w.clock.advance(4001); await flush();
  await w.complete(tidbyt.data.requestId);
  assert.equal(w.moments.length, 1, 'late preparation cannot revive the missed opportunity');
  w.clock.advance(999); await flush();
  await waitFor(() => w.preparations.some(command => command.data.action === 'present'));
  const browser = w.preparations.find(command => command.data.action === 'present'); assert.ok(browser);
  assert.equal(browser.data.action, 'present'); assert.ok(browser.data.action === 'present');
  assert.equal(browser.data.compositionId, BROWSER);
  const result = await completion;
  assert.deepEqual(result, {id: plan.id, displays: [
    {target: 'desk-display', prepare: {status: 'tracked', requestId: pixoo.data.requestId}, moment: {status: 'tracked', requestId: w.moments[0]?.data.requestId}},
    {target: 'shelf-display', prepare: {status: 'tracked', requestId: tidbyt.data.requestId}, moment: {status: 'not-requested', error: errorBody('invalid-state', {detail: 'art presentation passed its preparation cutoff'})}},
  ], browser: {status: 'tracked', requestId: browser.data.requestId}});
});

it('rain notice uses negotiated 2.2 and every changed fact conflicts under the retained plan identity',async t=>{
  const w=await world(t);const display=w.displays[0];assert.ok(display);assert.ok(display.record.capabilities.moments.supported&&display.record.capabilities.moments.art!==undefined);
  display.record.capabilities.moments.art.notices=['rain-forecast'];await display.publish();await flush();
  const at=w.clock.now();const plan:ArtPlan={...oneDisplay(at,'rain-plan'),notice:{kind:'rain-forecast',likelihood:'chance',forecastStartAtMs:at+3_600_000,
    forecastEndAtMs:at+7_200_000,forecastUpdatedAtMs:at-120_000,observedAtMs:at-60_000,staleAtMs:at+2_600_000,weatherRevision:7}};
  assert.ok(w.core.automation.art);const pending=w.core.automation.art.present(plan,()=>undefined);
  await waitFor(()=>w.preparations.length===1);const prepare=w.preparations[0];assert.ok(prepare);await w.complete(prepare.data.requestId);const result=await pending;
  assert.equal('error' in result,false);assert.equal(w.moments[0]?.dataschema,'https://bunny.invalid/events/moment-play/2.2');assert.deepEqual(w.moments[0]?.data.notice,plan.notice);
  await w.restart();assert.ok(plan.notice!==undefined);
  for(const notice of [{...plan.notice,likelihood:'likely' as const},{...plan.notice,weatherRevision:8},{...plan.notice,observedAtMs:at-60_001},
    {...plan.notice,staleAtMs:at+2_500_000},{...plan.notice,forecastStartAtMs:at+3_600_001},{...plan.notice,forecastEndAtMs:at+7_199_999}]) {
    const changed=await w.core.automation.art.present({...plan,notice},()=>undefined);
    assert.ok('error' in changed);assert.equal(changed.error.code,'duplicate-conflict');
  }
  assert.equal(w.moments.length,1);
});
it('rain notice skips a plain-art target without preparation or a substitute mood',async t=>{
  const w=await world(t),at=w.clock.now();assert.ok(w.core.automation.art);
  const result=await w.core.automation.art.present({...oneDisplay(at,'unsupported-rain'),notice:{kind:'rain-forecast',likelihood:'likely',forecastStartAtMs:at+3_600_000,
    forecastEndAtMs:at+7_200_000,forecastUpdatedAtMs:at,observedAtMs:at,staleAtMs:at+2_700_000,weatherRevision:7}},()=>undefined);
  assert.ok(!('error' in result));assert.equal(result.displays[0]?.prepare.status,'not-requested');assert.equal(w.preparations.length,0);assert.equal(w.moments.length,0);
});
