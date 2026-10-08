// The session row's guarded user label editor (Hub #1006). Only the synced record changes its displayed name.
import React, {useEffect, useId, useRef, useState} from 'react';
import {sendAction, type ActionReply} from './actions.ts';
import {labelAttempt, labelCanSubmit, labelEvidence, type LabelAttempt, type LabelEvidence} from './labels.ts';
import type {SessionRow} from './sessions.ts';

const EVIDENCE: Readonly<Record<LabelEvidence, string>> = {
  requested: 'Requested. Waiting for a reply.', accepted: 'Accepted. Waiting for the synced record.',
  confirmed: 'Accepted. Label confirmed by the synced record.', refused: 'The label was refused.',
  uncertain: 'The reply is uncertain. The action was not sent again.', retired: 'This session was replaced; the attempt is retired.',
};

export function LabelEditor({row, live}: {row: SessionRow; live: boolean}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [revision, setRevision] = useState(row.revision);
  const [attempt, setAttempt] = useState<LabelAttempt>();
  const [answer, setAnswer] = useState<ActionReply>();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const id = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const pending = attempt !== undefined && answer === undefined;
  const evidence = attempt === undefined ? undefined : labelEvidence(attempt, row, live, answer);
  const close = (): void => { setEditing(false); trigger.current?.focus(); };
  const open = (): void => {
    setDraft(row.label?.value ?? ''); setRevision(row.revision); setAttempt(undefined); setAnswer(undefined); setEditing(true);
  };
  const submit = async (label: string | null): Promise<void> => {
    if (!labelCanSubmit(row, live, pending, label)) return;
    // After a conflict, the next click is a new attempt against the current copy. Nothing automatically retries.
    const guard = answer === undefined ? revision : row.revision;
    const selected = labelAttempt({...row, revision: guard}, label, crypto.randomUUID());
    setAttempt(selected); setAnswer(undefined);
    const reply = await sendAction({family: 'session-label-set', target: selected.id, requestId: selected.requestId,
      data: {label, expectedRevision: selected.revision}});
    if (alive.current) setAnswer(reply);
  };
  const refused = answer !== undefined && 'error' in answer ? answer.error.code : undefined;
  return <div className="session-label">
    <button ref={trigger} type="button" aria-label={`Edit label for ${row.name}`} aria-expanded={editing} onClick={open} disabled={editing || !live || row.uncertain}>Edit label</button>
    {editing && <form className="edit inline" onSubmit={event => { event.preventDefault(); void submit(draft); }}
      onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); close(); } }}>
      <fieldset disabled={pending}><label htmlFor={id}>Session label<input id={id} ref={input} value={draft} maxLength={160}
        onChange={event => { setDraft(event.target.value); }}/></label></fieldset>
      <div className="actions">
        <button type="submit" disabled={!labelCanSubmit(row, live, pending, draft)}>Save label</button>
        <button type="button" onClick={() => { void submit(null); }} disabled={!labelCanSubmit(row, live, pending, null)}>Clear label</button>
        <button type="button" onClick={close} disabled={pending}>Cancel</button>
      </div>
      <p className="hint">Up to 80 characters. Clear restores the session title or native ID.</p>
      {(!live || row.uncertain) && <p className="warning">Session evidence is stale. Label changes are disabled.</p>}
      <p role="status" data-tone={evidence === 'confirmed' ? 'accepted' : undefined}>{evidence === undefined ? '' : EVIDENCE[evidence]}
        {refused === 'revision-conflict' ? ' The session changed. Your draft is kept; review it and save a new attempt.' : refused !== undefined ? ` Code: ${refused}.` : ''}</p>
    </form>}
  </div>;
}
