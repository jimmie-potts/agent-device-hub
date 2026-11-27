// Shell-owned command attempts shared across module pages and device controls.
import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {frontendCommandView, type FrontendAction, type FrontendActionReply, type FrontendUpload, type FrontendCommand, type FrontendCommandView, type FrontendContext} from '@jimmie-potts/sdk/frontend';
import {errorBody} from '@jimmie-potts/event-contracts/v2/errors';
import {ATTEMPTS_KEY, rememberAttempt, type AttemptIdentity} from './attempts.ts';
import {sendAction} from './actions.ts';
import {operationView} from './devices.ts';

export type TrackedCommand = FrontendCommand & FrontendCommandView;
type Attempt = AttemptIdentity & FrontendCommandView;
const NO_COMMAND = frontendCommandView({kind: 'none'});
/** Only action identities survive a reload, never draft values or credentials. A lost reply cannot unlock on reload. */
function saved(target: string): Attempt | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return undefined;
    const entry = value.find((item: unknown) => typeof item === 'object' && item !== null && 'target' in item && item.target === target) as Partial<Attempt> | undefined;
    if (entry === undefined || typeof entry.requestId !== 'string' || typeof entry.family !== 'string') return undefined;
    return {requestId: entry.requestId, target, family: entry.family, ...frontendCommandView({kind: 'restored'})};
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
/** Core metadata may use a distinct attempt key so a configured device ID cannot alias its save lock. */
export function useAttempt(target: string, operations: readonly OperationRecord[], operationsLive: boolean, send: Send = ordinary, attemptKey: string = target): TrackedCommand {
  const store = useMemo(() => attemptStore(attemptKey), [attemptKey]);
  const {attempt, sending} = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const latest = attemptKey !== target ? undefined : operations.filter(operation => operation.target === target).sort((a, b) => (b.sentAtMs - a.sentAtMs) === 0 ? b.revision - a.revision : b.sentAtMs - a.sentAtMs)[0];
  const operation = attempt === undefined ? latest : operations.find(item => item.requestId === attempt.requestId);
  const tracked = useMemo(() => operation === undefined ? undefined : operationView(operation), [operation]);
  const view = tracked ?? attempt ?? NO_COMMAND;
  useEffect(() => {
    if (operation === undefined || tracked === undefined || tracked.locked) return;
    store.update(previous => previous.attempt?.requestId === operation.requestId && previous.attempt.locked
      ? {...previous, attempt: {...previous.attempt, ...tracked}} : previous);
  }, [operation, tracked, store]);
  const settled = (tracked !== undefined || attempt !== undefined) && !view.locked;
  const settledRequest = operation?.requestId ?? attempt?.requestId;
  useEffect(() => {
    if (!settled) return;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]');
      if (Array.isArray(value)) sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(value.filter((item: unknown) =>
        typeof item !== 'object' || item === null || !('target' in item) || item.target !== attemptKey || !('requestId' in item) || item.requestId !== settledRequest)));
    } catch { /* No draft or credential is stored. */ }
  }, [attemptKey, settled, settledRequest]);
  return {
    phase: view.phase, text: view.text, locked: sending || view.locked, requestId: operation?.requestId ?? attempt?.requestId,
    run: async action => {
      if (store.getSnapshot().sending) return;
      if (typeof action === 'string' || !operationsLive) {
        store.update(previous => previous.attempt?.locked === true ? previous : {...previous, attempt: {requestId: '', target: attemptKey, family: '',
          ...frontendCommandView({kind: 'not-sent', reason: typeof action === 'string' ? action : 'operation records are stale'})}});
        return;
      }
      const next = {requestId: action.requestId, target: attemptKey, family: action.family, ...frontendCommandView({kind: 'requested'})};
      if (!remember(next)) {
        store.update(previous => previous.attempt?.locked === true ? previous : {...previous, attempt: {...next,
          ...frontendCommandView({kind: 'not-sent', reason: 'this browser could not retain the request identity for reload recovery'})}});
        return;
      }
      // Explicit owner-qualified hold release remains available through its existing
      // recovery controls. Ordinary controls share this lock and sending guard.
      store.update(() => ({attempt: next, sending: true}));
      const reply = await send(action);
      const result = frontendCommandView('error' in reply
        ? reply.error.code === 'uncertain-result' ? {kind: 'uncertain'} : {kind: 'refused', code: reply.error.code}
        : {kind: 'accepted'});
      // A streamed definitive result can arrive before this HTTP reply. Keep it for this request,
      // including after projection retirement; clearing the shared sending guard also rerenders.
      store.update(previous => previous.attempt?.requestId !== next.requestId ? previous : {sending: false,
        attempt: !previous.attempt.locked ? previous.attempt : {...next, ...result}});
    },
  };
}
/** A feature supplies its form; the shell owns request retention and tracked operation status. */
export function Command({context, target, attemptKey, children}: {
  context: FrontendContext; target: string; attemptKey?: string; children: (command: FrontendCommand) => React.ReactNode;
}): React.JSX.Element {
  const command = useAttempt(target, context.operations, context.operationsLive, action => 'upload' in action ? context.api.upload(action) : context.api.command(action),attemptKey);
  return <>{children(command)}</>;
}
