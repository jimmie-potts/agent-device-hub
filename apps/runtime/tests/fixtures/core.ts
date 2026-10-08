// Real core inbox/history with a fixed mode stand-in until #924. No copied history or inbox store.
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreModule, type CoreOptions, type CorePart} from '../../src/index.js';
import {modeState} from './lamp.js';
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;
export function standInParts(mode: Mode = 'work'): CorePart {
  const draft = modeState(mode), record = {...draft, data: {...draft.data, revision: 0}};
  return {families: ['mode'], start: async core => { await core.sdk.respond('bunny.cmd.mode-set.hub', () => ({status: 'accepted'})); }, states: families => families.includes('mode') ? [record] : []};
}
export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish'> & {mode?: Mode};
export function createCoreModule({mode = 'work', beforePublish}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({parts: [standInParts(mode)], consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish})});
}
