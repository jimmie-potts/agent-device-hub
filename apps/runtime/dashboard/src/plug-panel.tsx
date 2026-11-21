import React, {useState} from 'react';
import {lampAttributes, type Glow} from './glass-light.ts';

export type PlugPanelProps = {
  id: string; label: string;
  /**
   * The power a press switches away from: the latest power request when it succeeded after the plug's last report,
   * or else its observed power; undefined when unknown.
   */
  power: boolean | undefined;
  /** The state line: a limitation such as Stale or Held, or the observed power. */
  state: string;
  /** The last command's outcome when it needs attention; empty otherwise. */
  result: string; routine: boolean;
  disabled: boolean; glow: Glow; open: string;
  onPower: (on: boolean) => void;
};

/**
 * A plug in the Small square Home shape (#1931, the Clear reference): the panel is one toggle button that switches the
 * plug with the existing guarded command, to the opposite of the power it shows (a request newer than the plug's last
 * report, or else its observed power). It is disabled while that power is unknown or a guard blocks a change, so a
 * press never guesses. The icon is the panel's lamp for the glass layer and follows observed power only. The top right stays clear for the drag handle (#1933); Open leads to the plug's page with its full card.
 */
export function PlugPanel({id, label, power, state, result, routine, disabled, glow, open, onPower}: PlugPanelProps): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  const release = (): void => {setPressed(false);};
  return <article className="card plug-panel" aria-label={label} data-plug-panel={id}>
    <button type="button" className="plug-press" aria-label={`${label} power`} aria-pressed={power === true} disabled={disabled || power === undefined}
      onPointerDown={event => {if (event.button === 0) setPressed(true);}} onPointerUp={release} onPointerCancel={release} onPointerLeave={release}
      onClick={() => {if (power !== undefined) onPower(!power);}}>
      <span className="plug-icon" {...lampAttributes(glow, pressed && !disabled)} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </span>
      <strong title={label}>{label}</strong><small title={state}>{state}</small>
    </button>
    <p role="status" className={routine ? 'vh' : 'plug-result'} title={result}>{result}</p>
    <a className="plug-open" href={open} aria-label={`Open ${label}`}>Open</a>
  </article>;
}
