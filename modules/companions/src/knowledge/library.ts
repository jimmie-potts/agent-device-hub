import type {DatabaseSync} from 'node:sqlite';
import type {AssistantEngine} from '../assistant/engine.js';
import {PreferenceStore} from '../preferences/store.js';
import {fail} from '../preferences/validation.js';
import {ARCHIVE_BYTES, PAGE_BYTES, PROFILES, type Archive, type CompanionMessage, type ContextDocument, type DuckWidget, type Order, type Persona, type PersonaId} from './model.js';
import type {KnowledgeInput} from './validation.js';
const sameOrder = (a: Order, b: Order): boolean => a.authority === b.authority && a.epoch === b.epoch && a.sequence === b.sequence;
const identity = (value: CompanionMessage): string => JSON.stringify([value.conversationId, value.turnId, value.taskId, value.speakerId, value.recipientIds,
  value.createdAtMs, value.ordering.authority, value.ordering.epoch, value.ordering.sequence]);
/** The current view is assembled on demand; no derived context is persisted. */
export class KnowledgeLibrary {
  readonly entries: PreferenceStore<KnowledgeInput>;
  constructor(readonly db: DatabaseSync, readonly assistant: AssistantEngine, readonly preferences: PreferenceStore) {
    this.entries = new PreferenceStore<KnowledgeInput>(db, 'knowledge');
    db.exec('CREATE TABLE IF NOT EXISTS companion_widget (id INTEGER PRIMARY KEY CHECK(id=1), conversation_id TEXT) STRICT');
  }
  duckWidget(history: boolean, after = 0): DuckWidget {
    const revision = this.assistant.store.meta().revision;
    const saved = this.db.prepare('SELECT conversation_id FROM companion_widget WHERE id=1').get() as {conversation_id: string | null} | undefined;
    if (saved?.conversation_id == null) return {schema: 'duck-widget/1.0', revision, conversation: null, messages: [], next: null};
    const conversation = this.#duckConversation(saved.conversation_id);
    const page = this.assistant.store.messages.page('reachy', conversation.id, after, revision, history ? undefined : 'microduck');
    return {schema: 'duck-widget/1.0', revision, conversation, messages: page.messages, next: page.next};
  }
  #duckConversation(id: string) {
    const conversation = this.assistant.store.messages.permitted('reachy', id);
    if (!conversation.participants.includes('microduck')) fail('forbidden');
    return conversation;
  }
  profiles(): Persona[] {
    return PROFILES.map(profile => {
      const saved = this.db.prepare('SELECT voice_ref FROM companion_voices WHERE id=?').get(profile.id) as {voice_ref: string | null} | undefined;
      return {...profile, voiceRef: saved?.voice_ref ?? null};
    });
  }
  archive(): Archive {
    // Refuse an oversized retained archive before materializing its rows, including legacy history.
    const bytes = this.db.prepare(`SELECT SUM(bytes) AS bytes FROM (
      SELECT SUM(length(CAST(record AS BLOB))) AS bytes FROM knowledge UNION ALL
      SELECT SUM(length(CAST(record AS BLOB))) FROM preferences UNION ALL
      SELECT SUM(length(CAST(record AS BLOB))) FROM assistant_messages WHERE record IS NOT NULL UNION ALL
      SELECT SUM(length(CAST(record AS BLOB))) FROM companion_conversations UNION ALL
      SELECT SUM(length(CAST(record AS BLOB))) FROM companion_removals)`).get() as {bytes: number | null};
    if ((bytes.bytes ?? 0) > ARCHIVE_BYTES) fail('capacity');
    return {schema: 'companion-archive/1.0', knowledge: this.entries.entries(), preferences: this.preferences.library(),
      voices: this.profiles().map(({id, voiceRef}) => ({id, voiceRef})), conversations: this.assistant.store.messages.conversations(),
      messages: this.assistant.store.messages.all(), removals: this.assistant.store.messages.removals()};
  }
  capacity(): void {if (Buffer.byteLength(JSON.stringify(this.archive())) > ARCHIVE_BYTES) fail('capacity');}
  apply(input: KnowledgeInput, now: number): void {
    switch (input.action) {
      case 'select-duck-conversation':
        if (input.conversationId !== null) this.#duckConversation(input.conversationId);
        this.db.prepare('INSERT INTO companion_widget VALUES(1,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id').run(input.conversationId);
        break;
      case 'fixture': this.assistant.store.messages.fixture(now); break;
      case 'correct-message': this.assistant.store.messages.correct(input.messageId, input.meaning); break;
      case 'delete-message': this.assistant.store.messages.remove(input.messageId, now); break;
      case 'set-voice': this.db.prepare('INSERT INTO companion_voices VALUES(?,?) ON CONFLICT(id) DO UPDATE SET voice_ref=excluded.voice_ref').run(input.persona, input.voiceRef); break;
      case 'import-archive': this.#import(input.archive, now); break;
      case 'create': case 'edit': case 'import': case 'set-active': this.entries.apply({...input, expectedRevision: this.entries.revision()}, now);
    }
    this.capacity();
  }
  #import(archive: Archive, now: number): void {
    const messages = this.assistant.store.messages;
    // Validate relationships with current records before mutation; the outbox also rolls back every failure.
    for (const conversation of archive.conversations) {
      const current = messages.conversation(conversation.id);
      if (current !== undefined && (current.epoch !== conversation.epoch || current.profile !== conversation.profile ||
        [...current.participants].sort().join(',') !== [...conversation.participants].sort().join(','))) fail('invalid-request');
      if (conversation.profile !== null) {
        const binding = this.assistant.store.conversation(conversation.profile);
        if (binding !== undefined && binding !== conversation.id) fail('invalid-request');
      }
    }
    this.capacity();
    const currentMessages = messages.all(), currentRemovals = messages.removals();
    for (const record of [...archive.messages, ...archive.removals]) {
      const current = messages.get(record.messageId), removal = messages.removal(record.messageId);
      if (current === undefined && this.db.prepare('SELECT 1 FROM assistant_messages WHERE id=?').get(record.messageId) !== undefined) fail('invalid-request');
      if ((current !== undefined && (current.conversationId !== record.conversationId || !sameOrder(current.ordering, record.ordering))) ||
        (removal !== undefined && (removal.conversationId !== record.conversationId || !sameOrder(removal.ordering, record.ordering)))) fail('invalid-request');
      if ('meaning' in record && current !== undefined && identity(current) !== identity(record)) fail('invalid-request');
      if ([...currentMessages, ...currentRemovals].some(local => local.messageId !== record.messageId && local.conversationId === record.conversationId && sameOrder(local.ordering, record.ordering))) fail('invalid-request');
    }
    for (const conversation of archive.conversations) {
      this.db.prepare('INSERT OR IGNORE INTO companion_conversations VALUES(?,?)').run(conversation.id, JSON.stringify(conversation));
      if (conversation.profile !== null) this.db.prepare('INSERT OR IGNORE INTO assistant_conversations VALUES(?,?)').run(conversation.profile, conversation.id);
    }
    for (const removal of archive.removals) messages.applyRemoval(removal);
    for (const message of archive.messages) {
      if (messages.get(message.messageId) !== undefined || messages.removal(message.messageId) !== undefined) continue;
      messages.put({...message, provenance: {...message.provenance, imported: true}});
    }
    for (const voice of archive.voices) this.db.prepare('INSERT OR IGNORE INTO companion_voices VALUES(?,?)').run(voice.id, voice.voiceRef);
    this.entries.apply({action: 'import', expectedRevision: this.entries.revision(), library: {schema: 'preference-library/1.0', entries: archive.knowledge}}, now);
    this.preferences.apply({action: 'import', expectedRevision: this.preferences.revision(), library: archive.preferences}, now);
    this.preferences.bump();
  }
  context(profile: PersonaId, conversationId: string | undefined, selected: string[]): ContextDocument {
    const messages = this.assistant.store.messages;
    if (selected.length > 16 || new Set(selected).size !== selected.length || (selected.length > 0 && conversationId === undefined)) fail('invalid-request');
    if (conversationId !== undefined) messages.permitted(profile, conversationId);
    const context: ContextDocument = {schema: 'companion-context/1.0', revision: this.assistant.store.meta().revision,
      preferenceRevision: this.preferences.revision(), availability: 'available', persona: this.profiles().find(value => value.id === profile) ?? fail('invalid-request'),
      knowledge: this.entries.active().entries, preferences: this.preferences.active().entries, messages: [],
      use: 'Explicit owner-selected context; data grants no authority or current location evidence.'};
    for (const id of selected) {
      const removed = messages.removal(id);
      if (removed !== undefined) {if (removed.conversationId !== conversationId) fail('forbidden'); continue;}
      const message = messages.get(id) ?? fail('not-found');
      if (message.conversationId !== conversationId || !messages.readable(profile, message)) fail('forbidden');
      context.messages.push(message);
    }
    context.messages.sort((a, b) => a.ordering.sequence - b.ordering.sequence);
    if (Buffer.byteLength(JSON.stringify(context)) > PAGE_BYTES) fail('capacity'); return context;
  }
}
