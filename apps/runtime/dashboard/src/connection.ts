// The dashboard's link to the runtime (Hub #922, ADR 0012 "Consumers and recovery"): one remote participant, acting as
// the browser's session (`bunny/parts/dashboard`), that keeps a synced copy of the core's `session` family and follows
// its live changes. There is no polling and no replay: a lost stream reconnects, the copy syncs again and shows the
// core's current state, and nothing the page missed is played back. The page sends a command only when a person acts,
// and never sends one again by itself.
import {SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {NoticeAcknowledgeRequest, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  SdkError, connectRemote, type Diagnostic, type RemoteOptions, type RemoteParticipant, type RequestResult, type Scheduler, type SyncChange,
  type SyncCompleted, type SyncedCopy, type SyncResult,
} from '@jimmie-potts/sdk/remote';
import type {Message} from '@jimmie-potts/event-contracts/v2';

/** The source every browser session acts as, which the runtime's gateway gives the dashboard (Hub #835). */
export const DASHBOARD_SOURCE = 'bunny/parts/dashboard';
const SYNC_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 5000;
/** A refused connect or sync is tried again after a second, doubling to half a minute: one retry loop, capped. */
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * The page's link: connecting, connected, reconnecting after a lost stream, or ended because the runtime no longer
 * takes this browser's session (signed out, evicted, expired, or the runtime restarted).
 */
export type Feed = 'connecting' | 'connected' | 'reconnecting' | 'ended';

/** The page's copy of the core's sessions. */
export type SessionsCopy = {
  /** true while the copy follows the core; false before its first sync and after a sync failed, until one succeeds. */
  synced: boolean;
  /** The core's current records, in the copy's order; the last ones it had while it is not synced. */
  records: readonly SessionRecord[];
  /** The core's revision at the copy's last sync, and the highest record revision since. */
  revision: number | undefined;
  /** How many times the copy has synced, the first sync included. */
  syncs: number;
  /** When the copy last changed, on the page's clock. */
  changedAtMs: number | undefined;
  /** The code of the last sync that was refused, until a sync succeeds. */
  refused: ErrorCode | undefined;
};

export type DashboardState = {feed: Feed; sessions: SessionsCopy};

/** How a command a person sent ended: accepted, refused before it had any effect, or uncertain. */
export type CommandEnd = {status: 'accepted'} | {status: 'rejected' | 'uncertain'; error: ErrorBody};

export type ConnectionOptions = {
  /** The page's own origin. */
  url: string;
  now?: () => number;
  /** Runs the retry delays. Defaults to the browser's `setTimeout`. */
  scheduler?: Scheduler;
  /** Connects the participant; the SDK's `connectRemote` by default. */
  connect?: (options: RemoteOptions) => Promise<RemoteParticipant>;
};

const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

const codeOf = (error: unknown): ErrorCode | undefined => error instanceof SdkError ? error.body.error.code : undefined;
const ended = (code: ErrorCode | undefined): boolean => code === 'unauthenticated' || code === 'forbidden';

export class DashboardConnection {
  readonly #options: ConnectionOptions;
  readonly #now: () => number;
  readonly #scheduler: Scheduler;
  readonly #listeners = new Set<() => void>();
  #state: DashboardState = {feed: 'connecting', sessions: {synced: false, records: [], revision: undefined, syncs: 0, changedAtMs: undefined, refused: undefined}};
  #participant: RemoteParticipant | undefined;
  #copy: SyncedCopy<SessionRecord> | undefined;
  #closed = false;
  /** The `sync.completed` last counted. */
  #lastSync: string | undefined;
  #retryMs = FIRST_RETRY_MS;
  #cancelRetry: () => void = () => {};

  constructor(options: ConnectionOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
    this.#scheduler = options.scheduler ?? timers;
  }

  /** For React's `useSyncExternalStore`: the listener hears every change of the state. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  readonly getState = (): DashboardState => this.#state;

  /** Connects, then syncs the core's sessions. A connect the runtime refuses for this session ends the feed. */
  async start(): Promise<void> {
    if (this.#closed || this.#participant !== undefined) return;
    try {
      this.#participant = await (this.#options.connect ?? connectRemote)({
        url: this.#options.url, source: DASHBOARD_SOURCE, browser: true,
        onDiagnostic: diagnostic => { this.#heard(diagnostic); },
        // The page has no console to report to; a handler error stays in memory, and the copy stays as it was.
        onError: () => {},
      });
    } catch (error) {
      if (ended(codeOf(error))) {
        this.#update({feed: 'ended'});
        return;
      }
      this.#update({feed: 'reconnecting'});
      this.#later(() => this.start());
      return;
    }
    if (this.#closed) {
      await this.#participant.close();
      return;
    }
    this.#retryMs = FIRST_RETRY_MS;
    this.#update({feed: 'connected'});
    await this.#follow();
  }

  /** Stops following and ends the stream; a page that signs out or unmounts calls it. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelRetry();
    const participant = this.#participant;
    this.#participant = undefined;
    this.#copy = undefined;
    await participant?.close();
  }

  /**
   * Acknowledges one turn-ended notice of a session for the dashboard, the only consumer this page may acknowledge for
   * (Hub #918). The core commits it before it answers, and the session's next record is its evidence. Sent once: an
   * uncertain answer is never sent again.
   */
  async acknowledge(session: string, noticeId: string): Promise<CommandEnd> {
    const participant = this.#participant;
    if (participant === undefined || this.#state.feed !== 'connected') {
      return {status: 'rejected', error: errorBody('unavailable', {detail: 'the dashboard is not connected; nothing was sent'})};
    }
    let result: RequestResult;
    try {
      result = await participant.request<Omit<NoticeAcknowledgeRequest, 'requestId'>>(`bunny.cmd.notice-acknowledge.${session}`, {
        type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: `${SCHEMA_BASE}notice-acknowledge/2.0`,
        data: {consumerId: 'dashboard', noticeId},
      }, {timeoutMs: COMMAND_TIMEOUT_MS});
    } catch (error) {
      // The SDK refused the call before sending it, as on a participant that closed meanwhile: nothing was sent.
      return {status: 'rejected', error: errorBody(codeOf(error) ?? 'invalid-state', {detail: 'the dashboard could not send it; nothing was sent'})};
    }
    return result.status === 'accepted' ? {status: 'accepted'} : {status: result.status, error: result.error};
  }

  /** Syncs the core's sessions, and syncs again with the capped backoff while the core refuses or a copy fails. */
  async #follow(): Promise<void> {
    const participant = this.#participant;
    if (participant === undefined || this.#closed) return;
    let synced: SyncResult<SessionRecord>;
    try {
      synced = await participant.sync<SessionRecord>(['session'], change => { this.#changed(change); }, {timeoutMs: SYNC_TIMEOUT_MS});
    } catch (error) {
      synced = {status: 'rejected', requestId: 'not-sent', error: errorBody(codeOf(error) ?? 'unavailable', {detail: 'the sync could not be sent'})};
    }
    if (synced.status === 'rejected') {
      this.#update({sessions: {...this.#state.sessions, synced: false, refused: synced.error.error.code}});
      this.#later(() => this.#follow());
      return;
    }
    if (this.#closed || participant !== this.#participant) {
      await synced.copy.close();
      return;
    }
    this.#copy = synced.copy;
    this.#retryMs = FIRST_RETRY_MS;
    this.#show(synced.message);
  }

  /** One change of the copy, in order: the copy itself holds the records, so the page shows its states. */
  #changed(change: SyncChange<SessionRecord>): void {
    switch (change.type) {
      case 'updated':
      case 'removed':
        this.#show(undefined);
        return;
      case 'synced':
        this.#show(change.message);
        return;
      case 'failed': {
        // The copy stopped following the core and keeps its last records; a new sync replaces it.
        const copy = this.#copy;
        this.#copy = undefined;
        void copy?.close();
        this.#update({sessions: {...this.#state.sessions, synced: false, refused: change.error.error.code}});
        this.#later(() => this.#follow());
        return;
      }
    }
  }

  /**
   * Shows the copy's current records. A `sync.completed` counts one sync, once: the first sync's may reach the handler as
   * well as the sync's own answer. Before the first sync resolves, the copy is not the page's yet.
   */
  #show(completed: Message<SyncCompleted> | undefined): void {
    const copy = this.#copy;
    if (copy === undefined) return;
    const counted = completed !== undefined && completed.id !== this.#lastSync;
    if (completed !== undefined) this.#lastSync = completed.id;
    const records = copy.states().map(message => message.data);
    const revision = Math.max(completed?.data.revision ?? 0, this.#state.sessions.revision ?? 0, ...records.map(record => record.revision));
    this.#update({sessions: {
      synced: true, records, revision, syncs: this.#state.sessions.syncs + (counted ? 1 : 0), changedAtMs: this.#now(), refused: undefined,
    }});
  }

  /** The participant's own decisions: its stream lost and back, and the runtime refusing this session. */
  #heard(diagnostic: Diagnostic): void {
    const {event, code} = diagnostic;
    if (event === 'remote.disconnected' && this.#state.feed === 'connected') this.#update({feed: 'reconnecting'});
    else if (event === 'remote.reconnected' && this.#state.feed === 'reconnecting') this.#update({feed: 'connected'});
    else if (event === 'remote.refused' && ended(code)) {
      // The session ended. The page offers one explicit sign-in and never signs in by itself.
      this.#update({feed: 'ended', sessions: {...this.#state.sessions, synced: false}});
      void this.close();
    }
  }

  #later(retry: () => Promise<void>): void {
    if (this.#closed) return;
    const delayMs = this.#retryMs;
    this.#retryMs = Math.min(this.#retryMs * 2, MAX_RETRY_MS);
    this.#cancelRetry = this.#scheduler.after(delayMs, () => { void retry(); });
  }

  #update(change: Partial<DashboardState>): void {
    this.#state = {...this.#state, ...change};
    for (const listener of this.#listeners) listener();
  }
}
