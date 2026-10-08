import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {SimulatedSpeakers} from '../src/simulated.js';
import {host, storedCommands, test, withWriteFailure, type Hosted} from './support.js';

const playing = (title: string) => ({input: 'airplay', status: 'playing', title, artist: 'Artist'}) as const;
const answer = (result: Awaited<ReturnType<Hosted['send']>>): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;
const storage = (hosted: Hosted): string[] => hosted.logs().filter(record => record.fields['bunny.operation'] === 'storage')
  .map(record => `${record.level} ${record.event} ${String(record.fields['bunny.code'] ?? record.fields['bunny.outcome'] ?? '')}`);
const clean = (hosted: Hosted): void => { assert.deepEqual(hosted.problems(), [], 'every message follows profile 2.0, and nothing of the module failed'); };

test('a wrapped ENOSPC while recording command intent is capacity and sends nothing', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  let injected: Error | undefined;
  const hosted = await host(context, speakers, {wrapDatabase: database => withWriteFailure(database, () => {
    const failure = injected;
    injected = undefined;
    return failure;
  })});
  await hosted.advance(1000);
  injected = new Error('playback transaction failed', {cause: Object.assign(new Error('filesystem is full'), {code: 'ENOSPC'})});

  assert.equal(answer(await hosted.send('pause', 'r-wrapped-full')), 'capacity');
  assert.deepEqual(speakers.state().sony.commands, [], 'the command was refused before the speaker heard it');
  assert.deepEqual(storedCommands(hosted), [], 'the failed intent rolled back');
  assert.ok(storage(hosted).includes('warn operation.failed capacity'), 'the error code in the cause selects capacity');
  clean(hosted);
});

test('SQLite BUSY and LOCKED remain unavailable storage outcomes', async context => {
  for (const errcode of [5, 6]) {
    const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
    let injected: Error | undefined;
    const hosted = await host(context, speakers, {wrapDatabase: database => withWriteFailure(database, () => {
      const failure = injected;
      injected = undefined;
      return failure;
    })});
    await hosted.advance(1000);
    injected = Object.assign(new Error('SQLite is busy'), {errcode});

    assert.equal(answer(await hosted.send('pause', `r-busy-${errcode}`)), 'capacity', 'the existing refusal reply is unchanged');
    assert.ok(storage(hosted).includes('warn operation.failed unavailable'), `errcode ${errcode} keeps its unavailable diagnostic`);
    assert.deepEqual(speakers.state().sony.commands, [], `errcode ${errcode} sends nothing`);
    await hosted.stop();
  }
});

test('an explicit SdkError code keeps precedence over the full-disk test', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  let injected: Error | undefined;
  const hosted = await host(context, speakers, {wrapDatabase: database => withWriteFailure(database, () => {
    const failure = injected;
    injected = undefined;
    return failure;
  })});
  await hosted.advance(1000);
  injected = new SdkError(errorBody('forbidden', {detail: 'synthetic storage refusal'}), {cause: Object.assign(new Error('filesystem is full'), {code: 'ENOSPC'})});

  assert.equal(answer(await hosted.send('pause', 'r-sdk-error')), 'capacity', 'the established admission refusal stays unchanged');
  assert.ok(storage(hosted).includes('warn operation.failed forbidden'), 'SdkError keeps its explicit registry code');
  assert.deepEqual(speakers.state().sony.commands, [], 'the command was refused before the speaker heard it');
  clean(hosted);
});
