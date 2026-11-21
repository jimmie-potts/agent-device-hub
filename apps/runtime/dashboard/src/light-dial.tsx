import React, {useRef, useState} from 'react';
import {lampAttributes, type Glow} from './glass-light.ts';

/**
 * The ring dial of a light in the Small square Home shape (#1931, the Clear reference). The ring shows the observed
 * brightness; dragging it up or down dims, and a press without a drag switches the light. The ring is a slider for the
 * keyboard (arrows, Page Up and Down, Home and End, one request when the key is released) and its center is a switch
 * (Enter or Space). It sends only through `onPower` and `onBrightness`, which the light card guards as before.
 *
 * The ring and the light it gives the glass layer (its center is the lamp) follow observed state only. A value being
 * dragged or keyed shows as a thin inner arc until it is sent; a requested brightness that the light has not reported
 * yet stays as a fainter inner arc, and the ring waits for the light to report it. The switch shows what a press
 * switches away from (the newest of the request and the observation), so its state always agrees with its action; the
 * state line it is described by says which one that is. A drag or a key starts from the newest brightness, an off
 * light's stored one included, and one that ends where it started sends nothing. Pointer events serve mouse, pen and
 * touch alike; the ring takes touch moves itself, so a drag on it does not scroll the page and a tap still switches.
 */
export type LightDialProps = {
  name: string;
  /** Observed power and brightness from current records; undefined when unknown or mixed. */
  power: boolean | undefined; brightness: number | undefined;
  /** The power a press switches away from: the newest of the observed and the requested power. */
  pressFrom: boolean | undefined;
  /** A requested brightness newer than the light's last report, while it differs from the observed one. */
  requestedLevel: number | undefined;
  /** Where a drag or a key starts: the newest of the requested and the observed brightness, even while off. */
  startLevel: number | undefined;
  /** The element that states the light's state, which describes the switch. */
  describedBy?: string;
  /** Records are stale: the last observed value shows faded. */
  stale: boolean;
  glow: Glow; canPower: boolean; canDim: boolean;
  onPower: (on: boolean) => void; onBrightness: (percent: number) => void;
};

/** How far a pointer may move and still count as a press, in CSS pixels. */
const PRESS_SLOP = 4;
/** Percent per CSS pixel of vertical drag, as in the reference. */
const DRAG_RATE = 0.8;
const KEY_STEPS: Readonly<Record<string, number>> = {ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20};
const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));
const channel = (value: number): number => Math.round(value * 255);

export function LightDial({name, power, brightness, pressFrom, requestedLevel, startLevel, describedBy, stale, glow, canPower, canDim, onPower, onBrightness}: LightDialProps): React.JSX.Element {
  const shown = power === true ? brightness : power === false ? 0 : undefined;
  const [draft, setDraftState] = useState<number>(), [pressed, setPressed] = useState(false);
  const draftValue = useRef<number | undefined>(undefined);
  const setDraft = (value: number | undefined): void => {draftValue.current = value;setDraftState(value);};
  const gesture = useRef<{pointer: number; x: number; y: number; start: number; moved: boolean} | null>(null);
  const toggle = (): void => {if (canPower) onPower(!(pressFrom ?? false));};
  const from = startLevel ?? shown ?? 0;
  /** Where the keys being held started, so a key that changes nothing sends nothing. */
  const keyStart = useRef<number | undefined>(undefined);
  const commit = (value: number | undefined, start: number | undefined): void => {if (value !== undefined && value !== start && canDim) onBrightness(value);};
  const end = (sending: boolean): void => {
    const current = gesture.current;gesture.current = null;setPressed(false);
    if (current === null || !sending) {setDraft(undefined);return;}
    if (!current.moved) {toggle();return;}
    const value = draftValue.current;setDraft(undefined);commit(value, current.start);
  };
  const valueText = draft !== undefined ? `${String(draft)}%, release to set` : shown === undefined ? power === true ? 'On, brightness unknown' : 'Unknown'
    : power === true ? `${String(shown)}% · observed` : 'Off · observed';
  const color = glow.color === null ? undefined : `rgb(${glow.color.map(channel).join(' ')})`;
  return <div className="light-dial" {...lampAttributes(glow, pressed)} data-on={power === true ? '' : undefined} data-stale={stale ? '' : undefined} data-dragging={draft === undefined ? undefined : ''}
    style={color === undefined ? undefined : {'--light-dial-color': color} as React.CSSProperties}
    onPointerDown={event => {
      if (event.button > 0 || (!canPower && !canDim) || gesture.current !== null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {pointer: event.pointerId, x: event.clientX, y: event.clientY, start: from, moved: false};setPressed(true);
    }}
    onPointerMove={event => {
      const current = gesture.current;if (current?.pointer !== event.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < PRESS_SLOP) return;
      current.moved = true;if (canDim) setDraft(clampPercent(current.start + (current.y - event.clientY) * DRAG_RATE));
    }}
    onPointerUp={event => {if (gesture.current?.pointer === event.pointerId) end(true);}}
    onPointerCancel={event => {if (gesture.current?.pointer === event.pointerId) end(false);}}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle className="light-dial-track" cx="50" cy="50" r="44" pathLength={100}/>
      {shown !== undefined && shown > 0 && <circle className="light-dial-arc" cx="50" cy="50" r="44" pathLength={100} style={{strokeDashoffset: 100 - shown}}/>}
      {draft !== undefined ? <circle className="light-dial-draft" cx="50" cy="50" r="36" pathLength={100} style={{strokeDashoffset: 100 - draft}}/>
        : requestedLevel !== undefined && requestedLevel > 0 && <circle className="light-dial-draft light-dial-requested" cx="50" cy="50" r="36" pathLength={100} style={{strokeDashoffset: 100 - requestedLevel}}/>}
    </svg>
    <div className="light-dial-slider" role="slider" tabIndex={canDim ? 0 : -1} aria-label={`${name} brightness`} aria-orientation="vertical" aria-disabled={!canDim}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={draft ?? shown ?? 0} aria-valuetext={valueText}
      onKeyDown={event => {
        if (!canDim) return;
        const step = KEY_STEPS[event.key], base = draftValue.current ?? from;
        const next = step !== undefined ? clampPercent(base + step) : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : undefined;
        if (next === undefined) return;
        event.preventDefault();keyStart.current ??= from;setDraft(next);
      }}
      onKeyUp={event => {
        if (KEY_STEPS[event.key] === undefined && event.key !== 'Home' && event.key !== 'End') return;
        const value = draftValue.current, start = keyStart.current;keyStart.current = undefined;setDraft(undefined);commit(value, start);
      }}
      onBlur={() => {if (gesture.current === null) {keyStart.current = undefined;setDraft(undefined);}}}/>
    <button type="button" className="light-dial-switch" role="switch" aria-checked={pressFrom === true} aria-label={`${name} power`} aria-describedby={describedBy} disabled={!canPower}
      // A pointer press is the ring's own gesture; the click this button receives after it is a keyboard or assistive
      // activation only when it carries no pointer detail.
      onClick={event => {if (event.detail === 0) toggle();}}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  </div>;
}
