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
import {drawing, fakeImages} from './fixtures.js';
import {hosted, until} from './support.js';

const start = (targets: string[], purpose = 'request') => ({action: 'start', purpose, origin: {kind: 'owner'}, targets});
const validator = new MessageValidator(); registerCoreFamilies(validator);
const operation = (requestId: string, status: OperationRecord['status'], result?: OperationRecord['result']): OperationRecord => ({id: operationEntityId(requestId), revision: 1, requestId, kind: 'device', family: 'art-stage',
  command: 'org.bunny.art.stage.requested', target: 'tidbyt', requestedBy: 'bunny/modules/art', status, ...(result === undefined ? {} : {result}), sentAtMs: 1, updatedAtMs: 1, deadlineAtMs: 2});

/** The module with the default seams and a stand-in core: it checks each dispatch and publishes the operation records a test asks for. */
async function withCore(t: TestContext) {
  const dispatched: Message<ArtDispatch>[] = [], providers = {openai: fakeImages(drawing())}, art = await hosted(t, {providers}), {operator} = art;
  await operator.respond<ArtDispatch>('bunny.cmd.art-dispatch.art', command => {
    const checked = validator.validate(command, {nowMs: art.clock.now()});
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal(command.source, 'bunny/modules/art');
    dispatched.push(command);
    return {status: 'accepted'};
  });
  const records = new Map<string, OperationRecord>();
  await operator.serveSync(['operation'], () => ({revision: 1, states: [...records.values()].map(data => ({type: 'org.bunny.operation.updated', subject: data.id, dataschema: 'https://bunny.invalid/events/operation/2.0', data}))}));
  const publish = async (record: OperationRecord, revision: number): Promise<void> => {
    records.set(record.id, record);
    await operator.publish(`bunny.state.operation.${record.id}`, {kind: 'state', type: 'org.bunny.operation.updated', subject: record.id, dataschema: 'https://bunny.invalid/events/operation/2.0', data: {...record, revision}});
  };
  return {art, dispatched, publish};
}
const stageOf = (message: Message<ArtDispatch> | undefined): Extract<ArtDispatch, {family: 'art-stage'}> => message?.data.family === 'art-stage' ? message.data : assert.fail('not a stage');

void test('a composition is dispatched through the core as a valid art-stage, and offered only after its operation succeeded', async t => {
  const {art, dispatched, publish} = await withCore(t);
  await art.owner(start(['tidbyt']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  const stage = stageOf(dispatched[0]), bytes = Buffer.from(stage.data.base64, 'base64');
  assert.deepEqual([stage.target, stage.data.format, stage.data.width, stage.data.height, stage.data.frames, stage.data.durationMs], ['tidbyt', 'gif', 64, 32, 8, 1600]);
  assert.equal(stage.data.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(stage.data.compositionId, art.state.artworks[0]?.compositions[0]?.compositionId);
  // The module follows the core's records once its own sync has settled, and an accepted operation proves no effect.
  await new Promise(resolve => setTimeout(resolve, 30));
  await publish(operation(stage.requestId, 'accepted'), 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(art.state.candidates.length, 0);
  await publish(operation(stage.requestId, 'completed', 'succeeded'), 3);
  await until(() => art.state.candidates.length === 1, 'the candidate');
  assert.equal(art.state.candidates[0]?.compositionId, stage.data.compositionId);
  assert.equal(dispatched.length, 1, 'never resent');
});

void test('a failed or rejected operation offers nothing, and another module\'s records are ignored', async t => {
  const {art, dispatched, publish} = await withCore(t);
  await art.owner(start(['pixoo']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  await new Promise(resolve => setTimeout(resolve, 30));
  await publish({...operation('other', 'completed', 'succeeded'), family: 'power-set'}, 2);
  await publish(operation(stageOf(dispatched[0]).requestId, 'rejected'), 3);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(art.state.candidates, []);
  assert.equal(dispatched.length, 1);
});

void test('after a restart a stage is not resent, and the core\'s record can still settle it', async t => {
  const {art, dispatched, publish} = await withCore(t);
  await art.owner(start(['tidbyt']), 'req');
  await art.finished('req');
  await until(() => dispatched.length === 1, 'the dispatch');
  const {requestId} = stageOf(dispatched[0]);
  await art.restart();
  await new Promise(resolve => setTimeout(resolve, 30));
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
  await new Promise(resolve => setTimeout(resolve, 30));
  await publish(operation(stageOf(dispatched[0]).requestId, 'completed', 'succeeded'), 2);
  await until(() => dispatched.length === 2, 'the ambient set');
  const ambient: ArtDispatch = dispatched[1]?.data ?? assert.fail('no ambient');
  assert.equal(ambient.family, 'art-ambient-set');
  assert.deepEqual([ambient.target, ambient.data], ['tidbyt', {compositionId: stageOf(dispatched[0]).data.compositionId}]);
});

async function withWeather(t: TestContext, record: () => object) {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}}), owner: Participant = art.bus.connect('bunny/modules/weather');
  t.after(() => owner.close());
  await owner.serveSync(['weather-state'], () => ({revision: 1, states: [{type: 'org.bunny.weather-state.updated', subject: 'local', dataschema: 'https://bunny.invalid/events/weather-state/2.0', data: record() as never}]}));
  return {art, images, owner};
}
const available = (staleAtMs: number) => ({id: 'local', revision: 1, status: 'available', observedAtMs: 1, staleAtMs, ageMs: 0, words: ['chance of rain', '48°F', 'evening'], location: 'Springfield'});

void test('weather comes from weather-state as condition words only, with no location, temperature or day part', async t => {
  const stale = new Date(2030, 0, 1).getTime(), {art, images} = await withWeather(t, () => available(stale));
  // The module's first sync met no owner, so its retry finds this one; a live record reaches it from then on.
  await new Promise(resolve => setTimeout(resolve, 1200));
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
    const {art, images} = await withWeather(t, () => record);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await art.owner(start(['tidbyt']), 'req');
    await art.finished('req');
    assert.equal(/mood|rain/.test(images.requests[0]?.prompt ?? ''), false);
  }
});

void test('a job takes words from the command\'s validated context first', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  await art.automatic({...start(['tidbyt'], 'appearance'), context: {time: 'dawn', season: 'winter', weather: 'light snow'}}, 'req');
  await art.finished('req');
  assert.match(images.requests[0]?.prompt ?? '', /dawn in winter\. The weather's mood: light snow\./);
});

void test('the registration builds the wired module, with no provider until a key is named', async t => {
  assert.equal(registration.name, 'art');
  assert.equal(registration.shipped, true);
  assert.ok(createArtModule().manifest.content);
  const art = await hosted(t);
  await art.owner(start(['tidbyt']), 'req');
  assert.equal((await art.finished('req')).targets[0]?.reason, 'no-key');
});
