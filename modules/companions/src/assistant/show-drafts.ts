import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {draftProblem, showVersion, starter, type ShowSave} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';

type PendingSave = {requestId: string; admitByMs: number};
type Draft = {revision: number; value: ShowSave; pending: PendingSave | null};
type Result = {text: string} | {code: ErrorCode};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readPending(text: string): PendingSave {
  const pending: unknown = JSON.parse(text);
  if (!object(pending) || typeof pending.requestId !== 'string' || typeof pending.admitByMs !== 'number') {
    throw new Error('Invalid pending show save.');
  }
  return {requestId: pending.requestId, admitByMs: pending.admitByMs};
}

export class ShowDrafts {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_show_drafts (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL, pending TEXT
    )`);
  }

  list(offset: number, limit: number, exactId: string): {id: string; revision: number; name: string; expectedVersion: number}[] {
    const records = this.database.prepare("SELECT id FROM assistant_show_drafts WHERE ? = '' OR id = ? ORDER BY rowid DESC LIMIT ? OFFSET ?")
      .all(exactId, exactId, limit, offset);
    return records.flatMap(({id}) => {
      const draft = this.read(id);
      return draft === undefined ? [] : [{id: draft.value.showId, revision: draft.revision, name: draft.value.name, expectedVersion: draft.value.expectedVersion}];
    });
  }

  read(id: unknown): Draft | undefined {
    if (typeof id !== 'string') return undefined;
    const row = this.database.prepare('SELECT revision, value, pending FROM assistant_show_drafts WHERE id = ?').get(id);
    if (typeof row?.revision !== 'number' || typeof row.value !== 'string') return undefined;
    const raw: unknown = JSON.parse(row.value);
    if (!object(raw) || typeof raw.expectedVersion !== 'number') return undefined;
    const value = showVersion({schema: 'nanoleaf-show-version/2.0', showId: id, version: 1, kind: 'decorative',
      name: raw.name, versionName: raw.versionName, timeline: raw.timeline}, id, 1);
    const pending = typeof row.pending === 'string' ? readPending(row.pending) : null;
    return {revision: row.revision, pending,
      value: {showId: id, expectedVersion: raw.expectedVersion, name: value.name, versionName: value.versionName, timeline: value.timeline}};
  }

  create(input: Readonly<Record<string, unknown>>): Result {
    const {name, starter: selected} = input;
    if (typeof name !== 'string' || (selected !== 'warm' && selected !== 'ocean')) return {code: 'invalid-request'};
    const value = {...starter(selected, `show-${randomUUID()}`), name};
    if (draftProblem(value) !== undefined) return {code: 'invalid-request'};
    this.database.prepare('INSERT INTO assistant_show_drafts (id, revision, value) VALUES (?, 1, ?)').run(value.showId, JSON.stringify(value));
    return this.preview(value.showId);
  }

  edit(input: Readonly<Record<string, unknown>>): Result {
    const {draftId, revision, cue, changes} = input;
    const draft = this.read(draftId);
    if (draft === undefined) return {code: 'not-found'};
    if (draft.revision !== revision) return {code: 'revision-conflict'};
    if (typeof cue !== 'string' || typeof changes !== 'string' || changes.length > 2048) return {code: 'invalid-request'};
    let patch: unknown;
    try {patch = JSON.parse(changes);} catch {return {code: 'invalid-request'};}
    if (!object(patch) || Object.keys(patch).some(key => !['offsetMs', 'durationMs', 'intensity', 'recipe'].includes(key)) ||
      (patch.recipe !== undefined && !object(patch.recipe))) return {code: 'invalid-request'};
    const timeline = draft.value.timeline;
    const original = timeline.cues.find(item => item.id === cue);
    if (original === undefined) return {code: 'not-found'};
    const candidate = {...timeline, cues: timeline.cues.map(item => item.id === cue ? {...original, ...patch,
      recipe: {...original.recipe, ...(object(patch.recipe) ? patch.recipe : {})}} : item)};
    let value: ShowSave;
    try {
      const {showId, name, versionName} = draft.value;
      const parsed = showVersion({schema: 'nanoleaf-show-version/2.0', showId, name, versionName, version: 1,
        kind: 'decorative', timeline: candidate}, showId, 1);
      value = {...draft.value, timeline: parsed.timeline};
    } catch {return {code: 'invalid-request'};}
    this.database.prepare('UPDATE assistant_show_drafts SET revision = revision + 1, value = ? WHERE id = ? AND revision = ?')
      .run(JSON.stringify(value), value.showId, draft.revision);
    return this.preview(value.showId);
  }

  preview(id: unknown): Result {
    const draft = this.read(id);
    if (draft === undefined) return {code: 'not-found'};
    const {value, revision} = draft;
    const cues = value.timeline.cues.map(cue => `${cue.id} · ${String(cue.offsetMs)}–${String(cue.offsetMs + cue.durationMs)} ms · ${cue.recipe.pattern} · ${cue.recipe.colors.join(', ')} · intensity ${String(cue.intensity)}`);
    return {text: `Draft ${value.name} (${value.showId}, revision ${String(revision)}), ${String(value.timeline.durationMs)} ms. Preview only.\n${cues.join('\n')}`};
  }

  noteSave(input: Readonly<Record<string, unknown>>, pending: PendingSave): ErrorCode | undefined {
    const draft = this.read(input.showId);
    if (draft === undefined) return 'not-found';
    if (draft.pending !== null) return 'uncertain-result';
    const value = {...draft.value, versionName: input.versionName};
    if (!isDeepStrictEqual(value, input)) return 'revision-conflict';
    this.database.prepare('UPDATE assistant_show_drafts SET pending = ? WHERE id = ?').run(JSON.stringify(pending), draft.value.showId);
    return undefined;
  }

  clearSave(id: string, requestId: string): void {
    const pending = this.read(id)?.pending;
    if (pending?.requestId !== requestId) return;
    this.database.prepare('UPDATE assistant_show_drafts SET pending = NULL WHERE id = ? AND pending = ?').run(id, JSON.stringify(pending));
  }

  bindSaveToHead(draft: Draft, head: number): void {
    const value = {...draft.value, expectedVersion: head};
    this.database.prepare('UPDATE assistant_show_drafts SET value = ? WHERE id = ? AND revision = ? AND pending IS NULL')
      .run(JSON.stringify(value), value.showId, draft.revision);
  }

  confirmSave(draft: Draft): void {
    if (draft.pending === null) return;
    const value = {...draft.value, expectedVersion: draft.value.expectedVersion + 1};
    this.database.prepare('UPDATE assistant_show_drafts SET value = ?, pending = NULL WHERE id = ? AND pending = ?')
      .run(JSON.stringify(value), value.showId, JSON.stringify(draft.pending));
  }
}
