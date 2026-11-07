import {useEffect, useMemo, useRef, useState} from 'react';
import type {ArtRecord, ArtSelection, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
import type {CopyRead, Scheduler, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {CATALOG_PAGE_SIZE, catalogOf, latestBrowserArt, selectedBrowserArtwork, type CatalogPage} from './model.js';

/** What one art copy reports to its page. */
export type ArtFeed = {record: (value: ArtRecord | undefined) => void; live: (value: boolean) => void; error: (value: string | undefined) => void};
/** One art copy on the shell participant. A refused read leaves the record unavailable and its controls read-only. */
export function followArt(read: CopyRead<ArtRecord>, feed: ArtFeed, _scheduler?: Scheduler): () => void {
  let disposed = false, copy: SyncedCopy<ArtRecord> | undefined;
  const failed = (): void => {if (!disposed) {feed.live(false);feed.error('Art records are unavailable.');}};
  void read(change => {
    if (disposed) return;
    if (change.type === 'updated') feed.record(change.message.data);
    else if (change.type === 'removed') feed.record(undefined);
    else if (change.type === 'synced') feed.live(true);
    else failed();
  }, {onRestarted: () => {if (!disposed) feed.live(false);}}).then(result => {
    if (result.status !== 'synced') {failed();return;}
    if (disposed) {void result.copy.close();return;}
    copy = result.copy;
    feed.record(copy.states().find(message => message.data.id === 'art')?.data);
    feed.live(true);
  }).catch(failed);
  return () => {disposed = true;void copy?.close();};
}

export function useArt(api: FrontendApi, connected: boolean) {
  const [state, setState] = useState<ArtRecord>(), [live, setLive] = useState(false), [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLive(false); setError(undefined);
    if (!connected) return;
    return followArt((changed, options) => api.sync<ArtRecord>(['art'], changed, options), {record: setState, live: setLive, error: setError});
  }, [api, connected, attempt]);
  return {state, live: connected && live, error, refresh: () => {setAttempt(value => value + 1);}};
}

type WidgetArtwork = {status: 'ready'; artwork: ArtworkSummary | undefined} | {status: 'loading' | 'unavailable'};
export function useWidgetArtwork(api: FrontendApi, state: ArtRecord | undefined, live: boolean): WidgetArtwork {
  const selection = state !== undefined && 'selection' in state ? state.selection : null;
  const artworkId = selection?.artworkId, compositionId = selection?.compositionId;
  const listed = state?.artworks.find(artwork => artwork.artworkId === artworkId), missing = listed === undefined;
  // A new lookup identity also invalidates a response from before disconnection or an intervening selection.
  const lookup = useMemo(() => live && missing && artworkId !== undefined && compositionId !== undefined ? {artworkId, compositionId} : undefined,
    [live, missing, artworkId, compositionId]);
  const [loaded, setLoaded] = useState<{lookup: ArtSelection; result: WidgetArtwork}>();
  useEffect(() => {
    if (lookup === undefined) return;
    let disposed = false;
    void api.read(`/modules/art/content/artwork.${lookup.artworkId}`).then(value => {
      const artwork = selectedBrowserArtwork(value, lookup);
      if (!disposed) setLoaded({lookup, result: artwork === undefined ? {status: 'unavailable'} : {status: 'ready', artwork}});
    }).catch(() => {if (!disposed) setLoaded({lookup, result: {status: 'unavailable'}});});
    return () => {disposed = true;};
  }, [api, lookup]);
  if (selection === null) return {status: 'ready', artwork: latestBrowserArt(state?.artworks ?? [])};
  if (listed !== undefined) {
    const artwork = selectedBrowserArtwork(listed, selection);
    return artwork === undefined ? {status: 'unavailable'} : {status: 'ready', artwork};
  }
  return lookup !== undefined && loaded?.lookup === lookup ? loaded.result : {status: 'loading'};
}

export function useGalleryPage(api: FrontendApi, live: boolean, after: number, catalogRevision: string) {
  const [page, setPage] = useState<CatalogPage>(), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0), previousAfter = useRef(after);
  useEffect(() => {
    let disposed = false;
    if (previousAfter.current !== after) {setPage(undefined);previousAfter.current = after;}
    setLoading(live);setError(false);
    if (!live) return;
    void api.read(`/modules/art/content/catalog?after=${after}&limit=${CATALOG_PAGE_SIZE}`).then(value => {
      const next = catalogOf(value);
      if (!disposed) {setPage(next);setLoading(false);}
    }).catch(() => {if (!disposed) {setError(true);setLoading(false);}});
    return () => {disposed = true;};
  }, [api, live, after, catalogRevision, attempt]);
  return {page, loading, error, refresh: () => {setAttempt(value => value + 1);}};
}
