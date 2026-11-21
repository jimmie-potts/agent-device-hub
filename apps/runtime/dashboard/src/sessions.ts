// What the dashboard shows of each agent session (Hub #922), derived only from the session the core publishes and the
// page syncs (ADR 0012, "Inbox and history"; Hub #831). Every record is read through the contracts package's shared
// session view (Hub #1865, design decision 10), so the dashboard shows the hub's status and keeps no session rule of its
// own: it applies only its acknowledgment and read policy. The page never clears a finished turn itself or on a timer,
// and never infers readership from missing evidence: a finished turn shows unread until the record holds the evidence
// that clears it on the devices too (owner decision, 2026-10-08).
import type {Attention, Identity} from '@jimmie-potts/event-contracts/v2/families';
import {forConsumer, knownDetail, noticeCounts, type ConsumerPolicy, type SessionView} from '@jimmie-potts/event-contracts/v2/session-view';

/**
 * The state a session's chip shows, most pressing first: an approval, an input or a question to answer (or, for a
 * detail this version does not know, that the session needs the owner), work running, a finished turn not yet cleared,
 * and otherwise its work state.
 */
export type SessionChip = 'approval' | 'input' | 'question' | 'needs-owner' | 'working' | 'finished' | 'idle' | 'interrupted' | 'unknown';

export const CHIP_TEXT: Readonly<Record<SessionChip, string>> = {
  approval: 'Waiting for approval', input: 'Waiting for input', question: 'Question', 'needs-owner': 'Needs you', working: 'Working',
  finished: 'Finished · unread', idle: 'Idle', interrupted: 'Interrupted', unknown: 'Activity unknown',
};

/**
 * The dashboard's acknowledgment and read policy, unchanged by #1865: any consumer's acknowledgment clears a finished
 * turn, as on LIFX and Tidbyt (#1009's operator clear among them), and so does positive read evidence on the record.
 */
export const DASHBOARD_POLICY: ConsumerPolicy = Object.freeze({read: true});

/** One retained turn-ended notice, and who has acknowledged it. */
export type NoticeRow = {id: string; turn: string; acknowledgedBy: readonly string[]};

export type SessionRow = {
  id: string;
  /** The record's own generation: a new one is another run under the same identity. */
  generation: number;
  revision: number;
  /** The explicit label slot, separate from the title and neutral display fallback. */
  label: SessionView['label'];
  /** The label, then the title, then the neutral fallback, the native session ID. */
  name: string;
  /** The project, then the client, such as `agent-device-hub · Claude Code`. */
  where: string;
  chip: SessionChip;
  chipText: string;
  /** Retained unread evidence, independent of the face's higher-priority attention/activity chip. */
  unread: boolean;
  /** The hub's status is unknown or its working status is unconfirmed (`uncertainOf`); the copy's own sync is separate. */
  uncertain: boolean;
  /** Why the row is uncertain, as a sentence, while it is. */
  uncertainty: string | undefined;
  /** One line per attention item, in the record's order. */
  attention: string[];
  notices: NoticeRow[];
  /**
   * When the hub last heard from the session: the core's instant of its last lifecycle evidence, which the record
   * carries to within `SESSION_LIMITS.evidenceResolutionMs`, one minute (Hub #1947). The page shows its age (`heardAge`).
   */
  lastEvidenceAtMs: number;
  facts: {source: string; sessionId: string; work: string; read: string; parent: string; children: string};
};

const CLIENTS: Readonly<Record<string, string>> = {'claude/code': 'Claude Code', 'codex/cli': 'Codex CLI', 'codex/desktop': 'Codex Desktop', 'codex/local': 'Codex (local)',
  'bunny/assistant': 'B.U.N.N.Y. assistant'};
/** The client a session runs in, as a person names it. */
export const clientName = ({provider, client, hostId, sourceId}: Identity): string =>
  // This owner-selected source is explicitly Mac-local; other local sources remain surface-unspecified.
  provider === 'codex' && client === 'local' && hostId === 'mac-mini' && sourceId === 'codex-local-hooks'
    ? 'Mac Codex' : CLIENTS[`${provider}/${client}`] ?? `${provider} ${client}`;

/** The name a session shows: an explicit label first, then its title, then its native ID (AGENTS.md, Hub #424). */
export const sessionName = (view: Pick<SessionView, 'label' | 'title' | 'identity'>): string => view.label?.value ?? view.title?.value ?? view.identity.sessionId;

const attentionLine = ({kind}: Attention): string => kind === 'question' ? 'Question · continuing' : `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)} · blocked attention`;
const FINISHED: SessionView['status'] = {class: 'finished', detail: 'turn-ended'};

/**
 * Whether the session holds a finished turn that is still unread for the dashboard, whatever its higher-ranked status:
 * a notice that still counts (`noticeCounts`: a known later turn supersedes it, an unknown turn proves nothing) that
 * the dashboard's policy has not retired by a consumer's acknowledgment or positive read evidence on the record, such as
 * Codex Desktop's read marker. Missing evidence never counts as read.
 */
export function finishedUnread(view: SessionView): boolean {
  if (!view.outcome.notices.some(notice => noticeCounts(notice, view.turn))) return false;
  return forConsumer({...view, status: FINISHED}, DASHBOARD_POLICY).status.class === 'finished';
}

/**
 * The chip for one session, from the hub's status as the dashboard's policy shows it: the attention, named by its
 * detail; work, its own or a working child's; a finished turn still unread; and otherwise its work state. A detail this
 * version does not know falls back to its class.
 */
export function chipOf(view: SessionView): SessionChip {
  const {status, work} = forConsumer(view, DASHBOARD_POLICY);
  switch (status.class) {
    case 'needs-owner':
      return knownDetail(status) ? status.detail as 'approval' | 'input' | 'question' : 'needs-owner';
    case 'working':
      return 'working';
    case 'finished':
      return 'finished';
    case 'quiet':
    case 'unknown':
      return work.state === 'idle' || work.state === 'interrupted' ? work.state : 'unknown';
  }
}

const RESULT_TEXT: Readonly<Record<string, string>> = {succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled'};

/**
 * The chip's words for a session: the chip's own, except that a task whose finished turn records its result names it
 * (Hub #505): `Failed · unread` while it counts as finished, and `Failed` once the dashboard's policy retired it. A
 * finished turn without a result never names one, so the dashboard never claims success it has no evidence of.
 */
export function chipTextOf(view: SessionView, chip: SessionChip = chipOf(view)): string {
  const counting = view.outcome.notices.filter(notice => noticeCounts(notice, view.turn));
  const result = [...counting].reverse().find(notice => notice.result !== undefined)?.result;
  const text = result === undefined ? undefined : RESULT_TEXT[result];
  if (text === undefined) return CHIP_TEXT[chip];
  return chip === 'finished' ? `${text} · unread` : chip === 'idle' ? text : CHIP_TEXT[chip];
}

/**
 * Why a session is uncertain, or undefined when it is not (design decision 10): only an `unknown` status, or a `working`
 * status whose work is unconfirmed. Silence never makes a session that waits for the owner or holds a finished turn
 * uncertain, even while the turn under its question is unconfirmed. A copy that is not synced is uncertain as a whole;
 * each caller adds that from the copy.
 */
export function uncertainOf(view: SessionView): string | undefined {
  if (view.status.class === 'unknown') return 'The hub does not know what this session is doing.';
  if (view.status.class === 'working' && view.work.confidence === 'unconfirmed') return 'Its work is unconfirmed.';
  return undefined;
}

/** The chip's words: the last copy's state while the copy is not synced, and unconfirmed work named as such. */
export const faceText = (row: SessionRow, synced: boolean): string =>
  !synced ? 'Stale' : row.uncertain && row.chip === 'working' ? 'Unconfirmed' : row.chipText;

const parentText = (view: SessionView): string => {
  switch (view.parent.status) {
    case 'known':
      return view.parent.identity.sessionId;
    case 'top-level':
      return 'Top-level session';
    case 'unknown':
      return 'Unknown';
  }
};

/** One session as the dashboard shows it, from its view alone. */
export function sessionRow(view: SessionView): SessionRow {
  const chip = chipOf(view);
  const {identity, work} = view;
  const uncertainty = uncertainOf(view);
  return {
    id: view.id, generation: view.generation, revision: view.revision, label: view.label, name: sessionName(view),
    where: [view.project, clientName(identity)].filter((part): part is string => part !== undefined).join(' · '),
    chip, chipText: chipTextOf(view, chip), unread: finishedUnread(view), uncertain: uncertainty !== undefined, uncertainty,
    attention: view.attention.items.map(attentionLine),
    notices: view.outcome.notices.map(notice => ({id: notice.id, turn: notice.turn.status === 'known' ? notice.turn.id : 'unknown turn', acknowledgedBy: notice.acknowledgedBy})),
    lastEvidenceAtMs: view.lastEvidenceAtMs,
    facts: {
      source: `${identity.hostId} / ${identity.sourceId}`, sessionId: identity.sessionId,
      work: work.confidence === 'confirmed' ? work.state : `${work.state}, unconfirmed (${work.reasons.join(', ')})`, read: view.outcome.read,
      parent: parentText(view), children: `${String(view.relationships.children.working)} working / ${String(view.relationships.children.unconfirmed)} unconfirmed`,
    },
  };
}

/** Every session in the copy's order. */
export function sessionRows(views: readonly SessionView[]): SessionRow[] {
  return views.map(sessionRow);
}

/** Attention is independent of work, unread notices and the copy's sync. */
export const needsAttention = (row: SessionRow): boolean => row.attention.length > 0;

/** Full-collection counts; retained evidence never establishes current work while disconnected. */
export function agentSummary(rows: readonly SessionRow[], live: boolean): {working: number; attention: number; unread: number} {
  return {
    working: rows.filter(row => live && !row.uncertain && row.chip === 'working').length,
    attention: rows.filter(needsAttention).length,
    unread: rows.filter(row => row.unread).length,
  };
}

/** Whether a session matches the sessions widget's search and provider filter. */
export function matches(view: SessionView, query: string, provider: string): boolean {
  if (provider !== '' && view.identity.provider !== provider) return false;
  if (query === '') return true;
  const needle = query.toLowerCase();
  return [view.label?.value, view.title?.value, view.project, view.identity.sessionId].some(text => text?.toLowerCase().includes(needle) === true);
}

/** A duration as the dashboard writes it. */
export const age = (ms: number): string => ms < 1000 ? 'less than 1s' : ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m`;

/**
 * How long ago the hub last heard from a session, computed against the page's clock from the record's evidence time
 * (Hub #1947). The core publishes that time to the minute, so the age is in whole minutes, with hours past the first.
 */
export function heardAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 1 ? '<1m' : minutes < 60 ? `${String(minutes)}m` : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
