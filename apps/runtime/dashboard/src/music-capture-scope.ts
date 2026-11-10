/**
 * One read-only Music capture scope per page connection, shared by every surface that shows it: the measurement card,
 * the visualizer panel, its full view and its Home card (#1619). A second concurrent sync for the same records would
 * slow both round trips, and a sync slower than the capture clock allows leaves measurements unqualified.
 */
import {useEffect, useState} from 'react';
import type {DashboardConnection} from './connection.ts';
import type {MusicCaptureFeed} from './music-capture-feed.ts';

type Scope = {refresh(): Promise<boolean>; close(): Promise<void>};
type Opener<S extends Scope> = {openMusicCapture(): S};
const shared = new WeakMap<object, {scope: Scope; users: number}>();

/** The connection's shared scope, opened and synced by its first user; undefined while capture status is unavailable. */
export function acquireMusicCapture<S extends Scope>(connection: Opener<S>): S | undefined {
  let entry = shared.get(connection);
  if (entry === undefined) {
    let scope: S;
    try {scope = connection.openMusicCapture();} catch {return undefined;}
    entry = {scope, users: 0}; shared.set(connection, entry);
    void scope.refresh();
  }
  entry.users += 1;
  return entry.scope as S;
}

/** The last user's release closes the scope; a later user opens a fresh one. */
export function releaseMusicCapture<S extends Scope>(connection: Opener<S>, scope: S): void {
  const entry = shared.get(connection);
  if (entry?.scope !== scope) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  shared.delete(connection); void scope.close();
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
