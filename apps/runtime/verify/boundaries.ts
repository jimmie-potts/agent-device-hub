// The boundary checks of a disposable runtime run (Hub #920). Not built yet.
import type {CheckOutcome} from '@jimmie-potts/app-verify';
import type {BoundaryReport} from './protocol.js';

export const INSTALLED_PORTS: readonly number[] = [8765, 8787, 8788, 8791, 41230, 41231];
const notBuilt = (report: BoundaryReport): CheckOutcome => ({outcome: 'failed', reason: `not built (${report.runtime})`});
export const checkSimulatedTransports = notBuilt;
export const checkNoOutboundConnections = notBuilt;
export const checkPrivateState = notBuilt;
