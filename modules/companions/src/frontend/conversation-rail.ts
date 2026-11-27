import type {AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingPreference, SavedQuestion} from '../assistant/history-contract.js';
import {PROFILES, spokenAloud} from '../knowledge/model.js';

/** The chat profiles, in the order the rail lists them. Each uses the configured model (Hub #2026), so none is labelled a demo. */
export const profiles = {
  bunny: {name: 'B.U.N.N.Y.'},
  reachy: {name: 'Reachy'},
  microduck: {name: 'MicroDuck'},
} satisfies Record<AssistantProfile, {name: string}>;

/**
 * The note a profile's saved replies carry in place of Read aloud when its persona's audio is not speech, read from the
 * persona as the engine's speech rule is (Hub #2026): MicroDuck's English text is its intended meaning. Undefined for a
 * profile whose replies may be spoken.
 */
export function unspokenNote(profile: AssistantProfile): string | undefined {
  if (spokenAloud(profile)) return undefined;
  const persona = PROFILES.find(value => value.id === profile);
  return `Intended meaning. ${persona?.name ?? profiles[profile].name}'s audio is ${persona?.audio === 'quacks-only' ? 'quacks only' : 'not speech'}, so this text is never read aloud.`;
}

/** A saved question whose kind has been read: the task and question it belongs to, and whether it asks the owner or waits on the coding worker. */
export type KnownQuestion = {taskId: string; questionId: string; kind: SavedQuestion['kind']};
/** A profile's task that waits on a question nobody has answered. */
export type PendingQuestion = {profile: AssistantProfile; taskId: string; questionId: string};

/**
 * What the rail's conversation group and the Conversation page share (Hub #1890). It lives in the page's memory only:
 * nothing here is saved, sent or read from the runtime. `profile` is the conversation the page shows, or will show
 * when it is opened. `open` says whether the page is mounted. `questions` holds the kind of each profile's latest
 * question that either of them has read. `waiting` lists the profiles the rail found to need the owner.
 */
export type ConversationRailState = {
  readonly profile: AssistantProfile;
  readonly open: boolean;
  readonly questions: Readonly<Partial<Record<AssistantProfile, KnownQuestion>>>;
  readonly waiting: readonly AssistantProfile[];
};

const NONE: readonly AssistantProfile[] = [];
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

export class ConversationRailStore {
  readonly #listeners = new Set<() => void>();
  #codingDraft: {profile: AssistantProfile; preference: CodingPreference} | undefined;
  #opening: {profile: AssistantProfile; conversationId: string} | undefined;
  #state: ConversationRailState = {profile: 'bunny', open: false, questions: {}, waiting: NONE};
  readonly getSnapshot = (): ConversationRailState => this.#state;
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};
  /** Chooses the conversation the page shows. It sends nothing; the page reads the profile's history when it shows it. */
  select(profile: AssistantProfile): void {
    if (profile !== this.#state.profile) this.#set({...this.#state, profile});
  }
  openConversation(profile: AssistantProfile, conversationId: string): void {
    this.#opening = {profile, conversationId};
    this.select(profile);
  }
  openCodingDraft(profile: AssistantProfile, preference: CodingPreference): void {
    this.#codingDraft = {profile, preference};
    this.select(profile);
  }
  takeCodingDraft(profile: AssistantProfile): CodingPreference | undefined {
    if (this.#codingDraft?.profile !== profile) return undefined;
    const {preference} = this.#codingDraft;
    this.#codingDraft = undefined;
    return preference;
  }
  takeOpening(profile: AssistantProfile): string | undefined {
    const opening = this.#opening;
    this.#opening = undefined;
    return opening?.profile === profile ? opening.conversationId : undefined;
  }
  /** The Conversation page says when it is mounted, so the rail can mark the open conversation without knowing any address. */
  setOpen(open: boolean): void {
    if (open !== this.#state.open) this.#set({...this.#state, open});
  }
  /** Records the kind of a profile's question once its saved history has been read. A newer question replaces the older one. */
  learn(profile: AssistantProfile, question: KnownQuestion): void {
    const known = this.#state.questions[profile];
    if (known?.taskId === question.taskId && known.questionId === question.questionId && known.kind === question.kind) return;
    this.#set({...this.#state, questions: {...this.#state.questions, [profile]: question}});
  }
  /** The rail reports which conversations need the owner, for the phone menu button. */
  setWaiting(waiting: readonly AssistantProfile[]): void {
    if (!sameList(waiting, this.#state.waiting)) this.#set({...this.#state, waiting: waiting.length === 0 ? NONE : [...waiting]});
  }
  #set(next: ConversationRailState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

/** The one store of this browser page. The rail group and the Conversation page are separate mounts of the same bundle. */
export const conversationRail = new ConversationRailStore();

/**
 * Each profile's task that waits, or is paused, on a question with no answer: the same test the Conversation page
 * uses before it offers an answer box or an approval. A state copy that is missing or not live has none, so nothing
 * is claimed from a stale copy.
 */
export function pendingQuestions(state: AssistantState | undefined, live: boolean): readonly PendingQuestion[] {
  if (state === undefined || !live) return [];
  return (Object.keys(profiles) as AssistantProfile[]).flatMap(profile => {
    const task = state.tasks.find(value => value.profile === profile);
    return task !== undefined && task.questionId !== null && !task.hasAnswer && (task.status === 'waiting' || task.status === 'paused')
      ? [{profile, taskId: task.taskId, questionId: task.questionId}] : [];
  });
}

/** The kind of a pending question, when the question that was read is that same question. */
export const knownKind = (pending: PendingQuestion, questions: ConversationRailState['questions']): SavedQuestion['kind'] | undefined => {
  const known = questions[pending.profile];
  return known?.taskId === pending.taskId && known.questionId === pending.questionId ? known.kind : undefined;
};

/**
 * The profiles that need the owner: a pending clarification or approval. A wait on the coding worker needs nothing
 * from the owner, and a question whose kind has not been read is not claimed either way.
 */
export function waitingProfiles(pending: readonly PendingQuestion[], questions: ConversationRailState['questions']): readonly AssistantProfile[] {
  return pending.filter(question => {
    const kind = knownKind(question, questions);
    return kind === 'clarification' || kind === 'approval';
  }).map(question => question.profile);
}

/** Whether a conversation other than the one the page shows needs the owner. */
export const waitingElsewhere = (state: ConversationRailState): boolean => state.waiting.some(profile => !(state.open && profile === state.profile));

/**
 * The pending question whose kind the rail should read, if any: one that nobody has read and that the open
 * Conversation page is not reading itself. The open page reads its own profile's history and shares what it finds.
 */
export function questionToRead(pending: readonly PendingQuestion[], state: ConversationRailState): PendingQuestion | undefined {
  return pending.find(question => knownKind(question, state.questions) === undefined && !(state.open && state.profile === question.profile));
}
