// The status tile's view and frame (Hub #930). Copied from controllers/tidbyt/src/status.ts at main 627e3fe3 and
// rewritten for the module's synced copy of the core's `session/2.0` records, through the shared status helper in
// `@jimmie-potts/event-contracts/v2/status` (#918). It reads the owner's calculated state and never reduces lifecycle
// events itself. The per-session ranking is the shared `sessionState`; this file only owns the 64x32 display
// vocabulary (ASK, RUN and DONE) and the layout.
import {createHash} from 'node:crypto';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {STATUS_COLORS as SHARED_STATUS_COLORS, sessionState as sharedSessionState, type AgentState, type SessionCopy} from '@jimmie-potts/event-contracts/v2/status';
import {dim, fill, text, textWidth, type Rgb} from './draw.js';
import {fontText, GLYPH_ADVANCE, GLYPH_HEIGHT} from './font.js';
import {FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, type Frame} from './render.js';

export type StatusState = 'ASK' | 'RUN' | 'DONE';
export type StatusRow =
  | {kind: 'session'; state: StatusState; label: string; uncertain: boolean}
  | {kind: 'more'; count: number}
  | {kind: 'feed'};
export type StatusView = {
  /** `unavailable` while the copy of the sessions has not synced, or after a later sync failed. */
  feed: 'available' | 'unavailable';
  rows: StatusRow[];
  /** True only when the copy is synced and no session needs showing. */
  idle: boolean;
};
export type StatusViewOptions = {
  /** Consumers whose acknowledgment retires DONE. Omitted: any consumer's acknowledgment, as today (ADR 0012). */
  acknowledgingConsumers?: readonly string[];
};

export const STATUS_ROWS = 4;
export const LABEL_CHARS = 10;
const RANK: Readonly<Record<StatusState, number>> = {ASK: 0, RUN: 1, DONE: 2};
const DISPLAY: Readonly<Record<AgentState, StatusState>> = {attention: 'ASK', working: 'RUN', done: 'DONE'};

function sessionState(session: SessionRecord, consumers: readonly string[] | undefined): StatusState | undefined {
  const state = sharedSessionState(session, consumers);
  return state === undefined ? undefined : DISPLAY[state];
}

/**
 * The 1.x identity hash, over the identity's fields as a JSON array, so a session without a label keeps the neutral ID it
 * showed before the cutover. The 2.0 entity ID hashes the same fields as an object, which would show another one.
 */
function identityHash(session: SessionRecord): string {
  const {provider, client, hostId, sourceId, sessionId} = session.identity;
  return createHash('sha256').update(JSON.stringify([provider, client, hostId, sourceId, sessionId])).digest('hex');
}

const given = (value: string | undefined): value is string => value !== undefined && value !== '';

/** The owner-resolved label, then the title, the project's display name and its legacy ID, then a neutral hashed ID. */
function sessionLabel(session: SessionRecord, hash: string): string {
  const chosen = [session.label?.value, session.title?.value, session.project, session.projectId].find(given);
  const shown = chosen ?? `${session.identity.provider === 'codex' ? 'X' : 'C'}-${hash.slice(0, 4)}`;
  return fontText(shown).slice(0, LABEL_CHARS);
}

type Shown = {session: SessionRecord; state: StatusState; hash: string};

/** ASK, then RUN, then DONE; within a state, the newest evidence first; then by the identity hash, so the order is stable. */
function order(a: Shown, b: Shown): number {
  const byState = RANK[a.state] - RANK[b.state];
  if (byState !== 0) return byState;
  const byEvidence = b.session.lastEvidenceAtMs - a.session.lastEvidenceAtMs;
  if (byEvidence !== 0) return byEvidence;
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/**
 * The status view of a copy of the sessions. A copy that has not synced, or whose later sync failed, is an unavailable
 * feed: its last rows are marked uncertain, or the frame reads `FEED ?`, and it is never idle.
 */
export function statusView(copy: SessionCopy | undefined, options: StatusViewOptions = {}): StatusView {
  const unavailable = copy === undefined || !copy.synced;
  const shown = (copy?.sessions ?? [])
    .filter(session => session.parent.status !== 'known')
    .map(session => ({session, state: sessionState(session, options.acknowledgingConsumers), hash: identityHash(session)}))
    .filter((entry): entry is typeof entry & {state: StatusState} => entry.state !== undefined)
    .sort(order);
  const visible = shown.length > STATUS_ROWS ? shown.slice(0, STATUS_ROWS - 1) : shown;
  const rows: StatusRow[] = visible.map(({session, state, hash}) => ({
    kind: 'session', state, label: sessionLabel(session, hash), uncertain: unavailable || session.freshness === 'uncertain',
  }));
  if (shown.length > visible.length) rows.push({kind: 'more', count: shown.length - visible.length});
  if (unavailable && rows.length === 0) rows.push({kind: 'feed'});
  return {feed: unavailable ? 'unavailable' : 'available', rows, idle: !unavailable && shown.length === 0};
}

export const STATUS_COLORS: Readonly<Record<StatusState | 'TEXT' | 'MUTED', Rgb>> = Object.freeze({
  ASK: SHARED_STATUS_COLORS.attention, RUN: SHARED_STATUS_COLORS.working, DONE: SHARED_STATUS_COLORS.done,
  TEXT: [220, 220, 220], MUTED: [140, 140, 140],
});

/** Draws a status view as a 64x32 RGB frame: one 8-pixel row per entry. */
export function statusFrame(view: StatusView): Frame {
  const rgb = new Uint8Array(FRAME_BYTES);
  view.rows.slice(0, STATUS_ROWS).forEach((row, index) => {
    const top = index * 8;
    const baseline = top + Math.floor((8 - GLYPH_HEIGHT) / 2);
    switch (row.kind) {
      case 'more':
        text(rgb, 0, baseline, `+${row.count} MORE`, STATUS_COLORS.MUTED);
        return;
      case 'feed':
        text(rgb, 0, baseline, 'FEED ?', STATUS_COLORS.MUTED);
        return;
      case 'session':
        break;
    }
    const shade = (color: Rgb): Rgb => row.uncertain ? dim(color) : color;
    const marker = shade(STATUS_COLORS[row.state]);
    if (row.uncertain) text(rgb, 0, baseline, '?', marker);
    else for (let y = top + 2; y < top + 5; y += 1) for (let x = 0; x < 3; x += 1) fill(rgb, x, y, marker);
    text(rgb, GLYPH_ADVANCE + 1, baseline, row.label, shade(STATUS_COLORS.TEXT));
    text(rgb, FRAME_WIDTH - textWidth(row.state), baseline, row.state, marker);
  });
  return {width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb};
}
