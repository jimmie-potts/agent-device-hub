import type {CodingBounds, CodingHarnessCapabilities, CodingHarnessId, CodingLimit, CodingLimitWindow, CodingProgressReason, CodingResult} from '@jimmie-potts/event-contracts/v2/coding';
import type {HarnessReadiness} from './claude-stream.js';

function resultSchema(detail: 'optional' | 'nullable') {
  const nullable = detail === 'nullable';
  return {type: 'object', additionalProperties: false, required: ['outcome', 'summary', 'checks', 'findings', 'limitations'], properties: {
    outcome: {type: 'string', enum: ['tested-candidate', 'incomplete', 'failed', 'waiting-for-owner']},
    summary: {type: 'string', description: 'What changed and what was verified, in a few sentences.'},
    checks: {type: 'array', items: {
      type: 'object', additionalProperties: false, required: nullable ? ['name', 'status', 'detail'] : ['name', 'status'],
      properties: {name: {type: 'string'}, status: {type: 'string', enum: ['passed', 'failed', 'skipped', 'unrun', 'unknown']},
        detail: {type: nullable ? ['string', 'null'] : 'string'}},
    }},
    findings: {type: 'array', items: {type: 'string'}, description: 'Unresolved problems, questions for the owner, or refused actions. With waiting-for-owner, the question first.'},
    limitations: {type: 'array', items: {type: 'string'}},
  }};
}
export const CLAUDE_RESULT_SCHEMA = resultSchema('optional');
// Codex sends a strict Structured Outputs schema. A missing detail is represented by null on its wire.
export const CODEX_RESULT_SCHEMA = resultSchema('nullable');

export type AdapterHealth = HarnessReadiness & {windows?: CodingLimitWindow[]};
export type AdapterEvidence = {
  structured?: unknown;
  sessionId?: string;
  usage?: CodingResult['usage'];
  windows?: CodingLimitWindow[];
  limit?: CodingLimit;
  reason?: CodingProgressReason;
  uncertain?: boolean;
  writerStopped?: true;
  summary?: string;
  limitations?: string[];
};

export type AdapterSteer = (messageId: string, text: string) => Promise<'accepted' | 'unsupported' | 'unavailable' | 'uncertain'>;

export type AdapterRun = {
  worktree: string;
  brief: string;
  bounds: CodingBounds;
  signal: AbortSignal;
  session: (id: string) => void | Promise<void>;
  steering?: (steer: AdapterSteer | undefined) => void;
  observedMessage?: (messageId: string) => void;
  reportedModel?: (model: string) => void;
};

export type CodingAdapter = {
  id: CodingHarnessId;
  capabilities: CodingHarnessCapabilities;
  readiness(): Promise<AdapterHealth>;
  run(input: AdapterRun): Promise<AdapterEvidence>;
};

export function nativeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : undefined;
}

export function reportedModel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ? value : undefined;
}
