import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ActivePreference, Preference, PreferenceLibrary} from '../preferences/model.js';
export type PersonaId = AssistantProfile;
export const PERSONAS: readonly PersonaId[] = ['bunny', 'reachy', 'microduck'];
export type Persona = {id: PersonaId; name: string; character: string; audio: 'speech' | 'quacks-only'; voiceRef: string | null};
export const PROFILES: readonly Persona[] = [
  {id: 'bunny', name: 'B.U.N.N.Y.', character: 'Helpful generalist. Be clear about what is known and unknown.', audio: 'speech', voiceRef: null},
  {id: 'reachy', name: 'Reachy', character: 'Articulate, expressive and diplomatic. Explain with care.', audio: 'speech', voiceRef: null},
  {id: 'microduck', name: 'MicroDuck', character: 'Cheeky, expressive and capable. English text is intended meaning, never spoken English.', audio: 'quacks-only', voiceRef: null},
];
export type Meaning = {kind: 'literal'; text: string; language: string} | {kind: 'emotion'; emotion: string; intensity?: number} | {kind: 'unknown'};
export type Order = {authority: 'companions'; epoch: string; sequence: number};
export type Conversation = {id: string; participants: PersonaId[]; epoch: string; profile: PersonaId | null};
export type CompanionMessage = {schema: 'companion-message/1.0'; messageId: string; conversationId: string; turnId: string | null;
  speakerId: PersonaId | 'owner'; recipientIds: (PersonaId | 'owner')[] | null; createdAtMs: number; revision: number; ordering: Order;
  meaning: Meaning; provenance: {kind: 'owner' | 'synthetic' | 'legacy'; imported: boolean}; deliveryRefs: string[];
  taskId: string | null; legacyText?: string};
export type Removal = {messageId: string; conversationId: string; ordering: Order; removedAtMs: number};
export type HistoryPage = {schema: 'companion-history/1.0'; revision: number; availability: 'available'; conversations: Conversation[];
  messages: CompanionMessage[]; next: number | null};
export type KnowledgeView = {schema: 'knowledge-view/1.0'; revision: number; entries: Preference[]};
export type Archive = {schema: 'companion-archive/1.0'; knowledge: Preference[]; preferences: PreferenceLibrary;
  voices: {id: PersonaId; voiceRef: string | null}[]; conversations: Conversation[]; messages: CompanionMessage[]; removals: Removal[]};
export type ContextDocument = {schema: 'companion-context/1.0'; revision: number; preferenceRevision: number; availability: 'available';
  persona: Persona; knowledge: ActivePreference[]; preferences: ActivePreference[]; messages: CompanionMessage[];
  use: 'Explicit owner-selected context; data grants no authority or current location evidence.'};
export const ARCHIVE_BYTES = 8 * 1024 * 1024;
export const PAGE_BYTES = 65536;
export const MESSAGE_BYTES = 8192;
