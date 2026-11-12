// The real core owns mode, inbox and history; tests add fixture consumers, a publication hook, an optional bounded schedule
// choice and a test clock's monotonic clock. History keeps by the registrations' rules, as the shipped list's core does
// (#1772): every module's bookkeeping members and polled families.
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, historyRules, registrations, type CoreModule, type CoreOptions} from '../../src/index.js';
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;
export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish' | 'artScheduleChoice' | 'monotonic'>;
export function createCoreModule({beforePublish, artScheduleChoice, monotonic}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({consumers: FIXTURE_CONSUMERS, history: historyRules(registrations), ...(beforePublish === undefined ? {} : {beforePublish}),
    ...(artScheduleChoice === undefined ? {} : {artScheduleChoice}), ...(monotonic === undefined ? {} : {monotonic})});
}
