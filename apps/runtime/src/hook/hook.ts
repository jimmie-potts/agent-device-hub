// The 2.0 agent hook's work (Hub #926): one hook invocation from Claude Code or Codex becomes one lifecycle observation,
// published to the runtime's edge in one bounded call as the producer's credential. It is observational only, as the old
// hook was (apps/hub/bin/monitor-hook.mjs): no output protocol, no permission decision, no retry, no device and no child
// process. It fails open: every refusal, fault or lost answer ends the hook quietly, and the agent never waits for the
// runtime past the hook's budget. `bin/monitor-hook.mjs` runs it, and owns the process's exit and its hard deadline.
import {enrichHook, normalizeHook, type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {prepareMessage, publishOnce, traceFields} from '@jimmie-potts/sdk';
import {lifecycleMessage, observationOf} from './observation.js';
import {readProducer} from './producer.js';

/** How long one hook process may run, from its start: the clients' hook settings give it 3 s. */
export const HOOK_BUDGET_MS = 2900;
/** The largest hook input read: Claude Code's `PostToolUse` carries the whole tool response. Larger input is dropped. */
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export type HookOptions = {
  /** The producer file, as the client's hook command names it. */
  producer: string;
  /** The hook's JSON, from the client: the process's stdin. */
  input: AsyncIterable<Uint8Array>;
  /**
   * When the hook must be done, on `performance.now()`'s clock, which starts with the process. Defaults to
   * `HOOK_BUDGET_MS`, so the publication's deadline is what is left of the process's budget.
   */
  deadline?: number;
  /** The clock for `observedAtMs` and the message's `time`. Defaults to `Date.now`. */
  now?: () => number;
  /** The hook process's environment, which lifecycle 1.2 reads for Claude Desktop's session ID. Defaults to `process.env`. */
  environment?: unknown;
};

/**
 * How one hook ended, for tests and measurements; the process reports nothing. `skipped` sent nothing: the producer file
 * may not emit, the input is not a hook the normalizers map, or no time was left. `published`, `rejected` and `uncertain`
 * are the publication's result, with its trace.
 */
export type HookResult =
  | {status: 'skipped'; reason: 'producer' | 'input' | 'event' | 'deadline' | 'failed'}
  | {status: 'published'; messageId: string; traceId: string}
  | {status: 'rejected' | 'uncertain'; code: ErrorCode; messageId: string; traceId: string};

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The hook's JSON, or undefined when it is larger than `MAX_INPUT_BYTES`, not UTF-8 or not JSON. */
async function readInput(input: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    // Leaving the loop ends the stream, so nothing more is read.
    if (size > MAX_INPUT_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))) as unknown;
  } catch {
    return undefined;
  }
}

/** Runs one hook. It never throws: whatever goes wrong ends it as `skipped`, and nothing is sent again. */
export async function runHook(options: HookOptions): Promise<HookResult> {
  try {
    return await publishHook(options);
  } catch {
    return {status: 'skipped', reason: 'failed'};
  }
}

async function publishHook({producer: path, input, deadline = HOOK_BUDGET_MS, now = Date.now, environment}: HookOptions): Promise<HookResult> {
  const producer = await readProducer(path);
  if (producer === undefined) return {status: 'skipped', reason: 'producer'};
  const raw = await readInput(input);
  if (!isFields(raw) || typeof raw.hook_event_name !== 'string') return {status: 'skipped', reason: 'input'};
  // The normalizers check the source configuration themselves, and refuse a hook they do not map.
  const source = {...producer.configuration, hook: raw.hook_event_name} as unknown as SourceConfiguration;
  const observedAtMs = now();
  const envelope = producer.lifecycleVersion === undefined ? normalizeHook(raw, source, observedAtMs)
    : await enrichHook(raw, source, observedAtMs, {lifecycleVersion: producer.lifecycleVersion, ...(environment === undefined ? {} : {environment})});
  const observation = envelope === null ? undefined : observationOf(envelope);
  if (observation === undefined) return {status: 'skipped', reason: 'event'};
  const {key, draft} = lifecycleMessage(observation);
  // The message starts a trace, which the runtime's records of its intake carry.
  const message = prepareMessage(producer.source, draft, {now: () => observedAtMs});
  const timeoutMs = Math.floor(deadline - performance.now());
  if (timeoutMs < 1) return {status: 'skipped', reason: 'deadline'};
  const result = await publishOnce({url: producer.edge, source: producer.source, token: producer.token, timeoutMs}, key, message);
  const ids = {messageId: message.id, traceId: traceFields(message)?.traceId ?? ''};
  return result.status === 'published' ? {status: 'published', ...ids} : {status: result.status, code: result.error.error.code, ...ids};
}
