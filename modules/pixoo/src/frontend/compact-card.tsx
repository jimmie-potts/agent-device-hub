import React, {useState} from 'react';
import type {DeviceRecord, MediaAction} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendContext, FrontendPresentation} from '@jimmie-potts/sdk/frontend';
import {AnimatedMedia} from './media-picker.js';

export type PixooCompactProps = {
  context: FrontendContext; device: DeviceRecord; shape: FrontendPresentation['shape'];
  /** The card's state line, the active item's rendition and the caption, as the full card computes them. */
  state: string; renditionId: string | undefined; current: boolean; playing: boolean; caption: string;
  /** Playback controls show while a session exists; each is enabled exactly as in the full card. */
  session: boolean; deviceBlocked: boolean; actionDisabled: (action: MediaAction) => boolean;
  screenOn: boolean | undefined; desiredBrightness: number | undefined;
  /** The one result line: a refused or failed send, the command attempt, a block reason or a player error. */
  result: string;
  send: (family: string, data: object) => void;
};

/**
 * The Pixoo card in a Home shape (#1672 PR B). The shape comes from the shell's presentation hint and decides what
 * shows; nothing here measures itself. Every control sends exactly as the full card does, and the full card with the
 * Content tab, playlists and Hub-mode exceptions stays one step away on the device page through the options menu.
 *
 * - Small square: name, state, the active media and its caption.
 * - Wide: the media beside the caption, Screen on and off, playback and the result line.
 * - Tall: the same stacked under the media.
 * - Large square: the media beside the caption, screen, brightness, playback and the result line.
 */
export function PixooCompactCard(props: PixooCompactProps): React.JSX.Element {
  const {context, device, shape, state, renditionId, current, playing, caption, session, deviceBlocked, actionDisabled, screenOn, desiredBrightness, result, send} = props;
  const [brightness, setBrightness] = useState<number>();
  const controls = context.control && shape !== 'square';
  const pause = playing ? 'pause' : 'resume';
  return <article className="light-card pixoo-card pixoo-compact" aria-label="Pixoo display" data-pixoo-shape={shape}>
    <header className="light-card-heading"><div><h3 title={device.label ?? 'Pixoo'}>{device.label ?? 'Pixoo'}</h3><p title={state}>{state}</p></div>
      <details className="light-options"><summary aria-label="Pixoo options">⋯</summary><div className="light-options-body">
        <a href={`#/component/${encodeURIComponent(device.id)}`}>Device details</a>
        <a href="#/module/pixoo/library">Library</a><a href="#/module/pixoo/playlists">Advanced playlists</a>
        <a href="#/module/pixoo/monitor">Monitor</a><a href="#/module/pixoo/settings">Settings</a>
      </div></details>
    </header>
    <div className="pixoo-artwork" data-pixoo-artwork="true"><div className="pixoo-device">
      {renditionId === undefined ? <svg viewBox="0 0 64 64" role="img" aria-label="Pixoo placeholder"><rect x="5" y="5" width="54" height="54" rx="3"/>
        <path d="M23 33v-8h4v-9h4v10h4V16h4v9h4v17h-5v5H28v-5h-5z"/></svg>
        : <AnimatedMedia api={context.api} renditionId={renditionId} label="Active media illustration" active={current} animate={playing}/>}
    </div></div>
    <div className="pixoo-compact-body">
      <p className="pixoo-caption" title={caption}>{caption}</p>
      {controls && device.capabilities.power.supported && <div className="light-power">
        <button type="button" disabled={deviceBlocked} aria-pressed={screenOn === true} onClick={() => { send('power-set', {on: true}); }}>Screen on</button>
        <button type="button" disabled={deviceBlocked} aria-pressed={screenOn === false} onClick={() => { send('power-set', {on: false}); }}>Screen off</button>
      </div>}
      {controls && shape === 'large-square' && device.capabilities.brightness.supported && <form className="pixoo-compact-brightness" onSubmit={event => { event.preventDefault(); if (brightness !== undefined) send('brightness-set', {percent: brightness}); }}>
        <label className="light-slider"><span>Brightness<output>{brightness ?? desiredBrightness ?? 'Unknown'}% · {brightness !== undefined && brightness !== desiredBrightness ? 'draft' : 'requested'}</output></span>
          <input aria-label="Brightness" type="range" min="0" max="100" step="1" value={brightness ?? desiredBrightness ?? 50} disabled={deviceBlocked} onChange={event => { setBrightness(Number(event.target.value)); }}/>
        </label><button type="submit" className="secondary" disabled={deviceBlocked || brightness === undefined || brightness === desiredBrightness}>Apply brightness</button>
      </form>}
      {/* Symbols keep three controls on one row in one unit; each keeps the full card's name. */}
      {controls && session && <div className="actions pixoo-playback" aria-label="Playback controls">
        <button type="button" className="secondary" aria-label="Previous" title="Previous" disabled={actionDisabled('previous')} onClick={() => { send('media-control', {action: 'previous'}); }}>⏮</button>
        <button type="button" className="secondary" aria-label={playing ? 'Pause' : 'Resume'} title={playing ? 'Pause' : 'Resume'} disabled={actionDisabled(pause)} onClick={() => { send('media-control', {action: pause}); }}>{playing ? '⏸' : '▶'}</button>
        <button type="button" className="secondary" aria-label="Next" title="Next" disabled={actionDisabled('next')} onClick={() => { send('media-control', {action: 'next'}); }}>⏭</button>
      </div>}
      {shape !== 'square' && <p className="light-note pixoo-compact-result" role="status" title={result}>{result}</p>}
    </div>
  </article>;
}
