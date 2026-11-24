// The Conversation page's read of the current conversation's message queue (Hub #2030), from the module's private
// conversation route, once per assistant-state revision, so it follows every queue change without polling.
import {useEffect, useState} from 'react';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {QueueDocument, QueueHold} from '../assistant/queue-contract.js';
import {LIMITS} from '../assistant/limits.js';

export type QueueView = Omit<QueueDocument, 'version'>;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const instant = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const REASONS: readonly QueueHold['reason'][] = ['stop', 'restart', 'refused'];
const ID = /^[A-Za-z0-9_.-]{1,128}$/u;

function holdOf(value: unknown): QueueHold | null | undefined {
  if (value === null) return null;
  if (!object(value) || !REASONS.includes(value.reason as QueueHold['reason']) || !(value.code === null || typeof value.code === 'string') ||
    !(value.detail === null || (typeof value.detail === 'string' && value.detail.length <= 1024))) return undefined;
  return {reason: value.reason as QueueHold['reason'], code: value.code as QueueHold['code'], detail: value.detail};
}
/** The route's answer for the profile, or undefined for anything else, which the page shows as unknown. */
export function decodeQueue(value: unknown, profile: AssistantProfile): QueueView | undefined {
  if (!object(value) || value.version !== 1 || value.profile !== profile || !Array.isArray(value.messages) || value.messages.length > LIMITS.queuedMessages) return undefined;
  const {conversationId} = value, held = holdOf(value.held);
  if (!(conversationId === null || (typeof conversationId === 'string' && ID.test(conversationId))) || held === undefined) return undefined;
  const messages: QueueView['messages'] = [];
  for (const entry of value.messages) {
    if (!object(entry) || typeof entry.id !== 'string' || !ID.test(entry.id) || typeof entry.text !== 'string' || entry.text.trim() === '' ||
      !instant(entry.queuedAtMs) || !instant(entry.updatedAtMs)) return undefined;
    messages.push({id: entry.id, text: entry.text, queuedAtMs: entry.queuedAtMs, updatedAtMs: entry.updatedAtMs});
  }
  if (new Set(messages.map(entry => entry.id)).size !== messages.length || (held !== null && messages.length === 0)) return undefined;
  return {profile, conversationId, held, messages};
}
/** What the hold tells the owner, and the control that releases it: Start after a restart, Resume queue otherwise. */
export function holdText(hold: QueueHold): {text: string; action: 'Start' | 'Resume queue'} {
  if (hold.reason === 'restart') return {text: 'The queue is held because B.U.N.N.Y. restarted. Nothing in it starts until you start it.', action: 'Start'};
  if (hold.reason === 'stop') return {text: 'The queue is held because you stopped the task. Nothing in it starts until you resume it.', action: 'Resume queue'};
  return {text: `The queue is held because its next message could not start${hold.detail === null ? hold.code === null ? '.' : ` (${hold.code}).` : `: ${hold.detail}`}`, action: 'Resume queue'};
}
/** Reads the profile's queue once per assistant-state revision while the page is connected; a failed read shows unknown. */
export function useQueue(api: FrontendContext['api'], ready: boolean, profile: AssistantProfile, revision: number | undefined): QueueView | undefined {
  const [queue, setQueue] = useState<QueueView>();
  useEffect(() => {
    if (!ready) {setQueue(undefined); return;}
    let active = true;
    void api.read(`/modules/companions/content/conversation?${new URLSearchParams({profile, view: 'queue'}).toString()}`)
      .then(value => {if (active) setQueue(decodeQueue(value, profile));}, () => {if (active) setQueue(undefined);});
    return () => {active = false;};
  }, [api, ready, profile, revision]);
  return queue?.profile === profile ? queue : undefined;
}
