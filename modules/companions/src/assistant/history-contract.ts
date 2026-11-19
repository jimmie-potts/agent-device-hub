import type {AssistantLightAction, AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';

export const HISTORY_ROWS = 16;
/**
 * A proposed command awaiting the owner's approval: the exact family, target and value, and the revision it is bound to:
 * the synced Hub-mode revision for `mode-set`, the coding worker's state revision for a delegation (Hub #502).
 */
export type Proposal = {family: 'mode-set'; target: 'hub'; data: {mode: Mode}; expectedRevision: number}
  | {family: 'coding-dispatch'; target: 'assistant'; data: {repository: string; brief: string}; expectedRevision: number}
  | AssistantLightAction;
export type ConversationMessage = {seq: number; id: string; taskId: string; role: 'owner' | 'assistant' | 'tool'; text: string; atMs: number};
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
