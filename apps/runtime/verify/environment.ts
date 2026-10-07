// How a verification run's runtime loads its network guard (Hub #920): through NODE_OPTIONS, so the guard runs first in
// the runtime's main thread, in each of its worker threads and in every Node process it starts, all of which inherit the
// variable. Each refusal is appended to the run's report file, which the supervisor reads.
/** The guard module, as the file URL `--import` takes. */
export const GUARD = new URL('./guard.js', import.meta.url).href;

/**
 * The environment that loads the guard and names its report file. It replaces any NODE_OPTIONS the caller had, so the
 * runtime loads nothing else first.
 */
export function guardEnvironment(reportFile: string): {NODE_OPTIONS: string; BUNNY_GUARD_REPORT: string} {
  return {NODE_OPTIONS: `--import ${GUARD}`, BUNNY_GUARD_REPORT: reportFile};
}
