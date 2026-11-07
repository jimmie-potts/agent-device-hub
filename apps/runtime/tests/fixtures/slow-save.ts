// Preloaded with `node --import` into the runtime's real entry point by log.test.ts (Hub #1494). The first write of the
// core store's state block keeps the event loop busy past `SAVE_COST.saveMs`, as one save on a loaded host can, so the
// store records `storage.cost.high` (Hub #976) between the runtime's lifecycle records. Nothing else changes.
import {StatementSync, type StatementResultingChanges} from 'node:sqlite';
import {SAVE_COST} from '../../src/core/store.js';

type Run = (this: StatementSync, ...parameters: unknown[]) => StatementResultingChanges;
const run = Object.getOwnPropertyDescriptor(StatementSync.prototype, 'run')?.value as Run;
let slowed = false;
StatementSync.prototype.run = function (this: StatementSync, ...parameters: unknown[]): StatementResultingChanges {
  if (!slowed && this.sourceSQL.startsWith('INSERT INTO state VALUES')) {
    slowed = true;
    const until = performance.now() + SAVE_COST.saveMs + 50;
    while (performance.now() < until) { /* busy, as a loaded host is */ }
  }
  return run.apply(this, parameters);
};
