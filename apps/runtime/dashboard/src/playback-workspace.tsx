import React, {useEffect, useState} from 'react';
import type {LightingLayoutRecord, OperationRecord, PlaybackLayoutRecord, PlaybackPlacement, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {PlaybackCard} from './device-controls.tsx';
import {playbackArtworkUrl} from './playback-artwork.ts';
import {useAttempt} from './command-control.tsx';
import type {DashboardConnection} from './connection.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';

/** Composition and saved placement share the shell participant; no playback owner or room routing is added. */
export function PlaybackWorkspace({runtime, connected, operations, operationsLive, connection, route}: {
  runtime: RuntimeData; connected: boolean; operations: readonly OperationRecord[]; operationsLive: boolean; connection: DashboardConnection; route: Route;
}): React.JSX.Element | null {
  const players = runtime.copies.filter(copy => copy.family === 'playback').flatMap(copy => (copy.records as readonly PlaybackState[]).map(record => ({record, copy})));
  const layoutCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'playback-layout');
  const layout = (layoutCopy?.records as readonly PlaybackLayoutRecord[] | undefined)?.find(record => record.id === 'playback');
  const roomsCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'lighting-layout');
  const roomLayout = (roomsCopy?.records as readonly LightingLayoutRecord[] | undefined)?.find(record => record.id === 'lighting');
  const rooms = roomLayout?.layout.rooms ?? [];
  const layoutAction = useAttempt('playback', operations.filter(operation => operation.family === 'playback-layout-set'), operationsLive, undefined, 'core/playback-layout');
  const [refreshedRequest, setRefreshedRequest] = useState<string | undefined>();
  const [uncertainRequest, setUncertainRequest] = useState<string | undefined>();
  useEffect(() => {
    if (/Uncertain|Previous request/.test(layoutAction.text)) setUncertainRequest(layoutAction.requestId);
  }, [layoutAction.text, layoutAction.requestId]);
  const failedSave = /Refused|Not sent|Expired|Completed: failed/.test(layoutAction.text);
  const needsRefresh = (failedSave || uncertainRequest !== undefined && uncertainRequest === layoutAction.requestId) && refreshedRequest !== layoutAction.requestId;
  const refreshPlacement = async (): Promise<void> => {await connection.refreshDevices(); setRefreshedRequest(layoutAction.requestId);};
  const [draft, setDraft] = useState<PlaybackPlacement[] | undefined>();
  useEffect(() => {setDraft(undefined);}, [layout?.revision]);
  const coreLive = runtime.modules?.some(module => module.name === 'core' && module.state === 'running') === true;
  const layoutLive = connected && coreLive && !runtime.catalogFailed && layoutCopy?.synced === true && layout !== undefined;
  const roomsLive = connected && coreLive && !runtime.catalogFailed && roomsCopy?.synced === true && roomLayout !== undefined;
  const unique = (id: string): boolean => players.filter(player => player.record.id === id).length === 1;
  const playerLive = ({record, copy}: (typeof players)[number]): boolean => connected && copy.synced && !runtime.catalogFailed && unique(record.id)
    && runtime.modules?.some(module => copy.owner === `bunny/modules/${module.name}` && module.state === 'running' && module.serves.includes('playback')) === true;
  const editable = runtime.control && layoutLive && roomsLive && operationsLive && !layoutAction.locked && !needsRefresh;
  const assignments = draft ?? layout?.assignments ?? [];
  const save = (): void => {
    if (!editable || layout === undefined || players.some(player => !playerLive(player))) return;
    // Drop removed room IDs only on an explicit save; never infer a new membership.
    const next = assignments.map(item => ({playback: item.playback, rooms: item.rooms.filter(id => rooms.some(room => room.id === id))}));
    void layoutAction.run({family: 'playback-layout-set', target: 'playback', requestId: crypto.randomUUID(), data: {expectedRevision: layout.revision, assignments: next}});
  };
  const card = (player: (typeof players)[number]): React.ReactNode => <PlaybackCard key={`${player.copy.owner}:${player.record.id}`} record={player.record}
    live={playerLive(player)} control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={() => {void connection.refreshDevices();}}
    artworkUrl={playbackArtworkUrl(player.record, player.copy.owner, playerLive(player), runtime.modules)}/>;
  if (route.kind === 'rooms') return <section className="music-workspace" aria-label="Room audio">
    <h2>Room audio</h2><p className="hint">Shared playback cards. Room placement does not select AirPlay output.</p>
    {!layoutLive || !roomsLive ? <p role="status">Room placement is unavailable or stale.</p> : rooms.map(room => {
      const selected = players.filter(player => unique(player.record.id) && layout?.assignments.some(item => item.playback === player.record.id && item.rooms.includes(room.id)) === true);
      return selected.length === 0 ? null : <section className="music-room" key={room.id} aria-label={`${room.name} audio`}><h3>{room.name}</h3><div className="music-grid">{selected.map(card)}</div></section>;
    })}
    {layoutLive && roomsLive && !rooms.some(room => players.some(player => layout?.assignments.some(item => item.playback === player.record.id && item.rooms.includes(room.id)) === true)) && <p className="hint">Choose room placement on the <a href="#/audio">Audio page</a>.</p>}
  </section>;
  if (route.kind !== 'home' && route.kind !== 'audio' && route.kind !== 'playback') return null;
  const selected = route.kind === 'playback' ? players.filter(player => player.record.id === route.sourceId) : players;
  return <section className="music-workspace" aria-label="Music">
    {route.kind === 'audio' ? <header className="page"><h1>Audio</h1></header> : route.kind === 'home' ? <h2>Music</h2> : null}
    {selected.length === 0 && <p className="hint">No playback records are available.</p>}
    <div className="music-grid">{selected.map(card)}</div>
    {route.kind === 'audio' && <details className="music-placement"><summary>Show in rooms</summary>
      <p className="hint">Place the shared Music card in any room. This does not select a speaker or change AirPlay output.</p>
      {rooms.length === 0 && <p>Create rooms on the Rooms page first.</p>}
      {players.map(player => <fieldset key={`${player.copy.owner}:${player.record.id}`} disabled={!editable || !playerLive(player)}><legend>{player.record.id}</legend>
        {rooms.map(room => <label key={room.id}><input type="checkbox" aria-label={`Show ${player.record.id} in ${room.name}`} checked={assignments.some(item => item.playback === player.record.id && item.rooms.includes(room.id))} onChange={event => {
          const previous = assignments.find(item => item.playback === player.record.id)?.rooms ?? [];
          const next = previous.filter(id => id !== room.id); if (event.target.checked) next.push(room.id);
          setDraft([...assignments.filter(item => item.playback !== player.record.id), {playback: player.record.id, rooms: next}]);
        }}/>{room.name}</label>)}
      </fieldset>)}
      <button type="button" disabled={!editable || draft === undefined || players.some(player => !playerLive(player))} onClick={save}>Save room placement</button>
      <p role="status">{!layoutLive || !roomsLive ? 'Placement records are unavailable or stale. Editing is read-only.' : layoutAction.text.replace('The module observed the result.', 'Room placement saved.')}</p>
      {needsRefresh && <p className="hint">Refresh to review the current placement before editing.</p>}
      <button type="button" className="secondary" onClick={() => {void refreshPlacement();}}>Refresh placement records</button>
    </details>}
  </section>;
}
