import React, {useEffect, useRef, useState} from 'react';
import type {InboxItem, Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sendAction, type ActionReply} from './actions.ts';
import {modeAction, modeInboxIssues, modeName} from './hub-mode.ts';
import {HubModeCard} from './hub-mode-card.tsx';

/** Adapts existing shell-owned copies and the existing command path; it acquires no state. */
export function HubMode({record, live, control, operations, operationsSynced, items, inboxSynced, onCheckInbox, headingId}: {
  record: ModeState | undefined; live: boolean; control: boolean; operations: readonly OperationRecord[];
  operationsSynced: boolean; items: readonly InboxItem[]; inboxSynced: boolean;
  onCheckInbox: (id: string) => void; headingId?: string;
}): React.JSX.Element {
  const [attempt, setAttempt] = useState<{mode: Mode; requestId: string}>();
  const [answer, setAnswer] = useState<ActionReply>();
  const [issues, setIssues] = useState<readonly string[]>([]);
  const prior = useRef<readonly string[]>([]), inFlight = useRef(false), alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {
    if (!live || !operationsSynced || !inboxSynced) return;
    let current = true;
    void modeInboxIssues(operations, items, prior.current).then(ids => {
      if (current) {prior.current = ids; setIssues(ids);}
    }).catch(() => { /* Missing correlation evidence cannot establish resolution. */ });
    return () => {current = false;};
  }, [live, operations, operationsSynced, items, inboxSynced]);
  const available = control && live && record !== undefined;
  const pending = attempt !== undefined && answer === undefined;
  const select = async (mode: Mode): Promise<void> => {
    if (!available || record === undefined || inFlight.current) return;
    const requestId = crypto.randomUUID();
    inFlight.current = true; setAttempt({mode, requestId}); setAnswer(undefined);
    const reply = await sendAction(modeAction(record, mode, requestId));
    inFlight.current = false;
    if (alive.current) setAnswer(reply);
  };
  const matching = attempt === undefined ? undefined : operations.find(item => item.requestId === attempt.requestId && item.family === 'mode-set' && item.target === 'hub');
  const currentIssues = live && inboxSynced ? issues.filter(id => items.some(item => item.id === id)) : issues;
  const error = answer !== undefined && 'error' in answer ? answer.error : undefined;
  const resolvedReply = operationsSynced && matching?.status === 'completed' && matching.result === 'succeeded';
  const localIssue = error === undefined || resolvedReply ? undefined : {
    label: error.code === 'uncertain-result' ? 'Result unknown' : 'Not applied',
    detail: error.code === 'uncertain-result' ? 'The reply is uncertain. The request was not sent again.' : `Selection refused. Code: ${error.code}.`,
  };
  const issue = currentIssues.length > 0 ? {label: 'Check Inbox', detail: 'A mode request needs review in Inbox.'} : localIssue;
  const status = !live ? 'Stale' : record === undefined ? 'Not observed' : !control ? 'Read only' : '';
  const feedback = currentIssues.length > 0 ? 'Check Inbox for a mode request that needs review.' : localIssue?.detail ?? (attempt === undefined ? ''
    : pending ? `${modeName(attempt.mode)} requested. Waiting for a reply.`
      : `Selection ${operationsSynced ? matching?.status ?? 'not observed' : 'not synced'}. Device results are separate.`);
  return <HubModeCard mode={record?.mode} disabled={!available || pending} status={status} feedback={feedback} issue={issue} headingId={headingId}
    onSelect={mode => {void select(mode);}} onCheckInbox={currentIssues[0] === undefined ? undefined : () => {const id = currentIssues[0]; if (id !== undefined) onCheckInbox(id);}}/>;
}
