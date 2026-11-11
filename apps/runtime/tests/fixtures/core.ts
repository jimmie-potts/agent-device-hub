// The real core owns mode, inbox and history; tests add fixture consumers, a publication hook, an optional bounded schedule
// choice and a test clock's monotonic clock.
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreModule, type CoreOptions} from '../../src/index.js';
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;
export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish' | 'artScheduleChoice' | 'monotonic'>;
export function createCoreModule({beforePublish, artScheduleChoice, monotonic}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish}),
    ...(artScheduleChoice === undefined ? {} : {artScheduleChoice}), ...(monotonic === undefined ? {} : {monotonic})});
}
