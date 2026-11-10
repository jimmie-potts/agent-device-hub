/**
 * One read-only Music capture scope per page connection, shared by every surface that shows it: the measurement card,
 * the visualizer panel, its full view and its Home card (#1619). A second concurrent sync for the same records would
 * slow both round trips, and a sync slower than the capture clock allows leaves measurements unqualified.
 */
import {useEffect, useState} from 'react';
import type {DashboardConnection} from './connection.ts';
import type {MusicCaptureFeed} from './music-capture-feed.ts';

type Scope = {refresh(): Promise<boolean>; close(): Promise<void>; readonly closed: boolean; getSnapshot(): {synced: boolean}};
type Opener<S extends Scope> = {openMusicCapture(): S};
type Entry = {scope: Scope; users: number; syncing: boolean; closing: ReturnType<typeof setTimeout> | undefined};
const shared = new WeakMap<object, Entry>();

/** Syncs the shared view unless a sync is already in flight, so surfaces never race each other's clock check. */
function sync(entry: Entry): void {
  if (entry.syncing) return;
  entry.syncing = true;
  const done = (): void => {entry.syncing = false;};
  void entry.scope.refresh().then(done, done);
}

/**
 * The connection's shared scope; undefined while capture status is unavailable. The first user opens and syncs it. A
 * scope the connection has already closed is replaced, and a later user resyncs a view that is not synced, as each
 * measurement-card mount did before the scope was shared.
 */
export function acquireMusicCapture<S extends Scope>(connection: Opener<S>): S | undefined {
  let entry = shared.get(connection);
  if (entry === undefined || entry.scope.closed) {
    let scope: S;
    try {scope = connection.openMusicCapture();} catch {return undefined;}
    entry = {scope, users: 0, syncing: false, closing: undefined}; shared.set(connection, entry);
    sync(entry);
  } else {
    clearTimeout(entry.closing); entry.closing = undefined;
    if (!entry.scope.getSnapshot().synced) sync(entry);
  }
  entry.users += 1;
  return entry.scope as S;
}

/**
 * The last user's release closes the scope once the page has settled, so in-page navigation that unmounts one surface
 * and mounts another in the same commit keeps the synced scope. Releasing a replaced scope does nothing.
 */
export function releaseMusicCapture<S extends Scope>(connection: Opener<S>, scope: S): void {
  const entry = shared.get(connection);
  if (entry?.scope !== scope) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  entry.closing = setTimeout(() => {
    if (shared.get(connection) !== entry || entry.users > 0) return;
    shared.delete(connection); void scope.close();
  }, 0);
}

/** The shared scope while the page is connected and the core is running. */
export function useMusicCapture(connection: DashboardConnection, connected: boolean, coreLive: boolean): MusicCaptureFeed | undefined {
  const [scope, setScope] = useState<MusicCaptureFeed | undefined>();
  useEffect(() => {
    setScope(undefined);
    if (!connected || !coreLive) return;
    const current = acquireMusicCapture(connection);
    if (current === undefined) return;
    setScope(current);
    return () => {releaseMusicCapture(connection, current);};
  }, [connection, connected, coreLive]);
  return scope;
}
