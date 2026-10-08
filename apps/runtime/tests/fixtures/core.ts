// The real core owns mode, inbox and history; tests add only fixture consumers and a publication hook.
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreModule, type CoreOptions} from '../../src/index.js';
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;
export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish'>;
export function createCoreModule({beforePublish}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish})});
}
