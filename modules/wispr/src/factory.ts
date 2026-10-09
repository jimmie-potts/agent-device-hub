import type {ModuleFactory} from '@jimmie-potts/sdk';
import {createWisprModule, WISPR_MODULE} from './module.js';

/** Fresh synthetic paths are selected explicitly by the run; this default never selects personal data. */
export const WISPR_SIMULATED_SECTION = Object.freeze({sourceId: 'dictation-sim', aggregatePath: '/nonexistent/wispr-sim/aggregate.json',
  diagnosticsPath: '/nonexistent/wispr-sim/status.json', exposeToDashboard: false, shareTextAggregates: false});
export const wisprFactory: ModuleFactory = {name: WISPR_MODULE, create: () => createWisprModule(), simulate: () => createWisprModule(),
  simulatedSection: {config: WISPR_SIMULATED_SECTION}};
