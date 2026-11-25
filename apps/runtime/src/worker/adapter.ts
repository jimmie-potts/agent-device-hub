import type {CodingBounds, CodingHarnessCapabilities, CodingHarnessId, CodingLimit, CodingLimitWindow, CodingProgressReason, CodingResult} from '@jimmie-potts/event-contracts/v2/coding';
import type {HarnessReadiness} from './claude-stream.js';

export type AdapterHealth = HarnessReadiness & {windows?: CodingLimitWindow[]};
export type AdapterEvidence = {
  structured?: unknown;
  sessionId?: string;
  usage?: CodingResult['usage'];
  windows?: CodingLimitWindow[];
  limit?: CodingLimit;
  reason?: CodingProgressReason;
  uncertain?: boolean;
  summary?: string;
  limitations?: string[];
};

export type AdapterRun = {
  worktree: string;
  brief: string;
  bounds: CodingBounds;
  outputSchema: object;
  signal: AbortSignal;
  session: (id: string) => void | Promise<void>;
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
