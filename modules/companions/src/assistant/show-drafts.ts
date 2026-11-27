import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {draftProblem, showVersion, starter, type ShowSave} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';

type PendingSave = {requestId: string; admitByMs: number};
type Draft = {revision: number; value: ShowSave; pending: PendingSave | null};
type Result = {text: string; draftId: string} | {code: ErrorCode};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function showCueIndex(cues: ShowSave['timeline']['cues'], cue: string): number {
  const idIndex = cues.findIndex(item => item.id === cue);
  return idIndex >= 0 ? idIndex : /^[1-9]\d*$/u.test(cue) ? Number(cue) - 1 : -1;
}

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

  list(offset: number, limit: number, exactId: string, visible: (id: string) => boolean): {id: string; revision: number; name: string; expectedVersion: number}[] {
    const records = this.database.prepare("SELECT id FROM assistant_show_drafts WHERE ? = '' OR id = ? ORDER BY rowid DESC")
      .all(exactId, exactId).filter(({id}) => typeof id === 'string' && visible(id)).slice(offset, offset + limit);
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

  references(visible: (id: string) => boolean): {id: string; label: string}[] {
    const rows = this.database.prepare("SELECT id, json_extract(value, '$.name') AS name FROM assistant_show_drafts");
    const result: {id: string; label: string}[] = [];
    for (const {id, name} of rows.iterate()) {
      if (typeof id === 'string' && typeof name === 'string' && visible(id)) result.push({id, label: name});
    }
    return result;
  }

  find(selector: unknown, visible: (id: string) => boolean = () => true): Draft | {code: ErrorCode} {
    if (typeof selector !== 'string' || selector.length === 0 || selector.length > 131) return {code: 'invalid-request'};
    const exactId = selector.startsWith('id:') ? selector.slice(3) : selector;
    if (/^show-[a-z0-9-]+$/u.test(exactId)) {
      if (!visible(exactId)) return {code: 'not-found'};
      const exact = this.read(exactId);
      if (exact !== undefined || selector.startsWith('id:')) return exact ?? {code: 'not-found'};
    }
    let chosen: string | undefined;
    const matches = this.database.prepare("SELECT id FROM assistant_show_drafts WHERE lower(json_extract(value, '$.name')) = lower(?)");
    for (const {id} of matches.iterate(selector.trim())) {
      if (typeof id !== 'string' || !visible(id)) continue;
      if (chosen !== undefined) return {code: 'invalid-state'};
      chosen = id;
    }
    return this.read(chosen) ?? {code: 'not-found'};
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
    const draft = this.find(draftId);
    if ('code' in draft) return draft;
    if (revision !== -1 && draft.revision !== revision) return {code: 'revision-conflict'};
    if (typeof cue !== 'string' || typeof changes !== 'string' || changes.length > 2048) return {code: 'invalid-request'};
    let patch: unknown;
    try {patch = JSON.parse(changes);} catch {return {code: 'invalid-request'};}
    if (!object(patch) || Object.keys(patch).some(key => !['offsetMs', 'durationMs', 'intensity', 'recipe'].includes(key)) ||
      (patch.recipe !== undefined && !object(patch.recipe))) return {code: 'invalid-request'};
    const timeline = draft.value.timeline;
    const original = timeline.cues[showCueIndex(timeline.cues, cue)];
    if (original === undefined) return {code: 'not-found'};
    const candidate = {...timeline, cues: timeline.cues.map(item => item.id === original.id ? {...original, ...patch,
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
    return {draftId: value.showId, text: `Draft ${value.name} (${value.showId}, revision ${String(revision)}), ${String(value.timeline.durationMs)} ms. Preview only.\n${cues.join('\n')}`};
  }

  noteSave(input: Readonly<Record<string, unknown>>, pending: PendingSave, expectedDraftRevision: number): ErrorCode | undefined {
    const draft = this.read(input.showId);
    if (draft === undefined) return 'not-found';
    if (draft.revision !== expectedDraftRevision) return 'revision-conflict';
    if (draft.pending !== null) return 'uncertain-result';
    const head = input.expectedVersion;
    if (typeof head !== 'number' || head < draft.value.expectedVersion) return 'revision-conflict';
    const value = {...draft.value, versionName: input.versionName, expectedVersion: head};
    if (!isDeepStrictEqual(value, input)) return 'revision-conflict';
    this.database.prepare('UPDATE assistant_show_drafts SET value = ?, pending = ? WHERE id = ?')
      .run(JSON.stringify({...draft.value, expectedVersion: head}), JSON.stringify(pending), draft.value.showId);
    return undefined;
  }

  clearSave(id: string, requestId: string): void {
    const pending = this.read(id)?.pending;
    if (pending?.requestId !== requestId) return;
    this.database.prepare('UPDATE assistant_show_drafts SET pending = NULL WHERE id = ? AND pending = ?').run(id, JSON.stringify(pending));
  }

  confirmSave(draft: Draft): void {
    if (draft.pending === null) return;
    const value = {...draft.value, expectedVersion: draft.value.expectedVersion + 1};
    this.database.prepare('UPDATE assistant_show_drafts SET value = ?, pending = NULL WHERE id = ? AND pending = ?')
      .run(JSON.stringify(value), value.showId, JSON.stringify(draft.pending));
  }
}
