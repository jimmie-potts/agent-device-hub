// Nanoleaf presentation of validated shared state; no provider interpretation (shared_input.py).
// The feed transport, its credential files and the snapshot schema check are not ported: the runtime delivers
// validated session state (PORTING.md). Everything here runs inside the caller's transaction.
import {compareText, dumps, floatText, isObject, parseJson, sameValue, sha256Hex, type Json} from './compat.js';
// shared_input.ID is the same pattern as devices.ID.
import {DEFAULT, ID, legacyRow} from './devices.js';
import {FeedError, ValueError} from './errors.js';
import {defaultColor, fallbackTitle, isLineStatus, type Metadata, type TaskRow} from './project-map.js';
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
 * One session of a saved envelope. Envelopes saved by earlier bridges may lack `generation`; the projection reads
 * a missing one as 0, as Python's `.get('generation', 0)` did.
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
  activity: 'unknown' | 'active' | 'idle' | 'interrupted' | 'ended';
  attention: Attention[];
  notices: Notice[];
  read: 'unknown' | 'read' | 'unread';
  unavailable: Unavailable[];
  ordering: Json;
  lastEvidenceAtMs: number;
  observedAtMs: number;
  observationAgeMs: number;
  freshness: 'current' | 'uncertain';
  restartUncertain: boolean;
  children: {active: number; uncertain: number};
  generation?: number;
}

/**
 * One session of an agent-state snapshot (1.1 or 1.2), as the owner published it. The consumer requires its generation
 * (shared_input.validate_snapshot); checkEnvelope refuses a snapshot whose session lacks one.
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

export interface Binding {
  identity: Identity;
  legacySessionId: string;
}

/** The saved shared-input configuration (version 1), as validateConfig returns it. */
export interface SharedConfig {
  version: 1;
  ownerId: string;
  consumerId: string;
  endpoint: string;
  tokenFile: string;
  controlTokenFile?: string;
  clearOnNewTurn: true;
  qualifiedSources: Source[];
  bindings: Binding[];
}

export interface SharedState {
  source: SqlValue;
  generation: number;
  config: SharedConfig | null;
  envelope: StoredEnvelope | null;
  received: SqlValue;
  connection: SqlValue;
  error: SqlValue;
  backup: Json | null;
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
  return (value.provider === 'codex' && (value.client === 'cli' || value.client === 'desktop'))
    || (value.provider === 'claude' && value.client === 'code');
}

const ALLOWED_CONFIG = new Set(['version', 'ownerId', 'consumerId', 'endpoint', 'tokenFile', 'controlTokenFile', 'clearOnNewTurn',
  'qualifiedSources', 'bindings']);

function configurationProblem(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).some(key => !ALLOWED_CONFIG.has(key))) return true;
  for (const key of ['version', 'clearOnNewTurn', 'ownerId', 'consumerId', 'endpoint', 'qualifiedSources']) {
    if (!Object.hasOwn(value, key)) return true;
  }
  if (value.version !== 1 || value.clearOnNewTurn !== true) return true;
  if (['ownerId', 'consumerId'].some(key => typeof value[key] !== 'string' || !ID.test(value[key]))) return true;
  const endpoint = value.endpoint;
  const port = typeof endpoint === 'string' ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/api\/monitor\/v1$/.exec(endpoint) : null;
  if (port === null || Number(port[1]) > 65535) return true;
  for (const key of ['tokenFile', 'controlTokenFile']) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || !value[key].startsWith('/'))) return true;
  }
  if (!Object.hasOwn(value, 'tokenFile')) return true;
  const sources = value.qualifiedSources;
  const bindings = Object.hasOwn(value, 'bindings') ? value.bindings : [];
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 128
      || sources.some(source => !validIdentity(source, SOURCE)) || new Set(sources.map(dumps)).size !== sources.length
      || !Array.isArray(bindings) || bindings.length > 128) {
    return true;
  }
  const keys = new Set<string>();
  const locals = new Set<string>();
  for (const binding of bindings) {
    if (!isObject(binding) || Object.keys(binding).length !== 2 || !Object.hasOwn(binding, 'identity')
        || !Object.hasOwn(binding, 'legacySessionId') || !validIdentity(binding.identity)) {
      return true;
    }
    const local = binding.legacySessionId;
    if (typeof local !== 'string' || !ID.test(local) || local.startsWith('shared-')) return true;
    const key = identityKey(binding.identity as unknown as Identity);
    if (keys.has(key) || locals.has(local)) return true;
    keys.add(key);
    locals.add(local);
  }
  return false;
}

/** Check a shared-input configuration; returns a copy with `bindings` defaulted and keys sorted. */
export function validateConfig(value: unknown): SharedConfig {
  if (configurationProblem(value) || !isObject(value)) throw new FeedError('invalid-config');
  return decode(dumps({...value, bindings: Object.hasOwn(value, 'bindings') ? value.bindings : []})) as SharedConfig;
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

// The legacy task backup: each local task table and its columns in table order, because older
// sources restore the backup positionally. These are local presentation tables, never another
// agent reducer.
export const BACKUP = {
  sessions: ['id', 'turn', 'status', 'updated'],
  slots: ['session', 'slot', 'device'],
  waits: ['session', 'turn', 'key', 'kind', 'tool'],
  activity: ['session', 'turn', 'status', 'started'],
  receipts: ['session', 'turn', 'completed', 'observed'],
  comets: ['session', 'turn', 'queued', 'source', 'started', 'device'],
  task_info: ['session', 'title', 'cwd', 'project', 'manual_project', 'turn', 'started'],
} as const;
export type BackupTable = keyof typeof BACKUP;
export const BACKUP_TABLES = Object.keys(BACKUP) as BackupTable[];
/** The original Lines device. */
export const DEFAULT_DEVICE = DEFAULT;

export function initSharedInput(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS shared_input (id INTEGER PRIMARY KEY, source TEXT, generation INTEGER, config TEXT, envelope TEXT, received REAL, connection TEXT, error TEXT, backup TEXT)');
  db.exec("INSERT OR IGNORE INTO shared_input VALUES (1,'legacy',0,NULL,NULL,NULL,'unavailable',NULL,NULL)");
  db.exec('CREATE TABLE IF NOT EXISTS shared_stale (session TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_suppressed_waves (session TEXT PRIMARY KEY, epoch REAL)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_ack (id INTEGER PRIMARY KEY, payload TEXT, result TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS shared_evictions (session TEXT, device TEXT, token TEXT NOT NULL, PRIMARY KEY (session,device))');
}

const decoded = (value: SqlValue | undefined): unknown => (value === undefined || value === null ? null : decode(String(value)));

export function state(db: Db): SharedState {
  const row = first(db, 'SELECT source,generation,config,envelope,received,connection,error,backup FROM shared_input WHERE id=1');
  if (row === undefined) throw new TypeError('The shared input row is missing.');
  const [source = null, generation = null, config, envelope, received = null, connection = null, error = null, backup] = row;
  return {source, generation: Number(generation), config: decoded(config) as SharedConfig | null,
    envelope: decoded(envelope) as StoredEnvelope | null, received, connection, error, backup: decoded(backup) as Json | null};
}

export function selected(db: Db): boolean {
  const row = first(db, 'SELECT source FROM shared_input WHERE id=1');
  return row?.[0] === 'shared';
}

/** The tasks a device shows, alerts first: shared input keeps idle tasks and hides the device's evictions. */
export function visibleTasks(db: Db, device: string): TaskRow[] {
  const shared = selected(db);
  const statuses = shared ? "'working','question','blocked','unread','idle'" : "'working','question','blocked','unread'";
  const excluded = shared ? 'AND NOT EXISTS (SELECT 1 FROM shared_evictions WHERE session=sessions.id AND device=?) ' : '';
  const sql = 'SELECT id,turn,status FROM sessions WHERE status IN (' + statuses + ') ' + excluded
    + "ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'question' THEN 1 ELSE 2 END, updated, id";
  return (shared ? rows(db, sql, device) : rows(db, sql)).map(([id = null, turn = null, status = null]) => [String(id), turn, status]);
}

/** A stale-view guard, not an authentication credential or lifecycle event. */
export function evictionToken(current: SharedState, session: StoredSession): string {
  return sha256Hex(dumps([current.config?.ownerId ?? null, current.generation, session.identity, session.generation ?? 0, session.turn]));
}

/** Remove a shared task from one device, as its eviction token permits; the owner's state is not changed. */
export function evict(db: Db, device: string, payload: unknown): void {
  if (!isObject(payload) || Object.keys(payload).length !== 2 || typeof payload.id !== 'string'
      || typeof payload.evictionToken !== 'string' || !selected(db)) {
    throw new ValueError('Invalid eviction.');
  }
  const current = state(db);
  const tasks = current.envelope === null ? new Map<string, PresentedTask<StoredSession>>() : presented(current.envelope.snapshot);
  const key = payload.id;
  const task = tasks.get(key);
  if (task === undefined || payload.evictionToken !== evictionToken(current, task[0])
      || first(db, 'SELECT 1 FROM sessions WHERE id=?', key) === undefined) {
    throw new ValueError('Task changed. Refresh before evicting.');
  }
  execute(db, 'INSERT OR REPLACE INTO shared_evictions VALUES (?,?,?)', key, device, payload.evictionToken);
  for (const table of ['slots', 'comets']) execute(db, 'DELETE FROM ' + table + ' WHERE session=? AND device=?', key, device);
}

export type Backup = Record<BackupTable, SqlValue[][]>;

/** Every task table's rows as backup rows. */
export function dumpTables(db: Db): Backup {
  const saved = {} as Backup;
  for (const table of BACKUP_TABLES) {
    saved[table] = rows(db, 'SELECT ' + BACKUP[table].join(',') + ' FROM ' + table + ' ORDER BY rowid').map(row => [...row]);
  }
  return saved;
}

function bindable(value: unknown): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TypeError('Error binding parameter: type is not supported.');
}

function backupValues(table: BackupTable, row: unknown): Record<string, unknown> {
  const names: readonly string[] = BACKUP[table];
  let values: Record<string, unknown> | null = null;
  if (Array.isArray(row)) {
    const cells: unknown[] = row;
    values = cells.length === names.length ? Object.fromEntries(names.map((name, index) => [name, cells[index]])) : legacyRow(table, cells);
  }
  if (values === null) throw new FeedError('invalid-backup');
  return values;
}

/** Replace every task table with a backup's rows, whether saved before or after the device key. */
export function restoreTables(db: Db, saved: unknown): void {
  if (!isObject(saved) || BACKUP_TABLES.some(table => !Array.isArray(saved[table]))) throw new FeedError('invalid-backup');
  for (const table of BACKUP_TABLES) {
    execute(db, 'DELETE FROM ' + table);
    for (const row of saved[table] as Json[]) {
      const values = backupValues(table, row);
      const names = Object.keys(values);
      execute(db, 'INSERT INTO ' + table + ' (' + names.join(',') + ') VALUES (' + names.map(() => '?').join(',') + ')',
        ...names.map(name => bindable(values[name])));
    }
  }
}

/**
 * Back up the legacy task tables and keep only the explicitly bound tasks, under their shared keys.
 *
 * A bound task keeps its placements, status epoch and metadata. Every other legacy row waits in
 * the backup for a return to legacy input. Runs inside the caller's transaction.
 */
export function saveLegacyTasks(db: Db, bindings: readonly Binding[]): void {
  const saved = dumpTables(db);
  const keys = new Map(bindings.map(binding => [binding.legacySessionId, identityKey(binding.identity)]));
  const carried: Backup = {sessions: [], slots: [], waits: [], activity: [], receipts: [], comets: [], task_info: []};
  for (const table of ['slots', 'activity', 'task_info'] as const) {
    const at = (BACKUP[table] as readonly string[]).indexOf('session');
    carried[table] = saved[table].flatMap(row => {
      const shared = keys.get(String(row[at]));
      return typeof row[at] === 'string' && shared !== undefined ? [[...row.slice(0, at), shared, ...row.slice(at + 1)]] : [];
    });
  }
  restoreTables(db, carried);
  execute(db, 'UPDATE shared_input SET backup=? WHERE id=1', dumps(saved));
}

/**
 * Restore the legacy task backup inside the caller's transaction.
 *
 * Each bound task keeps its current project choice and its placement on every device, under its
 * legacy session.
 */
export function restoreLegacyTasks(db: Db, bindings: readonly Binding[]): void {
  const kept = new Map<string, [Row | undefined, Row[]]>();
  for (const binding of bindings) {
    const key = identityKey(binding.identity);
    const info = first(db, 'SELECT project,manual_project FROM task_info WHERE session=?', key);
    const placed = rows(db, 'SELECT device,slot FROM slots WHERE session=? ORDER BY device', key);
    kept.set(binding.legacySessionId, [info, placed]);
  }
  const saved = first(db, 'SELECT backup FROM shared_input WHERE id=1')?.[0] ?? null;
  restoreTables(db, saved === null ? null : decode(String(saved)));
  // Release old slots before applying the complete remap to avoid swaps colliding.
  for (const session of kept.keys()) execute(db, 'DELETE FROM slots WHERE session=?', session);
  for (const [session, [info, placed]] of kept) {
    if (info !== undefined) execute(db, 'UPDATE task_info SET project=?,manual_project=? WHERE session=?', info[0] ?? null, info[1] ?? null, session);
    for (const [device = null, slot = null] of placed) {
      execute(db, 'DELETE FROM slots WHERE slot=? AND device=?', slot, device);
      execute(db, 'INSERT INTO slots (session, slot, device) VALUES (?,?,?)', session, slot, device);
    }
  }
}

type Alert = 'blocked' | 'question';
const ALERTS: Readonly<Record<Alert, ReadonlySet<string>>> = {blocked: new Set(['approval', 'input']), question: new Set(['question'])};
const RANK: Readonly<Record<string, number>> = {idle: 0, unread: 1, working: 2, question: 3, blocked: 4};
const isAlert = (status: SqlValue): status is Alert => status === 'blocked' || status === 'question';
const rank = (status: SqlValue): number => (typeof status === 'string' && Object.hasOwn(RANK, status) ? RANK[status] ?? 0 : 0);

export type TaskStatus = 'blocked' | 'question' | 'working' | 'unread' | 'idle';

/**
 * A task's status from its own and its subagents' evidence. Subagent attention and owner-counted fresh
 * activity belong to the parent task; a subagent's own turn-ended notices are not task completions.
 */
export function semanticStatus(session: StoredSession, consumer: string, children: readonly StoredSession[] = []): TaskStatus {
  const members = [session, ...children];
  const kinds = new Set(members.flatMap(item => item.attention.map(attention => attention.kind)));
  if ([...ALERTS.blocked].some(kind => kinds.has(kind as Attention['kind']))) return 'blocked';
  if ([...ALERTS.question].some(kind => kinds.has(kind as Attention['kind']))) return 'question';
  if (session.activity === 'active' || members.some(item => item.children.active !== 0)) return 'working';
  if (session.read !== 'read' && session.notices.some(notice => !notice.acknowledgedBy.includes(consumer))) return 'unread';
  return 'idle';
}

function parentKey(session: StoredSession): string | null {
  const parent = session.parent;
  if (parent.status !== 'known' || session.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) return null;
  return identityKey(parent.identity);
}

/** A presented task: its top session, the subagent sessions folded into it, and whether its parent is missing. */
export type PresentedTask<S extends StoredSession = SharedSession> = [S, S[], boolean];

/**
 * Task key: [session, included subagent sessions, orphan]. A child joins its topmost
 * ancestor in the snapshot, as legacy hooks attributed subagent events to the parent
 * session. A group whose top has a missing parent, or a parent cycle keyed by its
 * smallest member, is an orphan presented only for its attention.
 */
export function presented<S extends StoredSession>(snapshot: {readonly sessions: readonly S[]}): Map<string, PresentedTask<S>> {
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

/**
 * Task members whose evidence supplies a status. For a retained status, a silent child
 * that still reports activity counts too, so its later current evidence can clear it.
 */
function supporters<S extends StoredSession>(session: S, children: readonly S[], status: SqlValue, retained = false): S[] {
  if (isAlert(status)) return [session, ...children].filter(item => item.attention.some(attention => ALERTS[status].has(attention.kind)));
  if (status === 'working') {
    return [...(session.activity === 'active' ? [session] : []),
      ...children.filter(child => child.activity === 'active' && (retained || child.freshness === 'current'))];
  }
  return [session];
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

/** Project a checked envelope into local task state inside the caller's transaction. */
export function projectEnvelope(db: Db, input: Envelope, config: SharedConfig, instant: number, options: ProjectionOptions = {}): void {
  const targets = options.targets ?? [DEFAULT_DEVICE];
  const metadata = options.metadata ?? null;
  const current = state(db);
  const previous = current.envelope;
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
  const priorTasks = previous === null ? new Map<string, PresentedTask<StoredSession>>() : presented(previous.snapshot);
  for (const [key, [session, children, orphan]] of presented(snapshot)) {
    let status: SqlValue = semanticStatus(session, config.consumerId, children);
    if (orphan && !isAlert(status)) continue;
    live.add(key);
    const token = evictionToken(current, session);
    execute(db, 'DELETE FROM shared_evictions WHERE session=? AND token!=?', key, token);
    const before = prior.get(key);
    const recreated = before !== undefined && session.generation !== (before.generation ?? 0);
    if (recreated) {
      forgetTask(db, key);
      prior.delete(key);
      priorTasks.delete(key);
    }
    const taskResync = resync || recreated;
    const old = first(db, 'SELECT turn,status FROM sessions WHERE id=?', key);
    const oldActivity = first(db, 'SELECT turn,status,started FROM activity WHERE session=?', key);
    let turn: SqlValue = session.turn.status === 'known' ? session.turn.id : '';
    // A task is current when current evidence supplies its displayed status.
    const supporting = supporters(session, children, status);
    const stale = snapshot.collector !== 'running' || !supporting.some(item => item.freshness === 'current');
    const priorSession = prior.get(key);
    const priorChildren = priorTasks.get(key)?.[1] ?? [];
    const priorBlocked = priorSession !== undefined && [priorSession, ...priorChildren]
      .some(member => member.attention.some(item => item.kind === 'approval' && item.id.status === 'unknown'));
    const ownerClearedBlock = priorBlocked && priorSession !== undefined && old !== undefined && old[1] === 'blocked'
      && status !== 'blocked' && sameValue(priorSession.turn, session.turn) && previous !== null
      && snapshot.revision > previous.snapshot.revision;
    // Current members that supplied the retained status and no longer do clear it, and a
    // higher subagent alert is shown steadily rather than hidden behind an older color.
    const members = new Map([session, ...children].map(item => [identityKey(item.identity), item]));
    const priorTask = priorTasks.get(key);
    const priorSupport = old !== undefined && priorTask !== undefined && old[1] !== status
      ? new Set(supporters(priorTask[0], priorTask[1], old[1] ?? null, true).map(item => identityKey(item.identity)))
      : new Set<string>();
    const still = old === undefined ? new Set<string>() : new Set(supporters(session, children, old[1] ?? null).map(item => identityKey(item.identity)));
    const evidenceCleared = priorSupport.size > 0 && [...priorSupport]
      .every(member => members.get(member)?.freshness === 'current' && !still.has(member));
    const childAlert = old !== undefined && isAlert(status) && rank(status) > rank(old[1] ?? null)
      && supporting.some(item => item !== session);
    // Owner read evidence, or this consumer's acknowledgment of every notice, clears a
    // retained unread task even while its lifecycle evidence is stale.
    const unreadCleared = old !== undefined && old[1] === 'unread' && status === 'idle';
    if (stale && old !== undefined && !(ownerClearedBlock || evidenceCleared || childAlert || unreadCleared)) {
      turn = old[0] ?? null;
      status = old[1] ?? null;
    }
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
      if ((old !== undefined && old[0] !== turn) || session.activity === 'active' || session.activity === 'interrupted') {
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
  execute(db, "UPDATE shared_input SET envelope=?,received=?,connection='current',error=NULL WHERE id=1", dumps(envelope), instant);
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

