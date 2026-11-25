import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {CodingCompanion, CodingRunEntry} from '@jimmie-potts/event-contracts/v2/coding';

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
