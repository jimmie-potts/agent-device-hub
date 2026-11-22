// Model-written conversation titles (Hub #2025). After the first owner message of a session appearance, and once more at
// its third task, a small model call writes the conversation's title, such as "#1896 Session tracking": the GitHub issue
// the conversation is about, then a short sentence-case description. The title is stored on the conversation with its
// source, generated or the owner's, and published as the session title; until one exists the persona name stands. The
// owner's rename always wins: it advances the conversation's title generation, so a generation in flight is dropped when
// it lands, and no generated title replaces it. A failed, refused or invalid title leaves the earlier title, or the
// persona, and never touches a task. Each paid title call reserves its most expensive cost in the shared spend ledger
// (Hub #2024) before it is sent, as a conversation-level call outside every task's limits, and settles it with the
// reported usage; a call the spend limits refuse is never sent. Each call is also recorded on the conversation with its
// outcome. Nothing is retried (ADR 0012).
//
// Third-party sources (see ../../THIRD-PARTY-NOTICES.md), adapted and modified here:
// - OpenAI Codex, codex-rs/tui/src/app/thread_title.rs at a0436d69ffd9a6d943d9b56175ba2968c5e698af, Apache License 2.0,
//   Copyright 2025 OpenAI: the title instruction (`thread_title_instructions`), the recent-conversation prompt
//   (`recent_conversation_thread_title_prompt`, `recent_conversation_messages`) and the normalization
//   (`parse_thread_title`), translated to TypeScript. Modified: the instruction leads with the issue reference, describes
//   instead of starting with a verb and bounds the description at 40 characters; the prompt names the owner and the
//   assistant and has its own bound; normalization takes plain text, strips a markdown heading, emphasis or a "Title:"
//   label, canonicalizes the issue reference and truncates the description only, at a word boundary.
// - T3 Code, packages/provider-core/src/server/textGenerationUtils.ts at b4277089795299da077e784f9f3432b3cc1c1c7d, MIT
//   License, Copyright (c) 2026 T3 Tools Inc.: `sanitizeThreadTitle`'s JSON `{"title": ...}` unwrap, first-line rule and
//   empty guard. Modified: an empty or placeholder title such as the literal "Title" is refused instead of replaced.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {AssistantProfile, AssistantProvider} from '@jimmie-potts/event-contracts/v2/assistant';
import {coreFamilies, type Title} from '@jimmie-potts/event-contracts/v2/families';
import type {AddMessage, Cancel, Outbox} from '@jimmie-potts/sdk';
import {ANTHROPIC_URL, ANTHROPIC_VERSION, codeOfStatus, type Transport} from './anthropic.js';
import {ProviderFault, textBytes} from './provider.js';
import {inputBound, type SpendLedger, type TokenUsage} from './spend.js';
import {PROFILES} from '../knowledge/model.js';

/** The longest description after any issue reference, in Unicode characters. */
export const TITLE_DESCRIPTION_CHARS = 40;
/** The longest owner title, as the session label bound. */
export const OWNER_TITLE_CHARS = 80;
/** The bound on the whole title prompt, instruction excluded, in UTF-8 bytes. */
export const TITLE_PROMPT_BYTES = 2048;
/** How many recent substantive messages the prompt carries, as Codex's `THREAD_TITLE_RECENT_MESSAGES`. */
export const TITLE_RECENT_MESSAGES = 8;
/** The task of an appearance whose start refreshes the title: a few turns in. */
export const TITLE_REFRESH_TURN = 3;
/** How long a title call may take before it is abandoned as uncertain. */
export const TITLE_DEADLINE_MS = 30_000;
/** The cap on one title answer's thinking and text, in tokens. */
export const TITLE_MAX_TOKENS = 1024;
/** The core removes a session that has had no lifecycle evidence for a day; the next one is a new appearance. */
export const SESSION_AGE_MS = 86_400_000;
export const DEFAULT_TITLE_MODEL = 'claude-haiku-5-5';
/** The fixed title the synthetic provider writes: it never echoes the conversation. */
export const SYNTHETIC_TITLE = 'Synthetic conversation';
/** The repository whose issues are written as a bare `#<number>`. */
export const HOME_REPOSITORY = 'agent-device-hub';

const session = coreFamilies.find(family => family.dataschema === 'https://bunny.invalid/events/session/3.1');
if (session === undefined) throw new Error('conversation titles need the session/3.1 title contract');
// The session contract's display text: no control characters and no recognizable credential, checked on the whole title.
const DISPLAY = new RegExp((session.schema as {$defs: {displayText: {pattern: string}}}).$defs.displayText.pattern, 'u');
const characters = (value: string): number => [...value].length;
/** Whether a title is session display text of at most `max` characters. */
export const displayable = (value: string, max = 160): boolean => value.length > 0 && characters(value) <= max && DISPLAY.test(value);

/** The title instruction: Codex's, modified as the header says. */
export const TITLE_INSTRUCTIONS = [
  'Generate a concise, single-line title for this conversation.',
  `If the conversation or a coding hand-off in it is about a GitHub issue, start with its reference: #<number> for an issue in ${HOME_REPOSITORY},`,
  'or <repository>#<number>, such as pixoo#14, for an issue in another repository. When several issues appear, use the main one. Never invent an issue number.',
  `After any reference, write a short description of at most ${String(TITLE_DESCRIPTION_CHARS)} characters and under five words where possible.`,
  'Capitalize only the first word unless the owner\'s language, proper nouns, acronyms, or code terms require otherwise.',
  'Write in the owner\'s language. Do not use quotes, markdown, or trailing punctuation. Do not answer the request. Reply with the title only.',
].join(' ');
const PREFIX = 'Prioritize the current task and latest substantive owner request.\n\nRecent conversation messages:\n';

/** One saved message the prompt may carry. Tool results are not conversation messages. */
export type TitleMessage = {role: 'owner' | 'assistant'; text: string};
const escape = (text: string): string => text.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** The longest prefix of `text` within `bytes` UTF-8 bytes that splits neither a character nor an escaped entity. */
function within(text: string, bytes: number): string {
  let kept = '', used = 0;
  for (const character of text) {
    const size = textBytes(character);
    if (used + size > bytes) break;
    kept += character; used += size;
  }
  const entity = kept.lastIndexOf('&');
  return entity >= 0 && !kept.slice(entity).includes(';') ? kept.slice(0, entity) : kept;
}

/**
 * The title prompt from a conversation's saved messages, oldest first: its last eight substantive messages, escaped and
 * wrapped as Codex's `recent_conversation_messages` does, each cut to an even share of the bound when they do not fit;
 * undefined without a substantive message.
 */
export function titlePrompt(messages: readonly TitleMessage[]): string | undefined {
  const recent = messages.filter(message => message.text.trim() !== '').slice(-TITLE_RECENT_MESSAGES).map(message => ({role: message.role, text: escape(message.text)}));
  if (recent.length === 0) return undefined;
  const markup = textBytes('<conversation>\n') + textBytes('\n</conversation>') + (recent.length - 1) +
    recent.reduce((sum, message) => sum + textBytes(`<message role="${message.role}"></message>`), 0);
  const room = Math.max(0, TITLE_PROMPT_BYTES - textBytes(PREFIX) - markup), share = Math.floor(room / recent.length);
  const cut = recent.reduce((sum, message) => sum + textBytes(message.text), 0) > room;
  const body = recent.map(message => `<message role="${message.role}">${cut && textBytes(message.text) > share ? within(message.text, share) : message.text}</message>`);
  return `${PREFIX}<conversation>\n${body.join('\n')}\n</conversation>`;
}

const QUOTES = new Set(['"', '\'', '`', '“', '”', '‘', '’', '*', '_']);
const trimQuotes = (value: string): string => {
  const chars = [...value];
  while (chars.length > 0 && QUOTES.has(chars[0] ?? '')) chars.shift();
  while (chars.length > 0 && QUOTES.has(chars.at(-1) ?? '')) chars.pop();
  return chars.join('');
};
const collapse = (value: string): string => value.split(/\s+/u).filter(part => part !== '').join(' ');
const PLACEHOLDER = /^(?:title|untitled|new (?:thread|conversation|chat)|conversation)$/iu;
const REFERENCE = /^(?:([A-Za-z0-9][A-Za-z0-9_.-]{0,99})#|#)([1-9][0-9]{0,8})(?=[\s:–—]|$)\s*(?:[:–—-]\s*)?(.*)$/u;

/** At most 40 characters of a description, ending at a word boundary when the cut would split a word that is not the first. */
function bounded(description: string): string {
  const chars = [...description];
  if (chars.length <= TITLE_DESCRIPTION_CHARS) return description;
  const kept = chars.slice(0, TITLE_DESCRIPTION_CHARS).join(''), space = kept.lastIndexOf(' ');
  return /\s/u.test(chars[TITLE_DESCRIPTION_CHARS] ?? '') || space <= 0 ? kept : kept.slice(0, space);
}
/**
 * A model's answer as a title, or undefined when it is no usable title. T3 Code's unwrap of a JSON `{"title": ...}`
 * answer and its first-line rule; Codex's trim of quote characters, whitespace collapse and trailing `.`, `?` and `!`;
 * then a markdown heading or emphasis and a "Title:" label go. A leading issue reference is kept, with this repository's
 * name dropped, and only the description after it is cut to 40 characters, at a word boundary where it has one. An empty or placeholder description, or a
 * title that is not session display text (a control character or a recognizable credential), is refused.
 */
export function normalizeTitle(response: string): string | undefined {
  let raw = response;
  try {
    const value: unknown = JSON.parse(response.trim());
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as {title?: unknown}).title === 'string') raw = (value as {title: string}).title;
  } catch { /* plain text, as the instruction asks */ }
  const line = raw.trim().split(/\r?\n/u)[0] ?? '';
  let text = collapse(trimQuotes(line.trim()));
  text = text.replace(/^#{1,6}\s+/u, '').replace(/^title\s*:\s*/iu, '');
  text = trimQuotes(text).trim().replace(/[.?!]+$/u, '').trimEnd();
  if (text === '' || PLACEHOLDER.test(text)) return undefined;
  const match = REFERENCE.exec(text);
  let reference = '', description = text;
  if (match !== null) {
    const [, repository, number, rest] = match;
    reference = repository === undefined || repository.toLowerCase() === HOME_REPOSITORY ? `#${String(number)}` : `${repository}#${String(number)}`;
    description = rest ?? '';
  }
  description = trimQuotes(bounded(description)).trimEnd().replace(/[.?!,;:]+$/u, '').trimEnd();
  if (description === '' || PLACEHOLDER.test(description)) return undefined;
  const title = reference === '' ? description : `${reference} ${description}`;
  return displayable(title) ? title : undefined;
}

const comparable = (value: string): string => collapse(value).replace(/[.?!]+$/u, '').toLocaleLowerCase();
/** A generated title, or undefined when the answer is no title or only repeats an owner message: raw prompt text is never published. */
export function generatedTitle(response: string | null, ownerTexts: readonly string[]): string | undefined {
  const title = response === null ? undefined : normalizeTitle(response);
  return title === undefined || ownerTexts.some(text => comparable(text) === comparable(title)) ? undefined : title;
}
/** The owner's title with its whitespace collapsed, or undefined when it is not session display text of at most 80 characters. */
export function ownerTitle(value: string): string | undefined {
  const title = collapse(value);
  return displayable(title, OWNER_TITLE_CHARS) ? title : undefined;
}

/** A title answer: its text, or null when the provider refused or cut it, and its reported usage by price class, or null when unreported. */
export type TitleReply = {text: string | null; usage: TokenUsage | null};
/** Writes one title from a bounded prompt. A provider never sees the bus, a task or anything but the prompt. */
export type TitleProvider = {readonly name: AssistantProvider; readonly model: string; title(prompt: string, signal: AbortSignal): Promise<TitleReply>};

/** The labelled synthetic provider's title: fixed, so it never echoes the conversation, and free. */
export class SyntheticTitleProvider implements TitleProvider {
  readonly name = 'synthetic' as const;
  readonly model = 'synthetic';
  title(): Promise<TitleReply> {return Promise.resolve({text: SYNTHETIC_TITLE, usage: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}});}
}

const MAX_RESPONSE_BYTES = 65_536;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A reported count; an absent or null cache count is zero, as the API reports a request that wrote or read no cache, while input and output are required. */
const count = (value: unknown, required: boolean): number | undefined => value === undefined || value === null ? required ? undefined : 0
  : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export type AnthropicTitleOptions = {readonly key: string; readonly model?: string; readonly transport?: Transport; readonly url?: string};
/**
 * The Anthropic Messages API behind the title call, through the same fetch seam, version and key as the turn provider:
 * the instruction as the system prompt, the conversation as one user message, low effort, the model's default thinking
 * and a small output cap. A refusal or a cut answer is no title; an error status fails the call once; a lost answer
 * leaves it uncertain. No retry and no fallback model.
 */
export class AnthropicTitleProvider implements TitleProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  readonly #key: string;
  readonly #transport: Transport;
  readonly #url: string;
  constructor(options: AnthropicTitleOptions) {
    this.model = options.model ?? DEFAULT_TITLE_MODEL; this.#key = options.key;
    this.#transport = options.transport ?? ((url, init) => fetch(url, init)); this.#url = options.url ?? ANTHROPIC_URL;
  }
  async title(prompt: string, signal: AbortSignal): Promise<TitleReply> {
    const body = JSON.stringify({model: this.model, max_tokens: TITLE_MAX_TOKENS, system: TITLE_INSTRUCTIONS,
      messages: [{role: 'user', content: [{type: 'text', text: prompt}]}], output_config: {effort: 'low'}});
    let response: Response;
    try {
      response = await this.#transport(this.#url, {method: 'POST', body, signal, redirect: 'error',
        headers: {'content-type': 'application/json', 'x-api-key': this.#key, 'anthropic-version': ANTHROPIC_VERSION}});
    } catch (error) {
      throw new ProviderFault(signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'unavailable', true);
    }
    if (!response.ok) throw codeOfStatus(response.status);
    let text: string;
    try {text = await response.text();} catch {throw new ProviderFault('unavailable', true);}
    if (textBytes(text) > MAX_RESPONSE_BYTES) throw new ProviderFault('too-large');
    let value: unknown;
    try {value = JSON.parse(text);} catch {throw new ProviderFault('invalid-message');}
    if (!object(value) || !Array.isArray(value.content) || !object(value.usage)) throw new ProviderFault('invalid-message');
    const {usage} = value;
    const input = count(usage.input_tokens, true), output = count(usage.output_tokens, true);
    const cacheWrite = count(usage.cache_creation_input_tokens, false), cacheRead = count(usage.cache_read_input_tokens, false);
    const reported = input === undefined || output === undefined || cacheWrite === undefined || cacheRead === undefined ? null : {input, output, cacheWrite, cacheRead};
    const answer = value.content.filter((block): block is {type: 'text'; text: string} => object(block) && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text).join('\n').trim();
    const usable = value.stop_reason !== 'refusal' && value.stop_reason !== 'max_tokens' && answer !== '';
    return {text: usable ? answer : null, usage: reported};
  }
}

/** A conversation's title and where its next one stands: the title and its source, the generation a rename advances, and the appearance. */
export type TitleRecord = {version: 1; title: {value: string; source: 'generated' | 'owner'} | null; generation: number;
  /** Tasks started in this appearance of the session, and the last instant the conversation reported lifecycle evidence. */
  turns: number; lastActivityMs: number | null};
/**
 * One title call: admitted before the request leaves, then settled. An admitted call that never settles, as after a
 * crash, keeps unknown usage, as an uncertain one does. `outcome` says what became of a definitive answer. A call the
 * spend limits refused is recorded failed with `capacity` and was never sent. A paid call's id is its spend ledger id.
 */
export type TitleCall = {version: 1; id: string; conversationId: string; provider: AssistantProvider; model: string; generation: number;
  startedAtMs: number; endedAtMs: number | null; status: 'admitted' | 'succeeded' | 'failed' | 'uncertain'; code?: ErrorCode;
  outcome: 'applied' | 'unchanged' | 'invalid' | 'dropped' | null; usage: TokenUsage | null; maxTokens: number};

/** The engine's seams: the outbox, the clock and scheduler, the spend ledger, the profile's provider and what the conversation has saved and reported. */
export type TitleDependencies = {
  outbox: Outbox;
  /** The shared spend ledger (Hub #2024): a paid title call reserves before it is sent and settles with its usage. */
  spend: Pick<SpendLedger, 'reserve' | 'settle'>;
  now: () => number;
  after: (delayMs: number, callback: () => void) => Cancel;
  provider: (profile: AssistantProfile) => TitleProvider;
  /** The conversation's saved owner and assistant messages, oldest first. */
  messages: (conversationId: string) => TitleMessage[];
  /** Whether the conversation has reported lifecycle evidence, so the core may hold its session. */
  reported: (conversationId: string) => boolean;
  /** The metadata observation that carries a title to the conversation's session now. */
  metadata: (conversationId: string, title: Title, observedAtMs: number) => {key: string; draft: object};
};
type InFlight = {controller: AbortController; work: Promise<void>};
const persona = (profile: AssistantProfile): string => PROFILES.find(value => value.id === profile)?.name ?? profile;

/** The conversation titles of one companions activation. Every write runs inside the caller's or its own outbox transaction. */
export class ConversationTitles {
  readonly #inFlight = new Map<string, InFlight>();
  #closed = false;
  constructor(readonly database: DatabaseSync, readonly deps: TitleDependencies) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_titles (conversation_id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_title_calls (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, started_at_ms INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_title_call_time ON assistant_title_calls(started_at_ms);`);
  }
  record(conversationId: string): TitleRecord | undefined {
    const row = this.database.prepare('SELECT record FROM assistant_titles WHERE conversation_id=?').get(conversationId) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as TitleRecord;
  }
  #save(conversationId: string, record: TitleRecord): void {
    this.database.prepare('INSERT INTO assistant_titles VALUES (?,?) ON CONFLICT(conversation_id) DO UPDATE SET record=excluded.record').run(conversationId, JSON.stringify(record));
  }
  #fresh(): TitleRecord {return {version: 1, title: null, generation: 0, turns: 0, lastActivityMs: null};}
  call(id: string): TitleCall | undefined {
    const row = this.database.prepare('SELECT record FROM assistant_title_calls WHERE id=?').get(id) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as TitleCall;
  }
  /** The title calls started at or after `sinceMs`, oldest first: the input the spend accounting counts (Hub #2024). */
  calls(sinceMs = 0): TitleCall[] {
    return this.database.prepare('SELECT record FROM assistant_title_calls WHERE started_at_ms>=? ORDER BY started_at_ms, id').all(sinceMs).map(row => JSON.parse(row.record as string) as TitleCall);
  }
  #saveCall(call: TitleCall): void {
    this.database.prepare('INSERT INTO assistant_title_calls VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(call.id, call.conversationId, call.startedAtMs, JSON.stringify(call));
  }
  /** The session title a conversation publishes: the owner's or the generated title, or the persona name until one exists. */
  published(conversationId: string, profile: AssistantProfile): Title {
    const title = this.record(conversationId)?.title ?? null;
    return title === null ? {value: persona(profile), source: 'provider'} : {value: title.value, source: title.source === 'owner' ? 'user' : 'provider'};
  }
  /**
   * Counts a task the owner started, in its admission's transaction, and says whether it is due a title: the first of a
   * new appearance, when the session had no lifecycle evidence for a day or never had any, or the refresh a few turns in.
   */
  started(conversationId: string): boolean {
    const now = this.deps.now(), record = this.record(conversationId) ?? this.#fresh();
    const appearing = record.lastActivityMs === null || now - record.lastActivityMs >= SESSION_AGE_MS;
    record.turns = appearing ? 1 : record.turns + 1;
    this.#save(conversationId, record);
    return record.title?.source !== 'owner' && (record.turns === 1 || record.turns === TITLE_REFRESH_TURN);
  }
  /** Records that the conversation reported lifecycle evidence now, in the transaction that reports it. */
  touched(conversationId: string): void {
    const record = this.record(conversationId) ?? this.#fresh();
    record.lastActivityMs = this.deps.now();
    this.#save(conversationId, record);
  }
  /** Whether a metadata title can reach the conversation's session: it reported evidence within the session's age. */
  #visible(conversationId: string, record: TitleRecord): boolean {
    return this.deps.reported(conversationId) && (record.lastActivityMs === null || this.deps.now() - record.lastActivityMs < SESSION_AGE_MS);
  }
  #announce(add: AddMessage, conversationId: string, record: TitleRecord, profile: AssistantProfile): void {
    if (!this.#visible(conversationId, record)) return;
    const {key, draft} = this.deps.metadata(conversationId, this.published(conversationId, profile), this.deps.now());
    add(key, draft as Parameters<AddMessage>[1]);
  }
  /**
   * The owner's rename, in its control's transaction: the title and its source, a new generation that drops any title in
   * flight, and the metadata observation that shows it on the session at once. Call `drop` after the commit.
   */
  rename(add: AddMessage, conversationId: string, profile: AssistantProfile, value: string): void {
    const record = this.record(conversationId) ?? this.#fresh();
    record.title = {value, source: 'owner'}; record.generation += 1;
    this.#save(conversationId, record);
    this.#announce(add, conversationId, record, profile);
  }
  /** Abandons the conversation's title call in flight, whose answer its generation would drop anyway. */
  drop(conversationId: string): void {this.#inFlight.get(conversationId)?.controller.abort();}
  /**
   * Writes the conversation's title once: admits the call with its generation, sends the prompt, and settles it. A title
   * that is valid, and still wanted because no rename landed meanwhile, is stored as generated and announced in the same
   * transaction. Every failure is absorbed: a title never fails, delays or rolls back a task.
   */
  generate(conversationId: string, profile: AssistantProfile): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.drop(conversationId);
    const controller = new AbortController();
    const work = this.#generate(conversationId, profile, controller).catch(() => { /* The admitted call keeps the evidence. */ }).finally(() => {
      if (this.#inFlight.get(conversationId)?.controller === controller) this.#inFlight.delete(conversationId);
    });
    this.#inFlight.set(conversationId, {controller, work});
    return work;
  }
  async #generate(conversationId: string, profile: AssistantProfile, controller: AbortController): Promise<void> {
    const provider = this.deps.provider(profile);
    let call: TitleCall | undefined, prompt: string | undefined, owners: string[] = [];
    await this.deps.outbox.transaction(() => {
      const record = this.record(conversationId) ?? this.#fresh();
      if (record.title?.source === 'owner' || controller.signal.aborted) return;
      const messages = this.deps.messages(conversationId);
      prompt = titlePrompt(messages);
      if (prompt === undefined) return;
      owners = messages.filter(message => message.role === 'owner').map(message => message.text);
      const admitted: TitleCall = {version: 1, id: randomUUID(), conversationId, provider: provider.name, model: provider.model, generation: record.generation,
        startedAtMs: this.deps.now(), endedAtMs: null, status: 'admitted', outcome: null, usage: null, maxTokens: TITLE_MAX_TOKENS};
      // A paid call reserves its most expensive cost with its receipt, as a conversation-level call; the synthetic one is free.
      const refused = provider.name === 'synthetic' ? undefined : this.deps.spend.reserve({id: admitted.id, purpose: 'conversation', owner: conversationId,
        model: provider.model, inputUnits: inputBound({system: TITLE_INSTRUCTIONS, prompt}), outputUnits: TITLE_MAX_TOKENS});
      if (refused !== undefined) {
        // The spend limits or a missing price refuse it: nothing is sent, and the earlier title or the persona stays.
        this.#saveCall({...admitted, endedAtMs: admitted.startedAtMs, status: 'failed', code: 'capacity'});
        return;
      }
      call = admitted;
      this.#saveCall(call);
    });
    if (call === undefined || prompt === undefined) return;
    const admitted: TitleCall = call;
    let reply: TitleReply | undefined, fault: unknown;
    const cancel = this.deps.after(TITLE_DEADLINE_MS, () => {controller.abort();});
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) reject(new ProviderFault('cancelled', true));
        controller.signal.addEventListener('abort', () => {reject(new ProviderFault('cancelled', true));}, {once: true});
      });
      reply = await Promise.race([provider.title(prompt, controller.signal), aborted]);
    } catch (error) {fault = error;} finally {cancel();}
    if (this.#closed || !this.database.isOpen) return;
    await this.deps.outbox.transaction(add => {
      const saved = this.call(admitted.id) ?? admitted;
      saved.endedAtMs = this.deps.now();
      // The reported usage replaces the reservation; a lost or failed answer reports none and keeps the reservation counting.
      if (saved.provider !== 'synthetic') this.deps.spend.settle(saved.id, reply?.usage ?? null);
      if (reply === undefined) {
        // A lost answer, a deadline, a rename or a stop leaves the call's fate and usage unknown; a definitive error settles it.
        const definitive = fault instanceof ProviderFault && !fault.uncertain ? fault : undefined;
        saved.status = definitive === undefined ? 'uncertain' : 'failed';
        if (definitive !== undefined) saved.code = definitive.code;
        this.#saveCall(saved);
        return;
      }
      saved.status = 'succeeded'; saved.usage = reply.usage;
      const record = this.record(conversationId) ?? this.#fresh(), title = generatedTitle(reply.text, owners);
      if (record.generation !== saved.generation || record.title?.source === 'owner') saved.outcome = 'dropped';
      else if (title === undefined) saved.outcome = 'invalid';
      else if (record.title?.value === title) saved.outcome = 'unchanged';
      else {
        record.title = {value: title, source: 'generated'};
        this.#save(conversationId, record);
        this.#announce(add, conversationId, record, profile);
        saved.outcome = 'applied';
      }
      this.#saveCall(saved);
    });
  }
  /** Stops every title call in flight and waits for each to settle. */
  async stop(): Promise<void> {
    const pending = [...this.#inFlight.values()];
    for (const item of pending) item.controller.abort();
    await Promise.all(pending.map(item => item.work));
    this.#closed = true;
  }
}
