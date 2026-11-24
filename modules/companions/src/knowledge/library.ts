import type {DatabaseSync} from 'node:sqlite';
import type {AssistantEngine} from '../assistant/engine.js';
import {PreferenceStore} from '../preferences/store.js';
import {fail} from '../preferences/validation.js';
import {ARCHIVE_BYTES, PAGE_BYTES, PROFILES, type Archive, type CompanionMessage, type ContextDocument, type DuckWidget, type Order, type Persona, type PersonaId} from './model.js';
import type {KnowledgeInput} from './validation.js';
/**
 * A part of the companion records with its own change revision (Hub #2056): the library, which holds knowledge entries,
 * voices and the synthetic exchanges a fixture adds, the Duck widget's selection, or the companions' context switches
 * (Hub #2029).
 */
export type Scope = 'library' | 'duck-widget' | 'context';
const SCOPES: readonly Scope[] = ['library', 'duck-widget', 'context'];
/** What a knowledge command changes: its scopes, and the conversations whose records it changes. */
export type Changes = {scopes: Scope[]; conversations: string[]};
const sameOrder = (a: Order, b: Order): boolean => a.authority === b.authority && a.epoch === b.epoch && a.sequence === b.sequence;
const identity = (value: CompanionMessage): string => JSON.stringify([value.conversationId, value.turnId, value.taskId, value.speakerId, value.recipientIds,
  value.createdAtMs, value.ordering.authority, value.ordering.epoch, value.ordering.sequence]);
/** The current view is assembled on demand; no derived context is persisted. */
export class KnowledgeLibrary {
  readonly entries: PreferenceStore<KnowledgeInput>;
  constructor(readonly db: DatabaseSync, readonly assistant: AssistantEngine, readonly preferences: PreferenceStore) {
    this.entries = new PreferenceStore<KnowledgeInput>(db, 'knowledge');
    db.exec('CREATE TABLE IF NOT EXISTS companion_widget (id INTEGER PRIMARY KEY CHECK(id=1), conversation_id TEXT) STRICT');
    // Each scope's last change, as the assistant revision that published it (Hub #2056): a knowledge command is stale only
    // when a scope it changes changed after the revision it names. Each start raises both rows with `restarted`.
    db.exec('CREATE TABLE IF NOT EXISTS companion_scope_changes (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT');
  }
  /**
   * The scopes and conversations a command changes, read before it applies. Entries, voices, a fixture and an archive change
   * the library; a correction or removal changes its message's conversation, found through the removal record once the message
   * is removed, and an archive also changes each conversation it adds to.
   */
  changes(input: KnowledgeInput): Changes {
    switch (input.action) {
      case 'select-duck-conversation': return {scopes: ['duck-widget'], conversations: []};
      case 'set-context-knowledge': return {scopes: ['context'], conversations: []};
      case 'correct-message': case 'delete-message': {
        const messages = this.assistant.store.messages;
        const conversationId = messages.get(input.messageId)?.conversationId ?? messages.removal(input.messageId)?.conversationId;
        return {scopes: [], conversations: conversationId === undefined ? [] : [conversationId]};
      }
      case 'import-archive': return {scopes: ['library'], conversations: this.#imported(input.archive)};
      case 'create': case 'edit': case 'import': case 'set-active': case 'set-voice': case 'fixture': return {scopes: ['library'], conversations: []};
    }
  }
  /** The assistant revision of the scope's last change, or 0 before its first. */
  changedAt(scope: Scope): number {
    return (this.db.prepare('SELECT revision FROM companion_scope_changes WHERE scope=?').get(scope) as {revision: number} | undefined)?.revision ?? 0;
  }
  /** Records the scopes as changed at the revision, in the command's transaction. */
  record(scopes: readonly Scope[], revision: number): void {
    const record = this.db.prepare('INSERT INTO companion_scope_changes VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision');
    for (const scope of scopes) record.run(scope, revision);
  }
  /**
   * Counts every scope as changed at the current revision, once per start, as the assistant's start does for conversations:
   * a command naming an older revision is refused, whatever an earlier release changed without recording it.
   */
  restarted(): void {
    const raise = this.db.prepare('INSERT INTO companion_scope_changes VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET revision=MAX(revision,excluded.revision)');
    for (const scope of SCOPES) raise.run(scope, this.assistant.store.meta().revision);
  }
  /** The conversations an archive import adds to: a new conversation or profile binding, an unknown removal or a new message. */
  #imported(archive: Archive): string[] {
    const messages = this.assistant.store.messages, changed = new Set<string>();
    for (const conversation of archive.conversations) {
      if (messages.conversation(conversation.id) === undefined || (conversation.profile !== null && this.assistant.store.conversation(conversation.profile) === undefined)) changed.add(conversation.id);
    }
    for (const removal of archive.removals) if (messages.removal(removal.messageId) === undefined) changed.add(removal.conversationId);
    for (const message of archive.messages) if (messages.get(message.messageId) === undefined && messages.removal(message.messageId) === undefined) changed.add(message.conversationId);
    return [...changed];
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
      voices: this.profiles().map(({id, voiceRef}) => ({id, voiceRef})), conversations: this.#exported(),
      messages: this.assistant.store.messages.all(), removals: this.assistant.store.messages.removals()};
  }
  /**
   * The conversations in archive order (Hub #2029): each profile's earlier conversations in saved order, then the current
   * ones, so an import into a store without a current conversation takes the export's current one as its own.
   */
  #exported(): Archive['conversations'] {
    const all = this.assistant.store.messages.conversations(), current = this.assistant.store.currentConversations();
    return [...all.filter(conversation => !current.has(conversation.id)), ...all.filter(conversation => current.has(conversation.id))];
  }
  capacity(): void {if (Buffer.byteLength(JSON.stringify(this.archive())) > ARCHIVE_BYTES) fail('capacity');}
  apply(input: KnowledgeInput, now: number): void {
    switch (input.action) {
      case 'select-duck-conversation':
        if (input.conversationId !== null) this.#duckConversation(input.conversationId);
        this.db.prepare('INSERT INTO companion_widget VALUES(1,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id').run(input.conversationId);
        break;
      case 'set-context-knowledge': this.assistant.store.setKnowledge(input.persona, input.enabled); break;
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
    // A profile's conversations arrive in the archive's order, oldest first. An import never moves a profile's current
    // conversation; a profile without one takes the archive's last, and the others stay readable as earlier conversations
    // (Hub #2029).
    for (const conversation of archive.conversations) this.db.prepare('INSERT OR IGNORE INTO companion_conversations VALUES(?,?)').run(conversation.id, JSON.stringify(conversation));
    for (const conversation of [...archive.conversations].reverse()) {
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
