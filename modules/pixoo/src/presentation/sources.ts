// What the Monitor and the Now Playing card read (Hub #843). The module fills them from its synced copies of the core's
// `session/2.0` records and the playback owner's `playback/2.0` record. The 1.x snapshot sources stayed in
// divoom-app-upgrade with its HTTP server.
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {NowPlayingView} from './now-playing.js';

/** The agent-state collector's states, as the Monitor's health mark draws them. */
export type Collector = 'running' | 'quiesced' | 'faulted' | 'closed';
/**
 * One session as the Monitor draws it: a `session/2.0` record with its display label as plain text. `ended` stays drawable
 * for the synthetic previews only: 2.0 removes a session when it ends.
 */
export type MonitorSession = Pick<SessionRecord,
  'identity' | 'parent' | 'turn' | 'attention' | 'notices' | 'read' | 'unavailable' | 'ordering' | 'observedAtMs' | 'lastEvidenceAtMs' | 'freshness'
  | 'restartUncertain' | 'children' | 'title' | 'project' | 'projectId'> & {activity: SessionRecord['activity'] | 'ended'; label?: string};
/**
 * The Monitor's source. `connection` is `current` while the copy follows its owner, `stale` once a later sync failed and
 * the copy keeps its last records, and `unavailable` before the first sync, when there is no snapshot.
 */
export type MonitorView = {
  connection: 'current' | 'stale' | 'unavailable';
  snapshot: {revision: number; collector: Collector; sessions: MonitorSession[]} | null;
};
export type PlaybackSourceStatus = {source: 'current' | 'stale' | 'unavailable'; view: NowPlayingView};

/** A synced session record as the Monitor draws it: its label's text, and every other field it reads unchanged. */
export function monitorSession(record: SessionRecord): MonitorSession {
  const {identity, parent, turn, activity, attention, notices, read, unavailable, ordering, observedAtMs, lastEvidenceAtMs, freshness, restartUncertain, children} = record;
  return structuredClone({
    identity, parent, turn, activity, attention, notices, read, unavailable, ordering, observedAtMs, lastEvidenceAtMs, freshness, restartUncertain, children,
    ...(record.label === undefined ? {} : {label: record.label.value}),
    ...(record.title === undefined ? {} : {title: record.title}),
    ...(record.project === undefined ? {} : {project: record.project}),
    ...(record.projectId === undefined ? {} : {projectId: record.projectId}),
  });
}

/** The state of the module's copy of the core's sessions. */
export type SessionCopyState = {state: 'current' | 'stale' | 'unavailable'; revision: number | null; sessions: readonly SessionRecord[]};

/**
 * The Monitor's view of a session copy. The collector mark shows running whenever the copy holds a snapshot, because the
 * core served it; a stale copy keeps that last known state beside its stale source mark, as a 1.x snapshot read that
 * failed did. Before the first sync there is no snapshot, and the mark shows unknown.
 */
export function monitorView({state, revision, sessions}: SessionCopyState): MonitorView {
  if (state === 'unavailable' || revision === null) return {connection: 'unavailable', snapshot: null};
  return {connection: state, snapshot: {revision, collector: 'running', sessions: sessions.map(monitorSession)}};
}
