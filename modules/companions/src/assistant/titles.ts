// Model-written conversation titles that follow the conversation's topic (Hub #2025, #2075). A small title model checks
// the title of a conversation such as "#1896 Session tracking", the GitHub issue the conversation is about and then a
// short sentence-case description: after the first owner message while the conversation has no title, after each
// finished task, and after each major event the module knows about, an answered approval, a tool call that changed
// state, an accepted coding hand-off and a hand-off's result. No task count or time gap starts a check. The model sees
// the current title and who set it, fixed-form labels of the events and the recent messages, and answers KEEP or a new
// title. Only a profile with a real title model makes the call; the others keep their persona names. The title is
// stored on the conversation with its source, generated or the owner's, and published as the session title; until one
// exists the persona name stands. The owner's rename is not permanent: the model is told the title is the owner's and
// keeps it unless the topic clearly changed. A rename, and each newer check, advances the conversation's title
// generation, so an answer that settles after either is dropped; a rename also abandons the call in flight. One call
// runs per conversation at a time, and the triggers that arrive meanwhile coalesce into one follow-up check. KEEP, and a
// failed, refused or invalid answer, leave the title as it was, or the persona, and never touch a task. Each paid
// title call reserves its most expensive cost in the shared spend ledger (Hub #2024) before it is sent, as a
// conversation-level call outside every task's limits, and settles it with the reported usage; a call the spend limits
// refuse is never sent. Each call is also recorded on the conversation with its events, its outcome and the model's raw
// answer, kept privately for diagnosis. Nothing is retried (ADR 0012).
//
// Third-party sources (see ../../THIRD-PARTY-NOTICES.md), adapted and modified here:
// - OpenAI Codex, codex-rs/tui/src/app/thread_title.rs at a0436d69ffd9a6d943d9b56175ba2968c5e698af, Apache License 2.0,
//   Copyright 2025 OpenAI: `THREAD_TITLE_RECENT_MESSAGES` (line 37), the title instruction (`thread_title_instructions`,
//   lines 336-346), the recent-conversation prompt (`recent_conversation_messages`, lines 406-491, and
//   `recent_conversation_thread_title_prompt`, lines 493-510) and the normalization (`parse_thread_title`, lines
//   512-537), translated to TypeScript. Modified: the instruction asks first whether the current title still fits,
//   answered by KEEP, and keeps an owner's title unless the topic clearly changed; it leads with the issue reference,
//   describes instead of starting with a verb and bounds the description at 40 characters; the prompt names the
//   current title, its source and the latest events before the messages, names the owner and the assistant and has its
//   own bound; normalization takes plain text, strips a markdown heading, emphasis or a "Title:" label, canonicalizes
//   the issue reference and truncates the description only, at a word boundary.
// - T3 Code, packages/provider-core/src/server/textGenerationUtils.ts at b4277089795299da077e784f9f3432b3cc1c1c7d, MIT
//   License, Copyright (c) 2026 T3 Tools Inc.: `sanitizeThreadTitle`'s JSON `{"title": ...}` unwrap, first-line rule and
//   empty guard. Modified: an empty or placeholder title such as the literal "Title" is refused instead of replaced.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {AssistantProfile, AssistantProvider} from '@jimmie-potts/event-contracts/v2/assistant';
import {coreFamilies, type Title} from '@jimmie-potts/event-contracts/v2/families';
import type {AddMessage, Cancel, Outbox} from '@jimmie-potts/sdk';
import {ANTHROPIC_URL, ANTHROPIC_VERSION, faultOf, type Transport} from './anthropic.js';
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
/** How many distinct event labels a check carries: the latest, oldest first, when triggers coalesce. */
export const TITLE_EVENTS = 4;
/** The answer that keeps the current title. */
export const KEEP = 'KEEP';
/** How long a title call may take before it is abandoned as uncertain. */
export const TITLE_DEADLINE_MS = 30_000;
/** A title whose description shares this many consecutive words with an owner message or a hand-off brief is an echo of it. */
export const ECHO_RUN_WORDS = 6;
/** The bound on the raw answer a title call record keeps, in UTF-8 bytes. */
export const TITLE_ANSWER_BYTES = 1024;
/** The cap on one title answer's thinking and text, in tokens. */
export const TITLE_MAX_TOKENS = 1024;
/** The core removes a session that has had no lifecycle evidence for a day, so a title published later cannot reach it. */
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

/** The title instruction: Codex's, modified as the header says. Fixed text: nothing from a conversation enters it. */
export const TITLE_INSTRUCTIONS = [
  'You keep the title of a conversation in step with its topic.',
  'You are given the current title and who set it, the latest events in the conversation and its recent messages.',
  `If there is a current title and it still fits the topic, reply with ${KEEP} and nothing else.`,
  `A title set by the owner is their choice: reply ${KEEP} unless the topic has clearly changed since they set it.`,
  'Otherwise generate a concise, single-line title for this conversation.',
  `If the conversation or a coding hand-off in it is about a GitHub issue, start with its reference: #<number> for an issue in ${HOME_REPOSITORY},`,
  'or <repository>#<number>, such as pixoo#14, for an issue in another repository. When several issues appear, use the main one. Never invent an issue number.',
  `After any reference, write a short description of at most ${String(TITLE_DESCRIPTION_CHARS)} characters and under five words where possible.`,
  'Capitalize only the first word unless the owner\'s language, proper nouns, acronyms, or code terms require otherwise.',
  `Write in the owner's language. Do not use quotes, markdown, or trailing punctuation. Do not answer the request. Reply with ${KEEP} or the title only.`,
].join(' ');
const PREFIX = 'Prioritize the current task and latest substantive owner request.\n\nRecent conversation messages:\n';

/** One saved message the prompt may carry. Tool results are not conversation messages. */
export type TitleMessage = {role: 'owner' | 'assistant'; text: string};
/** A conversation's stored title and who set it. */
export type StoredTitle = {value: string; source: 'generated' | 'owner'};
/**
 * What happened in the conversation that asks for a check, in the module's own terms: the first owner message of an
 * untitled conversation, a finished task with its result, a tool call that changed state, an answered approval, an
 * accepted coding hand-off and a hand-off's result with its outcome. A tool is named by its tool identifier.
 */
export type TitleEvent = {kind: 'message'} | {kind: 'task'; result: 'succeeded' | 'failed' | 'cancelled'} | {kind: 'tool'; tool: string}
  | {kind: 'approval'; tool: string; decision: 'approved' | 'declined'} | {kind: 'hand-off'}
  | {kind: 'hand-off-result'; outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'unknown'};
/** A tool identifier as the tool definitions name it; anything else is never put in a label. */
const TOOL = /^[a-z][a-z0-9_]{0,63}$/u;
const toolOf = (tool: string): string => TOOL.test(tool) ? tool : 'a tool';
/** An event's fixed-form label: the module's own words with a tool identifier, a decision or an outcome, never a tool result. */
export function eventLabel(event: TitleEvent): string {
  switch (event.kind) {
    case 'message': return 'The owner sent a message.';
    case 'task': return `A task finished: ${event.result}.`;
    case 'tool': return `A tool call changed state: ${toolOf(event.tool)} was accepted.`;
    case 'approval': return `The owner ${event.decision} ${toolOf(event.tool)}.`;
    case 'hand-off': return 'A coding hand-off was accepted.';
    case 'hand-off-result': return `A coding hand-off's result arrived: ${event.outcome}.`;
  }
}
const escape = (text: string): string => text.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** The longest prefix of `text` within `bytes` UTF-8 bytes that splits no character, and with `entities` no escaped entity. */
function within(text: string, bytes: number, entities = true): string {
  let kept = '', used = 0;
  for (const character of text) {
    const size = textBytes(character);
    if (used + size > bytes) break;
    kept += character; used += size;
  }
  const entity = kept.lastIndexOf('&');
  return entities && entity >= 0 && !kept.slice(entity).includes(';') ? kept.slice(0, entity) : kept;
}

/**
 * The title prompt: the current title and who set it, escaped, or none; the labels of the events that asked for the
 * check; and the conversation's saved messages, oldest first: its last eight substantive messages, escaped and wrapped as
 * Codex's `recent_conversation_messages` does, each cut to an even share of what the bound leaves when they do not fit.
 * Undefined without a substantive message. The title is at most 160 characters and each of at most four labels is short,
 * so the messages keep most of the 2 KiB.
 */
export function titlePrompt(messages: readonly TitleMessage[], current: StoredTitle | null, events: readonly string[]): string | undefined {
  const recent = messages.filter(message => message.text.trim() !== '').slice(-TITLE_RECENT_MESSAGES).map(message => ({role: message.role, text: escape(message.text)}));
  if (recent.length === 0) return undefined;
  const title = current === null ? 'Current title: none'
    : `Current title, ${current.source === 'owner' ? 'set by the owner' : 'written by the title model'}: ${escape(current.value)}`;
  const header = `${title}\n\nLatest events:\n${events.slice(-TITLE_EVENTS).map(label => `- ${label}`).join('\n')}\n\n`;
  const markup = textBytes('<conversation>\n') + textBytes('\n</conversation>') + (recent.length - 1) +
    recent.reduce((sum, message) => sum + textBytes(`<message role="${message.role}"></message>`), 0);
  const room = Math.max(0, TITLE_PROMPT_BYTES - textBytes(header) - textBytes(PREFIX) - markup), share = Math.floor(room / recent.length);
  const cut = recent.reduce((sum, message) => sum + textBytes(message.text), 0) > room;
  const body = recent.map(message => `<message role="${message.role}">${cut && textBytes(message.text) > share ? within(message.text, share) : message.text}</message>`);
  return `${header}${PREFIX}<conversation>\n${body.join('\n')}\n</conversation>`;
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
/** A normalized answer: the title, the same title before its description was cut, and whether it was cut. */
type TitleParts = {title: string; full: string; cut: boolean;
  /** The description after any issue reference: whole, before the cut, and as the title keeps it. */
  description: string; kept: string};
/**
 * A model's answer as a title, or undefined when it is no usable title. T3 Code's unwrap of a JSON `{"title": ...}`
 * answer and its first-line rule; Codex's trim of quote characters, whitespace collapse and trailing `.`, `?` and `!`;
 * then a markdown heading or emphasis and a "Title:" label go. A leading issue reference is kept, with this repository's
 * name dropped, and only the description after it is cut to 40 characters, at a word boundary where it has one. An
 * empty or placeholder description, or a title that is not session display text (a control character or a recognizable
 * credential), is refused.
 */
export function normalizeTitle(response: string): string | undefined {return titleParts(response)?.title;}
/** An answer's first line as normalization reads it: unwrapped, unquoted, without a heading, label or trailing `.?!`. */
function answerLine(response: string): string {
  let raw = response;
  try {
    const value: unknown = JSON.parse(response.trim());
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as {title?: unknown}).title === 'string') raw = (value as {title: string}).title;
  } catch { /* plain text, as the instruction asks */ }
  const line = raw.trim().split(/\r?\n/u)[0] ?? '';
  let text = collapse(trimQuotes(line.trim()));
  text = text.replace(/^#{1,6}\s+/u, '').replace(/^title\s*:\s*/iu, '');
  return trimQuotes(text).trim().replace(/[.?!]+$/u, '').trimEnd();
}
/** Whether an answer keeps the current title: KEEP alone on its first line, in any case, normalized as a title is. */
export function keeps(response: string | null): boolean {return response !== null && answerLine(response).toUpperCase() === KEEP;}
function titleParts(response: string): TitleParts | undefined {
  const text = answerLine(response);
  if (text === '' || PLACEHOLDER.test(text)) return undefined;
  const match = REFERENCE.exec(text);
  let reference = '', description = text;
  if (match !== null) {
    const [, repository, number, rest] = match;
    reference = repository === undefined || repository.toLowerCase() === HOME_REPOSITORY ? `#${String(number)}` : `${repository}#${String(number)}`;
    description = rest ?? '';
  }
  const kept = bounded(description), cut = kept !== description;
  description = trimQuotes(kept).trimEnd().replace(/[.?!,;:]+$/u, '').trimEnd();
  if (description === '' || PLACEHOLDER.test(description)) return undefined;
  const title = reference === '' ? description : `${reference} ${description}`;
  const full = match === null ? text : `${reference} ${match[3] ?? ''}`;
  return displayable(title) ? {title, full, cut, description: match === null ? text : match[3] ?? '', kept: description} : undefined;
}

/** A text in the form the echo guard compares: whitespace collapsed, no trailing `.?!`, this repository's references short, lower case. */
const comparable = (value: string): string => collapse(trimQuotes(collapse(value))).replace(/[.?!]+$/u, '')
  .replace(new RegExp(`\\b${HOME_REPOSITORY}#`, 'giu'), '#').toLocaleLowerCase();
/**
 * A saved coding hand-off message's fixed wrapper, so an echo of the brief alone is caught: the approval question
 * ("Delegate to the coding worker in <repo>: <brief>"), the accepted hand-off ("Delegated to ...") and one waiting for its
 * companion's busy slot ("Waiting to delegate to ...", Hub #2028), as the engine words them.
 */
const HANDED_OFF = /^(?:Delegated? to|Waiting to delegate to) the coding worker in [^:\s]+: /u;
/** The answer with the prompt's entity escapes undone, so an echo the model copied in escaped form is caught too. */
const unescaped = (value: string): string => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
/** The words of a text as the echo guard reads them: entity escapes undone, lower case, letters and digits only. */
const words = (value: string): string[] => unescaped(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** Each run of `ECHO_RUN_WORDS` consecutive words of a text. */
function runs(tokens: readonly string[]): string[] {
  const found: string[] = [];
  for (let start = 0; start + ECHO_RUN_WORDS <= tokens.length; start += 1) found.push(tokens.slice(start, start + ECHO_RUN_WORDS).join(' '));
  return found;
}
/**
 * A generated title, or undefined when the answer is no title or repeats text the prompt carried, so raw conversation
 * text is never published as a title. The answer is read whole and as its title, also with the prompt's entity escapes
 * undone, and compared ignoring case, spacing, surrounding quotes and trailing punctuation:
 * - with every message: an answer equal to one is refused, which catches a short echo;
 * - with each owner message and coding hand-off brief (its fixed wrapper stripped): the description after any issue
 *   reference, whole or as the title keeps it, may not share a run of `ECHO_RUN_WORDS` consecutive words with it, which
 *   catches a longer echo wherever the text named its issue;
 * - with each other assistant reply: an answer long enough to be cut may not appear inside it, whole or as its whole
 *   description after any issue reference. Replies naturally reuse the topic's words, so they get no word-run check.
 * Verbatim text only: a paraphrase, a reordered or reworded message or a shorter shared run passes, a short answer that
 * repeats part of a reply behind a new issue reference passes, and an owner message that is exactly the right title is
 * refused.
 */
export function generatedTitle(response: string | null, messages: readonly TitleMessage[]): string | undefined {
  const parts = response === null ? undefined : titleParts(response);
  if (parts === undefined) return undefined;
  const answers = [...new Set([parts.title, parts.full, unescaped(parts.title), unescaped(parts.full)].map(comparable))];
  const briefs = messages.filter(message => message.role === 'assistant' && HANDED_OFF.test(message.text)).map(message => message.text.replace(HANDED_OFF, ''));
  const said = [...messages.filter(message => message.role === 'owner').map(message => message.text), ...briefs];
  const replies = messages.filter(message => message.role === 'assistant' && !HANDED_OFF.test(message.text)).map(message => comparable(message.text));
  if ([...messages.map(message => message.text), ...briefs].some(text => answers.includes(comparable(text)))) return undefined;
  // A cut answer inside a reply, also by its whole description alone, without the issue reference the model put in front.
  const inside = parts.cut ? [...answers, ...[parts.description, unescaped(parts.description)].map(comparable)] : [];
  if (replies.some(reply => inside.some(answer => answer !== '' && reply.includes(answer)))) return undefined;
  const runsSaid = new Set(said.flatMap(text => runs(words(text))));
  const echoes = [parts.description, parts.kept].some(description => runs(words(description)).some(run => runsSaid.has(run)));
  return echoes ? undefined : parts.title;
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
    // A spend-limit refusal maps as for a task's call; any failure keeps the earlier title or the persona.
    if (!response.ok) throw await faultOf(response);
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

/**
 * A conversation's title and where its next check stands: the title and its source, the generation that a rename and
 * each admitted check advance, and the last instant the conversation reported lifecycle evidence. A record saved by the
 * #2025 release may still hold its count of the appearance's tasks, `turns`, which nothing reads.
 */
export type TitleRecord = {version: 1; title: StoredTitle | null; generation: number; lastActivityMs: number | null};
/**
 * One title call: admitted before the request leaves, then settled. An admitted call that never settles, as after a
 * crash, keeps unknown usage, as an uncertain one does. `outcome` says what became of a definitive answer: a new title
 * `applied`, the same title again `unchanged`, KEEP `kept`, no usable title `invalid`, or an answer that settled after a
 * rename or a newer check `dropped`. A call the spend limits refused is recorded failed with `capacity` and was never
 * sent. A paid call's id is its spend ledger id.
 */
export type TitleCall = {version: 1; id: string; conversationId: string; provider: AssistantProvider; model: string; generation: number;
  startedAtMs: number; endedAtMs: number | null; status: 'admitted' | 'succeeded' | 'failed' | 'uncertain'; code?: ErrorCode;
  outcome: 'applied' | 'unchanged' | 'kept' | 'invalid' | 'dropped' | null; usage: TokenUsage | null; maxTokens: number;
  /** The labels of the events the check answered, oldest first; absent on a #2025 call. */
  events?: string[];
  /** The model's raw answer, at most 1 KiB, kept privately for diagnosis; absent before the answer or without text. */
  answer?: string | null};

/** The engine's seams: the outbox, the clock and scheduler, the spend ledger, the profile's provider and what the conversation has saved and reported. */
export type TitleDependencies = {
  outbox: Outbox;
  /** The shared spend ledger (Hub #2024): a paid title call reserves before it is sent and settles with its usage. */
  spend: Pick<SpendLedger, 'reserve' | 'settle'>;
  now: () => number;
  after: (delayMs: number, callback: () => void) => Cancel;
  /** The profile's title provider, or undefined when it has no real model to write titles: it keeps its persona name. */
  provider: (profile: AssistantProfile) => TitleProvider | undefined;
  /** The conversation's saved owner and assistant messages, oldest first. */
  messages: (conversationId: string) => TitleMessage[];
  previousTitle?: (conversationId: string, profile: AssistantProfile, title: StoredTitle | null) => StoredTitle | null;
  /** Whether the conversation has reported lifecycle evidence, so the core may hold its session. */
  reported: (conversationId: string) => boolean;
  /** The metadata observation that carries a title to the conversation's session now. */
  metadata: (conversationId: string, title: Title, observedAtMs: number) => {key: string; draft: object};
};
/** A conversation's checks: the call in flight, the labels of the triggers waiting for its one follow-up, and the whole run. */
type InFlight = {controller: AbortController; pending: string[] | undefined; work: Promise<void>};
const persona = (profile: AssistantProfile): string => PROFILES.find(value => value.id === profile)?.name ?? profile;
/** The labels with one more, each once, oldest first, keeping the latest `TITLE_EVENTS`. */
const merged = (labels: readonly string[], label: string): string[] => labels.includes(label) ? [...labels] : [...labels, label].slice(-TITLE_EVENTS);

/** The conversation titles of one companions activation. Every write runs inside the caller's or its own outbox transaction. */
export class ConversationTitles {
  readonly #inFlight = new Map<string, InFlight>();
  #stopping = false;
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
  #fresh(): TitleRecord {return {version: 1, title: null, generation: 0, lastActivityMs: null};}
  call(id: string): TitleCall | undefined {
    const row = this.database.prepare('SELECT record FROM assistant_title_calls WHERE id=?').get(id) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as TitleCall;
  }
  /** The title calls started at or after `sinceMs`, oldest first, in admission order: the input the spend accounting counts (Hub #2024). */
  calls(sinceMs = 0): TitleCall[] {
    return this.database.prepare('SELECT record FROM assistant_title_calls WHERE started_at_ms>=? ORDER BY started_at_ms, rowid').all(sinceMs).map(row => JSON.parse(row.record as string) as TitleCall);
  }
  #saveCall(call: TitleCall): void {
    this.database.prepare('INSERT INTO assistant_title_calls VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(call.id, call.conversationId, call.startedAtMs, JSON.stringify(call));
  }
  /** The session title a conversation publishes: the owner's or the generated title, or the persona name until one exists. */
  published(conversationId: string, profile: AssistantProfile, policy?: {allowLabel: boolean; allowGenerated: boolean}): Title {
    const title = policy?.allowLabel === false ? null : this.record(conversationId)?.title ?? null;
    if (title?.source === 'owner') return {value: title.value, source: 'user'};
    const value = title?.source === 'generated' && policy?.allowGenerated !== false ? title.value : persona(profile);
    return {value, source: 'provider'};
  }
  /**
   * Whether a task the owner starts asks for a check by itself, read in its admission's transaction: only while the
   * conversation has no title, so its first message earns one. No count of tasks and no time since the last one counts.
   */
  started(conversationId: string): boolean {return (this.record(conversationId)?.title ?? null) === null;}
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
   * The owner's rename, in its control's transaction: the title and its source, a new generation that drops any answer
   * still to settle, and the metadata observation that shows it on the session at once. Call `drop` after the commit.
   * The title is not permanent: later checks tell the model it is the owner's.
   */
  rename(add: AddMessage, conversationId: string, profile: AssistantProfile, value: string): void {
    const record = this.record(conversationId) ?? this.#fresh();
    record.title = {value, source: 'owner'}; record.generation += 1;
    this.#save(conversationId, record);
    this.#announce(add, conversationId, record, profile);
  }
  /** Abandons the conversation's title call in flight and the follow-up check waiting behind it; the generation drops their answers anyway. */
  drop(conversationId: string): void {
    const entry = this.#inFlight.get(conversationId);
    if (entry === undefined) return;
    entry.pending = undefined;
    entry.controller.abort();
  }
  /**
   * Asks the title model to check the conversation's title after `event`. With no call in flight for the conversation
   * the check starts now; otherwise the event's label joins the one follow-up check that starts when that call settles.
   * Resolves once the conversation has no check left to run. Every failure is absorbed: a check never fails, delays or
   * rolls back a task.
   */
  check(conversationId: string, profile: AssistantProfile, event: TitleEvent): Promise<void> {
    if (this.#stopping || this.deps.provider(profile) === undefined) return Promise.resolve();
    const label = eventLabel(event), running = this.#inFlight.get(conversationId);
    if (running !== undefined) {
      running.pending = merged(running.pending ?? [], label);
      return running.work;
    }
    const entry: InFlight = {controller: new AbortController(), pending: undefined, work: Promise.resolve()};
    this.#inFlight.set(conversationId, entry);
    entry.work = this.#run(conversationId, profile, entry, [label]);
    return entry.work;
  }
  /**
   * Runs the conversation's checks one at a time: the first, then the coalesced follow-up while triggers keep arriving.
   * The run leaves `#inFlight` in the same synchronous step that finds no trigger waiting, so a later trigger starts a
   * new run instead of joining one that has ended.
   */
  async #run(conversationId: string, profile: AssistantProfile, entry: InFlight, first: string[]): Promise<void> {
    let events: string[] = first;
    for (;;) {
      await this.#ask(conversationId, profile, entry.controller, events).catch(() => { /* The admitted call keeps the evidence. */ });
      const next = this.#stopping ? undefined : entry.pending;
      entry.pending = undefined;
      if (next === undefined) {
        if (this.#inFlight.get(conversationId) === entry) this.#inFlight.delete(conversationId);
        return;
      }
      events = next; entry.controller = new AbortController();
    }
  }
  /**
   * One check: admits the call with a new generation, sends the prompt, and settles it. KEEP leaves the title. A new
   * title that is valid, and still wanted because no rename or newer check landed meanwhile, is stored as generated and
   * announced in the same transaction, replacing a generated or an owner's title.
   */
  async #ask(conversationId: string, profile: AssistantProfile, controller: AbortController, events: readonly string[]): Promise<void> {
    const provider = this.deps.provider(profile);
    if (provider === undefined) return;
    const previousTitle = (title: StoredTitle | null) => this.deps.previousTitle === undefined ? title : this.deps.previousTitle(conversationId, profile, title);
    let call: TitleCall | undefined, prompt: string | undefined, said: TitleMessage[] = [], priorTitle: StoredTitle | null = null;
    await this.deps.outbox.transaction(() => {
      const record = this.record(conversationId) ?? this.#fresh();
      if (controller.signal.aborted) return;
      const messages = this.deps.messages(conversationId);
      priorTitle = record.title;
      prompt = titlePrompt(messages, previousTitle(priorTitle), events);
      if (prompt === undefined) return;
      // The echo guard compares the answer with every message the prompt carried, the owner's and the assistant's.
      said = messages;
      const admitted: TitleCall = {version: 1, id: randomUUID(), conversationId, provider: provider.name, model: provider.model, generation: record.generation + 1,
        startedAtMs: this.deps.now(), endedAtMs: null, status: 'admitted', outcome: null, usage: null, maxTokens: TITLE_MAX_TOKENS, events: [...events]};
      // A paid call reserves its most expensive cost with its receipt, as a conversation-level call; the synthetic one is free.
      const refused = provider.name === 'synthetic' ? undefined : this.deps.spend.reserve({id: admitted.id, purpose: 'conversation', owner: conversationId,
        model: provider.model, inputUnits: inputBound({system: TITLE_INSTRUCTIONS, prompt}), outputUnits: TITLE_MAX_TOKENS});
      if (refused !== undefined) {
        // The spend limits refuse it: nothing is sent, and the title or the persona stays. Every model is priced (Hub #2047).
        this.#saveCall({...admitted, generation: record.generation, endedAtMs: admitted.startedAtMs, status: 'failed', code: 'capacity'});
        return;
      }
      // The admitted check is the conversation's newest, so an earlier answer still to settle is dropped.
      record.generation = admitted.generation;
      this.#save(conversationId, record);
      call = admitted;
      this.#saveCall(call);
    });
    if (call === undefined || prompt === undefined) return;
    const admitted: TitleCall = call;
    let reply: TitleReply | undefined, fault: unknown;
    const cancel = this.deps.after(TITLE_DEADLINE_MS, () => {controller.abort();});
    try {
      const current = titlePrompt(this.deps.messages(conversationId), previousTitle(priorTitle), events);
      if (current !== prompt) throw new ProviderFault('forbidden');
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
      // The model's own answer, bounded, so an invalid or refused outcome can be diagnosed from the private record; it
      // reaches no log, trace, diagnostic or published record (ADR 0011 allows private retention).
      saved.answer = reply.text === null ? null : within(reply.text, TITLE_ANSWER_BYTES, false);
      const record = this.record(conversationId) ?? this.#fresh();
      if (record.generation !== saved.generation) saved.outcome = 'dropped';
      else if (keeps(reply.text)) saved.outcome = 'kept';
      else {
        const title = generatedTitle(reply.text, said);
        if (title === undefined) saved.outcome = 'invalid';
        else if (record.title?.value === title) saved.outcome = 'unchanged';
        else {
          record.title = {value: title, source: 'generated'};
          this.#save(conversationId, record);
          this.#announce(add, conversationId, record, profile);
          saved.outcome = 'applied';
        }
      }
      this.#saveCall(saved);
    });
  }
  /** Stops every title call in flight and the follow-ups behind them, and waits for each to settle. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const pending = [...this.#inFlight.values()];
    for (const item of pending) {item.pending = undefined; item.controller.abort();}
    await Promise.all(pending.map(item => item.work));
    this.#closed = true;
  }
}
