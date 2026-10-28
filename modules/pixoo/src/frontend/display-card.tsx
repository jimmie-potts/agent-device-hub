import React, {useEffect, useId, useState} from 'react';
import type {DeviceRecord, MediaAction} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {DisplayRecord, PlaylistRecord} from '../module/schemas.js';
import {readingOf, type Reading} from './player.js';
import {AnimatedMedia, MediaPicker, type PickerMedia} from './media-picker.js';
import {PlaylistEditor} from './playlist-editor.js';
import {useCardCommand} from './card-command.js';

type Props = {context: FrontendContext; device: DeviceRecord; display: DisplayRecord | undefined; live: boolean; playlists: readonly PlaylistRecord[]; command: FrontendCommand};
const tabs = ['Display', 'Content'] as const;

/** Device artwork stays mounted; only the control face changes. All media state comes from the existing owner. */
export function PixooCard({context, device, display, live, playlists, command}: Props): React.JSX.Element {
  const id = useId();
  const [tab, setTab] = useState<typeof tabs[number]>('Display');
  const [source, setSource] = useState('playlists'), [selectedId, setSelectedId] = useState('');
  const [selection, setSelection] = useState<ReadonlyMap<string, PickerMedia>>(new Map());
  const [editor, setEditor] = useState<{saved?: PlaylistRecord}>();
  const [reading, setReading] = useState<{value: Reading; revision: number}>(), [loading, setLoading] = useState(false), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [brightness, setBrightness] = useState<number>();
  const {blocked, failure, send} = useCardCommand(context, device, live, command);
  const revision = display?.revision;
  useEffect(() => {
    let disposed = false;
    setError(false); setLoading(true);
    if (!context.connected || !live || revision === undefined) { setReading(undefined); setLoading(false); return; }
    void context.api.read('/modules/pixoo/content/player').then(value => {
      const parsed = readingOf(value);
      if (!disposed) { setReading({value: parsed, revision}); setLoading(false); }
    }).catch(() => { if (!disposed) { setError(true); setReading(undefined); setLoading(false); } });
    return () => { disposed = true; };
  }, [context.api, context.connected, live, revision, retry]);
  const current = context.connected && live && reading?.revision === revision && !loading && !error;
  const session = reading?.value.session, state = reading?.value.state;
  const activeItem = session?.playlist.items.find(item => item.id === state?.itemId);
  const selected = playlists.find(playlist => playlist.id === selectedId);
  const savedSession = playlists.find(playlist => playlist.id === session?.playlist.id);
  const pendingChanges = session?.source?.kind !== 'media' && savedSession !== undefined && savedSession.playlistRevision !== session?.playlist.revision;
  const media = [...selection.values()][0];
  const deviceBlocked = blocked !== undefined || !current || device.availability !== 'available';
  const contentBlocked = deviceBlocked || device.desired.mode.status !== 'known' || device.desired.mode.value !== 'media';
  const actionDisabled = (action: MediaAction): boolean => contentBlocked || !device.capabilities.media.supported || !device.capabilities.media.actions.includes(action)
    || session === null || session === undefined || (action === 'restart-with-changes' && (session.source?.kind === 'media' || savedSession?.repeat !== true));
  const desiredBrightness = device.desired.brightness.status === 'known' ? device.desired.brightness.value : undefined;
  const screenOn = device.desired.power.status === 'known' ? device.desired.power.value : undefined;
  return <article className="light-card pixoo-card" aria-label="Pixoo display">
    <header className="light-card-heading"><div><h3>{device.label ?? 'Pixoo'}</h3><p>{!current ? 'Stale' : display?.mode === 'monitor' ? 'Monitor' : state?.state ?? 'Media'}</p></div>
      <details className="light-options"><summary aria-label="Pixoo options">⋯</summary><div className="light-options-body">
        <a href="#/module/pixoo/library">Library</a><a href="#/module/pixoo/playlists">Advanced playlists</a>
        <a href="#/module/pixoo/monitor">Monitor</a><a href="#/module/pixoo/settings">Settings</a>
        <a href={`#/component/${encodeURIComponent(device.id)}`}>Device details</a>
      </div></details>
    </header>
    <div className="pixoo-artwork" data-pixoo-artwork="true"><div className="pixoo-device">
      {activeItem === undefined ? <svg viewBox="0 0 64 64" role="img" aria-label="Pixoo placeholder"><rect x="5" y="5" width="54" height="54" rx="3"/>
        <path d="M23 33v-8h4v-9h4v10h4V16h4v9h4v17h-5v5H28v-5h-5z"/></svg>
        : <AnimatedMedia api={context.api} renditionId={activeItem.renditionId} label="Active media illustration" active={current} animate={state?.state === 'playing'}/>}
    </div></div>
    <p className="pixoo-caption">{session?.playlist.name ?? 'Choose something to play'}{activeItem === undefined ? '' : ` · ${(session?.playlist.items.findIndex(item => item.id === activeItem.id) ?? -1) + 1}/${session?.playlist.items.length}`}</p>
    <div className="light-tabs pixoo-tabs" role="tablist" aria-label="Pixoo controls">{tabs.map((name, index) => <button type="button" role="tab" key={name}
      id={`${id}-${name}`} aria-controls={`${id}-${name}-face`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => { setTab(name); }} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowRight', 'ArrowLeft'].includes(event.key) ? 1 - index : undefined;
        if (next === undefined) return;
        event.preventDefault(); setTab(tabs[next] ?? 'Display'); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
      }}>{name}</button>)}</div>
    <div className="pixoo-face-space"><div className="light-face" hidden={tab !== 'Display'} id={`${id}-Display-face`} role="tabpanel" aria-labelledby={`${id}-Display`} tabIndex={0}>
      <>
        {context.ui.ModeChoice !== undefined && <context.ui.ModeChoice target={device.id}/>}
        {context.control && <>
          {device.capabilities.power.supported && <div className="light-power">
            <button type="button" disabled={deviceBlocked} aria-pressed={screenOn === true} onClick={() => { send('power-set', {on: true}); }}>Screen on</button>
            <button type="button" disabled={deviceBlocked} aria-pressed={screenOn === false} onClick={() => { send('power-set', {on: false}); }}>Screen off</button>
          </div>}
          {device.capabilities.brightness.supported && <form onSubmit={event => { event.preventDefault(); if (brightness !== undefined) send('brightness-set', {percent: brightness}); }}>
            <label className="light-slider"><span>Brightness<output>{brightness ?? desiredBrightness ?? 'Unknown'}% · {brightness !== undefined && brightness !== desiredBrightness ? 'draft' : 'requested'}</output></span>
              <input type="range" min="0" max="100" step="1" value={brightness ?? desiredBrightness ?? 50} disabled={deviceBlocked} onChange={event => { setBrightness(Number(event.target.value)); }}/>
            </label><button type="submit" className="secondary" disabled={deviceBlocked || brightness === undefined || brightness === desiredBrightness}>Apply brightness</button>
          </form>}
          {device.capabilities.modes.supported && <div className="actions">{device.capabilities.modes.values.filter(mode => mode === 'monitor' || mode === 'media').map(mode =>
            <button type="button" className="secondary" key={mode} disabled={deviceBlocked || mode === display?.mode} onClick={() => { send('device-mode-set', {mode}); }}>{mode === 'monitor' ? 'Show monitor' : 'Select Media'}</button>)}</div>}
        </>}
        <p className="light-note">Preview is illustrative. Screen on does not resume playback.</p>
      </>
    </div><div className="light-face" hidden={tab !== 'Content'} id={`${id}-Content-face`} role="tabpanel" aria-labelledby={`${id}-Content`} tabIndex={0}>
      {editor !== undefined ? <PlaylistEditor key={editor.saved?.id ?? 'new'} context={context} device={device} live={live} command={command} playlists={playlists} saved={editor.saved} active={live && tab === 'Content'} close={() => { setEditor(undefined); }}/>
        : <>
          <label>Browse<select value={source} onChange={event => { setSource(event.target.value); }}><option value="playlists">Playlists</option><option value="media">GIFs &amp; images</option></select></label>
          {source === 'playlists' ? <>
            <label>Saved playlist<select value={selectedId} onChange={event => { setSelectedId(event.target.value); setPlaylistOffset(0); }}>
              <option value="">Choose…</option>{playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
            </select></label>
            {selected !== undefined && <>
              <p className="light-note">{selected.items.length} items · {selected.repeat ? 'Loops automatically' : 'Loop is off'}</p>
              <div className="pixoo-media-grid" aria-label="Saved playlist contents">{selected.items.slice(playlistOffset, playlistOffset + 6).map((item, index) => <div key={item.id}>
                <AnimatedMedia api={context.api} renditionId={item.renditionId} label={`Saved item ${playlistOffset + index + 1} preview`} active={live && tab === 'Content' && context.connected}/>
              </div>)}</div>
              {selected.items.length > 6 && <div className="actions"><button type="button" className="secondary" disabled={playlistOffset === 0} onClick={() => { setPlaylistOffset(Math.max(0, playlistOffset - 6)); }}>Previous saved items</button>
                <span>{playlistOffset + 1}–{Math.min(playlistOffset + 6, selected.items.length)} of {selected.items.length}</span>
                <button type="button" className="secondary" disabled={playlistOffset + 6 >= selected.items.length} onClick={() => { setPlaylistOffset(playlistOffset + 6); }}>Next saved items</button></div>}
            </>}
            {context.control && <div className="actions">
              <button type="button" disabled={contentBlocked || selected === undefined || selected.items.length === 0 || !selected.repeat || !device.capabilities.media.supported
                || !device.capabilities.media.playlistIds.includes(selected.id)} onClick={() => { if (selected !== undefined && selected.repeat) send('media-start', {playlistId: selected.id}); }}>Play playlist</button>
              {selected !== undefined && !selected.repeat && <button type="button" className="secondary" disabled={blocked !== undefined} onClick={() => {
                send('pixoo-playlist-change', {change: {operation: 'options', playlistId: selected.id, revision: selected.playlistRevision, repeat: true}});
              }}>Enable loop</button>}
              <button type="button" className="secondary" disabled={blocked !== undefined || selected === undefined} onClick={() => { if (selected !== undefined) setEditor({saved: selected}); }}>Edit playlist</button>
              <button type="button" className="secondary" disabled={blocked !== undefined} onClick={() => { setEditor({}); }}>New playlist</button>
            </div>}
          </> : <>
            <MediaPicker context={context} active={live && tab === 'Content'} selected={selection} onSelect={item => { setSelection(new Map([[item.renditionId, item]])); }}/>
            {media !== undefined && <p className="light-note">Selected: {media.name}</p>}
            {context.control && <button type="button" disabled={contentBlocked || media === undefined || !device.capabilities.media.supported} onClick={() => {
              if (media !== undefined) send('pixoo-media-show', {renditionId: media.renditionId});
            }}>Play selected media</button>}
          </>}
        </>}
    </div></div>
    {context.control && session !== undefined && session !== null && <div className="actions pixoo-playback" aria-label="Playback controls">
      <button type="button" className="secondary" disabled={actionDisabled('previous')} onClick={() => { send('media-control', {action: 'previous'}); }}>Previous</button>
      <button type="button" className="secondary" disabled={actionDisabled(state?.state === 'playing' ? 'pause' : 'resume')} onClick={() => { send('media-control', {action: state?.state === 'playing' ? 'pause' : 'resume'}); }}>{state?.state === 'playing' ? 'Pause' : 'Resume'}</button>
      <button type="button" className="secondary" disabled={actionDisabled('next')} onClick={() => { send('media-control', {action: 'next'}); }}>Next</button>
    </div>}
    {pendingChanges && <div className="pixoo-pending"><p className="light-note">Saved changes are waiting. Active playback is unchanged.</p>
      {context.control && <button type="button" className="secondary" disabled={actionDisabled('restart-with-changes')} onClick={() => { send('media-control', {action: 'restart-with-changes'}); }}>Restart with changes</button>}
    </div>}
    {error && <p role="alert">Player unavailable. <button type="button" onClick={() => { setRetry(value => value + 1); }}>Refresh player</button></p>}
    {tab === 'Content' && device.desired.mode.status === 'known' && device.desired.mode.value !== 'media' && <p className="light-note">Select Media on the Display tab before playback.</p>}
    {blocked !== undefined && <p className="light-note">{blocked}</p>}
    {state?.lastError !== null && state?.lastError !== undefined && <p role="alert">Player error: {state.lastError.code}. Check advanced Player before resuming.</p>}
    <p className="light-note" role="status">{failure ?? command.text}</p>
  </article>;
}
