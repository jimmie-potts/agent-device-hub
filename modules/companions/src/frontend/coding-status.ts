// The coding worker as the Conversation page shows it (Hub #2028): the worker's slots, this companion's slot, whether a
// task's approved hand-off waits for a busy slot, and the shared plan usage windows its readiness reported. Pure
// functions of the synced `coding-state`, so the page never guesses beyond what the module published.
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingReadiness, CodingState} from '@jimmie-potts/event-contracts/v2/coding';

const NAMES: Readonly<Record<AssistantProfile, string>> = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'};
export const companionName = (profile: AssistantProfile): string => NAMES[profile];
/** Whether the worker holds one slot per companion; an older worker that declares none holds one run for every companion. */
const perCompanion = (coding: CodingState): boolean => (coding.slots ?? 1) >= 3;
const runsOf = (coding: CodingState) => coding.runs ?? (coding.active === null ? [] : [{...coding.active, companion: undefined}]);

/** The worker in one line: connected and how many of its slots are busy, with any hand-offs waiting. */
export function workerAvailability(coding: CodingState | undefined): string {
  switch (coding?.availability) {
    case 'available': {
      const runs = runsOf(coding).length, waiting = coding.waiting?.length ?? 0, slots = coding.slots ?? 1;
      const busy = runs === 0 ? 'connected and idle' : `connected, ${String(runs)} of ${String(slots)} slot${slots === 1 ? '' : 's'} busy`;
      return `${busy[0]?.toUpperCase() ?? ''}${busy.slice(1)}${waiting === 0 ? '' : `; ${String(waiting)} hand-off${waiting === 1 ? '' : 's'} waiting`}`;
    }
    case 'unavailable': return 'Lost. Start it again on your computer.';
    case 'off': return 'Not connected';
    case undefined: return 'Unknown';
  }
}
/** This companion's slot: idle, running a task, or shared with every companion on an older worker. */
export function slotStatus(coding: CodingState | undefined, profile: AssistantProfile): string {
  if (coding === undefined || coding.availability !== 'available') return 'No worker connected';
  const own = perCompanion(coding), runs = runsOf(coding);
  const run = own ? runs.find(entry => entry.companion === profile) : runs[0];
  const waiting = (coding.waiting ?? []).filter(entry => !own || entry.companion === profile).length;
  const head = run === undefined ? 'Idle' : `Running task ${run.taskId.slice(0, 8)} (${run.status})`;
  return `${head}${own ? '' : ', one slot shared by every companion'}${waiting === 0 ? '' : `; ${String(waiting)} waiting`}`;
}
/** Whether an approved hand-off from this companion would wait now: its slot runs a task or already has a line. */
export function slotBusy(coding: CodingState | undefined, profile: AssistantProfile): boolean {
  if (coding === undefined || coding.availability !== 'available') return false;
  const own = perCompanion(coding);
  return runsOf(coding).some(run => !own || run.companion === profile) || (coding.waiting ?? []).some(entry => !own || entry.companion === profile);
}
/** Whether this task's approved hand-off is waiting for its companion's slot, never sent yet. */
export const handOffWaiting = (coding: CodingState | undefined, taskId: string | undefined): boolean =>
  taskId !== undefined && (coding?.waiting ?? []).some(entry => entry.taskId === taskId);
/**
 * The shared plan usage windows the worker's readiness reported after its latest run, one line each, or why there are
 * none: no worker, a tool that reported none yet, or none at all. `at` formats an instant for the reader.
 */
export function planUsage(readiness: CodingReadiness | null | undefined, at: (ms: number) => string): string[] {
  if (readiness === null || readiness === undefined) return ['Unknown: the worker reported no readiness'];
  if (readiness.limits === null) return ['Not reported yet: the tool reports usage windows during a run'];
  if (readiness.limits.length === 0) return ['None reported'];
  const lines = readiness.limits.map(limit => `${limit.window}: ${limit.utilization === null ? 'use unknown' : `${String(Math.round(limit.utilization))}% used`}`
    + `${limit.status === 'allowed' ? '' : ` (${limit.status === 'allowed-warning' ? 'warning' : limit.status})`}, resets ${limit.resetsAtMs === null ? 'at an unknown time' : at(limit.resetsAtMs)}`);
  return readiness.limitsObservedAtMs === null ? lines : [...lines, `as of ${at(readiness.limitsObservedAtMs)}`];
}
