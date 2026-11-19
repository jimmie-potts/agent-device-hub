// A stand-in core for the read-receipt helpers (Hub #1865): a runtime whose `core` module only serves fixed session
// state messages and records the lifecycle messages it receives. It lets a helper meet a session version the real core
// does not publish yet, such as `session/3.0`, through the authenticated gateway.
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {sessionView} from '@jimmie-potts/event-contracts/v2/session';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CORE_MODULE} from '../../src/host.js';
import {edgeConfig, fixture, run} from '../support.js';

const SESSION_3 = 'https://bunny.invalid/events/session/3.0';

type SessionState = Message<{id: string; revision: number}>;

/**
 * A case's expected record moved to now, keeping its instants' distances from its message's time: a state message is
 * judged at the time the stand-in core publishes it.
 */
export function current(message: Message<SessionRecord>, nowMs = Date.now()): Message<SessionRecord> {
  const shift = nowMs - Date.parse(message.time);
  const data = {...structuredClone(message.data), observedAtMs: message.data.observedAtMs + shift, lastEvidenceAtMs: message.data.lastEvidenceAtMs + shift};
  return {...structuredClone(message), time: new Date(nowMs).toISOString(), data};
}

/** The same session as `session/3.0`: its view is the 3.0 record. */
export function asSession30(message: Message<SessionRecord>): SessionState {
  return {...structuredClone(message), dataschema: SESSION_3, data: sessionView(message.data)};
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
