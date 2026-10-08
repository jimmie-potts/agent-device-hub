// #923: the same shared-inbox journey in memory and an owned disposable run.
import type {InboxItem, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sessionStarted, turnEnded, turnStarted, SESSION_ID} from '../fixtures/agents.js';
import {switchLamp} from '../fixtures/lamp.js';
import {CORE_FAMILIES, act, dispatchOnce, expect, holds, inboxOf, publish, recorded, session, type Harness, type Scenario} from './framework.js';
const items = (h: Harness): InboxItem[] => h.reader.states<InboxItem>('inbox-item').map(state => state.data);
const handling = (h: Harness, action: 'dismiss' | 'send-again') => {
  const item = items(h)[0];
  if (item === undefined) throw new Error('synthetic inbox item missing');
  return h.gateway({as: 'operator', method: 'POST', path: '/api/v2/commands/inbox-handle', body: {
    target: item.id, requestId: `handle-${action}`, data: {action, expectedRevision: item.revision},
  }});
};
export const inboxScenarios: readonly Scenario[] = [{
  id: 'shared-inbox-history', title: 'failed and uncertain operations require explicit handling; history reads send nothing',
  seed: {modules: ['core', 'lamp'], follows: [[...CORE_FAMILIES, 'operation'], ['lamp']]},
  steps: [
    act('the simulated lamp fails its next command', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches the lamp on', h => dispatchOnce(h, 'operator', 'fail-inbox', switchLamp('lamp-1', 'on'), 'inbox-failed')),
    expect('the reader sees one failed item', h => inboxOf(h, 'inbox-failed').length === 1 || 'no failed item'),
    act('send again explicitly creates a new tracked operation', async h => {
      const answer = await handling(h, 'send-again'); if (answer.status !== 200) throw new Error('synthetic resend refused');
    }),
    expect('the original item is gone and one new command completed', h => {
      const operations = h.reader.states<OperationRecord>('operation').map(state => state.data);
      return (items(h).length === 0 && operations.some(op => op.requestId !== 'inbox-failed' && op.result === 'succeeded')) || 'resend not completed';
    }),
    act('the fixture mode accepts but never answers with an outcome', h => dispatchOnce(h, 'operator', 'mode-inbox', {
      key: 'bunny.cmd.mode-set.hub', draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: 'quiet'}},
    }, 'inbox-mode')),
    expect('the unanswered mode becomes one uncertain item', h => inboxOf(h, 'inbox-mode')[0]?.result === 'uncertain' || 'no uncertain mode item', 62_000),
    act('the operator dismisses the uncertain item', async h => {
      const answer = await handling(h, 'dismiss'); if (answer.status !== 200) throw new Error('synthetic dismissal refused');
    }),
    expect('the whole shared inbox read is empty', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/families/inbox-item'});
      return answer.status === 200 && (JSON.parse(answer.text) as {records: unknown[]}).records.length === 0 || 'shared handling missing';
    }),
    act('the hook records a finished agent turn', async h => { await publish(h, sessionStarted); await publish(h, turnStarted); await publish(h, turnEnded); }),
    expect('the turn is unread on its session and absent from the inbox', h => session(h)?.notices.length === 1 && items(h).length === 0 || 'turn inbox/unread mismatch'),
    expect('history reads filter kind, source, session and time', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: `/api/v2/history?kind=occurrence&source=bunny%2Fcore&session=${SESSION_ID}&fromAtMs=0&toAtMs=${h.now()}`});
      const rows = (JSON.parse(answer.text) as {rows?: {kind: string; source: string}[]}).rows;
      return answer.status === 200 && rows !== undefined && rows.length > 0 && rows.every(row => row.kind === 'occurrence' && row.source === 'bunny/core') || 'history filters mismatch';
    }),
    expect('the failed operation remains in real history', h => recorded(h, 'inbox-failed', 'failed', 'none')),
    holds('viewing and elapsed time create no inbox item', h => items(h).length === 0 || 'unexpected inbox item', 200),
  ],
}];
