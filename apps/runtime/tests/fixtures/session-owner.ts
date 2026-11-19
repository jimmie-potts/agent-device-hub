// A stand-in core for the read-receipt helpers (Hub #1865): a runtime whose `core` module only serves fixed session
// state messages and records the lifecycle messages it receives. It lets a helper meet a session version the real core
// no longer publishes, such as the `session/2.0` an older core sent, through the authenticated gateway.
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {buildSession, type SessionFacts} from '@jimmie-potts/event-contracts/v2/session';
import type {Session30Record, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CORE_MODULE} from '../../src/host.js';
import {edgeConfig, fixture, run} from '../support.js';

const SESSION_2 = 'https://bunny.invalid/events/session/2.0';
const SESSION_2_1 = 'https://bunny.invalid/events/session/2.1';

type SessionState = Message<{id: string; revision: number}>;

/**
 * A case's expected record moved to now, keeping its instants' distances from its message's time: a state message is
 * judged at the time the stand-in core publishes it.
 */
export function current(message: Message<Session30Record>, nowMs = Date.now()): Message<Session30Record> {
  const shift = nowMs - Date.parse(message.time);
  return {...structuredClone(message), time: new Date(nowMs).toISOString(), data: rebuilt(message.data, {
    observedAtMs: message.data.observedAtMs + shift, lastEvidenceAtMs: message.data.lastEvidenceAtMs + shift,
  })};
}

/** The facts of a `session/3.0` record, so a test can change one and rebuild the record with its status. */
function factsOf(record: Session30Record): SessionFacts {
  const {status: _status, work, attention, outcome, relationships, ...rest} = structuredClone(record);
  const unconfirmed = work.reasons.find(reason => reason === 'deadline' || reason === 'restart');
  return {
    ...rest, work: work.state, ...(unconfirmed === undefined ? {} : {unconfirmed}), attention: attention.items, notices: outcome.notices,
    read: outcome.read, ...(outcome.readReceipt === undefined ? {} : {readReceipt: outcome.readReceipt}), children: relationships.children,
  };
}

/** The record with `change` applied to its facts, its status following its claims. */
export function rebuilt(record: Session30Record, change: Partial<SessionFacts>): Session30Record {
  return buildSession({...factsOf(record), ...change});
}

/**
 * The same session as the `session/2.0` (or, with read provenance, `2.1`) state an older core published, whose
 * freshness holds at the message's time. The helpers of this release refuse it.
 */
export function asSession20(message: Message<Session30Record>): SessionState {
  const {status: _status, work, attention, outcome, relationships, ...rest} = structuredClone(message.data);
  const restartUncertain = work.reasons.includes('restart');
  const stale = Date.parse(message.time) - rest.lastEvidenceAtMs >= 300_000;
  const data: SessionRecord = {
    ...rest, activity: work.state, attention: attention.items, notices: outcome.notices, read: outcome.read,
    ...(outcome.readReceipt === undefined ? {} : {readReceipt: outcome.readReceipt}),
    freshness: restartUncertain || stale ? 'uncertain' : 'current', restartUncertain,
    children: {active: relationships.children.working, uncertain: relationships.children.unconfirmed},
  };
  return {...structuredClone(message), dataschema: data.readReceipt === undefined ? SESSION_2 : SESSION_2_1, data};
}

/**
 * A runtime with the stand-in core serving `states`, and a private producer file for `source` with the given feed. The
 * producer's credential has the read and ingest scopes, as a read helper's grant does.
 */
export async function servedSessions(context: TestContext, source: string, feed: object, states: readonly SessionState[]) {
  const token = randomBytes(32).toString('base64url');
  const files = await edgeConfig(context, [{source, token, scopes: ['read', 'ingest']}]);
  const received: Message[] = [];
  const core = fixture(CORE_MODULE, async ({sdk}) => {
    const revision = Math.max(0, ...states.map(state => state.data.revision));
    await sdk.serveSync(['session'], () => ({revision, states: states.map(({type, subject, dataschema, data}) => ({type, subject, dataschema, data}))}));
    await sdk.subscribe('bunny.event.lifecycle.*', message => { received.push(message); });
  });
  const {runtime} = await run(context, {modules: [core], configFile: files.config, edge: {schemas: {}}});
  const producer = join(files.dir, 'read-producer.json');
  await writeFile(producer, JSON.stringify({enabled: true, qualified: true, endpoint: `${runtime.url}/api/monitor/v1/events`, source: feed, token}), {mode: 0o600});
  return {runtime, producer, received};
}
