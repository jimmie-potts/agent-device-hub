// The real boundaries, against stand-in owners on the bus: the core that forwards `art-dispatch` and publishes operation
// records, and the weather owner that publishes `weather-state`. A real validator checks each dispatch.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import type {ArtDispatch} from '@jimmie-potts/event-contracts/v2/art';
import {operationEntityId, registerCoreFamilies, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Participant} from '@jimmie-potts/sdk';
import {createArtModule} from '../src/module.js';
import {registration} from '../src/registration.js';
import {artDevice, deviceDraft} from './device-fixtures.js';
import {drawing, fakeImages} from './fixtures.js';
import {hosted, until, type Hosted} from './support.js';

/** One turn of the event loop: the bus, the module's sync copies and its outbox settle on promises, never on a timer. */
const flush = () => new Promise<void>(resolve => {setImmediate(resolve);});
/**
 * The module's scheduler, recorded as the other art tests record it: a timer runs only when `advance` moves the module's
 * clock past it. The bus keeps its own real request deadlines, which are 2 s or more.
 */
function moduleTimers() {
  let elapsed = 0;
  const timers: {at: number; callback: () => void; cancelled: boolean}[] = [];
  const scheduler = {after: (delay: number, callback: () => void) => {const timer = {at: elapsed + delay, callback, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};}};
  /**
   * Lets the work under way settle for one turn, then moves `art`'s clock `ms` on, running each timer that falls due in
   * order of its time, with one turn after each for the work it starts.
   */
  const advance = async (art: Hosted, ms: number): Promise<void> => {
    const end = elapsed + ms;
    await flush();
    for (;;) {
      const due = timers.filter(timer => !timer.cancelled && timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      art.clock.value += due.at - elapsed; elapsed = due.at;
      due.callback();
      await flush();
    }
    art.clock.value += end - elapsed; elapsed = end;
  };
  return {scheduler, advance};
}

const start = (targets: string[], purpose = 'request') => ({action: 'start', purpose, origin: {kind: 'owner'}, targets});
const validator = new MessageValidator(); registerCoreFamilies(validator);
const operation = (requestId: string, status: OperationRecord['status'], result?: OperationRecord['result']): OperationRecord => ({id: operationEntityId(requestId), revision: 1, requestId, kind: 'device', family: 'art-stage',
  command: 'org.bunny.art.stage.requested', target: 'tidbyt', requestedBy: 'bunny/modules/art', status, ...(result === undefined ? {} : {result}), sentAtMs: 1, updatedAtMs: 1, deadlineAtMs: 2});

/** The module with the default seams and a stand-in core: it checks each dispatch and publishes the operation records a test asks for. */
async function withCore(t: TestContext) {
  const timers = moduleTimers(), dispatched: Message<ArtDispatch>[] = [], providers = {openai: fakeImages(drawing())};
  const art = await hosted(t, {providers, scheduler: timers.scheduler}), {operator} = art;
  await operator.respond<ArtDispatch>('bunny.cmd.art-dispatch.art', command => {
    const checked = validator.validate(command, {nowMs: art.clock.now()});
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal(command.source, 'bunny/modules/art');
    dispatched.push(command);
    return {status: 'accepted'};
  });
  const records = new Map<string, OperationRecord>();
  let syncs = 0;
  await operator.serveSync(['operation'], () => {
    syncs += 1;
    return {revision: 1, states: [...records.values()].map(data => ({type: 'org.bunny.operation.updated', subject: data.id, dataschema: 'https://bunny.invalid/events/operation/2.0', data}))};
  });
  const publish = async (record: OperationRecord, revision: number): Promise<void> => {
    records.set(record.id, record);
    await operator.publish(`bunny.state.operation.${record.id}`, {kind: 'state', type: 'org.bunny.operation.updated', subject: record.id, dataschema: 'https://bunny.invalid/events/operation/2.0', data: {...record, revision}});
  };
  for (const kind of ['pixoo', 'tidbyt'] as const) {
    const owner = art.bus.connect(`bunny/modules/${kind}`), device = artDevice(kind, `${kind}-configured`);
    await owner.serveSync(['device'], () => ({revision: 1, states: [deviceDraft(device)]}));
    t.after(() => owner.close());
  }
  /**
   * Restarts the module and waits until the core has served the new module's sync of the operation records, and one turn
   * more for the module to take the answer. Its copy subscribes before it asks, so every record the core publishes from
   * then on reaches the module.
   */
  const restart = async (): Promise<void> => {
    const before = syncs;
    await art.restart();
    await until(() => syncs > before, 'the module\'s sync of the core\'s operation records');
    await flush();
  };
  await restart();
  /** Moves the module's clock `ms` on, after the work under way has settled, and runs the module's timers that fall due. */
  const advance = (ms: number): Promise<void> => timers.advance(art, ms);
  return {art, dispatched, publish, restart, advance};
}
const stageOf = (message: Message<ArtDispatch> | undefined): Extract<ArtDispatch, {family: 'art-stage'}> => message?.data.family === 'art-stage' ? message.data : assert.fail('not a stage');

void test('a composition is dispatched through the core as a valid art-stage, and offered only after its operation succeeded', async t => {
  const {art, dispatched, publish, advance} = await withCore(t);
  await art.owner(start(['tidbyt']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  const stage = stageOf(dispatched[0]), bytes = Buffer.from(stage.data.base64, 'base64');
  assert.deepEqual([stage.target, stage.data.format, stage.data.width, stage.data.height, stage.data.frames, stage.data.durationMs], ['tidbyt-configured', 'gif', 64, 32, 8, 1600]);
  assert.equal(stage.data.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(stage.data.compositionId, art.state.artworks[0]?.compositions[0]?.compositionId);
  // The module follows the core's records since its sync at start, and an accepted operation proves no effect.
  await publish(operation(stage.requestId, 'accepted'), 2);
  await advance(20);
  assert.equal(art.state.candidates.length, 0);
  await publish(operation(stage.requestId, 'completed', 'succeeded'), 3);
  await until(() => art.state.candidates.length === 1, 'the candidate');
  assert.equal(art.state.candidates[0]?.compositionId, stage.data.compositionId);
  assert.equal(art.state.candidates[0]?.target, 'tidbyt', 'public art state keeps the display kind');
  assert.equal(dispatched.length, 1, 'never resent');
});

void test('a failed or rejected operation offers nothing, and another module\'s records are ignored', async t => {
  const {art, dispatched, publish, advance} = await withCore(t);
  await art.owner(start(['pixoo']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  await publish({...operation('other', 'completed', 'succeeded'), family: 'power-set'}, 2);
  await publish(operation(stageOf(dispatched[0]).requestId, 'rejected'), 3);
  await advance(20);
  assert.deepEqual(art.state.candidates, []);
  assert.equal(dispatched.length, 1);
});

void test('after a restart a stage is not resent, and the core\'s record can still settle it', async t => {
  const {art, dispatched, publish, restart, advance} = await withCore(t);
  await art.owner(start(['tidbyt']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  const {requestId} = stageOf(dispatched[0]);
  await restart();
  await advance(30);
  assert.equal(dispatched.length, 1, 'a restart resends nothing');
  assert.equal(art.state.candidates.length, 0);
  await publish(operation(requestId, 'completed', 'succeeded'), 2);
  await until(() => art.state.candidates.length === 1, 'the settled stage');
  assert.equal(dispatched.length, 1);
});

void test('an ambient job sets the tile through the core once its stage succeeded', async t => {
  const {art, dispatched, publish} = await withCore(t);
  await art.automatic(start(['tidbyt'], 'ambient'), 'tile');
  await art.finished('tile');
  await until(() => dispatched.length === 1, 'the stage');
  await publish(operation(stageOf(dispatched[0]).requestId, 'completed', 'succeeded'), 2);
  await until(() => dispatched.length === 2, 'the ambient set');
  const ambient: ArtDispatch = dispatched[1]?.data ?? assert.fail('no ambient');
  assert.equal(ambient.family, 'art-ambient-set');
  assert.deepEqual([ambient.target, ambient.data], ['tidbyt-configured', {compositionId: stageOf(dispatched[0]).data.compositionId}]);
});

/**
 * The module with no weather owner at its start, on a scheduler the test runs, and then a weather owner. The module's first
 * sync meets no owner, so it asks again 1 s later on its own clock, which `retry` advances.
 */
async function withWeather(t: TestContext, record: () => object) {
  const timers = moduleTimers();
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}, scheduler: timers.scheduler}), owner: Participant = art.bus.connect('bunny/modules/weather');
  t.after(() => owner.close());
  let syncs = 0;
  await owner.serveSync(['weather-state'], () => {
    syncs += 1;
    return {revision: 1, states: [{type: 'org.bunny.weather-state.updated', subject: 'local', dataschema: 'https://bunny.invalid/events/weather-state/2.0', data: record() as never}]};
  });
  /**
   * Moves the module's clock 1 s on and runs every timer that falls due by then: the retries of the copies the module
   * follows, the weather copy's among them. It then waits until the weather owner has served the module,
   * and one turn more for the module to take the answer.
   */
  const retry = async (): Promise<void> => {
    await timers.advance(art, 1000);
    await until(() => syncs > 0, 'the weather owner to serve the module\'s retry');
    await flush();
  };
  return {art, images, owner, retry};
}
const available = (staleAtMs: number) => ({id: 'local', revision: 1, status: 'available', observedAtMs: 1, staleAtMs, ageMs: 0, words: ['chance of rain', '48°F', 'evening'], location: 'Springfield'});

void test('weather comes from weather-state as condition words only, with no location, temperature or day part', async t => {
  const stale = new Date(2030, 0, 1).getTime(), {art, images, retry} = await withWeather(t, () => available(stale));
  // The module's first sync met no owner, so its retry finds this one; a live record reaches it from then on.
  await retry();
  await art.owner(start(['tidbyt']), 'req');
  await art.finished('req');
  const prompt = images.requests[0]?.prompt ?? assert.fail('no prompt');
  assert.match(prompt, /mood: chance of rain\./);
  assert.equal(prompt.includes('Springfield') || prompt.includes('48'), false);
  assert.equal(JSON.stringify(art.state).includes('Springfield'), false);
  assert.equal(JSON.stringify(art.host.logs).includes('Springfield'), false);
});

void test('stale or unavailable weather-state makes no claim', async t => {
  for (const record of [available(1), {id: 'local', revision: 1, status: 'unavailable', reason: 'outage', observedAtMs: null, ageMs: null}]) {
    const {art, images, retry} = await withWeather(t, () => record);
    await retry();
    await art.owner(start(['tidbyt']), 'req');
    await art.finished('req');
    assert.equal(/mood|rain/.test(images.requests[0]?.prompt ?? ''), false);
  }
});

void test('a job takes words from the command\'s validated context first', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  await art.automatic({...start(['tidbyt'], 'appearance'), context: {time: 'dawn', season: 'winter', weather: 'light snow'}}, 'req');
  await art.finished('req');
  assert.match(images.requests[0]?.prompt ?? '', /dawn in winter\. Requested weather inspiration: light snow\./);
});

void test('the registration builds the wired module, with no provider until a key is named', async t => {
  assert.equal(registration.name, 'art');
  assert.equal(registration.shipped, true);
  assert.ok(createArtModule().manifest.content);
  const art = await hosted(t);
  await art.owner(start(['tidbyt']), 'req');
  assert.equal((await art.finished('req')).targets[0]?.reason, 'no-key');
});
