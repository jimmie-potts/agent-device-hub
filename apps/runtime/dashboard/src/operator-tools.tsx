// One confirmed Connections override on the existing authenticated action path (Hub #1009).
import React, {useEffect, useId, useRef, useState} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {SessionsCopy} from './connection.ts';
import {sendAction, type ActionReply} from './actions.ts';
import {noticeAttempt, noticeEvidence, type NoticeAttempt} from './notice-clear.ts';
import {sessionName} from './sessions.ts';

export function OperatorTools({sessions, live, control, operations, operationsSynced}: {
  sessions: SessionsCopy; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsSynced: boolean;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('');
  const [confirmation, setConfirmation] = useState<NoticeAttempt>();
  const [attempt, setAttempt] = useState<NoticeAttempt>();
  const [answer, setAnswer] = useState<ActionReply>();
  const trigger = useRef<HTMLButtonElement>(null), confirm = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false), alive = useRef(true), returnFocus = useRef(false);
  const id = useId();
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {
    if (confirmation !== undefined) confirm.current?.focus();
    else if (returnFocus.current) {returnFocus.current = false; trigger.current?.focus();}
  }, [confirmation]);
  const selected = sessions.records.find(record => record.id === selectedId);
  const current = selected?.notices.at(-1);
  const available = control && live && sessions.synced && selected?.freshness === 'current' && selected.restartUncertain === false;
  const unchanged = selected !== undefined && confirmation !== undefined && selected.generation === confirmation.generation &&
    selected.revision === confirmation.revision && current?.id === confirmation.noticeId;
  const pending = attempt !== undefined && answer === undefined;
  const evidence = attempt === undefined ? undefined : noticeEvidence(attempt, selected, available, sessions.revision, operations, operationsSynced, answer);
  const acknowledgments = selected?.notices.find(notice => notice.id === attempt?.noticeId)?.acknowledgedBy.join(', ') ?? '';
  const close = (): void => {if (inFlight.current) return; returnFocus.current = true; setConfirmation(undefined);};
  const open = (): void => {
    if (!available || selected === undefined || current === undefined || inFlight.current) return;
    setAttempt(undefined); setAnswer(undefined); setConfirmation(noticeAttempt(selected, crypto.randomUUID()));
  };
  const submit = async (): Promise<void> => {
    if (!available || !unchanged || confirmation === undefined || attempt !== undefined || inFlight.current) return;
    inFlight.current = true; setAttempt(confirmation); setAnswer(undefined);
    const reply = await sendAction({family: 'notice-clear', target: confirmation.id, requestId: confirmation.requestId,
      data: {noticeId: confirmation.noticeId, expectedRevision: confirmation.revision}});
    inFlight.current = false;
    if (alive.current) setAnswer(reply);
  };
  return <div className="card" aria-label="Operator tools"><h2>Operator tools</h2>
    <p>This override acknowledges the selected current notice for every configured consumer. It proves no provider readership or physical device result.</p>
    <label htmlFor={id}>Session<select id={id} value={selectedId} disabled={pending || confirmation !== undefined}
      onChange={event => {setSelectedId(event.target.value); setAttempt(undefined); setAnswer(undefined);}}>
      <option value="">Choose a session</option>
      {sessions.records.map(record => <option key={record.id} value={record.id}>{sessionName(record)}</option>)}
    </select></label>
    <button ref={trigger} type="button" onClick={open} disabled={!available || current === undefined || confirmation !== undefined}>Clear this notice on every device</button>
    {!control && <p className="warning">Read-only connection. Operator controls require control authority.</p>}
    {control && (!live || !sessions.synced || selected?.freshness === 'uncertain' || selected?.restartUncertain === true) && <p className="warning">Current session evidence is unavailable. Wait for a fresh synced record.</p>}
    {selected !== undefined && current === undefined && <p>No current notice to clear.</p>}
    {confirmation !== undefined && <form className="edit" aria-label="Confirm notice override" onSubmit={event => {event.preventDefault(); void submit();}}
      onKeyDown={event => {if (event.key === 'Escape' && !pending) {event.preventDefault(); close();}}}>
      <p>Confirm clearing this notice for {selected === undefined ? 'the selected session' : sessionName(selected)} on every configured device.</p>
      <div className="actions"><button ref={confirm} type="submit" disabled={!available || !unchanged || attempt !== undefined}>Confirm clear</button>
        <button type="button" onClick={close} disabled={pending}>{attempt === undefined ? 'Cancel' : 'Close'}</button></div>
      {!unchanged && attempt === undefined && <p className="warning">The session or notice changed. Cancel and select the current notice.</p>}
      <div role="status">
        {evidence?.reply === 'requested' && <p>Requested. Waiting for a reply.</p>}
        {evidence?.reply === 'accepted' && <p>Accepted. The synced record supplies the result.</p>}
        {evidence?.reply === 'uncertain' && <p>The reply is uncertain. The action was not sent again.</p>}
        {evidence?.reply === 'refused' && <p>The override was refused. Code: {answer !== undefined && 'error' in answer ? answer.error.code : ''}.</p>}
        {evidence !== undefined && <p>Completion: {evidence.completion}.</p>}
        {evidence !== undefined && !evidence.retired && <p>Recorded acknowledgments: {acknowledgments.length > 0 ? acknowledgments : 'None observed'}.</p>}
        {evidence?.retired === true && <p>This session was replaced; the attempt is retired.</p>}
        {evidence?.observed === true && <p data-tone="accepted">Every configured consumer acknowledged this notice in the synced session record: {acknowledgments}.</p>}
      </div>
    </form>}
  </div>;
}
