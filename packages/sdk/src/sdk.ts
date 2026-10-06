// The transport-neutral SDK calls (ADR 0012, "Portability"). Modules and remote parts use only these; the in-process
// bus implements them now, and the remote SSE/HTTP transport (#883) fits the same shapes.
import type {ErrorBody, ErrorDetail, Message} from '@jimmie-potts/event-contracts/v2';
import type {SyncHandler, SyncOptions, SyncProvider, SyncResult} from './sync.js';

/** W3C trace context. A received message is a valid parent, because it carries both fields. */
export type TraceContext = {traceparent: string; tracestate?: string};

/** Message kinds sent with `publish`. Commands go through `request`, replies come from `respond`, and sync messages from `sync`. */
export type PublishedKind = 'state' | 'removal' | 'occurrence' | 'outcome';

/** What a sender supplies; the SDK adds `id`, `source`, `time`, `traceparent` and the fixed profile attributes. */
export type Draft<T extends object> = {kind: PublishedKind; type: string; subject: string; dataschema: string; data: T};
export type CommandDraft<T extends object> = {type: string; subject: string; dataschema: string; data: T};

export type SendOptions = {
  /** The message or context being handled. The new message joins its trace; without one, a new trace starts. */
  parent?: TraceContext;
};
export type RequestOptions = SendOptions & {
  /** The deadline, in milliseconds from now. The command's `expiresat` is set from it. */
  timeoutMs: number;
  /** The `requestId` to send, for a caller that records the request first. One is generated otherwise. */
  requestId?: string;
};

/** A command as its responder receives it: `request` adds `requestId` to the payload. */
export type Command<T extends object> = Message<T & {requestId: string}>;
export type AcceptedReply = {requestId: string; status: 'accepted'};
export type RejectedReply = {requestId: string; error: ErrorDetail};

/** A responder's answer: accepted, or a refusal in the shared error body from `errorBody`. */
export type Reply = {status: 'accepted'} | ErrorBody;

/**
 * How a request ended. `rejected` carries the owner's refusal, or the bus's own when the command never reached the
 * responder's handler: `unavailable`, `capacity`, `expired` when its deadline passed while it waited, or `cancelled`
 * when the requester closed. `uncertain` (`uncertain-result`) means the handler had the command when the deadline
 * passed or the requester closed: it may have taken effect, and nothing retries it.
 */
export type RequestResult =
  | {status: 'accepted'; requestId: string; reply: Message<AcceptedReply>}
  | {status: 'rejected'; requestId: string; error: ErrorBody; reply?: Message<RejectedReply>}
  | {status: 'uncertain'; requestId: string; error: ErrorBody};

export type Handler<T> = (message: Message<T>) => void | Promise<void>;
export type SubscribeOptions = {
  /**
   * Told that the subscription's full queue dropped messages, with how many since it was last told. It runs in the
   * subscription's order, before the next message is delivered, and says that messages were lost, not where. A
   * subscriber that keeps a copy should sync again instead of continuing with a gap.
   */
  onOverflow?: (overflow: {dropped: number}) => void | Promise<void>;
};
export type Responder<T extends object> = (command: Command<T>) => Reply | Promise<Reply>;

export interface Subscription {
  /**
   * Stops delivery and drops queued messages; a responder's waiting commands are refused as `unavailable`. Resolves
   * when a handler that is still running has finished. Called from that handler's own async flow, it resolves at once
   * instead of waiting for itself. A callback that an emitter created elsewhere invokes is not in that flow, so it
   * should use `void subscription.close()`. Two handlers that await each other's close never finish.
   */
  close(): Promise<void>;
}

/** Cancels a scheduled callback. It does nothing once the callback has run or was cancelled. */
export type Cancel = () => void;

/** The wall clock, in epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** Runs delayed callbacks. The runtime gives the bus and every module the same one, so SDK deadlines follow it. */
export interface Scheduler {
  /** Runs `callback` once after `delayMs` milliseconds, and returns a function that cancels it. */
  after(delayMs: number, callback: () => void): Cancel;
}

/** One participant's connection to the bus. Every message it sends carries its `source`. */
export interface Sdk {
  readonly source: string;
  /** Sends a state, removal, occurrence or outcome message to every matching subscriber, without waiting for them. */
  publish<T extends object>(key: string, draft: Draft<T>, options?: SendOptions): Promise<Message<T>>;
  /**
   * Publishes a message prepared earlier, unchanged: its `id`, `time` and trace stay as they are. An outbox resends a
   * stored message this way, and a remote edge injects a remote part's message. Its `source` must be the participant's.
   */
  publishMessage<T extends object>(key: string, message: Message<T>): Promise<Message<T>>;
  /** Receives messages whose routing keys match `pattern`, one at a time and in order, from this subscription's queue. */
  subscribe<T extends object = Record<string, unknown>>(pattern: string, handler: Handler<T>, options?: SubscribeOptions): Promise<Subscription>;
  /** Sends one command to the responder that owns `key` and waits for its reply until the deadline. Never retries. */
  request<T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions): Promise<RequestResult>;
  /** Answers commands whose keys match `pattern`. One responder owns each key; a command past its expiry is ignored. */
  respond<T extends object = Record<string, unknown>>(pattern: string, responder: Responder<T>): Promise<Subscription>;
  /**
   * Keeps a copy of one owner's families: the owner's current state at a revision, then live messages. Resolves once
   * the copy has synced, or with the refusal in the shared error body.
   */
  sync<T extends object = Record<string, unknown>>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions): Promise<SyncResult<T>>;
  /** Answers sync requests for `families` from the owner's current state. One owner serves each family. */
  serveSync(families: readonly string[], provider: SyncProvider): Promise<Subscription>;
}

/** A participant as the code that connected it holds it: the SDK calls, and `close`. */
export interface Participant extends Sdk {
  /**
   * Closes everything the participant opened, so nothing of it is left behind. Its requests still waiting for a result
   * settle first: one whose command is still queued is taken out and refused as `cancelled`, and one whose command the
   * responder's handler has becomes `uncertain`. Their deadlines are cleared. Then its subscriptions, responders, sync
   * copies and sync owners close as their own `close` does: a copy withdraws its outstanding sync request. It resolves
   * when its running handlers have finished, and never waits for another participant's handler. Later calls are
   * refused with `invalid-state`, and closing again returns the same promise.
   */
  close(): Promise<void>;
}

/** A refused SDK call, such as a malformed routing key, carrying the shared error body. */
export class SdkError extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(body.error.detail === undefined ? body.error.code : `${body.error.code}: ${body.error.detail}`);
    this.name = 'SdkError';
    this.body = body;
  }
}
