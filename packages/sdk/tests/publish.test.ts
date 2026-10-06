// Publish and subscribe on SDK routing keys, `bunny.<state|event|cmd>.<family>.<id>` (ADR 0012).
import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '../src/index.js';
import {assertValid, bus, flush, it, modeSet, removed, session, setMode, turnEnded} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

it('subscribers receive the messages whose routing keys match their patterns', async () => {
  const {core, wall} = bus();
  const seen: Record<string, string[]> = {sessions: [], s1: [], everything: [], mode: []};
  const record = (name: string) => (message: Message): void => { seen[name]?.push(`${message.kind} ${message.subject}`); };
  await wall.subscribe('bunny.state.session.*', record('sessions'));
  await wall.subscribe('bunny.*.session.s1', record('s1'));
  await wall.subscribe('bunny.*.*.*', record('everything'));
  await wall.subscribe('bunny.state.mode.wall', record('mode'));

  await core.publish('bunny.state.session.s1', session('s1', 1));
  await core.publish('bunny.state.session.s2', session('s2', 1));
  await core.publish('bunny.event.session.s1', turnEnded('s1'));
  await core.publish('bunny.state.session.s1', removed('s1', 2));
  await flush();

  assert.deepEqual(seen, {
    sessions: ['state s1', 'state s2', 'removal s1'],
    s1: ['state s1', 'occurrence s1', 'removal s1'],
    everything: ['state s1', 'state s2', 'occurrence s1', 'removal s1'],
    mode: [],
  });
});

it('a published message is a profile 2.0 envelope, delivered as the same plain object', async () => {
  const {core, wall} = bus();
  const received: Message[] = [];
  await wall.subscribe('bunny.state.session.*', message => { received.push(message); });
  const sent = await core.publish('bunny.state.session.s1', session('s1', 7));
  await flush();

  assertValid(sent);
  assert.equal(received[0], sent, 'no copy and no serialization in process');
  assert.equal(Object.getPrototypeOf(sent), Object.prototype);
  assert.equal(sent.source, 'bunny/core');
  assert.equal(sent.kind, 'state');
  assert.equal(sent.type, 'org.bunny.session.updated');
  assert.deepEqual(sent.data, {id: 's1', revision: 7});
  assert.equal(sent.expiresat, undefined);
  const second = await core.publish('bunny.state.session.s1', session('s1', 8));
  assert.notEqual(second.id, sent.id, 'each message has its own id');
  assertValid(await core.publish('bunny.state.session.s1', removed('s1', 9)));
  assertValid(await core.publish('bunny.event.session.s1', turnEnded('s1')));
});

it('each subscriber receives messages in the order they were published', async () => {
  const {core, wall} = bus();
  const revisions: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.s1', message => { revisions.push(message.data.revision); });
  await Promise.all([1, 2, 3, 4, 5].map(revision => core.publish('bunny.state.session.s1', session('s1', revision))));
  await flush();
  assert.deepEqual(revisions, [1, 2, 3, 4, 5]);
});

it('a closed subscription receives nothing more', async () => {
  const {core, wall} = bus();
  const revisions: number[] = [];
  const subscription = await wall.subscribe<{revision: number}>('bunny.state.session.s1', message => { revisions.push(message.data.revision); });
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await flush();
  await subscription.close();
  await core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  assert.deepEqual(revisions, [1]);
});

it('malformed routing keys and patterns are refused with the error body', async () => {
  const {core} = bus();
  const keys = [
    'bunny.state.session', 'bunny.state.session.s1.extra', 'Bunny.state.session.s1', 'bunny.state.Session.s1',
    'bunny.status.session.s1', 'bunny.state.session.-s1', 'bunny.state.session.s1-', 'bunny.state.session.s_1',
    'bunny.state.session.*', 'nats.state.session.s1', 'bunny.state..s1',
  ];
  for (const key of keys) await assert.rejects(core.publish(key, session('s1', 1)), refused('invalid-request'), key);
  const patterns = ['bunny.state.session', '*.state.session.s1', 'bunny.state.ses*.s1', 'bunny.state.session.>', 'bunny.state.session.S1'];
  for (const pattern of patterns) await assert.rejects(core.subscribe(pattern, () => {}), refused('invalid-request'), pattern);
});

it('a message kind travels on its own key class, and commands only through request and respond', async () => {
  const {core} = bus();
  await assert.rejects(core.publish('bunny.event.session.s1', session('s1', 1)), refused('invalid-request'), 'state on an event key');
  await assert.rejects(core.publish('bunny.event.session.s1', removed('s1', 1)), refused('invalid-request'), 'removal on an event key');
  await assert.rejects(core.publish('bunny.state.session.s1', turnEnded('s1')), refused('invalid-request'), 'occurrence on a state key');
  const command = {...setMode('quiet'), kind: 'command'} as unknown as ReturnType<typeof session>;
  await assert.rejects(core.publish('bunny.cmd.mode.wall', command), refused('invalid-request'), 'publish to a command key');
  await assert.rejects(core.subscribe('bunny.cmd.mode.*', () => {}), refused('invalid-request'), 'subscribe to command keys');
  await assert.rejects(core.respond('bunny.state.mode.*', () => ({status: 'accepted'})), refused('invalid-request'), 'respond off a command key');
});

it('an outcome is published on an event key, and refused on state and command keys', async () => {
  const {core, wall} = bus();
  const received: Message[] = [];
  await wall.subscribe('bunny.event.mode.*', message => { received.push(message); });
  const sent = await core.publish('bunny.event.mode.wall', modeSet('req-1'));
  await flush();
  assertValid(sent);
  assert.equal(sent.kind, 'outcome');
  assert.deepEqual(received, [sent]);
  await assert.rejects(core.publish('bunny.state.mode.wall', modeSet('req-1')), refused('invalid-request'), 'outcome on a state key');
  await assert.rejects(core.publish('bunny.cmd.mode.wall', modeSet('req-1')), refused('invalid-request'), 'outcome on a command key');
});

it('a participant source follows the profile', () => {
  const {bus: created} = bus();
  for (const source of ['core', 'bunny', 'bunny/', 'bunny/Core', 'bunny/core/']) {
    assert.throws(() => created.connect(source), refused('invalid-request'), source);
  }
  assert.equal(created.connect('bunny/modules/pixoo').source, 'bunny/modules/pixoo');
});
