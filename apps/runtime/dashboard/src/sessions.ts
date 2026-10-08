// What the dashboard shows of each agent session (Hub #922), derived only from the session record the core publishes
// and the page syncs (ADR 0012, "Inbox and history"; Hub #831). The page never clears a finished turn itself or on a
// timer, and never infers readership from missing evidence: a finished turn shows unread until the record holds the
// evidence that clears it on the devices too (owner decision, 2026-10-08). That rule is the dashboard's own, here; the
// shared status helper, which other consumers use, is unchanged.
import type {Attention, AttentionKind, Identity, KnownId, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';

/**
 * The state a session's chip shows, most pressing first: a question, an input or an approval to answer, work running,
 * a finished turn not yet cleared, and otherwise its activity.
 */
export type SessionChip = 'approval' | 'input' | 'question' | 'working' | 'finished' | 'idle' | 'interrupted' | 'unknown';

export const CHIP_TEXT: Readonly<Record<SessionChip, string>> = {
  approval: 'Waiting for approval', input: 'Waiting for input', question: 'Question', working: 'Working', finished: 'Finished · unread',
  idle: 'Idle', interrupted: 'Interrupted', unknown: 'Activity unknown',
};

/** One retained turn-ended notice, and who has acknowledged it. */
export type NoticeRow = {id: string; turn: string; acknowledgedBy: readonly string[]};

export type SessionRow = {
  id: string;
  /** The record's own generation: a new one is another run under the same identity. */
  generation: number;
  revision: number;
  /** The explicit label slot, separate from the title and neutral display fallback. */
  label: SessionRecord['label'];
  /** The label, then the title, then the neutral fallback, the native session ID. */
  name: string;
  /** The project, then the client, such as `agent-device-hub · Claude Code`. */
  where: string;
  chip: SessionChip;
  chipText: string;
  /** The record's freshness is uncertain: five minutes without evidence, or since the core restarted. */
  uncertain: boolean;
  /** One line per attention item, in the record's order. */
  attention: string[];
  notices: NoticeRow[];
  lastEvidenceAtMs: number;
  facts: {source: string; sessionId: string; activity: string; read: string; parent: string; children: string};
};

const CLIENTS: Readonly<Record<string, string>> = {'claude/code': 'Claude Code', 'codex/cli': 'Codex CLI', 'codex/desktop': 'Codex Desktop'};
/** The client a session runs in, as a person names it. */
export const clientName = ({provider, client}: Identity): string => CLIENTS[`${provider}/${client}`] ?? `${provider} ${client}`;

/** The name a session shows: an explicit label first, then its title, then its native ID (AGENTS.md, Hub #424). */
export const sessionName = (record: SessionRecord): string => record.label?.value ?? record.title?.value ?? record.identity.sessionId;

const ATTENTION_RANK: readonly AttentionKind[] = ['approval', 'input', 'question'];
const attentionLine = ({kind}: Attention): string => kind === 'question' ? 'Question · continuing' : `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)} · blocked attention`;

const sameTurn = (a: KnownId, b: KnownId): boolean => a.status === 'known' && b.status === 'known' && a.id === b.id;
/** A known turn other than the notice's has started since: the session moved on to its next turn. */
const nextTurnStarted = (record: SessionRecord, turn: KnownId): boolean => turn.status === 'known' && record.turn.status === 'known' && !sameTurn(record.turn, turn);

/**
 * Whether the session holds a finished turn that is still unread, by the evidence that clears it on the devices too: a
 * consumer's acknowledgment of its notice (#1009's operator clear among them), the session's next turn, or positive
 * read evidence on the record, such as Codex Desktop's read marker. Missing evidence never counts as read: an unknown
 * turn or read state leaves the turn unread.
 */
export function finishedUnread(record: SessionRecord): boolean {
  if (record.read === 'read') return false;
  return record.notices.some(notice => notice.acknowledgedBy.length === 0 && !nextTurnStarted(record, notice.turn));
}

/**
 * The chip for one session, most pressing first: the attention, named by kind; work, its own or an active child's; a
 * finished turn still unread; and otherwise its activity.
 */
export function chipOf(record: SessionRecord): SessionChip {
  if (record.attention.length > 0) return ATTENTION_RANK.find(kind => record.attention.some(item => item.kind === kind)) ?? 'question';
  if (record.activity === 'active' || record.children.active > 0) return 'working';
  if (finishedUnread(record)) return 'finished';
  return record.activity;
}

const parentText = (record: SessionRecord): string => {
  switch (record.parent.status) {
    case 'known':
      return record.parent.identity.sessionId;
    case 'top-level':
      return 'Top-level session';
    case 'unknown':
      return 'Unknown';
  }
};

/** One session as the dashboard shows it, from its record alone. */
export function sessionRow(record: SessionRecord): SessionRow {
  const chip = chipOf(record);
  const {identity} = record;
  return {
    id: record.id, generation: record.generation, revision: record.revision, label: record.label, name: sessionName(record),
    where: [record.project, clientName(identity)].filter((part): part is string => part !== undefined).join(' · '),
    chip, chipText: CHIP_TEXT[chip], uncertain: record.freshness !== 'current' || record.restartUncertain,
    attention: record.attention.map(attentionLine),
    notices: record.notices.map(notice => ({id: notice.id, turn: notice.turn.status === 'known' ? notice.turn.id : 'unknown turn', acknowledgedBy: notice.acknowledgedBy})),
    lastEvidenceAtMs: record.lastEvidenceAtMs,
    facts: {
      source: `${identity.hostId} / ${identity.sourceId}`, sessionId: identity.sessionId, activity: record.activity, read: record.read,
      parent: parentText(record), children: `${record.children.active} active / ${record.children.uncertain} uncertain`,
    },
  };
}

/** Every session in the copy's order, and how many are working. */
export function sessionRows(records: readonly SessionRecord[]): SessionRow[] {
  return records.map(sessionRow);
}

/** Whether a session matches the sessions widget's search and provider filter. */
export function matches(record: SessionRecord, query: string, provider: string): boolean {
  if (provider !== '' && record.identity.provider !== provider) return false;
  if (query === '') return true;
  const needle = query.toLowerCase();
  return [record.label?.value, record.title?.value, record.project, record.identity.sessionId].some(text => text?.toLowerCase().includes(needle) === true);
}

/** A duration as the dashboard writes it. */
export const age = (ms: number): string => ms < 1000 ? 'less than 1s' : ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m`;
