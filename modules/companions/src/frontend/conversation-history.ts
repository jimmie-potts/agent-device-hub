import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import {HISTORY_ROWS, readHistoryCursor, type ConversationMessage, type CurrentTask, type Proposal, type RecentConversationPage, type SavedQuestion} from '../assistant/history-contract.js';
import {LIMITS} from '../assistant/limits.js';

type WindowRequest = {profile: AssistantProfile; before?: string};
export type HistoryWindow = {messages: readonly ConversationMessage[]; older: string | null};
/** Windows are chronological. A later window's cursor can fill the gap before it. */
export type ConversationHistory = {
  profile: AssistantProfile;
  conversationId: string | null;
  currentTask: CurrentTask | null;
  windows: readonly HistoryWindow[];
};
type Read = (path: string, signal: AbortSignal) => Promise<unknown>;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const invalidPage = (): never => {throw new Error('Invalid conversation window');};

function decodeProposal(value: unknown): Proposal | null {
  if (value === null) return null;
  if (!record(value) || !record(value.data)) return invalidPage();
  const {family, target, data, expectedRevision, owner} = value;
  if (integer(expectedRevision) && family === 'mode-set' && target === 'hub' && (data.mode === 'work' || data.mode === 'free' || data.mode === 'quiet')) {
    return {family, target, data: {mode: data.mode}, expectedRevision};
  }
  if (integer(expectedRevision) && family === 'coding-dispatch' && target === 'assistant' && typeof data.repository === 'string' && typeof data.brief === 'string') {
    return {family, target, data: {repository: data.repository, brief: data.brief}, expectedRevision};
  }
  const {expectedConfigurationRevision, expectedGeneration} = data;
  if (typeof target !== 'string' || target.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target) ||
    !integer(expectedConfigurationRevision) || !record(expectedGeneration) || typeof expectedGeneration.epoch !== 'string' ||
    !integer(expectedGeneration.sequence)) return invalidPage();
  const guards = {expectedConfigurationRevision, expectedGeneration: {epoch: expectedGeneration.epoch, sequence: expectedGeneration.sequence}};
  if (family === 'power-set' && typeof data.on === 'boolean') {
    const power = {family, target, data: {...guards, on: data.on}} as const;
    if (owner === 'bunny/modules/wemo') return {...power, owner};
    if (owner === undefined) return power;
  }
  if (owner === undefined && family === 'brightness-set' && integer(data.percent) && data.percent <= 100) return {family, target, data: {...guards, percent: data.percent}};
  return invalidPage();
}

function decodeQuestion(value: unknown): SavedQuestion | null {
  if (value === null) return null;
  if (!record(value)) return invalidPage();
  const {id, text, answer, kind, proposal} = value;
  if (typeof id !== 'string' || typeof text !== 'string' || !(answer === null || typeof answer === 'string') ||
    !(kind === 'clarification' || kind === 'approval' || kind === 'delegation')) return invalidPage();
  return {id, text, answer, kind, proposal: decodeProposal(proposal)};
}

function decodeTask(value: unknown): CurrentTask | null {
  if (value === null) return null;
  if (!record(value) || typeof value.taskId !== 'string') return invalidPage();
  return {taskId: value.taskId, question: decodeQuestion(value.question)};
}

export function decodeConversationWindow(value: unknown, {profile, before}: WindowRequest): RecentConversationPage {
  if (!record(value) || value.version !== 2 || value.profile !== profile || !Array.isArray(value.messages) ||
    value.messages.length > HISTORY_ROWS || new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMITS.pageBytes) return invalidPage();
  const {conversationId, older} = value;
  if (!(conversationId === null || typeof conversationId === 'string' && conversationId !== '') ||
    !(older === null || typeof older === 'string')) return invalidPage();
  const currentTask = decodeTask(value.currentTask);
  const anchor = before === undefined ? undefined : readHistoryCursor(before, profile);
  if (before !== undefined && (anchor === undefined || anchor.conversationId !== conversationId || currentTask !== null)) return invalidPage();
  let previous = 0;
  const messages: ConversationMessage[] = [];
  for (const message of value.messages) {
    if (!record(message)) return invalidPage();
    const {seq, id, taskId, role, text, atMs} = message;
    if (!integer(seq) || seq <= previous || (anchor !== undefined && seq >= anchor.seq) || typeof id !== 'string' || typeof taskId !== 'string' ||
      !(role === 'owner' || role === 'assistant' || role === 'tool') || typeof text !== 'string' || !integer(atMs)) return invalidPage();
    messages.push({seq, id, taskId, role, text, atMs});
    previous = seq;
  }
  if (conversationId === null && (messages.length !== 0 || older !== null || currentTask !== null)) return invalidPage();
  if (older !== null) {
    const cursor = readHistoryCursor(older, profile);
    if (cursor === undefined || cursor.conversationId !== conversationId || cursor.seq !== messages[0]?.seq) return invalidPage();
  }
  return {version: 2, profile, conversationId, currentTask, messages, older};
}

async function readWindow(read: Read, request: WindowRequest, signal: AbortSignal): Promise<RecentConversationPage> {
  signal.throwIfAborted();
  const query = new URLSearchParams({profile: request.profile, view: 'recent'});
  if (request.before !== undefined) query.set('before', request.before);
  const response = await read(`/modules/companions/content/conversation?${query.toString()}`, signal);
  signal.throwIfAborted();
  return decodeConversationWindow(response, request);
}

function mergeWindows(windows: readonly HistoryWindow[], page: RecentConversationPage, anchorIndex: number): readonly HistoryWindow[] {
  // The read proves which sequence range it covers, including any gaps in the global sequence.
  const oldest = page.older === null ? 0 : page.messages[0]?.seq ?? 0;
  let first = anchorIndex;
  while (first > 0 && (windows[first - 1]?.messages.at(-1)?.seq ?? 0) >= oldest) first -= 1;
  const covered = windows.slice(first, anchorIndex + 1);
  const messages = new Map(covered.flatMap(window => window.messages).map(message => [message.seq, message]));
  for (const message of page.messages) messages.set(message.seq, message);
  const earliest = covered[0];
  const older = page.older !== null && earliest !== undefined && (earliest.messages[0]?.seq ?? Infinity) < oldest ? earliest.older : page.older;
  return [...windows.slice(0, first), {messages: [...messages.values()].sort((a, b) => a.seq - b.seq), older}, ...windows.slice(anchorIndex + 1)];
}

/** One recent read. Abort the previous request when the selected profile or read attempt changes. */
export async function refreshConversationHistory(read: Read, profile: AssistantProfile, signal: AbortSignal, prior?: ConversationHistory): Promise<ConversationHistory> {
  const page = await readWindow(read, {profile}, signal);
  signal.throwIfAborted();
  const windows = prior?.profile === profile && prior.conversationId === page.conversationId ? prior.windows : [];
  return {profile, conversationId: page.conversationId, currentTask: page.currentTask,
    windows: mergeWindows(windows, page, windows.length)};
}

/** Fetch one earlier page for a cursor in the retained history, without changing the current task. */
export async function loadEarlierConversationHistory(read: Read, history: ConversationHistory, before: string, signal: AbortSignal): Promise<ConversationHistory> {
  const index = history.windows.findIndex(window => window.older === before);
  if (index < 0) return invalidPage();
  const page = await readWindow(read, {profile: history.profile, before}, signal);
  signal.throwIfAborted();
  if (page.conversationId !== history.conversationId) return invalidPage();
  return {...history, windows: mergeWindows(history.windows, page, index)};
}
