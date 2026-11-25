import type {CodingCompanion, CodingProgress, CodingResult, CodingRunEntry} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingChoice, CodingHarness} from './routing.js';

export const CODING_JOB_PAGE_SIZE = 10;
export type CodingJobEntry = {
  jobId: string;
  operationId: string;
  taskId: string;
  conversationId: string;
  repository: string;
  companion?: CodingCompanion;
  status: CodingRunEntry['status'] | 'queued';
  setup?: CodingRunEntry['setup'];
  harness?: string;
  sessionId?: string;
};
export type CodingJobPage = {version: 1; jobs: CodingJobEntry[]; next: string | null};


export type CodingAttemptResult = Pick<CodingResult, 'outcome' | 'base' | 'head' | 'changedFiles'> & {
  checks: Pick<CodingResult['checks'][number], 'name' | 'status'>[];
};
export type CodingAttemptEntry = {
  operationId: string;
  harness: CodingHarness | null;
  sessionId: string | null;
  status: 'queued' | 'dispatching' | 'started' | 'cancelling' | Exclude<CodingProgress['status'], 'started'>;
  selectionReason: string;
  result: CodingAttemptResult | null;
};
export type CodingJobDetail = {
  version: 1;
  jobId: string;
  choice: CodingChoice;
  activeOperationId: string | null;
  attempts: CodingAttemptEntry[];
  continuationReason?: string;
  continuation: {fromOperationId: string; harness: CodingHarness; head: string; changedFiles: string[]} | null;
};
