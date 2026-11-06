// The real core owns mode, inbox and history; tests add fixture consumers, a publication hook and an optional bounded schedule choice.
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreModule, type CoreOptions} from '../../src/index.js';
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;
export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish' | 'artScheduleChoice'>;
export function createCoreModule({beforePublish, artScheduleChoice}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish}),
    ...(artScheduleChoice === undefined ? {} : {artScheduleChoice})});
}
