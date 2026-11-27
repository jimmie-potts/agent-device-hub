// The session row's guarded user label editor (Hub #1006). Only the synced record changes its displayed name.
import React, {useEffect, useId, useRef, useState} from 'react';
import {sendSaveAction, useSaveLifecycle} from './save-lifecycle.ts';
import {labelAttempt, labelCanSubmit, labelObservation, type LabelAttempt} from './labels.ts';
import type {SessionRow} from './sessions.ts';

const EVIDENCE = {
  sending: 'Requested. Waiting for a reply.', accepted: 'Accepted. Waiting for the synced record.',
  confirmed: 'Accepted. Label confirmed by the synced record.', refused: 'The label was refused.',
  uncertain: 'The reply is uncertain. The action was not sent again.', retired: 'This session was replaced; the attempt is retired.',
};

export function LabelEditor({row, live}: {row: SessionRow; live: boolean}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [revision, setRevision] = useState(row.revision);
  // An explicit retry after a reply uses the current synced session revision.
  const save = useSaveLifecycle<LabelAttempt>({
    uncertain: () => false,
    confirm: state => state.kind === 'accepted' && labelObservation(state.input, row, live) === 'confirmed',
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  const id = useId();
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [editing]);
  const phase = save.state;
  const pending = phase.kind === 'sending';
  const observation = phase.kind === 'idle' ? undefined : labelObservation(phase.input, row, live);
  const evidence = observation === 'retired' ? 'retired' : phase.kind === 'confirmed' && observation !== 'confirmed' ? 'accepted' : phase.kind;
  const close = (): void => { returnFocus.current = true; setEditing(false); };
  const open = (): void => {
    setDraft(row.label?.value ?? ''); setRevision(row.revision); save.reset(); setEditing(true);
  };
  const submit = (label: string | null): void => {
    if (!labelCanSubmit(row, live, save.blocked, label)) return;
    const guard = phase.kind === 'idle' ? revision : row.revision;
    const selected = labelAttempt({...row, revision: guard}, label, crypto.randomUUID());
    void save.run(selected, () => sendSaveAction({family: 'session-label-set', target: selected.id, requestId: selected.requestId,
      data: {label, expectedRevision: selected.revision}}));
  };
  const refused = phase.kind === 'refused' ? phase.code : phase.kind === 'uncertain' ? 'uncertain-result' : undefined;
  return <div className="session-label">
    <button ref={trigger} type="button" aria-label={`Edit label for ${row.name}`} aria-expanded={editing} onClick={open} disabled={editing || !live}>Edit label</button>
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
      {!live && <p className="warning">The session copy is not synced. Label changes are disabled until it is.</p>}
      <p role="status" data-tone={evidence === 'confirmed' ? 'accepted' : undefined}>{evidence === 'idle' ? '' : EVIDENCE[evidence]}
        {refused === 'revision-conflict' ? ' The session changed. Your draft is kept; review it and save a new attempt.' : refused !== undefined ? ` Code: ${refused}.` : ''}</p>
    </form>}
  </div>;
}
