import React, {useId, useRef, useState} from 'react';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';
import {modeName} from './hub-mode.ts';
import {InfoTip} from './ui.tsx';
import './hub-control-cards.css';
import './home-hero.css';

/** Shared artwork keeps the selected mode and its choice button visually identical. */
export function ModeIcon({mode}: {mode: Mode | undefined}): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-mode-icon={mode ?? 'unknown'}>
    {mode === 'work' ? <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M10 12h4"/></>
      : mode === 'free' ? <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7ZM20 2v4M18 4h4"/></>
        : mode === 'quiet' ? <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/> : <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>}
  </svg>;
}

export type HubModeHeroProps = {
  mode: Mode | undefined; disabled: boolean; status: string; feedback: string;
  issue?: {label: string; detail: string} | undefined; onCheckInbox?: (() => void) | undefined;
  onSelect: (mode: Mode) => void;
  exceptions?: {label: string; details: React.ReactNode} | undefined;
  /** The status chips under the switch. */
  children?: React.ReactNode;
};

const CHOICES = ['work', 'free', 'quiet'] as const;
const STEPS: Readonly<Record<string, number>> = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};

/**
 * Home's hero (#1930): a small "Hub mode" label, the mode as a large word, the Work, Free and Quiet switch and the
 * status chips. Presentation only; selection, evidence, transport and authority belong to the adapter in hub-mode.tsx.
 *
 * The switch is one Tab stop. Arrow keys, Home and End move between its segments without selecting; Enter or Space
 * selects, so moving through it never sends a command. The selected segment carries `data-glass-thumb`: on the glass
 * layer the thumb is drawn there and stretches as it travels, and without the layer the segment has a plain fill. The
 * text and the switch are veils, so the layer keeps the artwork behind them dim or light enough to read. Chips are
 * not: their fill alone keeps their text readable, and every veil adds to each software-rendered frame.
 */
export function HubModeHero({mode, disabled, status, feedback, issue, onCheckInbox, onSelect, exceptions, children}: HubModeHeroProps): React.JSX.Element {
  const heading = useId(), buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = mode === undefined ? 0 : CHOICES.indexOf(mode);
  const [stop, setStop] = useState<number>();
  const keys = (event: React.KeyboardEvent): void => {
    const current = buttons.current.findIndex(button => button === event.target);if (current < 0) return;
    const step = STEPS[event.key], next = event.key === 'Home' ? 0 : event.key === 'End' ? CHOICES.length - 1
      : step === undefined ? undefined : (current + step + CHOICES.length) % CHOICES.length;
    if (next === undefined) return;
    event.preventDefault();setStop(next);buttons.current[next]?.focus();
  };
  return <section className="home-hero hub-mode" aria-labelledby={heading} data-hub-mode>
    <div className="home-hero-mode" data-glass-veil>
      <h2 id={heading} className="home-hero-label">Hub mode</h2>
      <p className="hub-mode-choice home-hero-word">{mode === undefined ? 'Not observed' : modeName(mode)}</p>
    </div>
    <div className="home-hero-controls">
      <div className="home-hero-switch" role="group" aria-label="Choose Hub mode" data-glass-veil onKeyDown={keys} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setStop(undefined);
      }}>{CHOICES.map((choice, index) =>
        <button key={choice} ref={button => {buttons.current[index] = button;}} type="button" aria-pressed={mode === choice} disabled={disabled}
          tabIndex={index === (stop ?? selected) ? 0 : -1} data-glass-thumb={mode === choice ? choice : undefined}
          onClick={() => {setStop(index);onSelect(choice);}}><ModeIcon mode={choice}/><span>{modeName(choice)}</span></button>)}</div>
      {(status !== '' || issue !== undefined) && <div className="home-hero-meta" data-glass-veil>
        {status !== '' && <span className="hub-control-status">{status}</span>}
        {issue !== undefined && (onCheckInbox !== undefined
          ? <button type="button" className="home-hero-chip hub-mode-issue" onClick={onCheckInbox} title={issue.detail}><span className="hub-control-mark" aria-hidden="true">!</span>Check Inbox</button>
          : <InfoTip warning label={<><span className="hub-control-mark" aria-hidden="true">!</span> {issue.label}</>}>{issue.detail}</InfoTip>)}
      </div>}
    </div>
    <p className="hub-control-sr" role="status">{feedback}</p>
    {(exceptions !== undefined || children !== undefined) && <div className="home-hero-chips">
      {children}
      {exceptions !== undefined && <details className="hub-mode-exceptions home-hero-exceptions"><summary className="home-hero-chip">{exceptions.label}</summary><div className="home-hero-exception-list">{exceptions.details}</div></details>}
    </div>}
  </section>;
}
