// Hosted steps opt in. Attach only reviewed fields to the actual error, so a caught failure cannot describe a later one.
import {writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {browserFields} from '../../../../scripts/ci-selection/failure-fields.mts';

type Details = Parameters<typeof browserFields>[0];
const destination = process.env.BUNNY_CI_BROWSER_RECORD;
const diagnosed = new WeakMap<Error, Details>();

export function withFailureContext(error: unknown, fields: Details): void {
  if (destination !== undefined && error instanceof Error) {
    diagnosed.set(error, {...fields, ...diagnosed.get(error)});
  }
}

/** Nested smoke entries execute in one process. Attribute an error to the innermost entry, keeping its original stack. */
export async function browserEntry(name: string, run: Promise<unknown>): Promise<void> {
  try {await run;}
  catch (error) {withFailureContext(error, {journey: name}); throw error;}
}

if (destination !== undefined) {
  process.on('uncaughtExceptionMonitor', (error: Error) => {
    try {
      const details: Details = {journey: basename(process.argv[1] ?? '')};
      // The runner retains the original failure as its cause, including when teardown also fails.
      const seen = new Set<Error>();
      let current: unknown = error;
      while (current instanceof Error && !seen.has(current) && seen.size < 12) {
        seen.add(current);
        Object.assign(details, diagnosed.get(current));
        current = current instanceof AggregateError ? current.errors[0] : current.cause;
      }
      writeFileSync(destination, JSON.stringify(browserFields(details)), {mode: 0o600, flag: 'wx'});
    } catch { /* A reporting failure must leave the original exception and exit status intact. */ }
  });
}
