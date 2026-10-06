// Hub #842's reference-consumer scenarios (`packages/event-contracts/fixtures/v2/families.json`), run through SDK
// copies so that agreement with `tests/consumer.mjs` is executed, not argued. The test feeds each copy as a transport
// would:
// - a state or removal arrives on its family's subscription;
// - a sync request step makes that family's copy sync again;
// - a sync.completed step answers it.
// Within a sync, the states at or below the completed revision form the owner's snapshot. The messages above it
// arrived live and wait in the buffer. A removal at or below the revision is already reflected by membership.
// Occurrence steps are skipped: they travel on bunny.event keys, which a copy does not follow.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {entryOf, startSync, type SyncAnswer, type SyncCompleted, type SyncedCopy, type SyncRequest, type SyncTransport} from '../src/sync.js';
import {flush, it} from './support.js';

type Scenario = {name: string; steps: string[]; expect: string[]};
type Fixtures = {valid: Record<string, Message>; scenarios: Scenario[]};
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/v2/families.json', import.meta.resolve('@jimmie-potts/event-contracts/v2')), 'utf8')) as Fixtures;
const validator = new MessageValidator();
registerCoreFamilies(validator);

function fixture(step: string): Message {
  const message = fixtures.valid[step];
  assert.ok(message, step);
  const result = validator.validate(message);
  assert.ok(result.ok, `${step}: ${result.ok ? '' : result.error.detail ?? result.error.code}`);
  return structuredClone(message);
}

const keyOf = (message: Message): string => {
  const entry = entryOf(message);
  assert.ok(entry, message.id);
  return `${entry.entity.family}/${entry.entity.id}`;
};

/** One family's SDK copy, with the transport calls the test makes in its place. */
class Fed {
  readonly reported: unknown[] = [];
  readonly sent: {requestId: string; answer: (answer: SyncAnswer) => void}[] = [];
  deliver: (message: Message) => void = () => assert.fail('not subscribed');
  overflow: () => void = () => assert.fail('not subscribed');
  copy: SyncedCopy<Record<string, unknown>> | undefined;
  readonly transport: SyncTransport = {
    now: () => Date.now(),
    subscribe: (_pattern, handler, {onOverflow}) => {
      this.deliver = message => { void handler(message); };
      this.overflow = () => { void onOverflow?.({dropped: 1}); };
      return Promise.resolve({close: () => Promise.resolve()});
    },
    request: ({requestId}) => new Promise<SyncAnswer>(answer => { this.sent.push({requestId, answer}); }),
    report: error => { this.reported.push(error); },
  };

  /** The latest request the copy sent. */
  last(): {requestId: string; answer: (answer: SyncAnswer) => void} {
    const request = this.sent.at(-1);
    assert.ok(request, 'the copy sent a sync request');
    return request;
  }
}

/** A `sync.completed` built from a fixture's, for the copy's first sync: the owner holds nothing yet, at revision 0. */
function emptyAnswer(requestId: string, template: Message): SyncAnswer {
  const completed = {...structuredClone(template), data: {requestId, revision: 0, members: []}} as Message<SyncCompleted>;
  return {status: 'served', requestId, states: [], completed};
}

for (const {name, steps, expect} of fixtures.scenarios) {
  it(`#842 scenario through an SDK copy: ${name}`, async () => {
    const messages = steps.map(fixture);
    const template = fixture('sync-completed');
    const copies = new Map<string, Fed>();
    const familyOf = (message: Message): string => keyOf(message).split('/')[0] ?? '';
    for (const family of new Set(messages.filter(message => message.kind === 'state' || message.kind === 'removal').map(familyOf))) {
      const fed = new Fed();
      const started = startSync<Record<string, unknown>>(fed.transport, [family], () => {}, {timeoutMs: 60_000});
      await flush();
      fed.last().answer(emptyAnswer(fed.last().requestId, template));
      const result = await started;
      assert.equal(result.status, 'synced', family);
      if (result.status === 'synced') fed.copy = result.copy;
      copies.set(family, fed);
    }
    const copyOf = (family: string): Fed => {
      const fed = copies.get(family);
      assert.ok(fed, family);
      return fed;
    };
    const windows = new Map<string, {fed: Fed; family: string; request: {requestId: string; answer: (answer: SyncAnswer) => void}; seen: Message[]}>();

    for (const message of messages) {
      switch (message.kind) {
        case 'state':
        case 'removal': {
          const family = familyOf(message);
          const open = [...windows.values()].find(window => window.family === family);
          if (open !== undefined) open.seen.push(message);
          else {
            copyOf(family).deliver(message);
            await flush();
          }
          break;
        }
        case 'sync-request': {
          const {requestId, families} = (message as Message<SyncRequest>).data;
          assert.equal(families.length, 1, 'each scenario syncs one family');
          const family = families[0] ?? '';
          const fed = copyOf(family);
          fed.overflow();
          await flush();
          windows.set(requestId, {fed, family, request: fed.last(), seen: []});
          break;
        }
        case 'sync-completed': {
          const completed = message as Message<SyncCompleted>;
          const window = windows.get(completed.data.requestId);
          assert.ok(window, completed.data.requestId);
          windows.delete(completed.data.requestId);
          const {revision} = completed.data;
          const live = window.seen.filter(seen => (entryOf(seen)?.revision ?? 0) > revision);
          const states = window.seen.filter(seen => seen.kind === 'state' && (entryOf(seen)?.revision ?? 0) <= revision);
          for (const seen of live) window.fed.deliver(seen);
          await flush();
          window.request.answer({status: 'served', requestId: window.request.requestId, states, completed});
          await flush();
          break;
        }
        case 'occurrence':
        case 'command':
        case 'reply':
        case 'outcome':
          break;
      }
    }

    const held = new Map<string, unknown>();
    for (const fed of copies.values()) {
      assert.deepEqual(fed.reported, [], 'nothing was ignored');
      for (const state of fed.copy?.states() ?? []) held.set(keyOf(state), state.data);
    }
    const expected = new Map(expect.map(step => {
      const message = fixture(step);
      return [keyOf(message), message.data];
    }));
    assert.deepEqual(held, expected);
  });
}
