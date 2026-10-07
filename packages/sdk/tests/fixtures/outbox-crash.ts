// One run of a module's process for the outbox's crash tests (Hub #972). It opens the module's database file in WAL mode
// at `synchronous = FULL`, as the runtime does, and either commits one transaction that stores a state, an outcome and
// an occurrence, or republishes what the file still holds, as a module's start does. Each message it sends, and each
// record its outbox writes, is appended to the wire file, which outlives the process as a consumer's copy and the
// runtime's journal would. The process kills itself with SIGKILL where its mode says:
//   node outbox-crash.js <database> <wire> commit before-send    between the commit and the first send
//   node outbox-crash.js <database> <wire> commit after-send     after the last send, before the batch's bookkeeping commits
//   node outbox-crash.js <database> <wire> commit                and exits once the batch has gone out
//   node outbox-crash.js <database> <wire> republish
import {appendFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {Outbox, type LogFields, type Logger, type TraceContext} from '../../src/index.js';

const [file, wire, action, kill] = process.argv.slice(2);
if (file === undefined || wire === undefined || (action !== 'commit' && action !== 'republish')) throw new Error('usage: outbox-crash.js <database> <wire> commit|republish [before-send|after-send]');
const BASE = 'https://bunny.invalid/events/';
const append = (line: object): void => { appendFileSync(wire, `${JSON.stringify(line)}\n`); };
const die = (): never => {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('still alive after SIGKILL');
};

const database = new DatabaseSync(file);
database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS lamps (id TEXT PRIMARY KEY, power TEXT NOT NULL)');
let sent = 0;
const record = (level: string) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => { append({record: event, level, fields, trace}); };
const log: Logger = {debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error')};
const outbox = new Outbox({
  sdk: {source: 'bunny/modules/lamp', publishMessage: <T extends object>(key: string, message: Message<T>): Promise<Message<T>> => {
    if (kill === 'before-send') die();
    append({sent: key, message});
    sent += 1;
    // The last message went out; the process dies before its batch's bookkeeping commits.
    if (kill === 'after-send' && sent === 3) die();
    return Promise.resolve(message);
  }},
  database, clock: {now: () => Date.now()}, log,
});

if (action === 'republish') {
  append({republished: await outbox.republish()});
} else {
  await outbox.transaction(add => {
    database.prepare('INSERT INTO lamps (id, power) VALUES (?, ?)').run('lamp-1', 'on');
    // The outcome comes before the last message, so a first publication recorded before the bookkeeping commits shows.
    add('bunny.state.session.s1', {kind: 'state', type: 'org.bunny.session.updated', subject: 's1', dataschema: `${BASE}test-session/2.0`, data: {id: 's1', revision: 1}});
    add('bunny.event.mode.wall', {kind: 'outcome', type: 'org.bunny.mode.set.completed', subject: 'wall', dataschema: `${BASE}outcome/2.0`,
      data: {requestId: 'req-1', result: 'succeeded', evidence: 'observed'}});
    add('bunny.event.session.s1', {kind: 'occurrence', type: 'org.bunny.turn.ended', subject: 's1', dataschema: `${BASE}test-turn/2.0`, data: {sessionId: 's1'}});
  });
  append({committed: true});
}
database.close();
