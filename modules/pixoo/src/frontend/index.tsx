// Module-owned Library and Playlists pages through the shared browser context (Hub #932).
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendApi, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {DisplayRecord, PlaylistRecord} from '../module/schemas.js';
import {LibraryPage} from './library.js';
import {PlaylistsPage} from './playlists.js';
import {PlayerPage} from './player.js';
import {SettingsPage} from './settings.js';
import {MonitorPage} from './monitor.js';

type Record = DeviceRecord | PlaylistRecord | DisplayRecord;
const object = (value: unknown): value is {body: unknown} => typeof value === 'object' && value !== null && 'body' in value;
const codeOf = (error: unknown): string => object(error) && typeof error.body === 'object' && error.body !== null && 'error' in error.body
  && typeof error.body.error === 'object' && error.body.error !== null && 'code' in error.body.error && typeof error.body.error.code === 'string'
  ? error.body.error.code : 'unavailable';
type Catalog = {live: boolean; device: DeviceRecord | undefined; display: DisplayRecord | undefined; playlists: readonly PlaylistRecord[]; error: string | undefined; pending: boolean; retry: () => void};

/** Follow owned device and playlist facts on the shell participant; media reads use bounded content pages. */
function useCatalog(api: FrontendApi, includePlaylists = true, includeDisplay = false): Catalog {
  const [catalog, setCatalog] = useState<Omit<Catalog, 'retry'>>({live: false, device: undefined, display: undefined, playlists: [], error: undefined, pending: true});
  const [attempt, setAttempt] = useState(0);
  const kept = useRef(new Map<string, Record>());
  useEffect(() => {
    let disposed = false;
    let copy: SyncedCopy<Record> | undefined;
    const records = kept.current;
    setCatalog(previous => ({...previous, live: false, pending: true, error: undefined}));
    const show = (live: boolean, error?: string): void => {
      if (disposed) return;
      const values = [...records.values()];
      setCatalog({
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
    void api.sync<Record>(['device', ...includePlaylists ? ['pixoo-playlist'] : [], ...includeDisplay ? ['pixoo-display'] : []], changed).then(result => {
      if (result.status === 'rejected') { show(false, result.error.error.code); return; }
      if (disposed) { void result.copy.close(); return; }
      copy = result.copy;
      records.clear();
      for (const state of copy.states()) {
        const family = 'playlistRevision' in state.data ? 'pixoo-playlist' : 'monitor' in state.data ? 'pixoo-display' : 'device';
        records.set(`${family}/${state.data.id}`, state.data);
      }
      live = true;
      show(true);
    }).catch((error: unknown) => {
      show(false, codeOf(error));
    });
    return () => { disposed = true; void copy?.close(); };
  }, [api, includePlaylists, includeDisplay, attempt]);
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
  const catalog = useCatalog(context.api);
  return <><CatalogStatus catalog={catalog}/><PlaylistsPage context={context} device={catalog.device} live={catalog.live} playlists={catalog.playlists}/></>;
}

function Library({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false);
  return <><CatalogStatus catalog={catalog}/><LibraryPage context={context} device={catalog.device} live={catalog.live}/></>;
}

function Player({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, true, true);
  return <><CatalogStatus catalog={catalog}/><PlayerPage context={context} device={catalog.device} display={catalog.display} live={catalog.live} playlists={catalog.playlists}/></>;
}

function Settings({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false);
  return <><CatalogStatus catalog={catalog}/><SettingsPage context={context} device={catalog.device} live={catalog.live}/></>;
}

function Monitor({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false, true);
  return <><CatalogStatus catalog={catalog}/><MonitorPage context={context} device={catalog.device} display={catalog.display} live={catalog.live}/></>;
}

export const frontend: FrontendContribution = {module: 'pixoo', pages: [
  {id: 'library', Component: Library}, {id: 'playlists', Component: Playlists}, {id: 'player', Component: Player},
  {id: 'settings', Component: Settings},
  {id: 'monitor', Component: Monitor},
]};
