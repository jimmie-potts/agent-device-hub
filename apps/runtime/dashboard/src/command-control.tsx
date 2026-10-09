// Shared command attempts, extracted from device-controls for module pages without changing reload or outcome behavior.
import React, {useEffect, useRef, useState} from 'react';
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
export function useAttempt(target: string, operations: readonly OperationRecord[], operationsLive: boolean, send: Send = ordinary): FrontendCommand {
  const [attempt, setAttempt] = useState<Attempt | undefined>(() => saved(target));
  const sending = useRef(false);
  const latest = operations.filter(operation => operation.target === target).sort((a, b) => (b.sentAtMs - a.sentAtMs) === 0 ? b.revision - a.revision : b.sentAtMs - a.sentAtMs)[0];
  const operation = attempt === undefined ? latest : operations.find(item => item.requestId === attempt.requestId);
  const view = operation === undefined ? attempt : operationView(operation);
  useEffect(() => {
    if (operation === undefined || operationView(operation).locked) return;
    setAttempt(previous => previous?.requestId === operation.requestId && previous.locked
      ? {...previous, ...operationView(operation)} : previous);
  }, [operation]);
  const settled = view !== undefined && !view.locked;
  useEffect(() => {
    if (!settled) return;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]');
      if (Array.isArray(value)) sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(value.filter((item: unknown) => typeof item === 'object' && item !== null && 'target' in item && item.target !== target)));
    } catch { /* No draft or credential is stored. */ }
  }, [target, settled]);
  return {
    text: view?.text ?? 'No command sent from this page.', locked: sending.current || (view?.locked ?? false), requestId: operation?.requestId ?? attempt?.requestId,
    run: async action => {
      if (typeof action === 'string') { setAttempt({requestId: '', target, family: '', text: `Not sent: ${action}. Nothing was sent.`, locked: false}); return; }
      if (sending.current) return;
      if (!operationsLive) { setAttempt({requestId: '', target, family: '', text: 'Not sent: operation records are stale. Nothing was sent.', locked: false}); return; }
      sending.current = true;
      const next = {requestId: action.requestId, target, family: action.family, text: 'Requested. Waiting for acceptance.', locked: true};
      if (!remember(next)) {
        sending.current = false;
        setAttempt({...next, text: 'Not sent: this browser could not retain the request identity for reload recovery. Nothing was sent.', locked: false});
        return;
      }
      setAttempt(next);
      const reply = await send(action);
      sending.current = false;
      const result = 'error' in reply
        ? {text: reply.error.code === 'uncertain-result' ? 'Uncertain result. The command may have taken effect; it was not sent again.'
          : `Refused (${reply.error.code}) without changing state.`, locked: reply.error.code === 'uncertain-result'}
        : {text: 'Accepted. Waiting for completion.', locked: true};
      // A streamed definitive result can arrive before this HTTP reply. Keep it for this request,
      // including after projection retirement; copy it so clearing the sending guard also rerenders.
      setAttempt(previous => previous?.requestId === next.requestId && !previous.locked ? {...previous} : {...next, ...result});
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
