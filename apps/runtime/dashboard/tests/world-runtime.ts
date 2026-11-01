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
