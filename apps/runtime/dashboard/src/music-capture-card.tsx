import React, {useId, useState, useSyncExternalStore} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CaptureInput} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {DashboardConnection} from './connection.ts';
import {useAttempt} from './command-control.tsx';
import type {MusicCaptureView} from './music-capture-feed.ts';
import {useMusicCapture} from './music-capture-scope.ts';
import {MusicResponseControls} from './music-response-controls.tsx';
import {MusicLightingCard} from './music-lighting-card.tsx';
import './music.css';

const empty: MusicCaptureView = {synced: false, state: undefined, features: undefined, clockQualified: false, rechecking: false};
const emptySubscribe = (): (() => void) => () => {};
const emptySnapshot = (): MusicCaptureView => empty;
const resultText = (text: string): string => text.replace('The module observed the result.', 'The capture owner confirmed the result.')
  .replace('Nothing was sent to the device.', 'No capture work was sent.').replace('No evidence of a device effect.', 'No capture completion evidence.');
function statusText(view: MusicCaptureView, live: boolean): string {
  const state = view.state;
  if (!live || state === undefined) return 'Capture status is unavailable or disconnected.';
  if (state.availability === 'off') return 'Music producer is off.';
  const microphone = state.session.status !== 'idle' && state.session.input === 'microphone';
  if (state.availability === 'unavailable') return microphone ? 'Selected microphone is unavailable. Check its connection and microphone permission on the Mac.' : 'Music input is unavailable.';
  switch (state.session.status) {
    case 'idle': return 'Ready to measure Music.';
    case 'starting': return 'Starting measurement. Waiting for source evidence.';
    case 'active': return view.features !== undefined ? state.session.input === 'microphone' ? `Receiving ${state.session.microphoneId} measurements.` : 'Receiving Music measurements.' : view.clockQualified ? 'Waiting for fresh measurements.' : view.rechecking ? 'Checking measurement timing again.' : 'Measurement timing is unavailable. Refresh status to check again.';
    case 'stale': return 'Measurements are stale.';
    case 'stopping': return 'Stopping measurement. Waiting for confirmed cleanup.';
    case 'uncertain': return 'Capture may still be running. Its result is uncertain.';
    case 'unavailable': return microphone ? 'Selected microphone is unavailable. Check its connection and microphone permission on the Mac.' : 'Measurement is unavailable.';
  }
}
export function MusicCaptureCard({connection, connected, coreLive, control, operations, operationsLive, devices = [], presetPage = false}: {
  connection: DashboardConnection; connected: boolean; coreLive: boolean; control: boolean;
  operations: readonly OperationRecord[]; operationsLive: boolean; devices?: readonly DeviceRecord[]; presetPage?: boolean;
}): React.JSX.Element {
  const scope = useMusicCapture(connection, connected, coreLive);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState<CaptureInput>('music');
  const view = useSyncExternalStore(scope?.subscribe ?? emptySubscribe, scope?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const selected = operations.filter(operation => operation.family === 'music-capture-control' && operation.target === 'music');
  const start = useAttempt('music', selected, operationsLive, undefined, 'core/music-capture/start');
  const stop = useAttempt('music', selected, operationsLive, undefined, 'core/music-capture/stop');
  const state = view.state;
  const shownInput = state !== undefined && state.session.status !== 'idle' && state.session.status !== 'unavailable' ? state.session.input : input;
  const live = connected && coreLive && view.synced;
  const available = live && control && operationsLive && state?.availability === 'available' && state.endpointId !== null;
  const selectionSupported = input === 'music' || state?.microphone !== undefined;
  const mayStart = available && selectionSupported && (state?.session.status === 'idle' || state?.session.status === 'unavailable') && !start.locked && !stop.locked;
  const mayStop = available && state?.session.status !== 'idle' && state?.session.status !== 'stopping' && !stop.locked;
  const meter = live ? view.features : undefined;
  const meterId = useId();
  const inputId = useId();
  const selectedName = shownInput === 'music' ? 'Music' : state?.microphone?.id ?? 'microphone';
  const refresh = async (): Promise<void> => {
    if (scope === undefined || refreshing) return;
    setRefreshing(true); try {await scope.refresh();} finally {setRefreshing(false);}
  };
  return <><article className="music-capture-card" aria-label="Music input measurement">
    <h2>Music input measurement</h2>
    <p className="music-note">Measures the selected input. This card controls no lights; Music lighting below can render the Music.app measurement.</p>
    <label htmlFor={inputId}>Audio input</label>
    <select id={inputId} value={shownInput} disabled={!available || (state?.session.status !== 'idle' && state?.session.status !== 'unavailable') || start.locked || stop.locked}
      onChange={event => {if (event.target.value === 'music' || event.target.value === 'microphone') setInput(event.target.value);}}>
      <option value="music">Music.app</option>
      {(state?.microphone !== undefined || shownInput === 'microphone') && <option value="microphone" disabled={state?.microphone === undefined}>
        {state?.microphone?.id ?? 'Configured microphone unavailable'}
      </option>}
    </select>
    {state?.microphone !== undefined && <p className="music-note">{state.microphone.id} is configured. Its connection and existing microphone permission are checked when measurement starts. Starting here does not request permission.</p>}
    <p role="status">{statusText(view, live)}</p>
    <div className="music-input-level">
      <label htmlFor={meterId}>Input level</label>
      {meter === undefined ? <p>Input level unavailable.</p> : <>
        <meter id={meterId} min={0} max={1} value={Math.min(1, meter.rms)} aria-valuetext={`${(meter.rms * 100).toFixed(1)} percent of digital full scale`}/>
        <p>RMS {(meter.rms * 100).toFixed(1)}% · Peak {(meter.peak * 100).toFixed(1)}%</p>
        <p className="music-note">Full-scale crossings: {(meter.clippedFraction * 100).toFixed(1)}% of samples.</p>
        {meter.rms > 1 && <p className="music-note">The measured level is above digital full scale.</p>}
      </>}
    </div>
    <div className="music-capture-actions">
      <button type="button" disabled={!mayStart} onClick={() => {
        if (!mayStart || state === undefined || state.endpointId === null || (input === 'microphone' && state.microphone === undefined)) return;
        void start.run({family: 'music-capture-control', target: 'music', requestId: crypto.randomUUID(),
          data: {action: 'start', ...(input === 'music' ? {input: 'music'} : {input: 'microphone', microphoneId: state.microphone?.id}), endpointId: state.endpointId, expectedRevision: state.revision}});
      }}>Start measuring {selectedName}</button>
      <button type="button" disabled={!mayStop} onClick={() => {
        if (!mayStop || state === undefined) return;
        void stop.run({family: 'music-capture-control', target: 'music', requestId: crypto.randomUUID(), data: {action: 'stop', expectedRevision: state.revision}});
      }}>Stop measuring</button>
    </div>
    {!control && <p className="music-note">Read-only access. Capture controls are disabled.</p>}
    {control && !operationsLive && <p className="music-note">Command records are unavailable. Controls are disabled.</p>}
    {start.requestId !== undefined && <p role="status">Start: {resultText(start.text)}</p>}
    {stop.requestId !== undefined && <p role="status">Stop: {resultText(stop.text)}</p>}
    <button type="button" className="secondary" disabled={!connected || !coreLive || scope === undefined || refreshing} onClick={() => {void refresh();}}>Refresh capture status</button>
    <MusicResponseControls view={view} available={Boolean(available)} operations={selected} operationsLive={operationsLive}/>
  </article>
  <MusicLightingCard connection={connection} connected={connected} coreLive={coreLive} control={control} operations={operations} operationsLive={operationsLive}
    capture={view} captureLive={live} devices={devices} presetPage={presetPage}/></>;
}
