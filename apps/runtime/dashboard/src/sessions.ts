// What the dashboard shows of each agent session (Hub #922), derived only from the session record the core publishes
// and the page syncs (ADR 0012, "Inbox and history"; Hub #831). The page never clears a finished turn itself or on a
// timer: a finished turn shows unread until the record says otherwise. The state ranking is the shared status helper's,
// so the page and the devices agree.
import type {Attention, AttentionKind, Identity, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sessionState} from '@jimmie-potts/event-contracts/v2/status';

/** The dashboard's consumer ID in the core: it may acknowledge a notice for itself only (Hub #918). */
export const DASHBOARD_CONSUMER = 'dashboard';

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
export type NoticeRow = {id: string; turn: string; acknowledgedBy: readonly string[]; byDashboard: boolean};

export type SessionRow = {
  id: string;
  /** The record's own generation: a new one is another run under the same identity. */
  generation: number;
  revision: number;
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
  /** A turn-ended notice that no consumer has acknowledged: the finished turn is unread. */
  finished: boolean;
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

/** The chip for one session: the shared helper's state, with the attention kind named and the activity otherwise. */
export function chipOf(record: SessionRecord): SessionChip {
  const state = sessionState(record);
  switch (state) {
    case 'attention':
      return ATTENTION_RANK.find(kind => record.attention.some(item => item.kind === kind)) ?? 'question';
    case 'working':
      return 'working';
    case 'done':
      return 'finished';
    case undefined:
      return record.activity === 'active' ? 'working' : record.activity;
  }
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
    id: record.id, generation: record.generation, revision: record.revision, name: sessionName(record),
    where: [record.project, clientName(identity)].filter((part): part is string => part !== undefined).join(' · '),
    chip, chipText: CHIP_TEXT[chip], uncertain: record.freshness !== 'current' || record.restartUncertain,
    attention: record.attention.map(attentionLine),
    finished: record.notices.some(notice => notice.acknowledgedBy.length === 0),
    notices: record.notices.map(notice => ({
      id: notice.id, turn: notice.turn.status === 'known' ? notice.turn.id : 'unknown turn', acknowledgedBy: notice.acknowledgedBy,
      byDashboard: notice.acknowledgedBy.includes(DASHBOARD_CONSUMER),
    })),
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
