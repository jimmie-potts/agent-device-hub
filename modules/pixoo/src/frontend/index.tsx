// Module-owned playlist editing through the shared browser context (Hub #932).
import React, {useEffect, useId, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendApi, FrontendCommand, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {PlaylistRecord} from '../module/schemas.js';

type Record = DeviceRecord | PlaylistRecord;
type Catalog = {live: boolean; device: DeviceRecord | undefined; playlists: readonly PlaylistRecord[]; error: string | undefined};
type Draft = {id: string; revision: number; name: string};

/** This small first view follows the owner directly; full catalog pagination is a later slice. */
function useCatalog(api: FrontendApi): Catalog {
  const [catalog, setCatalog] = useState<Catalog>({live: false, device: undefined, playlists: [], error: undefined});
  useEffect(() => {
    let disposed = false;
    let copy: SyncedCopy<Record> | undefined;
    const records = new Map<string, Record>();
    const show = (live: boolean, error?: string): void => {
      if (disposed) return;
      const values = [...records.values()];
      setCatalog({
        live, error,
        device: values.find((value): value is DeviceRecord => 'kind' in value && value.kind === 'pixoo'),
        playlists: values.filter((value): value is PlaylistRecord => 'playlistRevision' in value)
          .sort((a, b) => {
            const order = a.name.localeCompare(b.name);
            return order === 0 ? a.id.localeCompare(b.id) : order;
          }),
      });
    };
    let live = false;
    const changed = (change: SyncChange<Record>): void => {
      if (disposed) return;
      switch (change.type) {
        case 'updated':
          records.set(`${change.entity.family}/${change.entity.id}`, change.message.data);
          show(live);
          break;
        case 'removed':
          records.delete(`${change.entity.family}/${change.entity.id}`);
          show(live);
          break;
        case 'synced':
          live = true;
          show(true);
          break;
        case 'failed':
          live = false;
          show(false, change.error.error.code);
          break;
      }
    };
    void api.sync<Record>(['device', 'pixoo-playlist'], changed).then(result => {
      if (result.status === 'rejected') { show(false, result.error.error.code); return; }
      if (disposed) { void result.copy.close(); return; }
      copy = result.copy;
      records.clear();
      for (const state of copy.states()) {
        const family = 'playlistRevision' in state.data ? 'pixoo-playlist' : 'device';
        records.set(`${family}/${state.data.id}`, state.data);
      }
      live = true;
      show(true);
    }).catch(() => { show(false, 'unavailable'); });
    return () => { disposed = true; void copy?.close(); };
  }, [api]);
  return catalog;
}

const nameValid = (name: string): boolean => name.length > 0 && name.length <= 120
  && Array.from(name).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);

function Rename({context, catalog, playlist, draft, change, reload, command}: {
  context: FrontendContext; catalog: Catalog; playlist: PlaylistRecord; draft: Draft;
  change: (name: string) => void; reload: () => void; command: FrontendCommand;
}): React.JSX.Element {
  const id = useId();
  const submitting = useRef(false);
  const [failure, setFailure] = useState<string>();
  const name = draft.name.trim();
  const stale = draft.revision !== playlist.playlistRevision;
  const blocked = !context.control ? 'Read-only access.'
    : !context.connected || !catalog.live || catalog.device === undefined ? 'Playlist records are stale.'
    : !context.operationsLive ? 'Command records are stale.'
    : command.locked ? 'Wait for the current command result.'
    : stale ? 'The saved playlist changed. Load its saved name before editing again.'
    : !nameValid(name) ? 'Use a name of 1 to 120 characters without control characters.'
    : name === playlist.name ? 'The name is unchanged.' : undefined;
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const device = catalog.device;
    if (blocked !== undefined || submitting.current || device === undefined) return;
    submitting.current = true;
    setFailure(undefined);
    void command.run({
      family: 'pixoo-playlist-change', target: device.id, requestId: crypto.randomUUID(),
      data: {change: {operation: 'rename', playlistId: draft.id, revision: draft.revision, name}},
    }).catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  return <>
    {context.control ? <form onSubmit={submit}>
      <label htmlFor={id}>Playlist name</label>
      <input id={id} value={draft.name} maxLength={120} onChange={event => { change(event.target.value); }}
        disabled={!context.connected || !catalog.live || command.locked} autoComplete="off"/>
      <div className="actions">
        <button type="submit" disabled={blocked !== undefined}>Save name</button>
        <button type="button" className="secondary" onClick={reload} disabled={command.locked}>Load saved name</button>
      </div>
      {blocked !== undefined && <p className="hint">{blocked}</p>}
    </form> : <p className="hint">Read-only access.</p>}
    <p role="status">{failure ?? command.text}</p>
  </>;
}

function Playlists({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api);
  const [draft, setDraft] = useState<Draft>();
  const {Badge, Facts, Select, Command} = context.ui;
  const playlist = catalog.playlists.find(value => value.id === draft?.id);
  const select = (id: string): void => {
    const saved = catalog.playlists.find(value => value.id === id);
    setDraft(saved === undefined ? undefined : {id: saved.id, revision: saved.playlistRevision, name: saved.name});
  };
  return <section className="widget" aria-label="Pixoo playlists">
    <header className="widget-head"><h2>Playlists</h2><Badge warning={!catalog.live}>{catalog.live ? 'Current' : 'Stale'}</Badge></header>
    <p className="hint">Choose a saved playlist. Editing its name does not start playback.</p>
    {catalog.error !== undefined && <p role="status" className="warning">Playlists unavailable ({catalog.error}).</p>}
    {catalog.live && catalog.playlists.length === 0 && <p>No saved playlists.</p>}
    <Select label="Playlist" value={draft?.id ?? ''} onChange={select}
      options={[{value: '', label: 'Choose…'}, ...catalog.playlists.map(value => ({value: value.id, label: value.name}))]}/>
    {draft !== undefined && playlist === undefined && <p role="status">The selected playlist is no longer saved.</p>}
    {playlist !== undefined && draft !== undefined && <>
      <Facts items={[
        ['Saved name', playlist.name], ['Saved revision', playlist.playlistRevision], ['Items', playlist.items.length],
        ['Playback', `${playlist.repeat ? 'Repeats' : 'Once'} · ${playlist.shuffle ? 'Shuffle' : 'Saved order'}`],
      ]}/>
      {catalog.device === undefined ? <p role="status">The Pixoo owner has no device record.</p>
        : <Command context={context} target={catalog.device.id} key={catalog.device.id}>{command =>
          <Rename context={context} catalog={catalog} playlist={playlist} draft={draft} command={command}
            change={name => { setDraft({...draft, name}); }} reload={() => { select(playlist.id); }}/>
        }</Command>}
    </>}
  </section>;
}

export const frontend: FrontendContribution = {module: 'pixoo', pages: [{id: 'playlists', Component: Playlists}]};
