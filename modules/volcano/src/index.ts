export {configureVolcano, type VolcanoConfig} from './configuration.js';
export {DEFAULT_GAP_MINUTES, MAX_GAP_MINUTES, MIN_GAP_MINUTES, STALE_MS, admit, emptyContinuity, reduce, type DiscontinuityReason, type Edge, type Fact, type FactData} from './facts.js';
export {GAP_COMPLETED_TYPE, GAP_FAMILY, GAP_SCHEMA, GAP_TYPE, STATUS_FAMILY, STATUS_SCHEMA, STATUS_TYPE, gapsSchema, registerVolcanoFamilies, sessionsSchema, statusSchema, timelineSchema, totalsSchema, volcanoSchemas} from './families.js';
export {createVolcanoModule, type GapRequest, type SyntheticFeed} from './module.js';
export {VOLCANO_SIMULATED_SECTION, registration} from './registration.js';
export type {Session, Stretch} from './sessions.js';
export {SIMULATION_ACTIONS, SimulatedVolcano, type SimulationAction} from './simulated.js';
export type {VolcanoStatus} from './status-document.js';
