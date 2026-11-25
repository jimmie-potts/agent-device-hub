import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {CodingCompanion, CodingNativeClient, CodingProgress, CodingResult, CodingRunEntry} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingChoice, CodingHarness} from './routing.js';

export const CODING_JOB_PAGE_SIZE = 10;
/** A full job reference stays local even when the rest of the request needs clarification. */
export function statusQuestion(text: string): string | null | undefined {
  const match = /\b[\w:-]+-step-\d+-job\b/u.exec(text);
  if (match === null) return /^(?:what(?: is|'s) (?:the )?(?:current )?status of|(?:show|check) (?:the )?status of) (?:my |the )?coding jobs?\b/iu.test(text.trim()) ? null : undefined;
  const question = text.trim().replace(match[0], '<job>').replace(/[?!.]?\s*read status only[.!]?$/iu, '').trim();
  return /^(?:(?:what(?: is|'s)|(?:please )?(?:show|check|read)(?: me)?) (?:the )?(?:current )?(?:status|state|progress) (?:of|for) (?:the )?(?:coding )?(?:job )?<job>|is (?:the )?(?:coding )?job <job> (?:running|finished|done))[.!?]?$/iu.test(question) ? match[0] : null;
}

export type JobMessage = {
  requestId: string;
  operationId: string;
  status: 'queued' | 'accepted' | 'refused' | 'uncertain';
  observed: boolean;
  recordedAtMs: number;
  code?: ErrorCode;
};
export type JobNativeClient = {
  clients: CodingNativeClient['clients'];
  state: CodingNativeClient['state'] | 'opening' | 'offline';
  observedAtMs: number;
  refusal?: ErrorCode;
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
  nativeClient?: JobNativeClient;
};
export type CodingJobPage = {version: 1; jobs: CodingJobEntry[]; next: string | null};


export type CodingAttemptResult = Pick<CodingResult, 'outcome' | 'base' | 'head' | 'changedFiles'> & {
  usage?: CodingResult['usage'];
  limitations?: string[];
  pendingDecision?: string;
  checks: Pick<CodingResult['checks'][number], 'name' | 'status'>[];
};
export type NativeObservation = Pick<CodingNativeClient, 'clients' | 'state' | 'observedAtMs'>;
export type AttemptContext = Pick<CodingJobEntry, 'worktreeRef' | 'branch' | 'model'> & {nativeObservation?: NativeObservation};
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
  continuationReason?: string;
  continuation: {fromOperationId: string; harness: CodingHarness; head: string; changedFiles: string[]} | null;
};
