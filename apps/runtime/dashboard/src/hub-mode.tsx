import React, {useEffect, useState} from 'react';
import type {InboxItem, Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sendSaveAction, useSaveLifecycle} from './save-lifecycle.ts';
import {modeAction, modeInboxIssues, modeName, type ModeInboxIssue} from './hub-mode.ts';
import {HubModeHero} from './hub-mode-hero.tsx';
import {modeExceptions, type ModeDeviceView} from './mode-exceptions.ts';

/**
 * Home's hero (#1930) over existing shell-owned copies and the existing command path; it acquires no state. `children`
 * are the status chips the hero shows under its switch.
 */
export function HubMode({record, live, control, operations, operationsSynced, items, inboxSynced, onCheckInbox, devices = [], children}: {
  devices?: readonly ModeDeviceView[]; record: ModeState | undefined; live: boolean; control: boolean; operations: readonly OperationRecord[];
  operationsSynced: boolean; items: readonly InboxItem[]; inboxSynced: boolean;
  onCheckInbox: (id: string) => void; children?: React.ReactNode;
}): React.JSX.Element {
  const operationFor = (requestId: string): OperationRecord | undefined =>
    operations.find(item => item.requestId === requestId && item.family === 'mode-set' && item.target === 'hub');
  // A new explicit selection uses the current mode revision after an uncertain reply.
  const save = useSaveLifecycle<{mode: Mode; requestId: string}>({
    uncertain: () => false,
    confirm: ({input}) => {
      const operation = operationFor(input.requestId);
      return live && operationsSynced && operation?.status === 'completed' && operation.result === 'succeeded';
    },
  });
  const [issues, setIssues] = useState<readonly ModeInboxIssue[]>([]);
  useEffect(() => {
    if (!live || !operationsSynced || !inboxSynced) return;
    let current = true;
    void modeInboxIssues(operations, items).then(ids => {
      if (current) {setIssues(ids);}
    }).catch(() => { /* Missing correlation evidence cannot establish resolution. */ });
    return () => {current = false;};
  }, [live, operations, operationsSynced, items, inboxSynced]);
  const available = control && live && record !== undefined;
  const phase = save.state;
  const attempt = phase.kind === 'idle' ? undefined : phase.input;
  const select = (mode: Mode): void => {
    if (!available || record === undefined) return;
    const requestId = crypto.randomUUID();
    void save.run({mode, requestId}, () => sendSaveAction(modeAction(record, mode, requestId)));
  };
  const matching = attempt === undefined ? undefined : operationFor(attempt.requestId);
  const currentIssues = live && inboxSynced ? issues.filter(issue => items.some(item => item.id === issue.id)) : issues;
  const localIssue = phase.kind === 'uncertain' ? {
    label: 'Result unknown', detail: 'The reply is uncertain. The request was not sent again.',
  } : phase.kind === 'refused' ? {label: 'Not applied', detail: `Selection refused. Code: ${phase.code}.`} : undefined;
  const issue = currentIssues.length > 0 ? {label: 'Check Inbox', detail: currentIssues.some(item => item.association === 'unavailable')
    ? 'Check Inbox to review a device-mode issue. Its link to a Hub selection is unavailable in recent evidence.' : 'Check Inbox for a mode request that needs review.'} : localIssue;
  const status = !live ? 'Stale' : record === undefined ? 'Not observed' : !control ? 'Read only' : '';
  const feedback = currentIssues.length > 0 ? issue?.detail ?? '' : localIssue?.detail ?? (attempt === undefined ? ''
    : phase.kind === 'sending' ? `${modeName(attempt.mode)} requested. Waiting for a reply.`
      : `Selection ${operationsSynced ? matching?.status ?? 'not observed' : 'not synced'}. Device results are separate.`);
  const exceptions = modeExceptions(record, devices, operationsSynced ? operations : [], live);
  const overrideCount = exceptions.filter(item => item.override).length, nativeCount = exceptions.length - overrideCount;
  const exceptionLabel = [overrideCount === 0 ? '' : `${overrideCount} ${overrideCount === 1 ? 'exception' : 'exceptions'}`, nativeCount === 0 ? '' : `${nativeCount} native ${nativeCount === 1 ? 'difference' : 'differences'}`].filter(Boolean).join(' · ');
  return <HubModeHero mode={record?.mode} disabled={!available || save.blocked} status={status} feedback={feedback} issue={issue}
    exceptions={exceptions.length === 0 ? undefined : {label: exceptionLabel, details: <ul>{exceptions.map(item => <li key={item.target}><>{item.linked ? <a href={`#/component/${encodeURIComponent(item.target)}`}>{item.name}</a> : item.name}</><p>{item.choice}</p><p className="light-note">{item.evidence}</p></li>)}</ul>}}
    onSelect={select} onCheckInbox={currentIssues[0] === undefined ? undefined : () => {const id = currentIssues[0]; if (id !== undefined) onCheckInbox(id.id);}}>{children}</HubModeHero>;
}
