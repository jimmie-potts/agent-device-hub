// The opt-in, host-wide refusal of a second run (Hub #944). A host runs one Acceptance run at a time, because memory
// is the limit, and only a procedure said so. A wrapper opts in by setting APP_VERIFY_SINGLE_RUN=1 for the process
// that runs `start`; the test suites never do, so they keep starting runs side by side. The core stays free of
// runtime dependencies: it asks the user manager, which already knows every live run.
//
// Two things make the refusal hold. A start refuses while a run's unit is live. And because a run has no unit until
// its build and seed steps are done, a start first takes a claim, a transient unit named `app-verify-start-claim`, so
// two starts begun together cannot both pass: the one that finds the claim held refuses.
import type {Env} from './lifecycle.js';
import * as systemd from './systemd.js';

/** The variable that opts a `start` in; any other value, or none, leaves it off. */
const SINGLE_RUN_VARIABLE = 'APP_VERIFY_SINGLE_RUN';

export const wantsSingleRun = (env: Env): boolean => env[SINGLE_RUN_VARIABLE] === '1';

/** A start that must not go ahead: another run is live, or another start is still creating one. */
export class SingleRunRefused extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

/** The refusal's `detail`: which runs are live, and how to end them. */
export function runActiveDetail(runIds: readonly string[]): string {
  const many = runIds.length > 1;
  const named = runIds.slice(0, 3).join(', ') + (runIds.length > 3 ? ` and ${runIds.length - 3} more` : '');
  return `${many ? 'runs' : 'run'} ${named} ${many ? 'are' : 'is'} still live on this host, and only one run may start at a time; `
    + `stop ${many ? 'them' : 'it'} with the stop operation of the adapter that started ${many ? 'them' : 'it'}, or wait for the lease to end, then start again`;
}

const STARTING_DETAIL = 'another start is still creating a run on this host, and only one run may start at a time; wait for it to finish, then start again';

export interface SingleRun {
  /** Give the claim back. A start calls it when it ends, whether it started a run or not. */
  release(): Promise<void>;
}

/**
 * Take the host's one-run slot for a start, or throw `SingleRunRefused`. Claim first, then read the units: with the
 * claim held no other guarded start is between its check and its unit. If the claim cannot be made, or the units
 * cannot be listed, the start goes ahead and `progress` says so.
 */
export async function holdSingleRun(progress: (line: string) => void = () => undefined): Promise<SingleRun> {
  const claim = await systemd.claimStart(process.pid);
  const live = await systemd.liveRuns();
  let held = claim === 'claimed';
  const release = async (): Promise<void> => {
    if (!held) return;
    held = false;
    await systemd.stopUnit(systemd.START_CLAIM);
  };
  if (claim === 'held') throw new SingleRunRefused(live?.length ? runActiveDetail(live) : STARTING_DETAIL);
  if (typeof claim === 'object') progress(`could not take the host's start claim (${claim.failed}); starting without it`);
  if (live === undefined) progress('could not list the host\'s run units; the one-run check was skipped');
  else if (live.length) {
    await release();
    throw new SingleRunRefused(runActiveDetail(live));
  }
  return {release};
}
