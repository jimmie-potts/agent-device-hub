// One confirmed Connections override on the existing authenticated action path (Hub #1009).
import React, {useEffect, useId, useRef, useState} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {SessionsCopy} from './connection.ts';
import {sendSaveAction, useSaveLifecycle} from './save-lifecycle.ts';
import {currentNotice, noticeAttempt, noticeEvidence, overrideAvailable, type NoticeAttempt} from './notice-clear.ts';
import {sessionName} from './sessions.ts';

export function OperatorTools({sessions, live, control, operations, operationsSynced}: {
  sessions: SessionsCopy; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsSynced: boolean;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('');
  const [confirmation, setConfirmation] = useState<NoticeAttempt>();
  const trigger = useRef<HTMLButtonElement>(null), confirm = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const id = useId();
  useEffect(() => {
    if (confirmation !== undefined) confirm.current?.focus();
    else if (returnFocus.current) {returnFocus.current = false; trigger.current?.focus();}
  }, [confirmation]);
  const selected = sessions.views.find(view => view.id === selectedId);
  const current = selected === undefined ? undefined : currentNotice(selected);
  const available = overrideAvailable(selected, {control, live, synced: sessions.synced});
  const unchanged = selected !== undefined && confirmation !== undefined && selected.generation === confirmation.generation &&
    selected.revision === confirmation.revision && current?.id === confirmation.noticeId;
  const observe = (attempt: NoticeAttempt): ReturnType<typeof noticeEvidence> =>
    noticeEvidence(attempt, selected, available, operations, operationsSynced);
  // Send once per confirmation dialog. Closing and reopening is a new explicit attempt.
  const save = useSaveLifecycle<NoticeAttempt>({
    accepted: () => true, uncertain: () => true,
    confirm: state => state.kind === 'accepted' && observe(state.input).completed,
  });
  const phase = save.state;
  const pending = phase.kind === 'sending';
  const evidence = phase.kind === 'idle' ? undefined : observe(phase.input);
  const acknowledgments = evidence?.acknowledgedBy?.join(', ') ?? '';
  const close = (): void => {if (pending) return; returnFocus.current = true; setConfirmation(undefined);};
  const open = (): void => {
    if (!available || selected === undefined || current === undefined || pending) return;
    save.reset(); setConfirmation(noticeAttempt(selected, crypto.randomUUID()));
  };
  const submit = (): void => {
    if (!available || !unchanged || confirmation === undefined || phase.kind !== 'idle') return;
    void save.run(confirmation, () => sendSaveAction({family: 'notice-clear', target: confirmation.id, requestId: confirmation.requestId,
      data: {noticeId: confirmation.noticeId, expectedRevision: confirmation.revision}}));
  };
  return <div className="card" aria-label="Operator tools"><h2>Operator tools</h2>
    <p>This override acknowledges the selected current notice for every configured consumer. It proves no provider readership or physical device result.</p>
    <label htmlFor={id}>Session</label><select id={id} value={selectedId} disabled={pending || confirmation !== undefined}
      onChange={event => {setSelectedId(event.target.value); save.reset();}}>
      <option value="">Choose a session</option>
      {sessions.views.map(view => <option key={view.id} value={view.id}>{sessionName(view)}</option>)}
    </select>
    <button ref={trigger} type="button" onClick={open} disabled={!available || current === undefined || confirmation !== undefined}>Clear this notice on every device</button>
    {!control && <p className="warning">Read-only connection. Operator controls require control authority.</p>}
    {control && !available && (!live || !sessions.synced || selected !== undefined) && <p className="warning">{!live || !sessions.synced
      ? 'The session copy is not synced. Wait for a synced record.' : 'The hub does not confirm this session\'s state. Wait for a confirmed record.'}</p>}
    {selected !== undefined && current === undefined && <p>No current notice to clear.</p>}
    {confirmation !== undefined && <form className="edit" aria-label="Confirm notice override" onSubmit={event => {event.preventDefault(); void submit();}}
      onKeyDown={event => {if (event.key === 'Escape' && !pending) {event.preventDefault(); close();}}}>
      <p>Confirm clearing this notice for {selected === undefined ? 'the selected session' : sessionName(selected)} on every configured device.</p>
      <div className="actions"><button ref={confirm} type="submit" disabled={!available || !unchanged || phase.kind !== 'idle'}>Confirm clear</button>
        <button type="button" onClick={close} disabled={pending}>{phase.kind === 'idle' ? 'Cancel' : 'Close'}</button></div>
      {!unchanged && phase.kind === 'idle' && <p className="warning">The session or notice changed. Cancel and select the current notice.</p>}
      <div role="status">
        {phase.kind === 'sending' && <p>Requested. Waiting for a reply.</p>}
        {(phase.kind === 'accepted' || phase.kind === 'confirmed') && <p>Accepted. Completion and acknowledgments are shown separately.</p>}
        {phase.kind === 'uncertain' && <p>The reply is uncertain. The action was not sent again.</p>}
        {phase.kind === 'refused' && <p>The override was refused. Code: {phase.code}.</p>}
        {evidence !== undefined && <p>Completion: {evidence.completion}.</p>}
        {evidence?.acknowledgedBy !== undefined && <p>Synced session acknowledgments: {acknowledgments.length > 0 ? acknowledgments : 'None observed'}.</p>}
        {evidence !== undefined && !evidence.retired && evidence.acknowledgedBy === undefined && <p>Current session acknowledgment evidence is unavailable.</p>}
        {evidence?.retired === true && <p>This session was replaced; the attempt is retired.</p>}
      </div>
    </form>}
  </div>;
}
