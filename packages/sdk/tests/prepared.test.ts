// A prepared message (Hub #883, #882): published unchanged, as an outbox resends what it stored and a remote edge
// injects a remote part's message.
import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '../src/index.js';
import {bus, flush, it, session, turnEnded} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

it('a prepared message is published unchanged, so an outbox can resend what it stored', async () => {
  const {core, wall} = bus();
  const received: Message[] = [];
  await wall.subscribe('bunny.state.session.*', message => { received.push(message); });
  const stored = await core.publish('bunny.state.session.s1', session('s1', 1));
  const again = await core.publishMessage('bunny.state.session.s1', stored);
  await flush();
  assert.equal(again, stored, 'the same object, not a copy');
  assert.deepEqual(received, [stored, stored], 'the same id, time and trace both times');
});

it('a prepared message keeps the key-class rules and comes only from its own source', async () => {
  const {core, wall} = bus();
  const stored = await core.publish('bunny.state.session.s1', session('s1', 1));
  await assert.rejects(wall.publishMessage('bunny.state.session.s1', stored), refused('forbidden'), 'another source');
  await assert.rejects(core.publishMessage('bunny.event.session.s1', stored), refused('invalid-request'), 'a state on an event key');
  await assert.rejects(core.publishMessage('bunny.state.session', stored), refused('invalid-request'), 'a malformed key');
  const command = {...await core.publish('bunny.event.session.s1', turnEnded('s1')), kind: 'command' as const};
  await assert.rejects(core.publishMessage('bunny.event.session.s1', command), refused('invalid-request'), 'a kind that is not published');
  await core.close();
  await assert.rejects(core.publishMessage('bunny.state.session.s1', stored), refused('invalid-state'), 'a closed participant');
});
