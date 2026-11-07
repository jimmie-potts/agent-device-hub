// Module-owned Library and Playlists pages through the shared browser context (Hub #932).
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendApi, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {followCopy, type CopyRead, type Scheduler} from '@jimmie-potts/sdk/remote';
import type {DisplayRecord, PlaylistRecord} from '../module/schemas.js';
import {LibraryPage} from './library.js';
import {PlaylistsPage} from './playlists.js';
import {PlayerPage} from './player.js';
import {SettingsPage} from './settings.js';
import {MonitorPage} from './monitor.js';
import {PixooCard} from './display-card.js';
export {MediaPicker} from './media-picker.js';
export {PlaylistEditor} from './playlist-editor.js';

type Record = DeviceRecord | PlaylistRecord | DisplayRecord;
type Catalog = {live: boolean; device: DeviceRecord | undefined; display: DisplayRecord | undefined; playlists: readonly PlaylistRecord[]; error: string | undefined; pending: boolean; retry: () => void};

type CatalogRecords = Omit<Catalog, 'retry'>;
/**
 * One catalog copy over the kept records, which stay marked stale with the refusal's code. A refusal that may clear is
 * read again with the shared backoff; any other waits for Retry Pixoo records or a reconnect. Only reads repeat.
 */
export function followPixooCatalog(read: CopyRead<Record>, records: Map<string, Record>, emit: (catalog: CatalogRecords) => void, scheduler?: Scheduler): () => void {
  let live = false;
  const show = (error?: string): void => {
    const values = [...records.values()];
    emit({
      live, error, pending: false,
      device: values.find((value): value is DeviceRecord => 'kind' in value && value.kind === 'pixoo'),
      display: values.find((value): value is DisplayRecord => 'monitor' in value && 'nowPlaying' in value),
      playlists: values.filter((value): value is PlaylistRecord => 'playlistRevision' in value)
        .sort((a, b) => {
          const order = a.name.localeCompare(b.name);
          return order === 0 ? a.id.localeCompare(b.id) : order;
        }),
    });
  };
  return followCopy<Record>(read, {
    changed: change => {
      switch (change.type) {
        case 'updated':
          records.set(`${change.entity.family}/${change.entity.id}`, change.message.data);
          show();
          break;
        case 'removed':
          records.delete(`${change.entity.family}/${change.entity.id}`);
          show();
          break;
        case 'synced':
          live = true;
          show();
          break;
      }
    },
    current: copy => {
      records.clear();
      for (const state of copy.states()) {
        const family = 'playlistRevision' in state.data ? 'pixoo-playlist' : 'monitor' in state.data ? 'pixoo-display' : 'device';
        records.set(`${family}/${state.data.id}`, state.data);
      }
      live = true;
      show();
    },
    refused: ({code}) => { live = false; show(code); },
  }, scheduler);
}

/** Follow owned device and playlist facts on the shell participant; media reads use bounded content pages. */
function useCatalog(api: FrontendApi, includePlaylists = true, includeDisplay = false, connected = true): Catalog {
  const [catalog, setCatalog] = useState<CatalogRecords>({live: false, device: undefined, display: undefined, playlists: [], error: undefined, pending: true});
  const [attempt, setAttempt] = useState(0);
  const kept = useRef(new Map<string, Record>());
  useEffect(() => {
    setCatalog(previous => ({...previous, live: false, pending: connected, error: undefined}));
    if (!connected) return;
    const families = ['device', ...includePlaylists ? ['pixoo-playlist'] : [], ...includeDisplay ? ['pixoo-display'] : []];
    return followPixooCatalog((changed, options) => api.sync<Record>(families, changed, options), kept.current, setCatalog);
  }, [api, includePlaylists, includeDisplay, attempt, connected]);
  return {...catalog, retry: () => { setAttempt(value => value + 1); }};
}

function CatalogStatus({catalog}: {catalog: Catalog}): React.JSX.Element | null {
  if (catalog.error === undefined) return null;
  return <div>
    <p role="alert">Pixoo records unavailable ({catalog.error}). Saved records remain stale until sync succeeds.</p>
    <button type="button" disabled={catalog.pending} onClick={catalog.retry}>Retry Pixoo records</button>
  </div>;
}

function Playlists({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, true, false, context.connected);
  return <><CatalogStatus catalog={catalog}/><PlaylistsPage context={context} device={catalog.device} live={catalog.live} playlists={catalog.playlists}/></>;
}

function Library({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false, false, context.connected);
  return <><CatalogStatus catalog={catalog}/><LibraryPage context={context} device={catalog.device} live={catalog.live}/></>;
}

function CatalogCard({context, catalog}: {context: FrontendContext; catalog: Catalog}): React.JSX.Element {
  const {Command} = context.ui;
  const device = catalog.device;
  return <><CatalogStatus catalog={catalog}/>{device === undefined ? <p role="status">Loading Pixoo device…</p>
    : <Command context={context} target={device.id} key={device.id}>{command =>
      <PixooCard context={context} device={device} display={catalog.display} live={catalog.live} playlists={catalog.playlists} command={command}/>
    }</Command>}</>;
}

export function PixooDisplay({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, true, true, context.connected);
  return <CatalogCard context={context} catalog={catalog}/>;
}

function Player({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, true, true, context.connected);
  const [advanced, setAdvanced] = useState(false);
  return <><CatalogCard context={context} catalog={catalog}/><details onToggle={event => { setAdvanced(event.currentTarget.open); }}><summary>Advanced player</summary>
    {advanced && <><CatalogStatus catalog={catalog}/><PlayerPage context={context} device={catalog.device} display={catalog.display} live={catalog.live} playlists={catalog.playlists}/></>}
  </details></>;
}

function Settings({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false, false, context.connected);
  return <><CatalogStatus catalog={catalog}/><SettingsPage context={context} device={catalog.device} live={catalog.live}/></>;
}

function Monitor({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false, true, context.connected);
  return <><CatalogStatus catalog={catalog}/><MonitorPage context={context} device={catalog.device} display={catalog.display} live={catalog.live}/></>;
}

export const frontend: FrontendContribution = {module: 'pixoo', pages: [
  {id: 'library', Component: Library}, {id: 'playlists', Component: Playlists}, {id: 'player', Component: Player},
  {id: 'settings', Component: Settings},
  {id: 'monitor', Component: Monitor},
]};
