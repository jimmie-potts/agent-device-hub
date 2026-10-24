import React, {useId, useRef, useState} from 'react';
import type {App, Key} from '../actions.js';
import type {OnnState} from '../contracts.js';
import {validOnnText, type OnnAvailability, type OnnFeedback} from './onn-card-data.js';
import './onn-card.css';

export type OnnCardProps = {
  id: string; label?: string | undefined; availability: OnnAvailability; app: string; readOnly: boolean; disabled: boolean;
  controls?: OnnState['controls'] | undefined; feedback: OnnFeedback;
  onKey: (key: Key) => void; onApp: (app: App) => void; onText: (text: string) => void; onReload: () => void;
};
type Glyph = 'up' | 'down' | 'left' | 'right' | 'back' | 'home' | 'play' | 'pause' | 'tv' | 'launch' | 'text';
function Icon({name}: {name: Glyph}): React.JSX.Element {
  const paths: Record<Glyph, string> = {up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', left: 'm15 6-6 6 6 6', right: 'm9 6 6 6-6 6',
    back: 'm9 6-5 5 5 5M4 11h10a5 5 0 0 1 5 5v3', home: 'm3 11 9-8 9 8M5 10v11h14V10M9 21v-8h6v8',
    play: 'm7 4 14 8-14 8Z', pause: 'M7 4v16M17 4v16', tv: 'M3 4h18v14H3ZM8 22h8', launch: 'M6 18 18 6M6 6h12v12', text: 'M20 4v7a4 4 0 0 1-4 4H4m5-5-5 5 5 5'};
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const directions: readonly {key: Key; label: string; icon?: Glyph}[] = [
  {key: 'up', label: 'Up', icon: 'up'}, {key: 'left', label: 'Left', icon: 'left'}, {key: 'select', label: 'Select'},
  {key: 'right', label: 'Right', icon: 'right'}, {key: 'down', label: 'Down', icon: 'down'},
];
const navigation: readonly {key: Key; label: string; icon: Glyph}[] = [
  {key: 'back', label: 'Back', icon: 'back'}, {key: 'home', label: 'Home', icon: 'home'}, {key: 'play-pause', label: 'Play / pause', icon: 'play'},
];

/** Presentation only. The caller owns the source, target, permission and tracked command callbacks. */
export function OnnCard({id, label = 'ONN TV', availability, app, readOnly, disabled, controls, feedback, onKey, onApp, onText, onReload}: OnnCardProps): React.JSX.Element {
  const uid = useId(), statusButton = useRef<HTMLButtonElement>(null), helpButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'remote' | 'apps'>('remote');
  const [text, setText] = useState(''), [note, setNote] = useState(false), [help, setHelp] = useState(false);
  const warning = availability !== 'available' || feedback.attention;
  const sourceNote = availability === 'stale' ? 'ONN status is stale. Reload status before using the remote.'
    : availability === 'unavailable' ? 'ONN is unavailable. Controls are paused.' : availability === 'unknown' ? 'ONN status or selected target is unknown.' : '';
  const inputError = text.length > 0 && !validOnnText(text);
  const showNote = (): void => {setNote(value => !value); setHelp(false);};
  return <article className="widget onn-card" data-onn-card="soft-keys" data-device={id} data-state={availability} aria-label="ONN controls" onKeyDown={event => {
    if (event.key !== 'Escape') return;
    if (note) {setNote(false); statusButton.current?.focus();}
    if (help) {setHelp(false); helpButton.current?.focus();}
  }}>
    <header className="onn-card-head"><div className="onn-card-identity"><span className="onn-card-mark"><Icon name="tv"/></span><div><h2>{label}</h2>{readOnly && <span className="onn-readonly">Read only</span>}</div></div>
      {warning && <button ref={statusButton} type="button" className="onn-status-button" aria-label="ONN status" aria-expanded={note} aria-controls={`${uid}-status`} onClick={showNote}><span aria-hidden="true">!</span></button>}
    </header>
    <div className="onn-status-note" id={`${uid}-status`} hidden={!note}>
      {sourceNote !== '' && <p>{sourceNote}</p>}
      {feedback.detail !== '' && <p>{feedback.detail}</p>}
      {feedback.attention && <p>Check Inbox on <a href="#/">Home</a>.</p>}
      {availability !== 'available' && <button type="button" className="secondary" onClick={onReload}>Reload status</button>}
    </div>
    <div className="onn-card-hero"><div className="onn-device-art" role="img" aria-label="Illustration of a television and ONN streaming box">
      <div className="onn-television"><div className="onn-screen"><span className="onn-hill"/><span className="onn-hill onn-hill-front"/></div><span className="onn-tv-label">onn.</span></div><span className="onn-stand"/><span className="onn-box">onn.</span>
    </div><p className="onn-current-app">{app}</p></div>
    <div className="onn-tabs" role="tablist" aria-label="ONN controls" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'remote' : event.key === 'End' ? 'apps' : tab === 'remote' ? 'apps' : 'remote';
      setTab(next); document.getElementById(`${uid}-${next}`)?.focus();
    }}>{(['remote', 'apps'] as const).map(value => <button type="button" key={value} role="tab" tabIndex={tab === value ? 0 : -1} id={`${uid}-${value}`} aria-controls={`${uid}-${value}-panel`} aria-selected={tab === value} onClick={() => {setTab(value);}}>{value === 'remote' ? 'Remote' : 'Apps'}</button>)}</div>
    <div className="onn-control-plane">
      <section id={`${uid}-remote-panel`} role="tabpanel" aria-labelledby={`${uid}-remote`} hidden={tab !== 'remote'}>
        <div className="onn-dpad" role="group" aria-label="Directional controls">{directions.map(item => <button type="button" key={item.key} data-key={item.key} aria-label={item.label}
          disabled={disabled || controls?.keys.includes(item.key) !== true} onClick={() => {onKey(item.key);}}>{item.icon === undefined ? 'OK' : <Icon name={item.icon}/>}</button>)}</div>
        <div className="onn-transport" role="group" aria-label="Navigation and playback">{navigation.map(item => <button type="button" key={item.key} aria-label={item.label}
          disabled={disabled || controls?.keys.includes(item.key) !== true} onClick={() => {onKey(item.key);}}><Icon name={item.icon}/>{item.key === 'play-pause' && <Icon name="pause"/>}</button>)}</div>
      </section>
      <section id={`${uid}-apps-panel`} role="tabpanel" aria-labelledby={`${uid}-apps`} hidden={tab !== 'apps'}>
        <div className="onn-app-shortcuts" role="group" aria-label="App shortcuts">{(['youtube', 'stremio'] as const).map(value => <button type="button" key={value}
          disabled={disabled || controls?.apps.includes(value) !== true} aria-label={`Open ${value === 'youtube' ? 'YouTube' : 'Stremio'}`} onClick={() => {onApp(value);}}><Icon name={value === 'youtube' ? 'play' : 'tv'}/><span>{value === 'youtube' ? 'YouTube' : 'Stremio'}</span><Icon name="launch"/></button>)}</div>
        <form autoComplete="off" onSubmit={event => {event.preventDefault(); if (disabled || controls === undefined || !validOnnText(text)) return; const submitted = text; setText(''); onText(submitted);}}>
          <label className="onn-sr" htmlFor={`${uid}-text`}>Focused text</label>
          <div className="onn-text-entry"><input id={`${uid}-text`} value={text} type="text" placeholder="Type on TV…" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={256}
            aria-describedby={`${uid}-text-help ${uid}-text-error`} aria-invalid={inputError} disabled={disabled || controls === undefined} onChange={event => {setText(event.target.value);}}/>
            <button type="submit" aria-label="Insert text" disabled={disabled || controls === undefined || !validOnnText(text)}><Icon name="text"/></button></div>
          <p className="onn-text-help" id={`${uid}-text-help`}>Focus a TV field first. Inserts text only.</p>
          <p className="onn-text-error" role="status" id={`${uid}-text-error`} hidden={!inputError}>Use letters, numbers, spaces, . _ -</p>
        </form>
      </section>
    </div>
    <div className="onn-feedback" role="status" aria-live="polite">{feedback.label !== '' && <><button type="button" aria-expanded={note} aria-controls={`${uid}-status`} onClick={showNote}>{feedback.label}</button><span className="onn-sr">{feedback.detail}</span></>}</div>
    <footer className="onn-card-foot"><button ref={helpButton} type="button" className="onn-help-button" aria-label="ONN help" aria-expanded={help} aria-controls={`${uid}-help`} onClick={() => {setHelp(value => !value); setNote(false);}}>?</button><a href="#/module/onn/history">History <Icon name="launch"/></a></footer>
    <div className="onn-guidance" id={`${uid}-help`} hidden={!help}><p>To seek, focus the timeline on the TV, then use Left or Right. YouTube needs a separate Select to apply; Stremio applies the step while paused.</p><p>Sent means transmission only. Check the TV for the visible effect.</p>{feedback.detail !== '' && <p>{feedback.detail}</p>}<button type="button" className="secondary" onClick={onReload}>Reload status</button></div>
  </article>;
}
