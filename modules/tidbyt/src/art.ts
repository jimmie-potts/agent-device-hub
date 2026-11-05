import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {MessageValidator, SCHEMA_BASE, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {artCommandRefusal, artReferenceRefusal, artStageDecision, registerArtFamilies, type ArtAmbientSetRequest, type ArtCopy, type ArtStageRequest} from '@jimmie-potts/event-contracts/v2/art';
import {Outcome, SdkError, fullDisk, type AddMessage, type Command, type ModuleContent, type Reply} from '@jimmie-potts/sdk';
import {ART_PROFILE} from './art-profile.js';
import type {TileReply} from './tiles.js';

export const MAX_ART_COPIES = 64;
type Family = 'art-stage' | 'art-ambient-set';
export type HeldArt = ArtCopy & {format: 'png' | 'gif'; frames: number; durationMs: number; delays: number[]; webp: Uint8Array};
type Row = {composition_id: string; sha256: string; expires_at_ms: number; format: 'png' | 'gif'; frames: number; duration_ms: number; delays: string; webp: Uint8Array; webp_sha256: string};
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const entity = (family: Family): string => family === 'art-stage' ? 'org.bunny.art.stage' : 'org.bunny.art-ambient.set';
const canonical = (data: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(key => [key, data[key]])));
const validator = new MessageValidator();
registerArtFamilies(validator);

type Options = {
  db: DatabaseSync; now: () => number; available: () => boolean;
  prepare: (stage: ArtStageRequest) => Promise<TileReply>;
  commit: (command: Command<Record<string, unknown>>, change: (add: AddMessage) => void) => Promise<boolean>;
  changed: (command: Command<Record<string, unknown>>) => void;
};

/** Private copies and local commands. A committed receipt and observed outcome share the copy/selection transaction. */
export class TidbytArt {
  readonly #options: Options;
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;

  constructor(options: Options) {
    this.#options = options;
    options.db.exec(`CREATE TABLE IF NOT EXISTS tidbyt_art (
      composition_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, format TEXT NOT NULL,
      frames INTEGER NOT NULL, duration_ms INTEGER NOT NULL, delays TEXT NOT NULL, webp BLOB NOT NULL, webp_sha256 TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_art_selection (id INTEGER PRIMARY KEY CHECK (id = 1), composition_id TEXT, sha256 TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_art_receipts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE (source, request_id)) STRICT`);
  }

  selected(): {compositionId: string; sha256: string} | null {
    const row = this.#options.db.prepare('SELECT composition_id, sha256 FROM tidbyt_art_selection WHERE id = 1').get() as {composition_id: string | null; sha256: string | null} | undefined;
    return row === undefined || row.composition_id === null || row.sha256 === null ? null : {compositionId: row.composition_id, sha256: row.sha256};
  }

  #held(id: string): HeldArt | undefined {
    const row = this.#options.db.prepare('SELECT * FROM tidbyt_art WHERE composition_id = ?').get(id) as Row | undefined;
    if (row === undefined) return;
    if (digest(row.webp) !== row.webp_sha256 || row.webp.length > ART_PROFILE.maxBytes) throw new SdkError(errorBody('unavailable', {detail: 'the private art copy could not be verified'}));
    return {compositionId: row.composition_id, sha256: row.sha256, expiresAtMs: row.expires_at_ms, format: row.format, frames: row.frames,
      durationMs: row.duration_ms, delays: JSON.parse(row.delays) as number[], webp: new Uint8Array(row.webp)};
  }

  /** Admission takes an independent copy. Later expiry or staging cannot alter an accepted moment. */
  reference(id: string): HeldArt | ErrorBody {
    try {
      const held = this.#held(id), refused = artReferenceRefusal(held, this.#options.now());
      return refused ?? held ?? errorBody('not-found');
    } catch {return errorBody('unavailable', {detail: 'the private art copy could not be read'});}
  }

  content(ref: string): ModuleContent | ErrorBody | undefined {
    if (ref === 'art-profile') return {type: 'application/json', bytes: Buffer.from(JSON.stringify({id: 'tidbyt-art', version: '1', ...ART_PROFILE, formats: ['png', 'gif'], output: 'image/webp', transparency: 'black', visible: 'unverified'}))};
    const match = /^(art|art-info)\.([0-9a-f]{64})$/.exec(ref);
    if (match === null) return;
    const held = this.reference(match[2] ?? '');
    if ('error' in held) return held;
    return match[1] === 'art' ? {type: 'image/webp', bytes: held.webp} : {type: 'application/json', bytes: Buffer.from(JSON.stringify({
      compositionId: held.compositionId, sourceSha256: held.sha256, expiresAtMs: held.expiresAtMs, width: 64, height: 32, frames: held.frames,
      durationMs: held.durationMs, delaysMs: held.delays, bytes: held.webp.length, sha256: digest(held.webp), visible: 'unverified',
    }))};
  }

  handle(family: Family, command: Command<Record<string, unknown>>): Promise<Reply> | Reply {
    const refusal = artCommandRefusal(command.source);
    if (refusal !== undefined) return refusal;
    if (command.dataschema !== `${SCHEMA_BASE}${family}/2.0` || command.type !== `${entity(family)}.requested` || !validator.validate(command).ok) return errorBody('invalid-request', {detail: 'the command does not match its art family'});
    if (!this.#options.available()) return errorBody('unavailable', {detail: 'the Tidbyt art owner is not available'});
    if (this.#pending === 8) return errorBody('capacity', {detail: 'too many art commands wait for the Tidbyt'});
    this.#pending += 1;
    const next = this.#tail.then(() => this.#apply(family, command));
    this.#tail = next.catch(() => undefined);
    return next.finally(() => {this.#pending -= 1;});
  }

  async #apply(family: Family, command: Command<Record<string, unknown>>): Promise<Reply> {
    const {db, now, available, commit} = this.#options;
    if (!available()) return errorBody('unavailable', {detail: 'the Tidbyt art owner is not available'});
    try {
      const data = command.data as ArtStageRequest | ArtAmbientSetRequest;
      const requestDigest = digest(Buffer.from(canonical({family, subject: command.subject, ...command.data})));
      const earlier = db.prepare('SELECT digest FROM tidbyt_art_receipts WHERE source = ? AND request_id = ?').get(command.source, data.requestId) as {digest: string} | undefined;
      if (earlier !== undefined) return earlier.digest === requestDigest ? {status: 'accepted'} : errorBody('duplicate-conflict', {detail: 'the requestId was used for another command'});
      let save: () => void;
      if (family === 'art-stage') {
        const stage = data as ArtStageRequest;
        const held = this.#held(stage.compositionId), decision = artStageDecision(held, stage, now());
        if ('error' in decision) return decision;
        if (decision.action === 'reuse') {
          if (held?.format !== stage.format || held.frames !== stage.frames || held.durationMs !== stage.durationMs || stage.width !== 64 || stage.height !== 32) return errorBody('invalid-request', {detail: 'the stage metadata does not describe the held copy'});
          save = () => {db.prepare('UPDATE tidbyt_art SET expires_at_ms = ? WHERE composition_id = ?').run(now() + stage.lifetimeMs, stage.compositionId);};
        } else {
          const {count} = db.prepare('SELECT COUNT(*) AS count FROM tidbyt_art WHERE expires_at_ms > ?').get(now()) as {count: number};
          if (count >= MAX_ART_COPIES) return errorBody('capacity', {detail: 'the Tidbyt holds its maximum number of art copies'});
          const prepared = await this.#options.prepare(stage);
          if (!prepared.ok) return errorBody(prepared.code ?? 'invalid-request', {detail: 'the art does not match the Tidbyt profile'});
          if (!(prepared.webp instanceof Uint8Array) || prepared.webp.length === 0 || prepared.webp.length > ART_PROFILE.maxBytes || !Array.isArray(prepared.delays)
            || prepared.delays.length !== (stage.format === 'png' ? 0 : stage.frames)
            || prepared.delays.some(delay => !Number.isInteger(delay) || delay < ART_PROFILE.minDelayMs || delay > ART_PROFILE.maxDelayMs)
            || prepared.delays.reduce((sum, delay) => sum + delay, 0) !== stage.durationMs) return errorBody('internal', {detail: 'the art worker did not return a bounded copy'});
          save = () => {
            db.prepare('DELETE FROM tidbyt_art WHERE expires_at_ms <= ?').run(now());
            db.prepare('INSERT INTO tidbyt_art VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(stage.compositionId, stage.sha256, now() + stage.lifetimeMs, stage.format, stage.frames, stage.durationMs, JSON.stringify(prepared.delays), prepared.webp, digest(prepared.webp));
          };
        }
      } else {
        const selected = data.compositionId;
        const held = selected === null ? undefined : this.reference(selected);
        if (held !== undefined && 'error' in held) return held;
        save = () => {db.prepare('INSERT INTO tidbyt_art_selection VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET composition_id = excluded.composition_id, sha256 = excluded.sha256').run(selected, held?.sha256 ?? null);};
      }
      if (!available()) return errorBody('unavailable', {detail: 'the Tidbyt art owner stopped before the command committed'});
      const committed = await commit(command, add => {
        if (!available()) throw new SdkError(errorBody('unavailable'));
        save();
        db.prepare('INSERT INTO tidbyt_art_receipts (source, request_id, digest) VALUES (?, ?, ?)').run(command.source, data.requestId, requestDigest);
        db.exec('DELETE FROM tidbyt_art_receipts WHERE seq NOT IN (SELECT seq FROM tidbyt_art_receipts ORDER BY seq DESC LIMIT 256)');
        add(`bunny.event.${family}.${command.subject}`, {kind: 'outcome', type: `${entity(family)}.completed`, subject: command.subject, dataschema: `${SCHEMA_BASE}outcome/2.0`, data: {requestId: data.requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
      });
      if (!committed) return errorBody('unavailable', {detail: 'the module could not store the art command'});
      // Only selection changes ask for a display evaluation. Staging itself has no display effect.
      if (family === 'art-ambient-set') this.#options.changed(command);
      return {status: 'accepted'};
    } catch (error) {
      return errorBody(error instanceof SdkError ? error.body.error.code : fullDisk(error) ? 'capacity' : 'unavailable', {detail: 'the private art command could not be completed'});
    }
  }
}
