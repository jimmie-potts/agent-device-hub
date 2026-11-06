import React, {useEffect, useId, useState, useSyncExternalStore} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import {followReactivePresets} from '@jimmie-potts/nanoleaf/reactive-presets';
import type {ReactiveCatalogView} from '@jimmie-potts/nanoleaf/reactive-presets';
import {useAttempt} from './command-control.tsx';
import type {DashboardConnection} from './connection.ts';
import {operationView} from './devices.ts';
import type {MusicCaptureView} from './music-capture-feed.ts';
import type {MusicLightingFeed, MusicLightingView} from './music-lighting-feed.ts';
import {controlText, endingText, lightingWorkId, sessionText, startBlocked, startCapture, stopBlocked, workText} from './music-lighting-model.ts';

const empty: MusicLightingView = {synced: false, records: [], presets: {value: undefined, live: false, pending: true, failed: false}};
const emptySubscribe = (): (() => void) => () => {};
const emptySnapshot = (): MusicLightingView => empty;
const time = (atMs: number): string => new Date(atMs).toLocaleTimeString();

/** The core's tracked work for one operator request, found by the ID the core derives; nothing is sent here. */
function useWork(target: string, requestId: string | undefined, operations: readonly OperationRecord[]): OperationRecord | undefined {
  const [derived, setDerived] = useState<{requestId: string; workId: string}>();
  useEffect(() => {
    if (requestId === undefined || requestId === '') return;
    let current = true;
    lightingWorkId(requestId, target).then(workId => {if (current) setDerived({requestId, workId});}, () => {});
    return () => {current = false;};
  }, [requestId, target]);
  if (derived === undefined || derived.requestId !== requestId) return undefined;
  return operations.find(operation => operation.requestId === derived.workId && operation.family === 'music-lighting-work' && operation.target === target);
}

function LightingTarget({record, device, live, control, operations, operationsLive, capture, captureLive, presets}: {
  record: LightingState; device: DeviceRecord | undefined; live: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  capture: MusicCaptureView; captureLive: boolean; presets: ReactiveCatalogView;
}): React.JSX.Element {
  const label = device?.label ?? record.id;
  const selected = operations.filter(operation => operation.family === 'music-lighting-control' && operation.target === record.id);
  const start = useAttempt(record.id, selected, operationsLive, undefined, `core/music-lighting/start/${record.id}`);
  const stop = useAttempt(record.id, selected, operationsLive, undefined, `core/music-lighting/stop/${record.id}`);
  const startWork = useWork(record.id, start.requestId, operations), stopWork = useWork(record.id, stop.requestId, operations);
  const [choice, setChoice] = useState<string>();
  const presetId = useId();
  const list = presets.value?.presets ?? [];
  const chosen = list.some(preset => preset.presetId === choice) ? choice : list[0]?.presetId;
  const controls = {record, recordsLive: live, control, operationsLive, capture: capture.state, captureLive, presets, presetId: chosen,
    startLocked: start.locked, stopLocked: stop.locked};
  const startReason = startBlocked(controls), stopReason = stopBlocked(controls);
  const session = record.session;
  const inUse = session.status === 'idle' ? undefined : list.find(preset => preset.presetId === session.presetId)?.name;
  const mode = device?.desired.mode;
  return <section className="music-lighting-target" aria-label={`${label} Music lighting`}>
    <h3>{label}</h3>
    <div role="status">
      <p>{live ? sessionText(session) : `Last known: ${sessionText(session)}`}</p>
      {session.status !== 'idle' && <p>Preset: {inUse ?? `${session.presetId} (not in the current library snapshot)`}. Started at {time(session.startedAtMs)}.</p>}
      {record.last !== null && <p>{endingText(record.last)} Ended at {time(record.last.atMs)}.</p>}
    </div>
    {mode?.status === 'known' && mode.value !== 'free' && <p className="music-note">This light&apos;s saved mode is not Free, so a Start would be refused. Starting never switches the mode; choose Free first.</p>}
    <label htmlFor={presetId}>Saved reactive preset</label>
    <select id={presetId} value={chosen ?? ''} disabled={list.length === 0 || session.status !== 'idle' || start.locked}
      onChange={event => {setChoice(event.currentTarget.value);}}>
      {list.length === 0 && <option value="">No saved presets</option>}
      {list.map(preset => <option key={preset.presetId} value={preset.presetId}>{preset.name}</option>)}
    </select>
    <div className="music-capture-actions">
      <button type="button" disabled={startReason !== undefined} onClick={() => {
        const bound = startCapture(capture.state, captureLive);
        if (startBlocked(controls) !== undefined || bound === undefined || chosen === undefined) return;
        void start.run({family: 'music-lighting-control', target: record.id, requestId: crypto.randomUUID(),
          data: {action: 'start', expectedRevision: record.revision, capture: bound, presetId: chosen}});
      }}>Start Music lighting</button>
      <button type="button" disabled={stopReason !== undefined} onClick={() => {
        if (stopBlocked(controls) !== undefined) return;
        void stop.run({family: 'music-lighting-control', target: record.id, requestId: crypto.randomUUID(), data: {action: 'stop', expectedRevision: record.revision}});
      }}>Stop Music lighting</button>
    </div>
    {session.status === 'idle' ? startReason !== undefined && <p className="music-note">Start unavailable: {startReason}</p>
      : stopReason !== undefined && <p className="music-note">Stop unavailable: {stopReason}</p>}
    {start.requestId !== undefined && <p role="status">Start request: {controlText(start.text)}</p>}
    {startWork !== undefined && <p role="status">Start light work: {workText(operationView(startWork).text)}</p>}
    {stop.requestId !== undefined && <p role="status">Stop request: {controlText(stop.text)}</p>}
    {stopWork !== undefined && <p role="status">Stop light work: {workText(operationView(stopWork).text)}</p>}
  </section>;
}

/** Per-light Music lighting status and explicit Start/Stop. Opening, reloading or reconnecting only reads. */
export function MusicLightingCard({connection, connected, coreLive, control, operations, operationsLive, capture, captureLive, devices, presetPage}: {
  connection: DashboardConnection; connected: boolean; coreLive: boolean; control: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  capture: MusicCaptureView; captureLive: boolean; devices: readonly DeviceRecord[]; presetPage: boolean;
}): React.JSX.Element {
  const [scope, setScope] = useState<MusicLightingFeed | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setScope(undefined);
    if (!connected || !coreLive) return;
    let current: MusicLightingFeed;
    try {current = connection.openMusicLighting(followReactivePresets);} catch {return;}
    setScope(current); void current.refresh();
    return () => {void current.close();};
  }, [connection, connected, coreLive]);
  const current = useSyncExternalStore(scope?.subscribe ?? emptySubscribe, scope?.getSnapshot ?? emptySnapshot, emptySnapshot);
  // After a disconnect or a failed read, keep showing the last fresh records as last known, with every control disabled.
  const [kept, setKept] = useState<MusicLightingView>(empty);
  useEffect(() => {if (current.synced) setKept(current);}, [current]);
  const view = current.synced || current.records.length > 0 ? current
    : {...kept, synced: false, presets: current.presets.value !== undefined ? current.presets : {...kept.presets, live: false, pending: false}};
  const live = connected && coreLive && view.synced;
  const presets = view.presets;
  const refresh = async (): Promise<void> => {
    if (scope === undefined || refreshing) return;
    setRefreshing(true); try {await scope.refresh();} finally {setRefreshing(false);}
  };
  return <article className="music-capture-card music-lighting-card" aria-label="Music lighting">
    <h2>Music lighting</h2>
    <p className="music-note">Renders the active Music.app measurement on a light with a saved reactive preset. Start needs the light on, already in
      Free mode and showing a named scene; a light outside Free is refused, never switched. An alert, a manual change on the light or lost Music
      input ends the session, and nothing restarts automatically. The microphone is never used.</p>
    {!live && <p role="status">Lighting status is stale or unavailable. Controls are disabled until a fresh read.</p>}
    {live && view.records.length === 0 && <p>No qualified Nanoleaf light is configured for Music lighting.</p>}
    {presets.live && presets.value?.presets.length === 0 && <p className="music-note">No saved reactive presets yet. Save one in the{' '}
      {presetPage ? <a href="#/module/nanoleaf/wall">Music effect preview</a> : 'Music effect preview'} on the Wall page; Start stays disabled until then.</p>}
    {!presets.live && view.records.length > 0 && <p className="music-note">{presets.failed ? 'The saved preset library is unavailable.' : 'The saved preset library is stale or still loading.'}</p>}
    {view.records.map(record => <LightingTarget key={record.id} record={record} live={live} control={control} operations={operations} operationsLive={operationsLive}
      device={devices.find(device => device.id === record.id)} capture={capture} captureLive={captureLive} presets={presets}/>)}
    <button type="button" className="secondary" disabled={!connected || !coreLive || scope === undefined || refreshing} onClick={() => {void refresh();}}>Refresh lighting status</button>
  </article>;
}
