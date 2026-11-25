import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {CodingCompanion, CodingProgress, CodingResult, CodingRunEntry} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingChoice, CodingHarness} from './routing.js';

export const CODING_JOB_PAGE_SIZE = 10;
export type JobMessage = {
  requestId: string;
  operationId: string;
  status: 'queued' | 'accepted' | 'refused' | 'uncertain';
  observed: boolean;
  recordedAtMs: number;
  code?: ErrorCode;
};
export type CodingJobEntry = {
  jobId: string;
  operationId: string;
  taskId: string;
  conversationId: string;
  repository: string;
  companion?: CodingCompanion;
  status: CodingRunEntry['status'] | 'queued' | 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'ended';
  latestUpdate?: string;
  label?: string;
  steering?: 'unsupported' | 'live' | 'unavailable';
  messages?: JobMessage[];
  setup?: CodingRunEntry['setup'];
  harness?: string;
  sessionId?: string;
  worktreeRef?: string;
  branch?: string | null;
  model?: string;
};
export type CodingJobPage = {version: 1; jobs: CodingJobEntry[]; next: string | null};


export type CodingAttemptResult = Pick<CodingResult, 'outcome' | 'base' | 'head' | 'changedFiles'> & {
  usage?: CodingResult['usage'];
  limitations?: string[];
  pendingDecision?: string;
  checks: Pick<CodingResult['checks'][number], 'name' | 'status'>[];
};
export type AttemptContext = Pick<CodingJobEntry, 'worktreeRef' | 'branch' | 'model'>;
export type CodingAttemptEntry = {
  operationId: string;
  harness: CodingHarness | null;
  sessionId: string | null;
  status: 'queued' | 'dispatching' | 'started' | 'cancelling' | Exclude<CodingProgress['status'], 'started'>;
  selectionReason: string;
  context?: AttemptContext;
  result: CodingAttemptResult | null;
};
export type CodingJobDetail = {
  version: 1;
  jobId: string;
  choice: CodingChoice;
  activeOperationId: string | null;
  attempts: CodingAttemptEntry[];
  continuation: {fromOperationId: string; harness: CodingHarness; head: string; changedFiles: string[]} | null;
};
