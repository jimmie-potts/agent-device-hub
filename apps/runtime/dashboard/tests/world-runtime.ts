import type {Runtime} from '../../dist/src/index.js';

/** The ports of the installed services, which a run must never touch. */
export const INSTALLED_PORTS = [8765, 8787, 8788, 8791, 41231];
const ALLOCATION_ATTEMPTS = 10;

export class PortAllocationError extends Error {
  constructor() {
    super(`could not allocate a dashboard runtime outside installed-service ports after ${ALLOCATION_ATTEMPTS} attempts`);
  }
}

export async function startWorldRuntime<T extends Pick<Runtime, 'url' | 'stop'>>(start: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt++) {
    const runtime = await start();
    if (!INSTALLED_PORTS.includes(Number(new URL(runtime.url).port))) return runtime;
    await runtime.stop();
  }
  throw new PortAllocationError();
}

/** What a world is doing: starting its runtime, serving its journey, or stopping. */
export type WorldPhase = 'starting' | 'running' | 'closing';
/**
 * How long one world may live. Every startWorld caller has this limit. The longest journey, home-idle.browser.ts in
 * the full browser suite, keeps its world open for about nine and a half minutes, mostly in real-time idle windows that
 * more CPU does not shorten. 25 minutes leaves a wide margin above it and still ends the run before a hosted job's
 * 40-minute limit.
 */
export const WORLD_LIMIT_MS = 25 * 60_000;
type DeadlineTimer = {after: (run: () => void, ms: number) => unknown; cancel: (timer: unknown) => void};
const realTimer: DeadlineTimer = {
  // The timer never keeps the process alive: a run with nothing else left to do ends as it would without it.
  after: (run, ms) => setTimeout(run, ms).unref(),
  cancel: timer => {clearTimeout(timer as ReturnType<typeof setTimeout>);},
};
const failRun = (message: string): void => {process.stderr.write(`${message}\n`); process.exit(1);};

/**
 * Ends the run when a world is not closed within its limit, naming the journey and what the world was doing. A wait
 * with no deadline of its own, in a journey or in the world's start or stop, otherwise holds the run silently until
 * the job's own limit cancels it (#1919: a hosted smoke run waited 37 minutes).
 */
export function worldDeadline(journey: string | (() => string), {limitMs = WORLD_LIMIT_MS, timer = realTimer, fail = failRun}: {limitMs?: number; timer?: DeadlineTimer; fail?: (message: string) => void} = {}):
  {phase: (phase: WorldPhase) => void; clear: () => void} {
  let phase: WorldPhase = 'starting';
  const handle = timer.after(() => {fail(`The world for ${typeof journey === 'string' ? journey : journey()} was not closed within ${String(limitMs / 60_000)} minutes; it was ${phase}.`);}, limitMs);
  return {phase: next => {phase = next;}, clear: () => {timer.cancel(handle);}};
}
