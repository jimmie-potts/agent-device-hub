// Module-owned Library and Playlists pages through the shared browser context (Hub #932).
import React, {useEffect, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendApi, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {DisplayRecord, PlaylistRecord} from '../module/schemas.js';
import {LibraryPage} from './library.js';
import {PlaylistsPage} from './playlists.js';
import {PlayerPage} from './player.js';

type Record = DeviceRecord | PlaylistRecord | DisplayRecord;
type Catalog = {live: boolean; device: DeviceRecord | undefined; display: DisplayRecord | undefined; playlists: readonly PlaylistRecord[]; error: string | undefined};

/** Follow owned device and playlist facts on the shell participant; media reads use bounded content pages. */
function useCatalog(api: FrontendApi, includePlaylists = true, includeDisplay = false): Catalog {
  const [catalog, setCatalog] = useState<Catalog>({live: false, device: undefined, display: undefined, playlists: [], error: undefined});
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
    }).catch(() => { show(false, 'unavailable'); });
    return () => { disposed = true; void copy?.close(); };
  }, [api, includePlaylists, includeDisplay]);
  return catalog;
}

function Playlists({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api);
  return <PlaylistsPage context={context} device={catalog.device} live={catalog.live} playlists={catalog.playlists}/>;
}

function Library({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, false);
  return <LibraryPage context={context} device={catalog.device} live={catalog.live}/>;
}

function Player({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api, true, true);
  return <PlayerPage context={context} device={catalog.device} display={catalog.display} live={catalog.live} playlists={catalog.playlists}/>;
}

export const frontend: FrontendContribution = {module: 'pixoo', pages: [
  {id: 'library', Component: Library}, {id: 'playlists', Component: Playlists}, {id: 'player', Component: Player},
]};
