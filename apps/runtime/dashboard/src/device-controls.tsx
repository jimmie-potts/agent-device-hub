// The existing dashboard's general cards on runtime records and tracked one-shot actions (Hub #922).
import React, {useRef, useState} from 'react';
import type {DeviceRecord, MediaAction, Tagged} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {useAttempt} from './command-control.tsx';
import {contentBlocked, deviceAction, deviceBlocked, operationView, type DeviceIntent} from './devices.ts';
import {Facts, Select} from './ui.tsx';

const shown = <T,>(value: Tagged<T>): string => value.status === 'known' ? String(value.value) : 'Unknown';
const title = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const choices = (values: readonly string[]): {value: string; label: string}[] => [{value: '', label: 'Choose…'}, ...values.map(value => ({value, label: title(value)}))];

export function DeviceCard({record, owner, live, control, operations, operationsLive, refresh, compact = false}: {
  record: DeviceRecord; owner: string; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  refresh: () => Promise<void>; compact?: boolean;
}): React.JSX.Element {
  const action = useAttempt(record.id, operations, operationsLive);
  const [brightness, setBrightness] = useState<string>();
  const [playlist, setPlaylist] = useState('');
  const [scene, setScene] = useState('');
  const [zone, setZone] = useState('');
  const [mood, setMood] = useState('');
  const pointer = useRef(false);
  const latest = useRef(record); latest.current = record;
  const blocked = deviceBlocked(record, live, control) ?? (!operationsLive ? 'Operation records are stale' : undefined);
  const contentReason = contentBlocked(record);
  const disabled = blocked !== undefined || action.locked;
  const cap = record.capabilities;
  const power = record.desired.power.status === 'known' ? record.desired.power.value
    : record.observed.status === 'known' && record.observed.power.status === 'known' ? record.observed.power.value : undefined;
  const run = (intent: DeviceIntent): void => {
    void action.run(blocked ?? deviceAction(latest.current, intent, crypto.randomUUID()));
  };
  const sendBrightness = (value: string): void => { if (value !== '') run({family: 'brightness-set', data: {percent: Number(value)}}); setBrightness(undefined); };
  const held = record.held;
  return <article className="widget" data-device={record.id} aria-label={record.label ?? record.id}>
    <header className="widget-head"><h2>{record.label ?? record.id}</h2><span className={!live || record.availability !== 'available' ? 'badge warning' : 'badge'}>{live ? record.availability : 'Stale'}</span></header>
    <Facts items={[
      ['Desired mode', shown(record.desired.mode)], ['Desired power', record.desired.power.status === 'known' ? record.desired.power.value ? 'On' : 'Off' : 'Unknown'],
      ['Desired brightness', record.desired.brightness.status === 'known' ? `${record.desired.brightness.value}%` : 'Unknown'],
      ['Observed power', record.observed.status === 'known' ? shown(record.observed.power) : 'Unknown'],
      ['Observed brightness', record.observed.status === 'known' ? shown(record.observed.brightness) : 'Unknown'],
      ['Pending changes', record.pending === 0 ? 'None' : `${record.pending} queued: ${record.pendingKinds.join(', ')}`],
      ['Last successful transmission', record.lastTransmission.status === 'known' ? new Date(record.lastTransmission.transmittedAtMs).toISOString() : 'Unknown'],
    ]}/>
    {held !== undefined && <p className="warning">Held since {new Date(held.heldAtMs).toISOString()} by operation <a href={`#held-${held.requestId}`} onClick={event => { event.preventDefault(); document.getElementById(`held-${held.requestId}`)?.focus(); }}>{held.requestId}</a>. A fresh explicit mode command releases the hold; refresh alone does not.</p>}
    {held !== undefined && <p id={`held-${held.requestId}`} tabIndex={-1} className="hint">Held operation {held.requestId}: {operations.find(item => item.requestId === held.requestId) === undefined ? 'No current operation record.' : operationView(operations.find(item => item.requestId === held.requestId) as OperationRecord).text}</p>}
    {!control && <p className="hint">Your session is read-only.</p>}
    {control && <>
      {blocked !== undefined && <p className="hint">Unavailable: {blocked}.</p>}
      <div className="cards quick-controls">
        {cap.power.supported && <div className="edit"><h3>{record.kind === 'pixoo' ? 'Screen power' : 'Power'}</h3><fieldset disabled={disabled}>
          {(power === undefined ? [true, false] : [!power]).map(on => <button type="button" key={String(on)} onClick={() => { run({family: 'power-set', data: {on}}); }}>Turn {on ? 'on' : 'off'}</button>)}
        </fieldset></div>}
        {cap.modes.supported && <div className="edit"><h3>Mode</h3><fieldset disabled={disabled}>
          <Select label="Device mode" value={record.desired.mode.status === 'known' ? record.desired.mode.value : ''} options={choices(cap.modes.values)}
            onChange={mode => { if (mode !== '') run({family: 'device-mode-set', data: {mode}}); }}/>
          {record.desired.mode.status === 'known' && <button type="button" className="secondary" onClick={() => { if (record.desired.mode.status === 'known') run({family: 'device-mode-set', data: {mode: record.desired.mode.value}}); }}>Reapply {title(record.desired.mode.value)}</button>}
        </fieldset></div>}
      </div>
      {!compact && <div className="cards">
        {cap.brightness.supported && <div className="edit"><h3>Brightness</h3><fieldset disabled={disabled}>
          <label>Brightness percent<input type="range" min="0" max="100" step="1" value={brightness ?? (record.desired.brightness.status === 'known' ? String(record.desired.brightness.value) : '0')}
            onPointerDown={() => { pointer.current = true; }} onChange={event => { setBrightness(event.target.value); }}
            onPointerUp={event => { pointer.current = false; sendBrightness(event.currentTarget.value); }}
            onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) sendBrightness(event.currentTarget.value); }}
            onBlur={event => { if (brightness !== undefined && !pointer.current) sendBrightness(event.currentTarget.value); }}/></label>
          <output>{brightness !== undefined ? `${brightness}%` : record.desired.brightness.status === 'known' ? `${record.desired.brightness.value}%` : 'Unknown'}</output>
        </fieldset></div>}
        {cap.scenes.supported && <div className="edit"><h3>Scenes</h3><fieldset disabled={disabled || contentReason !== undefined}>
          <Select label="Scene" value={scene} options={choices(cap.scenes.sceneIds)} onChange={setScene}/><button type="button" disabled={scene === ''} onClick={() => { run({family: 'scene-activate', data: {sceneId: scene}}); }}>Activate scene</button>
        </fieldset><p className="hint">{contentReason ?? 'Scenes are available.'} Nanoleaf scenes need Free mode. Selecting a scene never changes mode.</p></div>}
        {cap.zones.supported && <div className="edit"><h3>Zones</h3><fieldset disabled={disabled}>
          <Select label="Zone" value={zone} options={choices(cap.zones.zoneIds)} onChange={setZone}/>
          {[true, false].map(on => <button key={String(on)} type="button" disabled={zone === ''} onClick={() => { run({family: 'zone-power-set', data: {zoneId: zone, on}}); }}>Zone {on ? 'on' : 'off'}</button>)}
        </fieldset></div>}
        {cap.media.supported && <div className="edit"><h3>Media</h3><fieldset disabled={disabled || contentReason !== undefined}>
          <Select label="Playlist" value={playlist} options={choices(cap.media.playlistIds)} onChange={setPlaylist}/>
          <button type="button" disabled={playlist === ''} onClick={() => { run({family: 'media-start', data: {playlistId: playlist}}); }}>Play playlist</button>
          {cap.media.actions.map((value: MediaAction) => <button type="button" key={value} onClick={() => { run({family: 'media-control', data: {action: value}}); }}>{title(value)}</button>)}
        </fieldset><p className="hint">{contentReason ?? 'Media controls are available.'} Pixoo playback needs Media mode. Nothing changes or restores its mode automatically.</p></div>}
        {cap.moments.supported && <div className="edit"><h3>Moments</h3><fieldset disabled={disabled}>
          <Select label="Mood" value={mood} options={choices(cap.moments.moods)} onChange={setMood}/>
          <button type="button" disabled={mood === ''} onClick={() => { const requestId = crypto.randomUUID(); void action.run(blocked ?? {
            family: 'moment-play', target: record.id, requestId, data: {momentId: requestId, mood, durationMs: Math.min(3000, cap.moments.supported ? cap.moments.maxDurationMs : 0), priorityClass: 'flourish', coversStatus: false, startAtMs: Date.now(), toleranceMs: 1000},
          }); }}>Play moment</button>
        </fieldset></div>}
      </div>}
      {held !== undefined && cap.modes.supported && <div className="actions" aria-label="Release device hold">{cap.modes.values.map(mode =>
        <button type="button" className="secondary" disabled={blocked !== undefined || record.pending > 0} key={mode}
          onClick={() => { run({family: 'device-mode-set', data: {mode}}); }}>Release hold and apply {title(mode)}</button>)}</div>}
      <p role="status" id={action.requestId === undefined ? undefined : `operation-${action.requestId}`}>{action.text}</p>
      {action.locked && <button type="button" className="secondary" onClick={() => { void refresh(); }}>Refresh current state</button>}
    </>}
    {!compact && <details><summary>Device details</summary><Facts items={[
      ['Owner', owner], ['Device ID', record.id], ['Revision', record.revision], ['Configuration revision', record.configurationRevision],
      ['Last device outcome', record.lastOutcome.status === 'known' ? `${record.lastOutcome.outcome.result} (${record.lastOutcome.outcome.evidence})` : 'Unknown'],
      ['Generation', `${record.generation.epoch}:${record.generation.sequence}`], ['Operation', action.requestId ?? 'None'],
      ['Transmission operations', record.lastTransmission.status === 'known' ? record.lastTransmission.operationIds.join(', ') : 'Unknown'],
      ['Unsupported controls', Object.entries(cap).filter(([, value]) => !value.supported).map(([name]) => name).join(', ') === '' ? 'None' : Object.entries(cap).filter(([, value]) => !value.supported).map(([name]) => name).join(', ')],
    ]}/></details>}
  </article>;
}

export function PlaybackCard({record, live, control, operations, operationsLive}: {
  record: PlaybackState; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
}): React.JSX.Element {
  const action = useAttempt(record.id, operations, operationsLive);
  const playback = record.playback;
  return <article className="widget" aria-label={`Music ${record.id}`}><header className="widget-head"><h2>Music</h2></header>
    <p>{!live || record.availability !== 'available' ? 'Playback unavailable' : playback.status === 'known' ? playback.title ?? 'No track title' : 'Playback unknown'}</p>
    <Facts items={[['Observed status', !live || record.availability !== 'available' ? 'Unavailable' : playback.status === 'known' ? title(playback.player) : 'Unknown']]}/>
    {playback.status === 'known' && <p className="hint">{[playback.artist, playback.album].filter(Boolean).join(' · ')}</p>}
    {control && playback.status === 'known' && <fieldset disabled={!live || record.availability !== 'available' || action.locked || !operationsLive}>
      {playback.controls.map(value => <button type="button" key={value} onClick={() => { void action.run({family: 'playback-control', target: record.id, requestId: crypto.randomUUID(), data: {action: value, expectedRevision: record.revision}}); }}>{title(value)}</button>)}
    </fieldset>}<p role="status">{action.text}</p>
  </article>;
}
