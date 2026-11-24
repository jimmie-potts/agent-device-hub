// The private read of a conversation's message queue (Hub #2030), shared by the module and the Conversation page.
import type {AssistantProfile, AssistantQueueHold} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';

/** Why a queue waits for the owner, and for a refused start its code and the fixed text that names why. */
export type QueueHold = {reason: AssistantQueueHold; code: ErrorCode | null; detail: string | null};
/**
 * The page's read of one conversation's queue: the messages in the order they start, and the hold, if any. `revision` is
 * the assistant revision it was read at, which the page's withdraw, reorder and edit of what it shows name. `current`
 * is false for an earlier conversation's messages, left from a release that let New conversation leave them behind:
 * they never start, and the owner can only withdraw them.
 */
export type QueueDocument = {version: 1; profile: AssistantProfile; conversationId: string | null; revision: number; current: boolean; held: QueueHold | null;
  messages: {id: string; text: string; queuedAtMs: number; updatedAtMs: number}[]};
