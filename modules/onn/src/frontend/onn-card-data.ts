import type {FrontendAction, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {OnnState} from '../contracts.js';
import type {App, Key} from '../actions.js';

export type OnnAvailability = 'available' | 'stale' | 'unavailable' | 'unknown';
export type OnnIntent = {kind: 'key'; value: Key} | {kind: 'app'; value: App} | {kind: 'text'; value: string};
export const validOnnText = (text: string): boolean => /^[A-Za-z0-9 ._-]{1,256}$/.test(text);
export const onnFamilies = ['onn-key-press', 'onn-app-open', 'onn-text'] as const;

export function onnAvailability(state: OnnState | undefined, connected: boolean, live: boolean, target?: string): OnnAvailability {
  if (!connected || !live) return 'stale';
  if (state === undefined || target !== undefined && state.id !== target) return 'unknown';
  return state.connection;
}

/** App transmission never changes the captured app, and a future time is not fresh evidence. */
export function onnAppLabel(state: OnnState | undefined, live: boolean, now: number): string {
  const app = state?.currentApp;
  if (!live || app?.status !== 'known' || now < app.observedAtMs || now - app.observedAtMs >= 15_000) return 'App unknown';
  return {youtube: 'YouTube', stremio: 'Stremio', other: 'Other app', none: 'No app observed'}[app.value];
}

/** Presentation guards supplement the existing core/module admission, never replace it. */
export function onnAction(state: OnnState | undefined, context: Pick<FrontendContext, 'module' | 'connected' | 'control' | 'operationsLive'>,
  live: boolean, locked: boolean, intent: OnnIntent, requestId: string, target?: string): FrontendAction | undefined {
  if (context.module !== 'onn' || !context.connected || !context.control || !context.operationsLive || !live || locked ||
      state === undefined || state.connection !== 'available' || target !== undefined && state.id !== target) return undefined;
  const guards = {expectedConfigurationRevision: state.configurationRevision, expectedGeneration: state.generation};
  switch (intent.kind) {
    case 'key': return state.controls.keys.includes(intent.value)
      ? {family: 'onn-key-press', target: state.id, requestId, data: {...guards, key: intent.value}} : undefined;
    case 'app': return state.controls.apps.includes(intent.value)
      ? {family: 'onn-app-open', target: state.id, requestId, data: {...guards, app: intent.value}} : undefined;
    case 'text': return validOnnText(intent.value)
      ? {family: 'onn-text', target: state.id, requestId, data: {...guards, text: intent.value}} : undefined;
  }
}

export type OnnFeedback = {label: string; detail: string; attention: boolean};
/** Only structured completed evidence can become Sent/Observed; retained text remains available verbatim. */
export function onnFeedback(command: FrontendCommand, operations: readonly OperationRecord[], target: string): OnnFeedback {
  const detail = command.text === 'No command sent from this page.' ? '' : command.text;
  if (detail === '') return {label: '', detail: '', attention: false};
  const operation = operations.find(item => item.requestId === command.requestId && item.target === target && onnFamilies.some(family => family === item.family));
  if (operation !== undefined) {
    switch (operation.status) {
      case 'sent': return {label: 'Sending…', detail, attention: false};
      case 'accepted': return {label: 'Accepted', detail, attention: false};
      case 'rejected': case 'expired': return {label: 'Not sent', detail, attention: true};
      case 'uncertain': case 'conflict': return {label: 'Result unknown', detail, attention: true};
      case 'completed':
        if (operation.result === 'succeeded' && operation.evidence === 'transmitted') return {label: 'Sent to ONN', detail, attention: false};
        if (operation.result === 'succeeded' && operation.evidence === 'observed') return {label: 'Observed', detail, attention: false};
        return {label: operation.result === 'failed' ? 'Failed' : 'Result unknown', detail, attention: true};
    }
  }
  if (detail.startsWith('Requested.') || detail.startsWith('Accepted.')) return {label: 'Pending', detail, attention: false};
  return {label: 'Check request', detail, attention: true};
}

/** A single configured identity and monotone revision remain the source of the card's status. */
export function onnRecordOrder(previous: OnnState | undefined, next: OnnState, target?: string): 'accept' | 'ignore' | 'conflict' {
  if (target !== undefined && next.id !== target || previous !== undefined && previous.id !== next.id) return 'conflict';
  if (previous === undefined) return 'accept';
  if (next.revision < previous.revision) return 'ignore';
  if (next.revision === previous.revision) return JSON.stringify(previous) === JSON.stringify(next) ? 'ignore' : 'conflict';
  return 'accept';
}
