import {Outcome} from '@jimmie-potts/sdk';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import {fail} from '../preferences/validation.js';
import {PAGE_BYTES, type CompanionMessage, type Conversation, type HistoryPage, type Meaning, type Removal} from './model.js';

type Row = {record: string};
const parse = <T>(row: Row | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
/** Authoritative records extend the existing message table. Checkpoints/calls are never a read fallback. */
export class Messages {
  constructor(readonly db: DatabaseSync) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!(db.prepare('PRAGMA table_info(assistant_messages)').all() as {name: string}[]).some(row => row.name === 'record')) db.exec('ALTER TABLE assistant_messages ADD COLUMN record TEXT');
      db.exec(`CREATE TABLE IF NOT EXISTS companion_conversations (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS companion_removals (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS companion_voices (id TEXT PRIMARY KEY, voice_ref TEXT) STRICT;`);
      const rows = db.prepare("SELECT m.*,c.profile FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id WHERE m.record IS NULL AND m.role IN ('owner','assistant') ORDER BY m.seq").all() as {id: string; conversation_id: string; task_id: string; role: string; text: string; at_ms: number; seq: number; profile: AssistantProfile}[];
      for (const row of rows) {
        this.ensure(row.conversation_id, [row.profile], row.profile);
        const message: CompanionMessage = {schema: 'companion-message/1.0', messageId: row.id, conversationId: row.conversation_id,
          turnId: null, speakerId: row.role === 'owner' ? 'owner' : row.profile, recipientIds: null, createdAtMs: row.at_ms, revision: 1,
          ordering: {authority: 'companions', epoch: row.conversation_id, sequence: row.seq}, meaning: {kind: 'unknown'},
          provenance: {kind: 'legacy', imported: false}, deliveryRefs: [], taskId: row.task_id, legacyText: row.text};
        db.prepare('UPDATE assistant_messages SET record=? WHERE id=?').run(JSON.stringify(message), row.id);
      }
      db.exec("CREATE INDEX IF NOT EXISTS companion_message_creation ON assistant_messages(conversation_id,json_extract(record,'$.ordering.sequence')) WHERE record IS NOT NULL");
      db.exec('COMMIT');
    } catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  conversation(id: string): Conversation | undefined {return parse<Conversation>(this.db.prepare('SELECT record FROM companion_conversations WHERE id=?').get(id) as Row | undefined);}
  conversations(): Conversation[] {return (this.db.prepare('SELECT record FROM companion_conversations ORDER BY rowid').all() as Row[]).map(row => JSON.parse(row.record) as Conversation);}
  ensure(id: string, participants: AssistantProfile[], profile: AssistantProfile | null = null): Conversation {
    const current = this.conversation(id);
    if (current !== undefined) return current;
    const value: Conversation = {id, participants, epoch: id, profile};
    this.db.prepare('INSERT INTO companion_conversations VALUES(?,?)').run(id, JSON.stringify(value)); return value;
  }
  all(): CompanionMessage[] {return (this.db.prepare('SELECT record FROM assistant_messages WHERE record IS NOT NULL ORDER BY seq').all() as Row[]).map(row => JSON.parse(row.record) as CompanionMessage);}
  get(id: string): CompanionMessage | undefined {return parse<CompanionMessage>(this.db.prepare('SELECT record FROM assistant_messages WHERE id=? AND record IS NOT NULL').get(id) as Row | undefined);}
  removal(id: string): Removal | undefined {return parse<Removal>(this.db.prepare('SELECT record FROM companion_removals WHERE id=?').get(id) as Row | undefined);}
  removals(): Removal[] {return (this.db.prepare('SELECT record FROM companion_removals ORDER BY rowid').all() as Row[]).map(row => JSON.parse(row.record) as Removal);}
  next(conversationId: string): number {
    const row = this.db.prepare(`SELECT MAX(sequence) AS sequence FROM (
      SELECT json_extract(record,'$.ordering.sequence') AS sequence FROM assistant_messages WHERE conversation_id=? AND record IS NOT NULL
      UNION ALL SELECT json_extract(record,'$.ordering.sequence') FROM companion_removals WHERE json_extract(record,'$.conversationId')=?)`).get(conversationId, conversationId) as {sequence: number | null};
    const next = (row.sequence ?? 0) + 1; if (!Number.isSafeInteger(next)) fail('capacity'); return next;
  }
  capture(task: {id: string; conversationId: string; profile: AssistantProfile}, id: string, role: 'owner' | 'assistant' | 'tool', text: string, atMs: number): void {
    if (role === 'tool' || this.get(id) !== undefined || this.removal(id) !== undefined) return;
    this.ensure(task.conversationId, [task.profile], task.profile);
    const value: CompanionMessage = {schema: 'companion-message/1.0', messageId: id, conversationId: task.conversationId, turnId: task.id,
      speakerId: role === 'owner' ? 'owner' : task.profile, recipientIds: [role === 'owner' ? task.profile : 'owner'], createdAtMs: atMs,
      revision: 1, ordering: {authority: 'companions', epoch: task.conversationId, sequence: this.next(task.conversationId)},
      meaning: {kind: 'literal', text, language: 'en'}, provenance: {kind: role === 'owner' ? 'owner' : 'synthetic', imported: false}, deliveryRefs: [], taskId: task.id};
    this.db.prepare('UPDATE assistant_messages SET record=? WHERE id=?').run(JSON.stringify(value), id);
  }
  put(message: CompanionMessage): void {
    if (this.removal(message.messageId) !== undefined) return;
    const text = message.meaning.kind === 'literal' ? message.meaning.text : message.legacyText ?? '';
    this.db.prepare(`INSERT INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms,record) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET text=excluded.text,record=excluded.record`).run(message.messageId, message.conversationId,
      message.taskId ?? '', message.speakerId === 'owner' ? 'owner' : 'assistant', text, message.createdAtMs, JSON.stringify(message));
  }
  #editable(message: CompanionMessage | undefined): void {
    if (message?.taskId == null) return;
    const row = this.db.prepare('SELECT status FROM assistant_tasks WHERE id=?').get(message.taskId) as {status: string} | undefined;
    if (row !== undefined && ![Outcome.succeeded, Outcome.failed, 'cancelled'].includes(row.status)) fail('invalid-state');
  }
  correct(id: string, meaning: Meaning): void {
    const value = this.get(id) ?? fail('not-found'); this.#editable(value);
    if (!Number.isSafeInteger(value.revision + 1)) fail('capacity');
    value.meaning = meaning; value.revision += 1; delete value.legacyText; this.put(value);
  }
  remove(id: string, now: number): void {
    if (this.removal(id) !== undefined) return;
    const message = this.get(id) ?? fail('not-found');
    this.applyRemoval({messageId: id, conversationId: message.conversationId, ordering: message.ordering, removedAtMs: now});
  }
  applyRemoval(removal: Removal): void {
    const message = this.get(removal.messageId); this.#editable(message);
    if (message !== undefined && (message.conversationId !== removal.conversationId || (message.ordering.authority !== removal.ordering.authority || message.ordering.epoch !== removal.ordering.epoch || message.ordering.sequence !== removal.ordering.sequence))) fail('invalid-request');
    this.db.prepare('INSERT OR IGNORE INTO companion_removals VALUES(?,?)').run(removal.messageId, JSON.stringify(removal));
    this.db.prepare('DELETE FROM assistant_messages WHERE id=?').run(removal.messageId);
  }
  permitted(profile: AssistantProfile, conversationId: string): Conversation {
    const conversation = this.conversation(conversationId) ?? fail('not-found');
    if (!conversation.participants.includes(profile)) fail('forbidden'); return conversation;
  }
  readable(profile: AssistantProfile, message: CompanionMessage): boolean {
    return message.speakerId === profile || message.recipientIds?.includes(profile) === true ||
      (message.recipientIds === null && this.conversation(message.conversationId)?.profile === profile);
  }
  page(profile: AssistantProfile, conversationId: string | undefined, after: number, revision: number, latest?: AssistantProfile): HistoryPage {
    const result: HistoryPage = {schema: 'companion-history/1.0', revision, availability: 'available', conversations: [], messages: [], next: null};
    if (conversationId === undefined) {
      const rows = this.db.prepare(`SELECT record FROM companion_conversations
        WHERE EXISTS (SELECT 1 FROM json_each(record,'$.participants') WHERE value=?) ORDER BY rowid LIMIT 17 OFFSET ?`).all(profile, after) as Row[];
      result.conversations = rows.slice(0, 16).map(row => JSON.parse(row.record) as Conversation);
      result.next = rows.length > 16 ? after + 16 : null; return result;
    }
    const conversation = this.permitted(profile, conversationId); result.conversations = [conversation];
    const rows = (this.db.prepare(`SELECT record FROM assistant_messages WHERE conversation_id=? AND record IS NOT NULL
      AND json_extract(record,'$.ordering.sequence')>?
      AND (json_extract(record,'$.speakerId')=? OR EXISTS (SELECT 1 FROM json_each(record,'$.recipientIds') WHERE value=?)
        OR (json_type(record,'$.recipientIds')='null' AND ?=1))
      ${latest === undefined ? '' : "AND json_extract(record,'$.speakerId')=?"}
      ORDER BY json_extract(record,'$.ordering.sequence') ${latest === undefined ? 'ASC LIMIT 17' : 'DESC LIMIT 1'}`)
      .all(conversationId, after, profile, profile, conversation.profile === profile ? 1 : 0, ...(latest === undefined ? [] : [latest])) as Row[])
      .map(row => JSON.parse(row.record) as CompanionMessage);
    for (const row of rows.slice(0, 16)) {
      if (Buffer.byteLength(JSON.stringify({...result, messages: [...result.messages, row]})) > PAGE_BYTES) break;
      result.messages.push(row);
    }
    if (rows.length > result.messages.length) result.next = result.messages.at(-1)?.ordering.sequence ?? after;
    return result;
  }
  fixture(now: number): void {
    const conversation = this.ensure(randomUUID(), ['reachy', 'microduck']);
    const turnId = randomUUID();
    const texts = ['A fictional garden adventure?', 'I claim the imaginary pond.', 'Then let us plan our fictional expedition.', 'Quack: captain of the imaginary pond.'];
    texts.forEach((text, index) => {
      const speakerId = index % 2 === 0 ? 'reachy' : 'microduck';
      this.put({schema: 'companion-message/1.0', messageId: randomUUID(), conversationId: conversation.id, turnId, speakerId,
        recipientIds: [speakerId === 'reachy' ? 'microduck' : 'reachy'], createdAtMs: now, revision: 1,
        ordering: {authority: 'companions', epoch: conversation.epoch, sequence: index + 1}, meaning: {kind: 'literal', text, language: 'en'},
        provenance: {kind: 'synthetic', imported: false}, deliveryRefs: [], taskId: null});
    });
  }
}
