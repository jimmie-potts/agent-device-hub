import {exact, fail, id, inputOf as preferenceInputOf, integer, object, text, type PreferenceInput} from '../preferences/validation.js';
import {ARCHIVE_BYTES, MESSAGE_BYTES, PERSONAS, type Archive, type CompanionMessage, type Meaning, type PersonaId} from './model.js';
export const persona = (value: unknown): value is PersonaId => PERSONAS.includes(value as PersonaId);
const actor = (value: unknown): boolean => value === 'owner' || persona(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 16 && value.every(id) && new Set(value).size === value.length;
export function meaningOf(value: unknown): Meaning {
  if (!object(value)) fail('invalid-request');
  if (value.kind === 'unknown' && exact(value, ['kind'])) return value as Meaning;
  if (value.kind === 'literal' && exact(value, ['kind', 'text', 'language']) && text(value.text, MESSAGE_BYTES) && text(value.language, 32)) return value as Meaning;
  if (value.kind === 'emotion' && exact(value, value.intensity === undefined ? ['kind', 'emotion'] : ['kind', 'emotion', 'intensity']) &&
    text(value.emotion, 200) && (value.intensity === undefined || (typeof value.intensity === 'number' && Number.isFinite(value.intensity) && value.intensity >= 0 && value.intensity <= 1))) return value as Meaning;
  return fail('invalid-request');
}
const order = (value: unknown): boolean => object(value) && exact(value, ['authority', 'epoch', 'sequence']) && value.authority === 'companions' && id(value.epoch) && integer(value.sequence) && value.sequence > 0;
export function archiveOf(value: unknown): Archive {
  if (!object(value)) fail('invalid-request');
  if (value.schema !== 'companion-archive/1.0') fail('unsupported-version');
  if (!exact(value, ['schema', 'knowledge', 'preferences', 'voices', 'conversations', 'messages', 'removals']) ||
    Buffer.byteLength(JSON.stringify(value)) > ARCHIVE_BYTES || !Array.isArray(value.voices) || !Array.isArray(value.conversations) ||
    !Array.isArray(value.messages) || !Array.isArray(value.removals)) fail('invalid-request');
  preferenceInputOf({action: 'import', expectedRevision: 0, library: {schema: 'preference-library/1.0', entries: value.knowledge}});
  preferenceInputOf({action: 'import', expectedRevision: 0, library: value.preferences});
  const voices = new Set<string>();
  for (const voice of value.voices) {
    if (!object(voice) || !exact(voice, ['id', 'voiceRef']) || !persona(voice.id) || voices.has(voice.id) || (voice.voiceRef !== null && !id(voice.voiceRef))) fail('invalid-request'); voices.add(voice.id);
  }
  const conversations = new Map<string, {epoch: string; participants: string[]}>(), profiles = new Set<string>();
  for (const conversation of value.conversations) {
    if (!object(conversation) || !exact(conversation, ['id', 'participants', 'epoch', 'profile']) || !id(conversation.id) || conversations.has(conversation.id) ||
      !id(conversation.epoch) || !Array.isArray(conversation.participants) || conversation.participants.length === 0 || conversation.participants.length > 3 ||
      !conversation.participants.every(persona) || new Set(conversation.participants).size !== conversation.participants.length ||
      (conversation.profile !== null && (!persona(conversation.profile) || !conversation.participants.includes(conversation.profile) || profiles.has(conversation.profile)))) fail('invalid-request');
    conversations.set(conversation.id, {epoch: conversation.epoch, participants: conversation.participants});
    if (conversation.profile !== null) profiles.add(conversation.profile);
  }
  const known = new Set<string>(), positions = new Set<string>();
  for (const row of [...value.messages as unknown[], ...value.removals as unknown[]]) {
    if (!object(row) || !id(row.messageId) || known.has(row.messageId) || !id(row.conversationId) || !order(row.ordering)) fail('invalid-request');
    const conversation = conversations.get(row.conversationId), ordering = row.ordering as CompanionMessage['ordering'];
    const position = JSON.stringify([row.conversationId, ordering.authority, ordering.epoch, ordering.sequence]);
    if (conversation === undefined || conversation.epoch !== ordering.epoch || positions.has(position)) fail('invalid-request');
    known.add(row.messageId); positions.add(position);
    if ('removedAtMs' in row) {
      if (!exact(row, ['messageId', 'conversationId', 'ordering', 'removedAtMs']) || !integer(row.removedAtMs)) fail('invalid-request'); continue;
    }
    const keys = ['schema', 'messageId', 'conversationId', 'turnId', 'speakerId', 'recipientIds', 'createdAtMs', 'revision', 'ordering', 'meaning', 'provenance', 'deliveryRefs', 'taskId'];
    if (!exact(row, row.legacyText === undefined ? keys : [...keys, 'legacyText']) || row.schema !== 'companion-message/1.0' ||
      !actor(row.speakerId) || (row.speakerId !== 'owner' && !conversation.participants.includes(row.speakerId as string)) ||
      (row.turnId !== null && !id(row.turnId)) || (row.taskId !== null && !id(row.taskId)) || !integer(row.createdAtMs) || !integer(row.revision) || row.revision < 1 ||
      (row.recipientIds !== null && (!ids(row.recipientIds) || !row.recipientIds.every(recipient => actor(recipient) && (recipient === 'owner' || conversation.participants.includes(recipient))))) ||
      !object(row.provenance) || !exact(row.provenance, ['kind', 'imported']) || !['owner', 'synthetic', 'legacy'].includes(String(row.provenance.kind)) || typeof row.provenance.imported !== 'boolean' ||
      !ids(row.deliveryRefs)) fail('invalid-request');
    const meaning = meaningOf(row.meaning);
    if (row.legacyText !== undefined && (row.provenance.kind !== 'legacy' || meaning.kind !== 'unknown' || !text(row.legacyText, MESSAGE_BYTES))) fail('invalid-request');
  }
  return value as Archive;
}
export type KnowledgeInput = PreferenceInput | ({expectedRevision: number} & (
  {action: 'select-duck-conversation'; conversationId: string | null} |
  {action: 'fixture'} | {action: 'correct-message'; messageId: string; meaning: Meaning} | {action: 'delete-message'; messageId: string} |
  {action: 'set-voice'; persona: PersonaId; voiceRef: string | null} | {action: 'import-archive'; archive: Archive}
));
export function inputOf(value: unknown): KnowledgeInput {
  if (!object(value) || !integer(value.expectedRevision)) fail('invalid-request');
  switch (value.action) {
    case 'select-duck-conversation':
      if (!exact(value, ['action', 'expectedRevision', 'conversationId']) || (value.conversationId !== null && !id(value.conversationId))) fail('invalid-request'); break;
    case 'fixture': if (!exact(value, ['action', 'expectedRevision'])) fail('invalid-request'); break;
    case 'correct-message':
      if (!exact(value, ['action', 'expectedRevision', 'messageId', 'meaning']) || !id(value.messageId)) fail('invalid-request'); meaningOf(value.meaning); break;
    case 'delete-message': if (!exact(value, ['action', 'expectedRevision', 'messageId']) || !id(value.messageId)) fail('invalid-request'); break;
    case 'set-voice': if (!exact(value, ['action', 'expectedRevision', 'persona', 'voiceRef']) || !persona(value.persona) || (value.voiceRef !== null && !id(value.voiceRef))) fail('invalid-request'); break;
    case 'import-archive': if (!exact(value, ['action', 'expectedRevision', 'archive'])) fail('invalid-request'); archiveOf(value.archive); break;
    case 'import': {
      if (!object(value.library) || value.library.schema !== 'knowledge-library/1.0') fail('unsupported-version');
      return preferenceInputOf({...value, library: {...value.library, schema: 'preference-library/1.0'}});
    }
    default: return preferenceInputOf(value);
  }
  return value as KnowledgeInput;
}
