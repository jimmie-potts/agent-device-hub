import React, {useId} from 'react';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';
import {modeName} from './hub-mode.ts';
import {InfoTip} from './ui.tsx';
import './hub-control-cards.css';

/** Shared artwork keeps the selected mode and its choice button visually identical. */
export function ModeIcon({mode}: {mode: Mode | undefined}): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-mode-icon={mode ?? 'unknown'}>
    {mode === 'work' ? <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M10 12h4"/></>
      : mode === 'free' ? <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7ZM20 2v4M18 4h4"/></>
        : mode === 'quiet' ? <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/> : <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>}
  </svg>;
}

export type HubModeCardProps = {
  mode: Mode | undefined; disabled: boolean; status: string; feedback: string;
  issue?: {label: string; detail: string} | undefined; onCheckInbox?: (() => void) | undefined;
  onSelect: (mode: Mode) => void; headingId?: string | undefined;
};

/** Presentation only; selection, evidence, transport and authority belong to the adapter. */
export function HubModeCard({mode, disabled, status, feedback, issue, onCheckInbox, onSelect, headingId}: HubModeCardProps): React.JSX.Element {
  const uid = useId();
  return <div className="hub-mode hub-mode-card">
    <header className="hub-control-heading"><h2 id={headingId ?? uid}>Hub mode</h2><div className="hub-mode-meta">
      {status !== '' && <span className="hub-control-status">{status}</span>}
      {issue !== undefined && (onCheckInbox !== undefined
        ? <button type="button" className="secondary hub-mode-issue" onClick={onCheckInbox}><span className="hub-control-mark" aria-hidden="true">!</span>Check Inbox</button>
        : <InfoTip warning label={<><span className="hub-control-mark" aria-hidden="true">!</span> {issue.label}</>}>{issue.detail}</InfoTip>)}
    </div></header>
    <div className="hub-mode-hero"><div className="hub-mode-art"><ModeIcon mode={mode}/></div><p className="hub-mode-choice">{mode === undefined ? 'Not observed' : modeName(mode)}</p></div>
    <div className="hub-mode-choices" role="group" aria-label="Choose Hub mode">{(['work', 'free', 'quiet'] as const).map(choice =>
      <button key={choice} type="button" className="secondary" aria-pressed={mode === choice} disabled={disabled} onClick={() => {onSelect(choice);}}><ModeIcon mode={choice}/><span>{modeName(choice)}</span></button>)}</div>
    <p className="hub-control-sr" role="status">{feedback}</p>
  </div>;
}
