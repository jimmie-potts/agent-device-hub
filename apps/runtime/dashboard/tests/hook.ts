// A synthetic agent hook for a disposable run (Hub #922), so a person checking the dashboard can make a session do what
// an agent's hook would report: start, start a turn, ask for an approval, have it resolved, finish the turn or end. It
// publishes one lifecycle observation through the run's SDK edge with the run's own `hook` credential, which it reads
// from the run's `part-tokens.json` and never prints. Every identity is synthetic. Run `npm run build` first.
//
//   node apps/runtime/dashboard/tests/hook.ts <origin> <part-tokens.json> <event> [--session <id>] [--turn <id>]
//     [--title <text>] [--attention <id>] [--desktop]
//
// <event> is a lifecycle kind: session-started, turn-started, turn-ended, attention-approval, attention-resolved,
// question-continuing, read-observed or runtime-ended.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import type {LifecycleEvent} from '@jimmie-potts/event-contracts/v2/families';
import {connectRemote} from '@jimmie-potts/sdk';
import {IDENTITY, observation} from '../../dist/tests/fixtures/agents.js';

const {positionals, values} = parseArgs({
  allowPositionals: true,
  options: {session: {type: 'string'}, turn: {type: 'string'}, title: {type: 'string'}, attention: {type: 'string'}, desktop: {type: 'boolean'}},
});
const [origin, tokensFile, kind] = positionals;
if (origin === undefined || tokensFile === undefined || kind === undefined) {
  throw new Error('usage: hook.ts <origin> <part-tokens.json> <event> [--session <id>] [--turn <id>] [--title <text>] [--attention <id>] [--desktop]');
}
const attention = {status: 'known', id: values.attention ?? 'approval-1'} as const;
const events: Readonly<Record<string, LifecycleEvent>> = {
  'session-started': {kind: 'session-started'}, 'turn-started': {kind: 'turn-started'}, 'turn-ended': {kind: 'turn-ended'},
  'read-observed': {kind: 'read-observed', state: 'read'},
  'runtime-ended': {kind: 'runtime-ended'}, 'attention-approval': {kind: 'attention-approval', attention},
  'attention-resolved': {kind: 'attention-resolved', attention}, 'question-continuing': {kind: 'question-continuing', attention},
};
const event = events[kind];
if (event === undefined) throw new Error(`unknown event ${kind}; use one of ${Object.keys(events).join(', ')}`);
const token = (JSON.parse(await readFile(tokensFile, 'utf8')) as {hook?: unknown}).hook;
if (typeof token !== 'string') throw new Error('the tokens file holds no hook token');
const hook = await connectRemote({url: origin, source: 'bunny/parts/hook', token});
try {
  const {key, draft} = observation(event, Date.now(), {
    identity: {...IDENTITY, ...(values.desktop === true ? {provider: 'codex', client: 'desktop', sourceId: 'codex-desktop'} as const : {}), sessionId: values.session ?? IDENTITY.sessionId}, turn: values.turn ?? 'turn-1',
    ...(values.title === undefined ? {} : {title: {value: values.title, source: 'provider'}}),
  });
  await hook.publish(key, draft);
  process.stdout.write(`${JSON.stringify({published: kind, session: values.session ?? IDENTITY.sessionId, turn: values.turn ?? 'turn-1'})}\n`);
} finally {
  await hook.close();
}
