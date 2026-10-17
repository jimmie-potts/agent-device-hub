// Shell-owned command attempts shared across module pages and device controls.
import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendAction, FrontendActionReply, FrontendUpload, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {errorBody} from '@jimmie-potts/event-contracts/v2/errors';
import {ATTEMPTS_KEY, rememberAttempt} from './attempts.ts';
import {sendAction} from './actions.ts';
import {operationView} from './devices.ts';

type Attempt = {requestId: string; target: string; family: string; text: string; locked: boolean};
/** Only action identities survive a reload, never draft values or credentials. A lost reply cannot unlock on reload. */
function saved(target: string): Attempt | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return undefined;
    const entry = value.find((item: unknown) => typeof item === 'object' && item !== null && 'target' in item && item.target === target) as Partial<Attempt> | undefined;
    if (entry === undefined || typeof entry.requestId !== 'string' || typeof entry.family !== 'string') return undefined;
    return {requestId: entry.requestId, target, family: entry.family, locked: true, text: 'Previous request has no confirmed result yet. It was not sent again.'};
  } catch { return undefined; }
}
function remember(attempt: Attempt): boolean {
  try { return rememberAttempt(attempt, sessionStorage); } catch { return false; }
}
type Send = (action: FrontendAction | FrontendUpload) => Promise<FrontendActionReply>;
const ordinary: Send = action => 'upload' in action
  ? Promise.resolve(errorBody('invalid-request', {detail: 'uploads use a module page'})) : sendAction(action);
type AttemptState = {attempt: Attempt | undefined; sending: boolean};
// Every mounted control for a target shares the browser's attempt, including HTTP-only
// uncertainty that has no operation projection. Keep it across route unmounts; reload
// hydrates only the identity from session storage, never a draft or an action to replay.
const attempts = new Map<string, ReturnType<typeof createAttemptStore>>();
function createAttemptStore(target: string) {
  let state: AttemptState = {attempt: saved(target), sending: false};
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (change: (previous: AttemptState) => AttemptState) => {
      const next = change(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
function attemptStore(target: string) {
  let store = attempts.get(target);
  if (store === undefined) { store = createAttemptStore(target); attempts.set(target, store); }
  return store;
}
export function useAttempt(target: string, operations: readonly OperationRecord[], operationsLive: boolean, send: Send = ordinary): FrontendCommand {
  const store = useMemo(() => attemptStore(target), [target]);
  const {attempt, sending} = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const latest = operations.filter(operation => operation.target === target).sort((a, b) => (b.sentAtMs - a.sentAtMs) === 0 ? b.revision - a.revision : b.sentAtMs - a.sentAtMs)[0];
  const operation = attempt === undefined ? latest : operations.find(item => item.requestId === attempt.requestId);
  const view = operation === undefined ? attempt : operationView(operation);
  useEffect(() => {
    if (operation === undefined || operationView(operation).locked) return;
    store.update(previous => previous.attempt?.requestId === operation.requestId && previous.attempt.locked
      ? {...previous, attempt: {...previous.attempt, ...operationView(operation)}} : previous);
  }, [operation, store]);
  const settled = view !== undefined && !view.locked;
  const settledRequest = operation?.requestId ?? attempt?.requestId;
  useEffect(() => {
    if (!settled) return;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]');
      if (Array.isArray(value)) sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(value.filter((item: unknown) =>
        typeof item !== 'object' || item === null || !('target' in item) || item.target !== target || !('requestId' in item) || item.requestId !== settledRequest)));
    } catch { /* No draft or credential is stored. */ }
  }, [target, settled, settledRequest]);
  return {
    text: view?.text ?? 'No command sent from this page.', locked: sending || (view?.locked ?? false), requestId: operation?.requestId ?? attempt?.requestId,
    run: async action => {
      if (store.getSnapshot().sending) return;
      if (typeof action === 'string' || !operationsLive) {
        store.update(previous => previous.attempt?.locked === true ? previous : {...previous, attempt: {requestId: '', target, family: '',
          text: `Not sent: ${typeof action === 'string' ? action : 'operation records are stale'}. Nothing was sent.`, locked: false}});
        return;
      }
      const next = {requestId: action.requestId, target, family: action.family, text: 'Requested. Waiting for acceptance.', locked: true};
      if (!remember(next)) {
        store.update(previous => previous.attempt?.locked === true ? previous : {...previous, attempt: {...next,
          text: 'Not sent: this browser could not retain the request identity for reload recovery. Nothing was sent.', locked: false}});
        return;
      }
      // Explicit owner-qualified hold release remains available through its existing
      // recovery controls. Ordinary controls share this lock and sending guard.
      store.update(() => ({attempt: next, sending: true}));
      const reply = await send(action);
      const result = 'error' in reply
        ? {text: reply.error.code === 'uncertain-result' ? 'Uncertain result. The command may have taken effect; it was not sent again.'
          : `Refused (${reply.error.code}) without changing state.`, locked: reply.error.code === 'uncertain-result'}
        : {text: 'Accepted. Waiting for completion.', locked: true};
      // A streamed definitive result can arrive before this HTTP reply. Keep it for this request,
      // including after projection retirement; clearing the shared sending guard also rerenders.
      store.update(previous => previous.attempt?.requestId !== next.requestId ? previous : {sending: false,
        attempt: !previous.attempt.locked ? previous.attempt : {...next, ...result}});
    },
  };
}
/** A feature supplies its form; the shell owns request retention and tracked operation status. */
export function Command({context, target, children}: {
  context: FrontendContext; target: string; children: (command: FrontendCommand) => React.ReactNode;
}): React.JSX.Element {
  const command = useAttempt(target, context.operations, context.operationsLive, action => 'upload' in action ? context.api.upload(action) : context.api.command(action));
  return <>{children(command)}</>;
}
