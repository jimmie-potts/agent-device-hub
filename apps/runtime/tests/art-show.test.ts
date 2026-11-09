// The owner's on-demand art show (Hub #1581) on the real core, with synthetic art, Pixoo and Tidbyt owners.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtAuto21} from '@jimmie-potts/event-contracts/v2/art';
import {artShowPlanId, artShowSurfaces, type ArtShowRequest} from '@jimmie-potts/event-contracts/v2/art-show';
import type {ArtState, ArtTarget, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {BunnyModule, Command, ModuleContext, Reply} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {artPlanRequestId, type ArtPermit, type ArtPlan, type ArtPlanResult} from '../src/core/art-plans.js';
import {createArtShow, artShowOutcome} from '../src/core/art-show.js';
import type {NewLogRow} from '../src/core/automation-store.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {edgeConfig, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

const BROWSER = 'c'.repeat(64), PIXOO = 'a'.repeat(64), TIDBYT = 'b'.repeat(64);
const COMPOSITION: Readonly<Record<ArtTarget, string>> = {ui: BROWSER, pixoo: PIXOO, tidbyt: TIDBYT};
const artwork = (artworkId: string, kinds: readonly ArtTarget[] = ['ui', 'pixoo', 'tidbyt']): ArtworkSummary => ({artworkId, createdAtMs: 1, favorite: false, feedback: null,
  variationOf: null, palette: ['#112233'], provenance: {generatedBy: 'local', factual: false}, compositions: kinds.map((target, index) => {
    const id = String(index + 1).repeat(64);
    return {target, compositionId: COMPOSITION[target], outcome: 'succeeded', motion: target === 'ui' ? 'still' : 'gif',
      renditions: [{renditionId: id, width: target === 'ui' ? 320 : 64, height: target === 'ui' ? 320 : target === 'pixoo' ? 64 : 32, frames: 1, durationMs: 0, format: 'png', bytes: 100, ref: `rendition.${id}`}]};
  })});
const provider = (name: 'openai' | 'anthropic') => ({provider: name, available: false, ceilingMicros: 0, paceMicros: 0, spentMicros: 0, reservedMicros: 0,
  uncertainMicros: 0, remainingMicros: 0, todayMicros: 0, excessMicros: 0, earlierUncertainMicros: 0});
const catalog = (): ArtState => ({id: 'art', revision: 1, month: '2026-11', day: '2026-11-08', providers: [provider('openai'), provider('anthropic')],
  guard: {calls: 0, limit: 30, windowMs: 3_600_000}, gifs: {accepted: 0, rejected: 0}, jobs: [],
  artworks: [artwork('saved-art'), artwork('browser-less', ['pixoo']), artwork('pixoo-less', ['ui', 'tidbyt'])], candidates: [],
  retention: {recentLimit: 24, recent: 3, favorites: 0, retained: []}});

type DisplayReply = (command: Command<MomentPlayRequest>) => Reply;
async function world(t: TestContext, replies: Partial<Record<'desk-display' | 'shelf-display', DisplayReply>> = {}) {
  const clock = manualClock(1_700_000_000_000), art = catalog();
  const presents: Command<ArtAuto21>[] = [], moments: Command<MomentPlayRequest>[] = [];
  let artContext: ModuleContext | undefined, handle: CoreHandle | undefined;
  const makeCore = () => createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  let core = makeCore();
  const artModule: BunnyModule = {manifest: {name: 'art', apiVersion: '1.3'}, start: async context => {
    artContext = context;
    await context.sdk.serveSync(['art'], () => ({revision: art.revision, states: [{type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0', data: art}]}));
    await context.sdk.respond<ArtAuto21>('bunny.cmd.art-auto.art', command => {presents.push(command); return {status: 'accepted'};});
  }, stop() {}};
  const displays = (['pixoo', 'tidbyt'] as const).map(kind => {
    const id = kind === 'pixoo' ? 'desk-display' : 'shelf-display', record = deviceRecord(id, 1, kind, 'available');
    record.capabilities.moments = {supported: true, moods: ['celebrate', 'reminder'], maxDurationMs: kind === 'pixoo' ? 10_000 : 60_000,
      coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840}};
    let syncs = 0;
    const module: BunnyModule = {manifest: {name: kind, apiVersion: '1.3', configure: section => ({config: section, devices: [id]})},
      start: async given => {
        await given.sdk.serveSync(['device'], () => {syncs++; return {revision: record.revision, states: [{...deviceState(record), dataschema: 'https://bunny.invalid/events/device/2.2'}]};});
        await given.sdk.respond<MomentPlayRequest>(`bunny.cmd.moment-play.${id}`, command => {moments.push(command); return replies[id]?.(command) ?? {status: 'accepted'};});
      }, stop() {}};
    return {id, module, syncs: () => syncs};
  });
  const files = await edgeConfig(t, [], {modules: {pixoo: {}, tidbyt: {}}});
  const directory = await stateDir(t);
  const launch = () => run(t, {modules: [core, artModule, ...displays.map(display => display.module)], configFile: files.config, stateDir: directory,
    clock: {now: clock.now}, scheduler: clock.scheduler});
  let {runtime} = await launch();
  await waitFor(() => displays.every(display => display.syncs() > 0)); await flush();
  const prepares = () => presents.filter(command => command.data.action === 'prepare');
  const browser = () => presents.filter(command => command.data.action === 'present');
  return {clock, art, moments, prepares, browser, get core() {return core;}, get handle() {assert.ok(handle); return handle;},
    get artContext() {assert.ok(artContext); return artContext;},
    show: (requestId: string, data: Omit<ArtShowRequest, 'requestId'>) => core.actions.dispatch({key: 'bunny.cmd.art-show.hub', requestedBy: 'bunny/parts/operator', requestId,
      draft: {type: 'org.bunny.art.show.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/art-show/2.0', data}}),
    complete: async (requestId: string) => {
      assert.ok(artContext);
      await artContext.sdk.publish('bunny.event.art-auto.art', {kind: 'outcome', type: 'org.bunny.art.auto.completed', subject: 'art',
        dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId, result: 'succeeded', evidence: 'observed'}});
      await waitFor(() => handle?.operation(requestId)?.result === 'succeeded');
    },
    restart: async () => {await runtime.stop(); core = makeCore(); ({runtime} = await launch()); await flush();},
  };
}
const ownerRows = (w: Awaited<ReturnType<typeof world>>, requestId: string) => w.core.automation.log(100).filter(entry => entry.ruleId === 'art-show' && entry.event.id === requestId);

it('one show reaches both displays and the browser with independent operations at a near-term common start', async t => {
  const w = await world(t), acceptedAtMs = w.clock.now(), targets = ['desk-display', 'shelf-display', 'browser'];
  assert.deepEqual(await w.show('show-all', {artworkId: 'saved-art', targets}), {status: 'accepted', requestId: 'show-all'});
  await waitFor(() => w.prepares().length === 2);
  assert.deepEqual(w.prepares().map(command => command.data.action === 'prepare' ? [command.data.target, command.data.compositionId] : []).sort(),
    [['desk-display', PIXOO], ['shelf-display', TIDBYT]]);
  for (const prepare of w.prepares()) await w.complete(prepare.data.requestId);
  await waitFor(() => w.moments.length === 2);
  const byTarget = new Map(w.moments.map(command => [command.subject, command.data]));
  assert.equal(byTarget.get('desk-display')?.art?.compositionId, PIXOO);assert.equal(byTarget.get('desk-display')?.durationMs, 10_000);
  assert.equal(byTarget.get('shelf-display')?.art?.compositionId, TIDBYT);assert.equal(byTarget.get('shelf-display')?.durationMs, 30_000);
  for (const moment of byTarget.values()) {
    assert.equal(moment.startAtMs, acceptedAtMs + 20_000);assert.equal(moment.priorityClass, 'event');assert.equal(moment.coversStatus, true);
  }
  assert.equal(w.browser().length, 0, 'the browser waits for the common start');
  assert.equal(w.handle.operation('show-all')?.status, 'accepted', 'the show is not complete before every surface is handed off');
  w.clock.advance(20_000); await flush();
  await waitFor(() => w.browser().length === 1);
  const present = w.browser()[0]?.data;assert.ok(present?.action === 'present');assert.equal(present.compositionId, BROWSER);
  await waitFor(() => w.handle.operation('show-all')?.status === 'completed');
  const show = w.handle.operation('show-all');assert.equal(show?.result, 'succeeded');assert.equal(show.kind, 'moment');
  assert.equal(show.outcomes[0]?.evidence, 'observed', 'the core observed its own handoff, not a panel');
  // The gallery and MCP derive the same identities the core tracked.
  const surfaces = await artShowSurfaces('show-all', targets);
  for (const surface of surfaces) {
    if (surface.kind === 'browser') {assert.equal(w.browser()[0]?.data.requestId, surface.presentRequestId);continue;}
    assert.equal(w.handle.operation(surface.prepareRequestId)?.target, 'art');
    assert.equal(w.moments.find(command => command.subject === surface.target)?.data.requestId, surface.momentRequestId);
  }
  const planId = await artShowPlanId('show-all');assert.equal(artPlanRequestId(planId, 'moment', 'desk-display'), surfaces[0]?.kind === 'display' ? surfaces[0].momentRequestId : '');
  const rows = ownerRows(w, 'show-all');
  assert.deepEqual(rows.map(entry => [entry.target, entry.outcome, entry.event.source, entry.priorityClass]).sort(),
    [['browser', 'receipt', 'owner', 'event'], ['desk-display', 'receipt', 'owner', 'event'], ['shelf-display', 'receipt', 'owner', 'event']]);
  // Every command the show sent belongs to the show's trace.
  const trace = w.moments[0]?.traceparent.split('-')[1];
  for (const command of [...w.prepares(), ...w.browser(), ...w.moments]) assert.equal(command.traceparent.split('-')[1], trace);
});

it('refusals send nothing: unknown art, no composition, a concurrent show and an undispatched command', async t => {
  const w = await world(t);
  const unknown = await w.show('show-unknown', {artworkId: 'never-saved', targets: ['browser']});
  assert.ok('error' in unknown);assert.equal(unknown.error.code, 'not-found');
  const missing = await w.show('show-missing', {artworkId: 'browser-less', targets: ['browser']});
  assert.ok('error' in missing);assert.equal(missing.error.code, 'unsupported-capability');
  const unconfigured = await w.show('show-unconfigured', {artworkId: 'saved-art', targets: ['hall-display']});
  assert.ok('error' in unconfigured);assert.equal(unconfigured.error.code, 'not-found');
  const direct = await w.artContext.sdk.request('bunny.cmd.art-show.hub', {type: 'org.bunny.art.show.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/art-show/2.0',
    data: {requestId: 'show-direct', artworkId: 'saved-art', targets: ['browser']}}, {timeoutMs: 5000, requestId: 'show-direct'});
  assert.equal(direct.status, 'rejected');assert.ok(direct.status === 'rejected' && direct.error.error.code === 'forbidden');
  await flush();
  assert.equal(w.prepares().length + w.browser().length + w.moments.length, 0);
  assert.deepEqual(await w.show('show-first', {artworkId: 'saved-art', targets: ['desk-display']}), {status: 'accepted', requestId: 'show-first'});
  const second = await w.show('show-second', {artworkId: 'saved-art', targets: ['browser']});
  assert.ok('error' in second);assert.equal(second.error.code, 'capacity');
  await waitFor(() => w.prepares().length === 1);
  assert.equal(w.browser().length, 0, 'the refused second show sent nothing');
  assert.equal(w.handle.operation('show-second')?.status, 'rejected');
});

it('a target without a composition is skipped while the others proceed, and logged', async t => {
  const w = await world(t);
  assert.deepEqual(await w.show('show-partial', {artworkId: 'pixoo-less', targets: ['desk-display', 'browser']}), {status: 'accepted', requestId: 'show-partial'});
  w.clock.advance(20_000); await flush();
  await waitFor(() => w.handle.operation('show-partial')?.status === 'completed');
  assert.equal(w.prepares().length, 0);assert.equal(w.moments.length, 0);assert.equal(w.browser().length, 1);
  assert.deepEqual(ownerRows(w, 'show-partial').map(entry => [entry.target, entry.outcome, entry.reason ?? null]).sort(),
    [['browser', 'receipt', null], ['desk-display', 'blocked', 'unsupported-capability']]);
});

it('a display refusal fails that surface alone', async t => {
  const w = await world(t, {'desk-display': () => errorBody('invalid-state', {detail: 'a paused item holds the display'})});
  await w.show('show-held', {artworkId: 'saved-art', targets: ['desk-display', 'shelf-display']});
  await waitFor(() => w.prepares().length === 2);
  for (const prepare of w.prepares()) await w.complete(prepare.data.requestId);
  await waitFor(() => w.handle.operation('show-held')?.status === 'completed');
  const [pixoo, tidbyt] = (await artShowSurfaces('show-held', ['desk-display', 'shelf-display'])).map(surface => surface.kind === 'display' ? w.handle.operation(surface.momentRequestId) : undefined);
  assert.equal(pixoo?.status, 'rejected');assert.equal(pixoo.error?.code, 'invalid-state');
  assert.equal(tidbyt?.status, 'accepted', 'the Tidbyt keeps its own outcome');
  assert.equal(w.handle.operation('show-held')?.result, 'succeeded', 'the show handed both off; their outcomes stay separate');
  assert.deepEqual(ownerRows(w, 'show-held').map(entry => [entry.target, entry.outcome, entry.reason ?? null, typeof entry.requestId]).sort(),
    [['desk-display', 'not-sent', 'invalid-state', 'string'], ['shelf-display', 'receipt', null, 'string']], 'a display refusal is never logged as an admission');
});

it('a restart before the start leaves the show uncertain and replays nothing', async t => {
  const w = await world(t);
  await w.show('show-restart', {artworkId: 'saved-art', targets: ['desk-display', 'browser']});
  await waitFor(() => w.prepares().length === 1);
  await w.restart();
  w.clock.advance(200_000); await flush();
  await waitFor(() => w.handle.operation('show-restart')?.status === 'uncertain');
  assert.equal(w.moments.length, 0);assert.equal(w.browser().length, 0);assert.equal(w.prepares().length, 1);
  await w.show('show-restart', {artworkId: 'saved-art', targets: ['desk-display', 'browser']});
  await flush();assert.equal(w.prepares().length, 1, 'the same request is never sent again');
});

it('the owner permit holds every surface for attention and nothing else', async () => {
  let attention = false, permit: ArtPermit | undefined;
  const rows: NewLogRow[] = [];
  const plans = {targets: () => [{target: 'desk-display', kind: 'pixoo' as const}], present: (plan: ArtPlan, given: ArtPermit): Promise<ArtPlanResult> => {
    permit = given;
    const refusal = given({kind: 'display', target: 'desk-display'});
    return Promise.resolve({id: plan.id, displays: [{target: 'desk-display', prepare: {status: 'tracked', requestId: 'prepare-1'},
      moment: refusal === undefined ? {status: 'tracked', requestId: 'moment-1'} : {status: 'not-requested', error: refusal}}]});
  }};
  const show = createArtShow({clock: () => 0, active: () => true, plans, art: () => Promise.resolve(catalog()), attention: () => attention, log: value => {rows.push(...value);}, operation: () => undefined, failed: () => {}});
  const first = await show.prepare({requestId: 'permit-1', artworkId: 'saved-art', targets: ['desk-display']});assert.ok(!('error' in first));
  assert.equal(show.showing, true);
  const second = await show.prepare({requestId: 'permit-2', artworkId: 'saved-art', targets: ['desk-display']});
  assert.ok('error' in second);assert.equal(second.error.code, 'capacity');
  assert.deepEqual(artShowOutcome(await show.run(first)), {result: 'succeeded', evidence: 'observed'});
  assert.equal(permit?.({kind: 'browser'}), undefined, 'quiet hours, budgets and schedule policy are not consulted');
  attention = true;
  const held = await show.prepare({requestId: 'permit-3', artworkId: 'saved-art', targets: ['desk-display']});assert.ok(!('error' in held));
  const outcome = artShowOutcome(await show.run(held));
  assert.equal(outcome.result, 'failed');assert.equal(outcome.error?.code, 'invalid-state');
  assert.deepEqual(rows.map(row => [row.eventId, row.outcome, row.reason, row.eventSource, row.priorityClass]),
    [['permit-1', 'receipt', null, 'owner', 'event'], ['permit-3', 'not-sent', 'invalid-state', 'owner', 'event']]);
  assert.equal(show.showing, false);
});
