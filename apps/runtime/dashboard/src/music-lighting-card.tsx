import React, {useEffect, useId, useState, useSyncExternalStore} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import {followShows, type ShowCatalogView} from '@jimmie-potts/nanoleaf/frontend';
import {followReactivePresets} from '@jimmie-potts/nanoleaf/reactive-presets';
import type {ReactiveCatalogView} from '@jimmie-potts/nanoleaf/reactive-presets';
import {useAttempt} from './command-control.tsx';
import type {DashboardConnection} from './connection.ts';
import {operationView} from './devices.ts';
import type {MusicCaptureView} from './music-capture-feed.ts';
import {emptyLightingView, NANOLEAF_OWNER, type MusicLightingFeed, type MusicLightingView} from './music-lighting-feed.ts';
import {baseText, controlText, endingText, lightBase, lightingWorkId, savedShowBaseText, savedStartBlocked, sessionBaseText, sessionText, startBlocked, startCapture, stopBlocked, workText,
  type LightBase} from './music-lighting-model.ts';

const emptySubscribe = (): (() => void) => () => {};
const emptySnapshot = (): MusicLightingView => emptyLightingView;
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

function LightingTarget({record, device, base, baseLive, live, control, operations, operationsLive, capture, captureLive, presets, shows}: {
  record: LightingState; device: DeviceRecord | undefined; base: LightBase | undefined; baseLive: boolean; live: boolean; control: boolean;
  operations: readonly OperationRecord[]; operationsLive: boolean; capture: MusicCaptureView; captureLive: boolean; presets: ReactiveCatalogView; shows: ShowCatalogView;
}): React.JSX.Element {
  const label = device?.label ?? record.id;
  const selected = operations.filter(operation => operation.family === 'music-lighting-control' && operation.target === record.id);
  const start = useAttempt(record.id, selected, operationsLive, undefined, `core/music-lighting/start/${record.id}`);
  const stop = useAttempt(record.id, selected, operationsLive, undefined, `core/music-lighting/stop/${record.id}`);
  const startWork = useWork(record.id, start.requestId, operations), stopWork = useWork(record.id, stop.requestId, operations);
  const [choice, setChoice] = useState<string>();
  const presetId = useId();
  const [showChoice, setShowChoice] = useState('');
  const showId = useId();
  const versions = (shows.value?.shows ?? []).flatMap(show => show.versions.map(version => ({
    key: `${show.id}:${String(version.version)}`, showId: show.id, version: version.version,
    label: `${show.name} · v${String(version.version)} · ${version.versionName}${version.kind === 'measured' ? ' · Measured excerpt' : ''}`,
  })));
  const saved = versions.find(version => version.key === showChoice);
  const list = presets.value?.presets ?? [];
  const chosen = list.some(preset => preset.presetId === choice) ? choice : list[0]?.presetId;
  const controls = {record, recordsLive: live, control, operationsLive, capture: capture.state, captureLive, presets, presetId: chosen,
    startLocked: start.locked, stopLocked: stop.locked};
  const startReason = startBlocked(controls), stopReason = stopBlocked(controls);
  const session = record.session;
  const activePreset = 'presetId' in session ? session.presetId : undefined;
  const inUse = list.find(preset => preset.presetId === activePreset)?.name;
  const mode = device?.desired.mode;
  const modeBlocked = mode?.status === 'known' && mode.value !== 'free';
  const pending = selected.some(operation => operation.status === 'sent' || operation.status === 'accepted');
  const savedControls = {...controls, startLocked: start.locked || pending};
  const savedReason = savedStartBlocked(savedControls, shows, saved !== undefined, modeBlocked);
  // What an ending puts back (#1614), from the light module's own record: the session's base when it names this
  // generation, otherwise the light's last read selection before a Start.
  const sessionBase = session.status !== 'idle' && base?.musicBase?.generation === session.generation ? base.musicBase.restores : undefined;
  const endedBase = record.last !== null && base?.musicBase?.generation === record.last.generation ? base.musicBase.restores : undefined;
  // A selection read before an ending that put the base back, or may have, is no longer on the light: the general
  // explanation stands until a later read.
  const read = base?.selection ?? null;
  const restored = record.last !== null && (record.last.restoration === 'restored' || record.last.restoration === 'uncertain');
  const fresh = read !== null && !(restored && record.last !== null && read.readAtMs <= record.last.atMs) ? read : null;
  const stale = baseLive ? '' : 'Last known: ';
  return <section className="music-lighting-target" aria-label={`${label} Music lighting`}>
    <h3>{label}</h3>
    <div role="status">
      <p>{live ? sessionText(session) : `Last known: ${sessionText(session)}`}</p>
      {session.status !== 'idle' && ('show' in session
        ? <p>Saved show {session.show.showId}, version {session.show.version}. Missed cues: {session.show.missedCues}.</p>
        : <p>Preset: {inUse ?? `${session.presetId} (not in the current library snapshot)`}. Started at {time(session.startedAtMs)}.</p>)}
      {sessionBase !== undefined && <p>{stale}{'show' in session ? savedShowBaseText(sessionBase) : sessionBaseText(sessionBase)}</p>}
      {record.last !== null && <p>{endingText(record.last, endedBase)} Ended at {time(record.last.atMs)}.</p>}
    </div>
    {modeBlocked && <p className="music-note">This light&apos;s saved mode is not Free, so a Start would be refused. Starting never switches the mode; choose Free first.</p>}
    <h4>Live Music.app lighting</h4>
    {session.status === 'idle' && base !== undefined && <p className="music-note">{stale}{baseText(fresh, fresh === null ? '' : time(fresh.readAtMs))}</p>}
    <label htmlFor={presetId}>Saved reactive preset</label>
    <select id={presetId} value={chosen ?? ''} disabled={list.length === 0 || session.status !== 'idle' || start.locked}
      onChange={event => {setChoice(event.currentTarget.value);}}>
      {list.length === 0 && <option value="">{presets.live ? 'No saved presets' : presets.failed ? 'Preset library unavailable' : 'Loading saved presets'}</option>}
      {list.map(preset => <option key={preset.presetId} value={preset.presetId}>{preset.name}</option>)}
    </select>
    <div className="music-capture-actions">
      <button type="button" disabled={startReason !== undefined} onClick={() => {
        const bound = startCapture(capture.state, captureLive);
        if (startBlocked(controls) !== undefined || bound === undefined || chosen === undefined) return;
        void start.run({family: 'music-lighting-control', target: record.id, requestId: crypto.randomUUID(),
          data: {action: 'start', expectedRevision: record.revision, capture: bound, presetId: chosen}});
      }}>Start Music lighting</button>
    </div>
    {session.status === 'idle' && startReason !== undefined && <p className="music-note">Start unavailable: {startReason}</p>}
    <h4>Saved show</h4>
    <label htmlFor={showId}>Saved show and version</label>
    <select id={showId} value={saved?.key ?? ''} disabled={!shows.live || versions.length === 0 || session.status !== 'idle' || start.locked || stop.locked}
      onChange={event => {setShowChoice(event.currentTarget.value);}}>
      <option value="">{versions.length === 0 && shows.live ? 'No saved versions' : 'Choose a saved version'}</option>
      {versions.map(version => <option key={version.key} value={version.key}>{version.label}</option>)}
    </select>
    <div className="music-capture-actions">
      <button type="button" disabled={savedReason !== undefined} onClick={() => {
        if (savedStartBlocked(savedControls, shows, saved !== undefined, modeBlocked) !== undefined || saved === undefined) return;
        void start.run({family: 'music-lighting-control', target: record.id, requestId: crypto.randomUUID(), data: {
          action: 'start-show', expectedRevision: record.revision, showId: saved.showId, version: saved.version, positionMs: 0, startDelayMs: 0,
        }});
      }}>Start saved show</button>
    </div>
    {session.status === 'idle' && savedReason !== undefined && <p className="music-note">{savedReason}</p>}
    <div className="music-capture-actions">
      <button type="button" disabled={stopReason !== undefined} onClick={() => {
        if (stopBlocked(controls) !== undefined) return;
        void stop.run({family: 'music-lighting-control', target: record.id, requestId: crypto.randomUUID(), data: {action: 'stop', expectedRevision: record.revision, ...('show' in session ? {generation: session.generation} : {})}});
      }}>Stop Music lighting</button>
    </div>
    {session.status !== 'idle' && stopReason !== undefined && <p className="music-note">Stop unavailable: {stopReason}</p>}
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
    try {current = connection.openMusicLighting(followReactivePresets, followShows);} catch {return;}
    setScope(current); void current.refresh();
    return () => {void current.close();};
  }, [connection, connected, coreLive]);
  const current = useSyncExternalStore(scope?.subscribe ?? emptySubscribe, scope?.getSnapshot ?? emptySnapshot, emptySnapshot);
  // Each light's selection and session base come from the shell's existing `nanoleaf-wall` copy: no read of its own.
  const shell = useSyncExternalStore(connection.subscribe, connection.getState, connection.getState);
  const walls = shell.runtime.copies.find(copy => copy.owner === NANOLEAF_OWNER && copy.family === 'nanoleaf-wall');
  // After a disconnect or a failed read, keep showing the last fresh records as last known, with every control disabled.
  const [kept, setKept] = useState<MusicLightingView>(emptyLightingView);
  useEffect(() => {if (current.synced) setKept(current);}, [current]);
  const view = current.synced || current.records.length > 0 ? current
    : {...kept, synced: false, presets: current.presets.value !== undefined ? current.presets : {...kept.presets, live: false, pending: false}};
  const live = connected && coreLive && view.synced;
  const presets = view.presets;
  const shows = current.shows;
  const refresh = async (): Promise<void> => {
    if (scope === undefined || refreshing) return;
    setRefreshing(true); try {await scope.refresh();} finally {setRefreshing(false);}
  };
  return <article className="music-capture-card music-lighting-card" aria-label="Music lighting">
    <h2>Music lighting</h2>
    <p className="music-note">Both starts require the light on and in Free mode. Live lighting follows Music.app measurement and ends if that input is lost.
      Decorative shows start at the beginning. Measured excerpts follow the matching Mac Music item from its current position. Nothing restarts automatically after a session ends.</p>
    {!live && <p role="status">Lighting status is stale or unavailable. Controls are disabled until a fresh read.</p>}
    {live && view.records.length === 0 && <p>No qualified Nanoleaf light is configured for Music lighting.</p>}
    {presets.live && presets.value?.presets.length === 0 && <p className="music-note">No saved reactive presets yet. Save one in the{' '}
      {presetPage ? <a href="#/module/nanoleaf/wall">Music effect preview</a> : 'Music effect preview'} on the Wall page to enable live Music.app lighting.</p>}
    {!presets.live && view.records.length > 0 && <p className="music-note">{presets.failed ? 'The saved preset library is unavailable.' : 'The saved preset library is stale or still loading.'}</p>}
    {view.records.map(record => <LightingTarget key={record.id} record={record} live={live} control={control} operations={operations} operationsLive={operationsLive}
      device={devices.find(device => device.id === record.id)} capture={capture} captureLive={captureLive} presets={presets} shows={shows}
      base={lightBase(walls?.records.find(wall => wall.id === record.id))} baseLive={connected && walls?.synced === true}/>)}
    <button type="button" className="secondary" disabled={!connected || !coreLive || scope === undefined || refreshing} onClick={() => {void refresh();}}>Refresh lighting status</button>
  </article>;
}
