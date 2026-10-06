// Stub: the kit's tests are written first (#882).
import {describe, test} from 'node:test';
import type {BunnyModule} from '../module.js';
import type {CommandDraft} from '../sdk.js';
import type {Snapshot} from '../sync.js';

export type ConformanceSpec = {
  create: () => BunnyModule;
  schemas?: Readonly<Record<string, object>>;
  serves: readonly string[];
  copies?: {families: readonly string[]; snapshot: Snapshot};
  accepted: {key: string; draft: CommandDraft<object>};
  refused: {key: string; draft: CommandDraft<object>; code: string};
  timeoutMs?: number;
};
export type ConformanceCheck = {name: string; run: () => Promise<void>};

export const CHECKS = {
  manifest: 'declares a manifest the runtime accepts',
  lifecycle: 'starts, and stops leaving nothing behind',
  serves: 'serves its families through sync',
  copies: 'copies the families it follows',
  accepts: 'accepts a command and replies',
  refuses: 'refuses a command with the shared error body',
  outbox: 'reports the outcome through its outbox, once after a restart',
} as const;

export function conformanceChecks(spec: ConformanceSpec): ConformanceCheck[] {
  const names: string[] = [CHECKS.manifest, CHECKS.lifecycle, CHECKS.serves, ...(spec.copies === undefined ? [] : [CHECKS.copies]), CHECKS.accepts, CHECKS.refuses, CHECKS.outbox];
  return names.map(name => ({name, run: () => Promise.reject(new Error('not built yet'))}));
}

export function moduleConformance(spec: ConformanceSpec): void {
  void describe(`module ${spec.create().manifest.name} conformance`, () => {
    for (const check of conformanceChecks(spec)) void test(check.name, {timeout: 60_000}, () => check.run());
  });
}
