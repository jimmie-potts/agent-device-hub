/** Timers may wake early. Preserve absolute deadlines without dispatching early. */
export async function waitUntil(clock, deadline, signal) {
  let previous = clock.now();
  while (previous < deadline) {
    signal?.throwIfAborted();
    await clock.wait(Math.max(1, deadline - previous), signal);
    const current = clock.now();
    if (!Number.isFinite(current) || current < previous) throw new Error('Clock invalid');
    previous = current;
  }
  signal?.throwIfAborted();
}
