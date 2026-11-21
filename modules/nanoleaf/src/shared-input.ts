// Nanoleaf presentation of validated shared state; no provider interpretation (shared_input.py).
// The feed transport, its credential files and the snapshot schema check are not ported: the runtime delivers
// validated session state (PORTING.md). Everything here runs inside the caller's transaction. The module keeps its copy
// of the core's sessions in memory (`SharedCopy`), rebuilt by sync after a restart and never saved (ADR 0012).
import {compareText, dumps, floatText, isObject, parseFloatText, parseJson, sameValue, sha256Hex, type Json} from './compat.js';
// shared_input.ID is the same pattern as devices.ID.
import {DEFAULT, ID} from './devices.js';
import {FeedError, ValueError} from './errors.js';
import {defaultColor, fallbackTitle, isLineStatus, type Metadata, type TaskRow} from './project-map.js';
import type {RenderConfig} from './renderer.js';
import {execute, first, rows, sameRow, type Db, type Row, type SqlValue} from './sqlite.js';
import {controlState, markDirty} from './store.js';

export const IDENTITY = ['provider', 'client', 'hostId', 'sourceId', 'sessionId'] as const;
export const SOURCE = ['provider', 'client', 'hostId', 'sourceId'] as const;

export interface Identity {
  provider: string;
  client: string;
  hostId: string;
  sourceId: string;
  sessionId: string;
}
export type Source = Omit<Identity, 'sessionId'>;
export type KnownId = {status: 'unknown'} | {status: 'known'; id: string};
export type Parent = {status: 'unknown'} | {status: 'top-level'} | {status: 'known'; identity: Identity};
export interface Attention {
  id: KnownId;
  kind: 'question' | 'input' | 'approval';
  turn: KnownId;
}
export interface Notice {
  id: string;
  kind: 'turn-ended';
  turn: KnownId;
  acknowledgedBy: string[];
}
export interface Unavailable {
  kind: 'evidence.unavailable';
  dimension: 'activity' | 'attention' | 'turn' | 'parent' | 'read' | 'ordering';
  reason: 'unsupported' | 'inaccessible' | 'missing' | 'ambiguous' | 'lost';
}

/**
 * The hub's status of a session as the wall shows it (Hub #1865, design decision 10): its class and detail from the
 * shared session read function, with Nanoleaf's acknowledgment and read policy applied at the feed boundary.
 */
export interface HubStatus {
  class: 'needs-owner' | 'working' | 'finished' | 'quiet' | 'unknown';
  detail: string;
}

/**
 * One session of the copy. A session without `generation` reads as 0, as Python's `.get('generation', 0)` did. `status`
 * and `work` are the hub's: the wall keeps no session rule of its own, such as evidence age (owner decision, 2026-11-18).
 */
export interface StoredSession {
  identity: Identity;
  turn: KnownId;
  parent: Parent;
  label?: string;
  labelOrigin?: 'user' | 'agent';
  projectId?: string;
  project?: string;
  title?: {value: string; source: 'provider' | 'user'};
  status: HubStatus;
  /** The hub's work claim: its state, and whether evidence confirms it. */
  work: {state: 'unknown' | 'active' | 'idle' | 'interrupted'; confidence: 'confirmed' | 'unconfirmed'};
  attention: Attention[];
  notices: Notice[];
  read: 'unknown' | 'read' | 'unread';
  unavailable: Unavailable[];
  ordering: Json;
  lastEvidenceAtMs: number;
  observedAtMs: number;
  generation?: number;
}

/**
 * One session as the feed gives it. The consumer requires its generation (shared_input.validate_snapshot); checkEnvelope
 * refuses a snapshot whose session lacks one.
 */
export interface SharedSession extends StoredSession {
  generation: number;
}

export interface Snapshot<S extends StoredSession = SharedSession> {
  apiVersion: string;
  revision: number;
  asOfMs: number;
  collector: 'running' | 'quiesced' | 'faulted' | 'closed';
  lossCount: number;
  sessions: S[];
}

/** The owner's envelope around a checked snapshot. */
export interface Envelope<S extends StoredSession = SharedSession> {
  apiVersion: string;
  ownerId: string;
  connection: string;
  snapshot: Snapshot<S>;
  admissionRejected: number;
  nextRequestId: string;
}

export interface Skipped {
  sessions: number;
  sources: Source[];
}

/** The saved envelope holds only declared sessions, plus a count of the skipped ones. */
export interface StoredEnvelope extends Envelope<StoredSession> {
  skipped?: Skipped;
}

/**
 * The saved shared-input configuration (version 1), as validateConfig returns it. The runtime module follows the core
 * through the SDK's sync, so the 1.x feed's `endpoint`, `tokenFile` and `controlTokenFile` are optional: a saved 1.x
 * configuration that names them is still checked, and nothing reads them (Hub #844).
 */
export interface SharedConfig {
  version: 1;
  ownerId: string;
  consumerId: string;
  endpoint?: string;
  tokenFile?: string;
  controlTokenFile?: string;
  clearOnNewTurn: true;
  qualifiedSources: Source[];
}

export interface SharedState {
  source: SqlValue;
  generation: number;
  config: SharedConfig | null;
  received: SqlValue;
  connection: SqlValue;
  error: SqlValue;
}

/**
 * The module's copy of the core's sessions as last projected: the declared sessions with a count of the skipped ones. It
 * lives in memory only, so a restart starts from an empty copy and the next sync projects a fresh start; no row saves the
 * core's state (ADR 0012, "Ownership and publication"). Python saved it in `shared_input.envelope`, which stays NULL.
 */
export class SharedCopy {
  envelope: StoredEnvelope | null = null;
}

/** shared_input.decode: saved JSON; anything unreadable is invalid-json. */
export function decode(raw: string): unknown {
  try {
    return parseJson(raw);
  } catch {
    throw new FeedError('invalid-json');
  }
}

export const identityKey = (identity: Identity): string => 'shared-' + sha256Hex(dumps(IDENTITY.map(key => identity[key])));

export function validIdentity(value: unknown, fields: readonly string[] = IDENTITY): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every(field => Object.hasOwn(value, field))) return false;
  if (!fields.every(field => typeof value[field] === 'string' && ID.test(value[field]))) return false;
  // The native B.U.N.N.Y. assistant (Hub #505) shows on the Lines once the owner qualifies its source in the configuration.
  return (value.provider === 'codex' && (value.client === 'cli' || value.client === 'desktop' || value.client === 'local'))
    || (value.provider === 'claude' && value.client === 'code') || (value.provider === 'bunny' && value.client === 'assistant');
}

// Python's configuration also took `bindings`, which carried legacy tasks across a source switch; legacy input is
// not ported (owner decision, Hub #26, 2026-10-06), so a configuration with them is refused.
const ALLOWED_CONFIG = new Set(['version', 'ownerId', 'consumerId', 'endpoint', 'tokenFile', 'controlTokenFile', 'clearOnNewTurn',
  'qualifiedSources']);

function configurationProblem(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).some(key => !ALLOWED_CONFIG.has(key))) return true;
  for (const key of ['version', 'clearOnNewTurn', 'ownerId', 'consumerId', 'qualifiedSources']) {
    if (!Object.hasOwn(value, key)) return true;
  }
  if (value.version !== 1 || value.clearOnNewTurn !== true) return true;
  if (['ownerId', 'consumerId'].some(key => typeof value[key] !== 'string' || !ID.test(value[key]))) return true;
  // The 1.x feed's endpoint and token files: optional since the SDK's sync replaced the feed, checked when present.
  if (Object.hasOwn(value, 'endpoint')) {
    const endpoint = value.endpoint;
    const port = typeof endpoint === 'string' ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/api\/monitor\/v1$/.exec(endpoint) : null;
    if (port === null || Number(port[1]) > 65535) return true;
  }
  for (const key of ['tokenFile', 'controlTokenFile']) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || !value[key].startsWith('/'))) return true;
  }
  const sources = value.qualifiedSources;
  return !Array.isArray(sources) || sources.length < 1 || sources.length > 128
    || sources.some(source => !validIdentity(source, SOURCE)) || new Set(sources.map(dumps)).size !== sources.length;
}

/** Check a shared-input configuration; returns a copy with its keys sorted. */
export function validateConfig(value: unknown): SharedConfig {
  if (configurationProblem(value) || !isObject(value)) throw new FeedError('invalid-config');
  return decode(dumps(value)) as SharedConfig;
}

/**
 * The part of shared_input.check_envelope this consumer keeps: every session carries an integer generation, the rule
 * Python's validate_snapshot added for 1.1 and 1.2 snapshots, and the revision never goes back. A failure is
 * invalid-feed and changes nothing. The schema, owner and connection checks belong to the 1.x feed (PORTING.md).
 */
export function checkEnvelope(value: Envelope, minimumRevision = 0): Envelope {
  const sessions: readonly {readonly generation?: unknown}[] = value.snapshot.sessions;
  if (sessions.some(session => typeof session.generation !== 'number' || !Number.isInteger(session.generation))
      || value.snapshot.revision < minimumRevision) {
    throw new FeedError('invalid-feed');
  }
  return value;
}

/**
 * Keep sessions from declared sources. Others are counted, never presented or
 * acknowledged, and take no part in parent grouping.
 */
export function declared(snapshot: Snapshot, config: Pick<SharedConfig, 'qualifiedSources'>): [Snapshot, Skipped] {
  const sources = new Set(config.qualifiedSources.map(source => dumps(source)));
  const kept: SharedSession[] = [];
  const skipped: string[] = [];
  for (const session of snapshot.sessions) {
    const source = dumps(Object.fromEntries(SOURCE.map(key => [key, session.identity[key]])));
    if (sources.has(source)) kept.push(session);
    else skipped.push(source);
  }
  const distinct = [...new Set(skipped)].sort(compareText);
  return [{...snapshot, sessions: kept}, {sessions: skipped.length, sources: distinct.map(source => decode(source) as Source)}];
}

/** The original Lines device. */
export const DEFAULT_DEVICE = DEFAULT;

/**
 * The stored source before shared input is first selected, and while a new configuration waits for its selection.
 * It is Python's name for its other input, kept so saved state and the recordings stay comparable; nothing reads tasks
 * from it any more.
 */
export const NOT_SELECTED = 'legacy';

/**
 * The shared input row and its tables. A new database starts unselected. The `backup` column held the legacy task
 * backup, which is not ported; it stays for saved state's sake.
 */
export function initSharedInput(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS shared_input (id INTEGER PRIMARY KEY, source TEXT, generation INTEGER, config TEXT, envelope TEXT, received REAL, connection TEXT, error TEXT, backup TEXT)');
  execute(db, "INSERT OR IGNORE INTO shared_input VALUES (1,?,0,NULL,NULL,NULL,'unavailable',NULL,NULL)", NOT_SELECTED);
  db.exec('CREATE TABLE IF NOT EXISTS shared_stale (session TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_suppressed_waves (session TEXT PRIMARY KEY, epoch REAL)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_ack (id INTEGER PRIMARY KEY, payload TEXT, result TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_evictions (session TEXT, device TEXT, token TEXT NOT NULL, PRIMARY KEY (session,device))');
}

const decoded = (value: SqlValue | undefined): unknown => (value === undefined || value === null ? null : decode(String(value)));

export function state(db: Db): SharedState {
  const row = first(db, 'SELECT source,generation,config,received,connection,error FROM shared_input WHERE id=1');
  if (row === undefined) throw new TypeError('The shared input row is missing.');
  const [source = null, generation = null, config, received = null, connection = null, error = null] = row;
  return {source, generation: Number(generation), config: decoded(config) as SharedConfig | null, received, connection, error};
}

export function selected(db: Db): boolean {
  const row = first(db, 'SELECT source FROM shared_input WHERE id=1');
  return row?.[0] === 'shared';
}

/**
 * The tasks a device shows, alerts first: idle tasks too, but not the device's evictions. These are the shared-input rules,
 * applied whether or not shared input is selected, so a task held while shared input is paused keeps its Line. Python
 * applied its legacy rules then (idle hidden, evictions ignored); the port has no legacy input (PORTING.md).
 */
export function visibleTasks(db: Db, device: string): TaskRow[] {
  return rows(db, "SELECT id,turn,status FROM sessions WHERE status IN ('working','question','blocked','unread','idle') "
    + 'AND NOT EXISTS (SELECT 1 FROM shared_evictions WHERE session=sessions.id AND device=?) '
    + "ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'question' THEN 1 ELSE 2 END, updated, id", device)
    .map(([id = null, turn = null, status = null]) => [String(id), turn, status]);
}

/** A stale-view guard, not an authentication credential or lifecycle event. */
export function evictionToken(current: SharedState, session: StoredSession): string {
  return sha256Hex(dumps([current.config?.ownerId ?? null, current.generation, session.identity, session.generation ?? 0, session.turn]));
}

/** Remove a shared task from one device, as its eviction token permits; the owner's state is not changed. */
export function evict(db: Db, copy: SharedCopy, device: string, payload: unknown): void {
  if (!isObject(payload) || Object.keys(payload).length !== 2 || typeof payload.id !== 'string'
      || typeof payload.evictionToken !== 'string' || !selected(db)) {
    throw new ValueError('Invalid eviction.');
  }
  const current = state(db);
  const tasks = copy.envelope === null ? new Map<string, PresentedTask<StoredSession>>() : presented(copy.envelope.snapshot);
  const key = payload.id;
  const task = tasks.get(key);
  if (task === undefined || payload.evictionToken !== evictionToken(current, task[0])
      || first(db, 'SELECT 1 FROM sessions WHERE id=?', key) === undefined) {
    throw new ValueError('Task changed. Refresh before evicting.');
  }
  execute(db, 'INSERT OR REPLACE INTO shared_evictions VALUES (?,?,?)', key, device, payload.evictionToken);
  for (const table of ['slots', 'comets']) execute(db, 'DELETE FROM ' + table + ' WHERE session=? AND device=?', key, device);
}

const isAlert = (status: SqlValue): boolean => status === 'blocked' || status === 'question';

export type TaskStatus = 'blocked' | 'question' | 'working' | 'unread' | 'idle';

/**
 * A task's status from the hub's statuses (design decision 10). A member, root or subagent, that needs the owner with a
 * question asks; with an approval, input or a detail this version does not know, which falls back to its class, it
 * blocks. Otherwise the task shows its root's status: working, unread when finished for this consumer, and idle when
 * quiet or `unknown`. A subagent's work reaches the task only through the root's status, whose `subagent` detail counts
 * the children whose work the hub confirms, so a silent subagent never hides the root's finished turn, as on every other
 * device. A subagent's own finished turn is not a task completion.
 */
export function semanticStatus(session: StoredSession, children: readonly StoredSession[] = []): TaskStatus {
  const owner = [session, ...children].filter(item => item.status.class === 'needs-owner');
  if (owner.some(item => item.status.detail !== 'question')) return 'blocked';
  if (owner.length > 0) return 'question';
  if (session.status.class === 'working') return 'working';
  if (session.status.class === 'finished') return 'unread';
  return 'idle';
}

/**
 * Whether the wall holds a task steady for the hub's unconfirmed work: the task is working on its root's own active work,
 * which evidence no longer confirms. It is the only hold beyond idle's own steady slot and a lost copy's freeze.
 */
export function heldForUnconfirmedWork(status: TaskStatus, root: StoredSession): boolean {
  return status === 'working' && root.work.state === 'active' && root.work.confidence === 'unconfirmed';
}

/** What grouping reads of a session: its identity, its parent and whether that parent is ambiguous. */
type Grouped = Pick<StoredSession, 'identity' | 'parent' | 'unavailable'>;

function parentKey(session: Grouped): string | null {
  const parent = session.parent;
  if (parent.status !== 'known' || session.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) return null;
  return identityKey(parent.identity);
}

/** A presented task: its top session, the subagent sessions folded into it, and whether its parent is missing. */
export type PresentedTask<S extends Grouped = SharedSession> = [S, S[], boolean];

/**
 * Task key: [session, included subagent sessions, orphan]. A child joins its topmost
 * ancestor in the snapshot, as legacy hooks attributed subagent events to the parent
 * session. A group whose top has a missing parent, or a parent cycle keyed by its
 * smallest member, is an orphan presented only for its attention.
 */
export function presented<S extends Grouped>(snapshot: {readonly sessions: readonly S[]}): Map<string, PresentedTask<S>> {
  const sessions = new Map<string, S>();
  for (const session of snapshot.sessions) sessions.set(identityKey(session.identity), session);
  const sessionOf = (key: string): S => {
    const session = sessions.get(key);
    if (session === undefined) throw new RangeError('Unknown session.');
    return session;
  };
  const top = (key: string): string => {
    const path = [key];
    for (let parent = parentKey(sessionOf(key)); parent !== null && sessions.has(parent); parent = parentKey(sessionOf(parent))) {
      const index = path.indexOf(parent);
      if (index !== -1) return path.slice(index).sort(compareText)[0] ?? parent;
      path.push(parent);
    }
    return path[path.length - 1] ?? key;
  };
  const tasks = new Map<string, PresentedTask<S>>();
  for (const key of sessions.keys()) {
    const root = top(key);
    let entry = tasks.get(root);
    if (entry === undefined) {
      const rootSession = sessionOf(root);
      entry = [rootSession, [], parentKey(rootSession) !== null];
      tasks.set(root, entry);
    }
    if (key !== root) entry[1].push(sessionOf(key));
  }
  return tasks;
}

function forgetTask(db: Db, key: SqlValue): void {
  for (const [table, column] of [['sessions', 'id'], ['activity', 'session'], ['task_info', 'session'], ['comets', 'session'],
    ['slots', 'session'], ['waits', 'session'], ['receipts', 'session'], ['shared_stale', 'session'],
    ['shared_suppressed_waves', 'session'], ['shared_evictions', 'session']] as const) {
    execute(db, 'DELETE FROM ' + table + ' WHERE ' + column + '=?', key);
  }
}

export interface ProjectionOptions {
  resync?: boolean;
  /** Registered devices; a completion queues one comet on each device in Work. */
  targets?: readonly string[];
  metadata?: Metadata | null;
}

/**
 * Project a checked envelope into local task state inside the caller's transaction, against the copy's previous envelope,
 * and keep the new one in the copy. The copy changes as the projection ends; a caller whose transaction then fails
 * empties the copy, so the next envelope projects a fresh start.
 */
export function projectEnvelope(db: Db, copy: SharedCopy, input: Envelope, config: SharedConfig, instant: number, options: ProjectionOptions = {}): void {
  const targets = options.targets ?? [DEFAULT_DEVICE];
  const metadata = options.metadata ?? null;
  const current = state(db);
  const previous = copy.envelope;
  // The stored envelope holds only declared sessions, plus a local count of the skipped ones.
  const [snapshot, skipped] = declared(input.snapshot, config);
  const envelope: StoredEnvelope = {...input, snapshot, skipped};
  const prior = new Map<string, StoredSession>();
  for (const session of previous?.snapshot.sessions ?? []) prior.set(identityKey(session.identity), session);
  const resync = options.resync === true || previous === null || current.connection !== 'current'
    || snapshot.revision > previous.snapshot.revision + 1
    || snapshot.lossCount !== previous.snapshot.lossCount
    || envelope.admissionRejected !== previous.admissionRejected;
  if (resync) execute(db, "INSERT OR REPLACE INTO meta VALUES ('shared_wave_cutoff',?)", floatText(instant));
  let presentationChanged = metadata === null ? false : metadata.syncCatalog(db);
  const live = new Set<string>();
  for (const [key, [session, children, orphan]] of presented(snapshot)) {
    const status = semanticStatus(session, children);
    if (orphan && !isAlert(status)) continue;
    live.add(key);
    const token = evictionToken(current, session);
    execute(db, 'DELETE FROM shared_evictions WHERE session=? AND token!=?', key, token);
    const before = prior.get(key);
    const recreated = before !== undefined && session.generation !== (before.generation ?? 0);
    if (recreated) {
      forgetTask(db, key);
      prior.delete(key);
    }
    const taskResync = resync || recreated;
    const old = first(db, 'SELECT turn,status FROM sessions WHERE id=?', key);
    const oldActivity = first(db, 'SELECT turn,status,started FROM activity WHERE session=?', key);
    const turn: SqlValue = session.turn.status === 'known' ? session.turn.id : '';
    // Every hub status replaces the displayed one at once, whatever the silence; the only steady hold is the hub's
    // unconfirmed work.
    const stale = snapshot.collector !== 'running' || heldForUnconfirmedWork(status, session);
    const priorSession = prior.get(key);
    const wasStale = first(db, 'SELECT 1 FROM shared_stale WHERE session=?', key) !== undefined;
    if (stale) execute(db, 'INSERT OR IGNORE INTO shared_stale VALUES (?)', key);
    else execute(db, 'DELETE FROM shared_stale WHERE session=?', key);
    const changed = !sameRow(old, [turn, status]);
    if (changed) {
      execute(db, 'INSERT OR REPLACE INTO sessions VALUES (?,?,?,?)', key, turn, status, instant);
      if (isLineStatus(status)) {
        // A retained matching phase survives cutover and resync. New resync states
        // use an expired wave epoch; ordinary current transitions get one wave.
        const epoch = oldActivity !== undefined && oldActivity[0] === turn && oldActivity[1] === status
          ? oldActivity[2] ?? null
          : taskResync || stale || wasStale ? instant - 10 : instant;
        execute(db, 'INSERT OR REPLACE INTO activity VALUES (?,?,?,?)', key, turn, status, epoch);
      } else {
        execute(db, 'DELETE FROM activity WHERE session=?', key);
      }
      if ((old !== undefined && old[0] !== turn) || session.work.state === 'active' || session.work.state === 'interrupted') {
        execute(db, 'DELETE FROM comets WHERE session=?', key);
      } else {
        execute(db, 'DELETE FROM comets WHERE session=? AND started IS NULL', key);
      }
    }
    if (stale || wasStale) {
      execute(db, 'INSERT OR REPLACE INTO shared_suppressed_waves SELECT session,started FROM activity WHERE session=?', key);
    }
    if (stale || taskResync || wasStale) {
      execute(db, 'DELETE FROM comets WHERE session=?', key);
    } else if (changed && status === 'unread' && priorSession !== undefined) {
      const oldNotices = new Set(priorSession.notices.map(notice => notice.id));
      if (session.notices.some(notice => !oldNotices.has(notice.id) && !notice.acknowledgedBy.includes(config.consumerId))) {
        for (const device of targets) {
          if (controlState(db, device).mode === 'work'
              && first(db, 'SELECT 1 FROM shared_evictions WHERE session=? AND device=?', key, device) === undefined) {
            execute(db, 'INSERT OR IGNORE INTO comets (session,turn,queued,source,started,device) VALUES (?,?,?,NULL,NULL,?)',
              key, turn, instant, device);
          }
        }
      }
    }
    let project = session.projectId !== undefined && session.projectId !== '' ? 'shared-project-' + session.projectId : null;
    if (project === null && session.project !== undefined && session.project !== '') project = 'shared-project-name:' + sha256Hex(session.project);
    if (project !== null) {
      const name = session.project !== undefined && session.project !== '' ? session.project : session.projectId ?? null;
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', project, name, defaultColor(project), '[]');
    }
    const existing = first(db, 'SELECT title,cwd,project,manual_project,turn,started FROM task_info WHERE session=?', key);
    const identity = session.identity;
    let localTitle: SqlValue = '';
    let localProject: SqlValue = null;
    if (metadata !== null && identity.provider === 'codex') [localTitle, localProject] = metadata.lookup(db, identity.sessionId);
    const title = firstText(session.label, session.title?.value, localTitle) ?? fallbackTitle(identity.provider, identity.sessionId);
    const manual = existing?.[3] ?? null;
    const started = existing !== undefined && existing[4] === turn
      ? existing[5] ?? null
      : !taskResync && truthy(turn) ? instant : null;
    const details: Row = [title, '', project ?? localProject, manual, turn, started];
    if (!sameRow(existing, details)) {
      execute(db, 'INSERT OR REPLACE INTO task_info VALUES (?,?,?,?,?,?,?)', key, ...details);
      presentationChanged = true;
    }
  }
  for (const [key = null] of rows(db, 'SELECT id FROM sessions')) {
    if (typeof key !== 'string' || !live.has(key)) forgetTask(db, key);
  }
  // The copy holds what the saved row once held: the envelope as its JSON text reads back.
  execute(db, "UPDATE shared_input SET envelope=NULL,received=?,connection='current',error=NULL WHERE id=1", instant);
  copy.envelope = decode(dumps(envelope)) as StoredEnvelope;
  if (!sameValue(previous, envelope) || presentationChanged) markDirty(db);
}

/** Python's truth value of a saved value. */
const truthy = (value: SqlValue): boolean => value !== null && value !== '' && value !== 0;

/** Python's `a or b or c` over optional text: the first non-empty string. */
function firstText(...values: readonly (SqlValue | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}


/**
 * shared_input.render_config: hold idle and stale tasks' Lines steady, suppress outward waves a recovered task must not
 * replay, and apply the shared wave cutoff, for one worker pass.
 */
export function sharedRenderConfig(db: Db, config: RenderConfig): void {
  const device = config.device ?? DEFAULT_DEVICE;
  const slots = (sql: string): number[] => rows(db, sql, device).map(([slot]) => {
    if (typeof slot !== 'number') throw new TypeError('A saved slot must be a number.');
    return slot;
  });
  config._steady_slots = slots('SELECT slot FROM slots JOIN sessions ON sessions.id=slots.session WHERE slots.device=? AND '
    + "(sessions.status='idle' OR EXISTS (SELECT 1 FROM shared_stale WHERE shared_stale.session=slots.session))");
  config._wave_suppressed_slots = slots('SELECT slot FROM slots JOIN shared_suppressed_waves USING (session) JOIN activity USING (session) '
    + 'WHERE epoch=started AND slots.device=?');
  const row = first(db, "SELECT value FROM meta WHERE key='shared_wave_cutoff'");
  if (row !== undefined) config._wave_cutoff = Math.max(config._wave_cutoff ?? -Infinity, parseFloatText(String(row[0])));
}
