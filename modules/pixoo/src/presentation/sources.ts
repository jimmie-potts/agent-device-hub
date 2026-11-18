// What the Monitor and the Now Playing card read (Hub #843). The module fills them from its synced copies of the core's
// `session` records, read through the contracts package's shared session read function (Hub #1865), and the playback
// owner's `playback/2.0` record. The 1.x snapshot sources stayed in divoom-app-upgrade with its HTTP server.
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import type {NowPlayingView} from './now-playing.js';

/** The agent-state collector's states, as the Monitor's health mark draws them. */
export type Collector = 'running' | 'quiesced' | 'faulted' | 'closed';
/**
 * One session as the Monitor draws it, from its view: the hub's status, its work state as `activity` and the work claim's
 * confidence, its attention items and notices, its child counts, and its display label as plain text. `ended` stays
 * drawable for the synthetic previews only: the core removes a session when it ends.
 */
export type MonitorSession = Pick<SessionView,
  'identity' | 'parent' | 'turn' | 'status' | 'unavailable' | 'ordering' | 'observedAtMs' | 'lastEvidenceAtMs' | 'title' | 'project' | 'projectId'> & {
  activity: SessionView['work']['state'] | 'ended'; workConfidence: SessionView['work']['confidence'];
  attention: SessionView['attention']['items']; notices: SessionView['outcome']['notices']; read: SessionView['outcome']['read'];
  children: SessionView['relationships']['children']; label?: string;
};
/**
 * The Monitor's source. `connection` is `current` while the copy follows its owner, `stale` once a later sync failed and
 * the copy keeps its last records, and `unavailable` before the first sync, when there is no snapshot.
 */
export type MonitorView = {
  connection: 'current' | 'stale' | 'unavailable';
  snapshot: {revision: number; collector: Collector; sessions: MonitorSession[]} | null;
};
export type PlaybackSourceStatus = {source: 'current' | 'stale' | 'unavailable'; view: NowPlayingView};

/** A synced session's view as the Monitor draws it: its label's text, and every other member it reads unchanged. */
export function monitorSession(view: SessionView): MonitorSession {
  const {identity, parent, turn, status, unavailable, ordering, observedAtMs, lastEvidenceAtMs} = view;
  return structuredClone({
    identity, parent, turn, status, activity: view.work.state, workConfidence: view.work.confidence, attention: view.attention.items,
    notices: view.outcome.notices, read: view.outcome.read, unavailable, ordering, observedAtMs, lastEvidenceAtMs, children: view.relationships.children,
    ...(view.label === undefined ? {} : {label: view.label.value}),
    ...(view.title === undefined ? {} : {title: view.title}),
    ...(view.project === undefined ? {} : {project: view.project}),
    ...(view.projectId === undefined ? {} : {projectId: view.projectId}),
  });
}

/** The state of the module's copy of the core's sessions. */
export type SessionCopyState = {state: 'current' | 'stale' | 'unavailable'; revision: number | null; sessions: readonly SessionView[]};

/**
 * The Monitor's view of a session copy. The collector mark shows running whenever the copy holds a snapshot, because the
 * core served it; a stale copy keeps that last known state beside its stale source mark, as a 1.x snapshot read that
 * failed did. Before the first sync there is no snapshot, and the mark shows unknown.
 */
export function monitorView({state, revision, sessions}: SessionCopyState): MonitorView {
  if (state === 'unavailable' || revision === null) return {connection: 'unavailable', snapshot: null};
  return {connection: state, snapshot: {revision, collector: 'running', sessions: sessions.map(monitorSession)}};
}
