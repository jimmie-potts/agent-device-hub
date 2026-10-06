// The overflow signal: a subscriber whose bounded queue dropped messages hears of the gap, so it can sync again. The
// cases follow agent-state's "two healthy consumers progress while a stalled consumer stays bounded and resyncs".
import assert from 'node:assert/strict';
import {SdkError} from '../src/index.js';
import {bus, deferred, flush, it, session, type Session} from './support.js';

it('a stalled subscriber is told how many messages its full queue dropped, before its next message', async () => {
  const {core, wall, errors} = bus({maxQueued: 2});
  const gate = deferred<undefined>();
  const stalled: string[] = [];
  const healthy: number[] = [];
  await wall.subscribe<Session>('bunny.state.session.*', async message => {
    stalled.push(`s1@${message.data.revision}`);
    if (message.data.revision === 1) await gate.promise;
  }, {onOverflow: ({dropped}) => { stalled.push(`dropped ${dropped}`); }});
  await core.subscribe<Session>('bunny.state.session.*', message => { healthy.push(message.data.revision); });
  for (const revision of [1, 2, 3, 4, 5, 6]) {
    await core.publish('bunny.state.session.s1', session('s1', revision));
    await flush();
  }
  // Revision 1 is being handled, 2 and 3 wait, and 4, 5 and 6 find the queue full.
  assert.deepEqual(healthy, [1, 2, 3, 4, 5, 6], 'other subscribers progress');
  assert.deepEqual(stalled, ['s1@1']);
  assert.equal(errors.length, 3, 'onError still receives each dropped message');
  for (const {error} of errors) assert.ok(error instanceof SdkError && error.body.error.code === 'capacity');

  gate.resolve(undefined);
  await flush();
  assert.deepEqual(stalled, ['s1@1', 'dropped 3', 's1@2', 's1@3']);
  await core.publish('bunny.state.session.s1', session('s1', 7));
  await flush();
  assert.deepEqual(stalled.slice(4), ['s1@7'], 'one notice per gap');
});

it('each new gap is told again, and an overflow handler that throws is reported while delivery goes on', async () => {
  const {core, wall, errors} = bus({maxQueued: 1});
  const failure = new Error('cannot restart');
  const seen: string[] = [];
  await wall.subscribe<Session>('bunny.state.session.*', message => { seen.push(`s1@${message.data.revision}`); }, {onOverflow: ({dropped}) => {
    seen.push(`dropped ${dropped}`);
    throw failure;
  }});
  // Published in one turn, so the queue holds the first and drops the second.
  void core.publish('bunny.state.session.s1', session('s1', 1));
  void core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  void core.publish('bunny.state.session.s1', session('s1', 3));
  void core.publish('bunny.state.session.s1', session('s1', 4));
  void core.publish('bunny.state.session.s1', session('s1', 5));
  await flush();
  assert.deepEqual(seen, ['dropped 1', 's1@1', 'dropped 2', 's1@3']);
  const reported = errors.filter(({error}) => error === failure);
  assert.equal(reported.length, 2);
  assert.deepEqual(reported[0]?.scope, {source: 'bunny/wall', pattern: 'bunny.state.session.*'});
});
