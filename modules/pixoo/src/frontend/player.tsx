// Adapted from divoom-app-upgrade apps/web/src/player.tsx (0777479c): frozen sessions, explicit controls and illustrative timing.
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord, MediaAction} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {DisplayRecord, PlaylistRecord, Policy} from '../module/schemas.js';
import {Preview} from './preview.js';

type State = {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'reconnecting' | 'error'; intent: 'active' | 'paused' | 'stopped';
  availability: 'unknown' | 'available' | 'offline'; requestedScreenOn: boolean;
  sessionId: string | null; itemId: string | null; dwellDeadlineMs: number | null;
  lastError: {code: string; priorEffects?: 'none' | 'possible'} | null;
};
type Session = {id: string; playlist: {id: string; name: string; revision: number; repeat: boolean; shuffle: boolean;
  items: {id: string; renditionId: string; playback: Policy}[]}; source?: {kind: 'playlist' | 'media'}};
type Reading = {state: State; session: Session | null; sampledAtMs: number; simulated: boolean};
type Sample = Reading & {receivedAtMs: number; revision: number};
type Props = {context: FrontendContext; device: DeviceRecord | undefined; display: DisplayRecord | undefined;
  live: boolean; playlists: readonly PlaylistRecord[]};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const member = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);
const nullableId = (value: unknown): boolean => value === null || uuid(value);
const codeOf = (error: unknown): string => object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string'
  ? error.body.error.code : 'unavailable';
function readingOf(value: unknown): Reading {
  if (!object(value) || !object(value.state) || !finite(value.sampledAtMs) || typeof value.simulated !== 'boolean') throw new Error('invalid player');
  const state = value.state;
  if (!member(state.state, ['idle', 'loading', 'playing', 'paused', 'reconnecting', 'error'])
    || !member(state.intent, ['active', 'paused', 'stopped']) || !member(state.availability, ['unknown', 'available', 'offline'])
    || typeof state.requestedScreenOn !== 'boolean' || !nullableId(state.sessionId) || !nullableId(state.itemId)
    || !(state.dwellDeadlineMs === null || finite(state.dwellDeadlineMs))
    || !(state.lastError === null || object(state.lastError) && typeof state.lastError.code === 'string' && state.lastError.code.length >= 1 && state.lastError.code.length <= 64
      && (state.lastError.priorEffects === undefined || member(state.lastError.priorEffects, ['none', 'possible'])))) throw new Error('invalid player');
  const session = value.session;
  if (session !== null) {
    if (!object(session) || !uuid(session.id) || session.id !== state.sessionId || !object(session.playlist)) throw new Error('invalid session');
    const playlist = session.playlist;
    if (!uuid(playlist.id) || typeof playlist.name !== 'string' || playlist.name.length < 1 || playlist.name.length > 120
      || !positive(playlist.revision) || typeof playlist.repeat !== 'boolean' || typeof playlist.shuffle !== 'boolean'
      || !Array.isArray(playlist.items) || playlist.items.length > 1000 || !playlist.items.every((item: unknown) =>
        object(item) && uuid(item.id) && typeof item.renditionId === 'string' && /^[a-f0-9]{64}$/.test(item.renditionId)
        && object(item.playback) && (item.playback.mode === 'plays' ? positive(item.playback.totalPlays)
          : item.playback.mode === 'duration' && positive(item.playback.durationMs)))
      || !(session.source === undefined || object(session.source) && member(session.source.kind, ['playlist', 'media']))) throw new Error('invalid session');
  } else if (state.sessionId !== null) throw new Error('invalid session');
  return value as Reading;
}

function Controls({context, device, display, sample, current, playlists, command}: Props & {
  device: DeviceRecord; sample: Sample | undefined; current: boolean; command: FrontendCommand;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState('');
  const [failure, setFailure] = useState<string>();
  const submitting = useRef(false);
  const selected = playlists.find(playlist => playlist.id === selectedId);
  const session = sample?.session;
  const savedSession = playlists.find(playlist => playlist.id === session?.playlist.id);
  const state = sample?.state;
  const blocked = !context.control ? 'Read-only access.' : !current ? 'Player records are stale.'
    : !context.operationsLive ? 'Command records are stale.' : command.locked ? 'Wait for the current command result.' : undefined;
  const media = device.capabilities.media;
  const run = (family: 'media-start' | 'media-control' | 'device-mode-set', data: object): void => {
    if (blocked !== undefined || submitting.current) return;
    submitting.current = true; setFailure(undefined);
    void command.run({family, target: device.id, requestId: crypto.randomUUID(), data: {
      ...data, expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation,
    }}).catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  const actionDisabled = (action: MediaAction): boolean => blocked !== undefined || !media.supported || !media.actions.includes(action)
    || (action !== 'stop' && action !== 'clear' && (session === undefined || session === null))
    || (action === 'restart-with-changes' && session?.source?.kind === 'media');
  const {Select} = context.ui;
  return <>
    <Select label="Playlist to play" value={selectedId} onChange={setSelectedId}
      options={[{value: '', label: 'Choose…'}, ...playlists.map(playlist => ({value: playlist.id, label: playlist.name}))]}/>
    <p>Selected saved playlist: {selected?.name ?? 'Choose a playlist'}. Play uses saved items.</p>
    {session !== undefined && session !== null && <>
      <h3>{session.playlist.name}</h3>
      <p>{session.source?.kind === 'media' ? 'Temporary media session'
        : `Session revision ${session.playlist.revision}${savedSession === undefined ? '' : ` · Saved revision ${savedSession.playlistRevision}`}`}</p>
      <p>Item {session.playlist.items.findIndex(item => item.id === state?.itemId) + 1} of {session.playlist.items.length}</p>
      {session.source?.kind !== 'media' && savedSession !== undefined && savedSession.playlistRevision !== session.playlist.revision
        && <p className="hint">Saved changes are waiting for the next session. Restart with changes applies them now.</p>}
    </>}
    {context.control ? <>
      <div className="actions">
        <button type="button" disabled={blocked !== undefined || !media.supported || selected === undefined || selected.items.length === 0}
          onClick={() => { if (selected !== undefined) run('media-start', {playlistId: selected.id}); }}>Play playlist</button>
        {(['pause', 'resume', 'stop', 'previous', 'next', 'restart-with-changes', 'clear'] as const).map(action =>
          <button type="button" className="secondary" key={action} disabled={actionDisabled(action)} onClick={() => { run('media-control', {action}); }}>
            {{pause: 'Pause playlist', resume: 'Resume', stop: 'Stop', previous: 'Previous', next: 'Next', 'restart-with-changes': 'Restart with changes', clear: 'Clear session'}[action]}
          </button>)}
      </div>
      {device.capabilities.modes.supported && <>
        <Select label="Display mode" value={mode} onChange={setMode}
          options={[{value: '', label: 'Choose…'}, ...device.capabilities.modes.values.map(value => ({value, label: value === 'media' ? 'Media' : value === 'monitor' ? 'Monitor' : value}))]}/>
        <div className="actions"><button type="button" className="secondary"
          disabled={blocked !== undefined || mode === '' || mode === display?.mode} onClick={() => { run('device-mode-set', {mode}); }}>Set display mode</button></div>
      </>}
      {blocked !== undefined && <p className="hint">{blocked}</p>}
    </> : <p className="hint">Read-only access.</p>}
    <p role="status">{failure ?? command.text}</p>
  </>;
}

export function PlayerPage(props: Props): React.JSX.Element {
  const {context, device, display, live} = props;
  const [sample, setSample] = useState<Sample>();
  const [failure, setFailure] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(performance.now());
  const revision = display?.revision;
  useEffect(() => {
    let disposed = false;
    setFailure(undefined); setLoading(true);
    if (revision === undefined) { setSample(undefined); setLoading(false); return; }
    void context.api.read('/modules/pixoo/content/player').then(value => {
      const data = readingOf(value);
      if (!disposed) { setSample({...data, revision, receivedAtMs: performance.now()}); setLoading(false); setNow(performance.now()); }
    }).catch((error: unknown) => { if (!disposed) { setFailure(codeOf(error)); setSample(undefined); setLoading(false); } });
    return () => { disposed = true; };
  }, [context.api, revision, refresh]);
  const current = context.connected && live && sample !== undefined && sample.revision === revision && !loading && failure === undefined;
  useEffect(() => {
    if (!current || sample?.state.state !== 'playing') return;
    // Redraw the existing illustrative estimate locally; this timer performs no reads or commands.
    const timer = window.setInterval(() => { setNow(performance.now()); }, 250);
    return () => { window.clearInterval(timer); };
  }, [current, sample?.state.state]);
  const state = sample?.state;
  const session = sample?.session;
  const item = session?.playlist.items.find(value => value.id === state?.itemId);
  const remaining = current && sample !== undefined && state?.state === 'playing' && state.dwellDeadlineMs !== null
    ? Math.max(0, state.dwellDeadlineMs - sample.sampledAtMs - Math.max(0, now - sample.receivedAtMs)) : null;
  const {Badge, Facts, Command} = context.ui;
  return <section className="widget" aria-label="Pixoo player">
    <header className="widget-head"><h2>Player</h2><Badge warning={!current}>{current ? 'Current' : 'Stale'}</Badge></header>
    <div className="actions"><button type="button" className="secondary" disabled={loading} onClick={() => { setRefresh(value => value + 1); }}>Refresh player</button></div>
    {loading && <p role="status">Loading player…</p>}
    {failure !== undefined && <p role="alert">Player unavailable ({failure}). Refresh to try again.</p>}
    {state !== undefined && <>
      <Facts items={[
        ['Playback', state.state], ['Intent', state.intent], ['Transport', `${sample?.simulated === true ? 'Simulator adapter' : 'Device transport'}: ${state.availability}`],
        ['Requested screen', state.requestedScreenOn ? 'on' : 'off'], ['Display mode', display?.mode ?? 'Unknown'],
      ]}/>
      <p aria-live="off">{state.state === 'loading' ? 'Loading frames; dwell has not started.' : remaining === null
        ? 'Estimated remaining: unavailable while not playing.' : `Estimated remaining: ${(remaining / 1000).toFixed(1)} seconds`}</p>
      {state.lastError !== null && <p role="alert">Player error: {state.lastError.code}. {sample?.simulated === false && state.lastError.priorEffects === 'possible'
        ? 'The device may have applied part of the operation. Playback is paused. Explicit resume restarts the current item from its beginning.'
        : 'Check the media, skip it, or explicitly resume to retry.'}</p>}
      {session === null && <p>No active session.</p>}
    </>}
    {device === undefined ? <p role="status">The Pixoo owner has no device record.</p>
      : <Command context={context} target={device.id} key={device.id}>{command =>
        <Controls {...props} device={device} sample={sample} current={current} command={command}/>
      }</Command>}
    {item === undefined ? <p>No active preview.</p> : <Preview key={item.renditionId} api={context.api} renditionId={item.renditionId} active={current}/>}
    <p className="hint">Pause stops playlist advancement. Resume restarts the item from its beginning. Stop leaves the last content. Preview and timing are estimates, not physical telemetry.</p>
  </section>;
}
