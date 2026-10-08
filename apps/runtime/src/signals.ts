// What the runtime's offline tools share for SIGINT and SIGTERM (Hub #933, #931, #1003): the migration tools' entry
// points pass this signal to the tool, so an interrupted migration removes what it wrote.

/**
 * A signal that aborts on the process's first SIGINT or SIGTERM. Both listeners go with the first signal, so a second
 * one stops the process at once. Until then they stay, so a signal that arrives after the tool has written its line
 * aborts nothing that still runs, and the process exits with the code the line reports.
 */
export function abortOnSignals(target: Pick<NodeJS.EventEmitter, 'once' | 'removeListener'> = process): AbortSignal {
  const controller = new AbortController();
  const names = ['SIGINT', 'SIGTERM'] as const;
  const stop = (): void => {
    for (const name of names) target.removeListener(name, stop);
    controller.abort();
  };
  for (const name of names) target.once(name, stop);
  return controller.signal;
}
