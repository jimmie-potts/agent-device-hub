import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {CatalogProposal} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {AssistantDeviceAction, AssistantProfile, AssistantProvider} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ContextSection} from './context.js';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';

export const HISTORY_ROWS = 16;
/**
 * A proposed command awaiting the owner's approval: the exact family, target and value, and the revision it is bound to:
 * the synced Hub-mode revision for `mode-set`, the coding worker's state revision for a delegation (Hub #502).
 */
export type Proposal = {family: 'mode-set'; target: 'hub'; data: {mode: Mode}; expectedRevision: number}
  | {family: 'coding-dispatch'; target: 'assistant'; data: {repository: string; brief: string}; expectedRevision: number}
  | AssistantDeviceAction | CatalogProposal;
export type ConversationAttachment = {kind: 'artwork'; requestId: string; description: string; showTargets?: string[]; admission: 'pending' | 'accepted' | 'uncertain' | 'refused'; code?: ErrorCode};
export type ConversationMessage = {seq: number; id: string; taskId: string; role: 'owner' | 'assistant' | 'tool'; text: string; atMs: number; follows?: string; attachment?: ConversationAttachment};
/** A clarification for the owner, an approval decision, or a delegation waiting on the worker. */
export type SavedQuestion = {id: string; text: string; answer: string | null; kind: 'clarification' | 'approval' | 'delegation'; proposal: Proposal | null};
export type CurrentTask = {taskId: string; question: SavedQuestion | null};
export type RecentConversationPage = {
  version: 2;
  profile: AssistantProfile;
  conversationId: string | null;
  messages: ConversationMessage[];
  currentTask: CurrentTask | null;
  older: string | null;
};

/**
 * A profile's conversations (Hub #2029): the current one first, which new messages go to, then each earlier one New
 * conversation replaced, by its last message, newest first; each stays readable by its ID. `title` is the session title
 * it publishes. `older` is the keyset cursor of the next page, passed back as `after`.
 */
export type ConversationListEntry = {conversationId: string; current: boolean; messages: number; firstAtMs: number | null; lastAtMs: number | null;
  title: {value: string; source: 'provider' | 'user'}};
export type ConversationList = {version: 1; profile: AssistantProfile; conversations: ConversationListEntry[]; older: string | null};
/**
 * The page's context preview (Hub #2029): the context builder's sections, exactly as the next model call for the profile
 * would send them, with each one's budget and what it left out. `basis` says which call: the next one of the current
 * conversation's unfinished task, or that of a new message's task.
 */
export type ContextPreview = {schema: 'assistant-context/1.0'; revision: number; profile: AssistantProfile; conversationId: string | null;
  provider: AssistantProvider; model: string; basis: {kind: 'task'; taskId: string} | {kind: 'next-message'}; sections: readonly ContextSection[]};

type Cursor = {profile: AssistantProfile; conversationId: string; seq: number};

export function historyCursor({profile, conversationId, seq}: Cursor): string {
  return btoa(JSON.stringify([profile, conversationId, seq])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function readHistoryCursor(token: string, profile: AssistantProfile): Cursor | undefined {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(token)) return undefined;
  try {
    const tuple: unknown = JSON.parse(atob(token.replaceAll('-', '+').replaceAll('_', '/')));
    if (!Array.isArray(tuple) || tuple.length !== 3) return undefined;
    const selected: unknown = tuple[0], conversationId: unknown = tuple[1], seq: unknown = tuple[2];
    if (selected !== profile || typeof conversationId !== 'string' || conversationId === '' ||
      typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) return undefined;
    const cursor = {profile, conversationId, seq};
    return historyCursor(cursor) === token ? cursor : undefined;
  } catch {
    return undefined;
  }
}

/** Authenticated Conversation input for a particular background coding attempt. */
export type StopCodingInput = {action: 'stop-coding-job'; jobId: string; operationId: string};
