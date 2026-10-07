// The module test kit (Hub #882): `@jimmie-potts/sdk/testing`. Module tests import it; the runtime never does.
export {ModuleHarness, type HarnessOptions, type HarnessRecord, type HarnessSent} from './harness.js';
export {CHECKS, conformanceChecks, moduleConformance, type ConformanceCheck, type ConformanceSpec} from './kit.js';
export {checkModuleRecord} from './records.js';
export {RecordedSpans, lostParents, type RecordedSpan} from './spans.js';
export {
  STAND_IN_ACK_SCHEMA, followStandInAcks, standInAck, standInAckKey, standInAckSchemas, type StandInAck,
} from './acknowledge.js';
