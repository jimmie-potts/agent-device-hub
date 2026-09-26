import { createHash } from 'node:crypto';
import type { SessionSnapshot, Snapshot } from '@jimmie-potts/agent-state';
import { sessionState as sharedSessionState, STATUS_COLORS as SHARED_STATUS_COLORS, type AgentState } from '@jimmie-potts/agent-status';
import { dim, fill, text, textWidth, type Rgb } from './draw.js';
import { fontText, GLYPH_ADVANCE, GLYPH_HEIGHT } from './font.js';
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, type Frame } from './render.js';

/**
 * Pure status view of one shared agent-state snapshot. It reads the owner's
 * calculated state and never reduces lifecycle events itself. The per-session
 * ranking is the shared `@jimmie-potts/agent-status` reduction every device
 * that shows automatic agent status consumes; this module only owns the
 * 64x32 display vocabulary (ASK/RUN/DONE) and layout.
 */
export type StatusState = 'ASK' | 'RUN' | 'DONE';
export type StatusRow =
  | { kind: 'session'; state: StatusState; label: string; uncertain: boolean }
  | { kind: 'more'; count: number }
  | { kind: 'feed' };
export type StatusView = {
  /** `unavailable` when the snapshot could not be read or its collector is not running. */
  feed: 'available' | 'unavailable';
  rows: StatusRow[];
  /** True only when the feed is available and no session needs showing. */
  idle: boolean;
};
export type StatusViewOptions = {
  /** False when the latest read failed and `snapshot` is the last good one. */
  feedAvailable?: boolean;
  /** Consumers whose acknowledgment retires DONE. Omitted: any consumer's acknowledgment. */
  acknowledgingConsumers?: readonly string[];
};

export const STATUS_ROWS = 4;
export const LABEL_CHARS = 10;
const RANK: Record<StatusState, number> = { ASK: 0, RUN: 1, DONE: 2 };
const DISPLAY: Record<AgentState, StatusState> = { attention: 'ASK', working: 'RUN', done: 'DONE' };

function sessionState(session: SessionSnapshot, consumers?: readonly string[]): StatusState | undefined {
  const state = sharedSessionState(session, consumers);
  return state ? DISPLAY[state] : undefined;
}

function identityHash(session: SessionSnapshot): string {
  const { provider, client, hostId, sourceId, sessionId } = session.identity;
  return createHash('sha256').update(JSON.stringify([provider, client, hostId, sourceId, sessionId])).digest('hex');
}

/** Owner-resolved label, title, project display name/legacy ID, then a neutral identity hash. */
function sessionLabel(session: SessionSnapshot, hash: string): string {
  const chosen = session.label || session.title?.value || session.project || session.projectId;
  const text = chosen ? chosen : `${session.identity.provider === 'codex' ? 'X' : 'C'}-${hash.slice(0, 4)}`;
  return fontText(text).slice(0, LABEL_CHARS);
}

export function statusView(snapshot: Snapshot | undefined, options: StatusViewOptions = {}): StatusView {
  const unavailable = options.feedAvailable === false || !snapshot || snapshot.collector !== 'running';
  const shown = (snapshot?.sessions ?? [])
    .filter(session => session.parent.status !== 'known')
    .map(session => ({ session, state: sessionState(session, options.acknowledgingConsumers), hash: identityHash(session) }))
    .filter((entry): entry is typeof entry & { state: StatusState } => entry.state !== undefined)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.session.lastEvidenceAtMs - a.session.lastEvidenceAtMs
      || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const visible = shown.length > STATUS_ROWS ? shown.slice(0, STATUS_ROWS - 1) : shown;
  const rows: StatusRow[] = visible.map(({ session, state, hash }) => ({
    kind: 'session', state, label: sessionLabel(session, hash),
    uncertain: unavailable || session.freshness === 'uncertain',
  }));
  if (shown.length > visible.length) rows.push({ kind: 'more', count: shown.length - visible.length });
  if (unavailable && !rows.length) rows.push({ kind: 'feed' });
  return { feed: unavailable ? 'unavailable' : 'available', rows, idle: !unavailable && shown.length === 0 };
}

export const STATUS_COLORS: Readonly<Record<StatusState | 'TEXT' | 'MUTED', Rgb>> = Object.freeze({
  ASK: SHARED_STATUS_COLORS.attention, RUN: SHARED_STATUS_COLORS.working, DONE: SHARED_STATUS_COLORS.done,
  TEXT: [220, 220, 220], MUTED: [140, 140, 140],
});
/** Draw a status view as the renderer's 64×32 RGB frame: one 8-pixel row per entry. */
export function statusFrame(view: StatusView): Frame {
  const rgb = new Uint8Array(FRAME_BYTES);
  view.rows.slice(0, STATUS_ROWS).forEach((row, index) => {
    const top = index * 8;
    const baseline = top + Math.floor((8 - GLYPH_HEIGHT) / 2);
    if (row.kind === 'more') return text(rgb, 0, baseline, `+${row.count} MORE`, STATUS_COLORS.MUTED);
    if (row.kind === 'feed') return text(rgb, 0, baseline, 'FEED ?', STATUS_COLORS.MUTED);
    const shade = (color: Rgb) => row.uncertain ? dim(color) : color;
    const marker = shade(STATUS_COLORS[row.state]);
    if (row.uncertain) text(rgb, 0, baseline, '?', marker);
    else for (let y = top + 2; y < top + 5; y++) for (let x = 0; x < 3; x++) fill(rgb, x, y, marker);
    text(rgb, GLYPH_ADVANCE + 1, baseline, row.label, shade(STATUS_COLORS.TEXT));
    text(rgb, FRAME_WIDTH - textWidth(row.state), baseline, row.state, marker);
  });
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb };
}
