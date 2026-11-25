import type {CodingCompanion, CodingRunEntry} from '@jimmie-potts/event-contracts/v2/coding';

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
