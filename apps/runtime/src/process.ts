// The runtime as a service process: arguments, the ready line, signals, escaped errors and the event-loop lag check.
import type {BunnyModule} from '@jimmie-potts/sdk';
import type {LogLevel} from './log.js';

export type ProcessOptions = {port: number; stateDir: string; lagLimitMs: number; logLevel: LogLevel};

export function parseArguments(_argv: readonly string[]): ProcessOptions {
  throw new Error('not implemented');
}

export function runProcess(_options: ProcessOptions & {modules: readonly BunnyModule[]}): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}

/** The entry point: parses `argv`, exiting with status 2 and a usage line when it is malformed, then runs the process. */
export function runMain(_argv: readonly string[], _modules: readonly BunnyModule[]): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
