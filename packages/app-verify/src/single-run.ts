// The opt-in, host-wide refusal of a second run (Hub #944). A host runs one Acceptance run at a time, because memory
// is the limit, and only a procedure said so. A wrapper opts in by setting APP_VERIFY_SINGLE_RUN=1 for the process
// that runs `start`; the test suites never do, so they keep starting runs side by side. The core stays free of
// runtime dependencies: the check is one `systemctl --user list-units`.
import type {Env} from './lifecycle.js';

/** The variable that opts a `start` in; any other value, or none, leaves it off. */
const SINGLE_RUN_VARIABLE = 'APP_VERIFY_SINGLE_RUN';

export const wantsSingleRun = (env: Env): boolean => env[SINGLE_RUN_VARIABLE] === '1';

/** The refusal's `detail`: which runs are live, and how to end them. */
export function runActiveDetail(runIds: readonly string[]): string {
  const many = runIds.length > 1;
  const named = runIds.slice(0, 3).join(', ') + (runIds.length > 3 ? ` and ${runIds.length - 3} more` : '');
  return `${many ? 'runs' : 'run'} ${named} ${many ? 'are' : 'is'} still live on this host, and only one run may start at a time; `
    + `stop ${many ? 'them' : 'it'} with the stop operation of the adapter that started ${many ? 'them' : 'it'}, or wait for the lease to end, then start again`;
}
