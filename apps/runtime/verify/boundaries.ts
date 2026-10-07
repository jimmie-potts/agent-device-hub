// The boundary checks of a disposable runtime run (Hub #920), judged from the supervisor's report: the runtime built its
// modules with simulated transports, made no outbound connection, and kept its state in the run's own directory. Each
// one has a negative control: a run scenario that crosses the boundary, so its start fails the check.
import type {CheckOutcome} from '@jimmie-potts/app-verify';
import type {BoundaryReport} from './protocol.js';

/** The installed Hub's, local controllers' and their services' ports, which a run must never reach. */
export const INSTALLED_PORTS: readonly number[] = [8765, 8787, 8788, 8791, 41230, 41231];
const passed: CheckOutcome = {outcome: 'passed'};
const failed = (reason: string): CheckOutcome => ({outcome: 'failed', reason});

/** The runtime built every module with its simulated transport (`--simulate`), as its `runtime.started` record says. */
export function checkSimulatedTransports(report: BoundaryReport): CheckOutcome {
  if (report.simulate === true) return passed;
  return failed(report.simulate === false ? 'the runtime ran without --simulate, so its modules would reach real devices' : 'the runtime never said how it built its modules');
}

/** The runtime opened no outbound connection; the guard refused any it tried, before it connected. */
export function checkNoOutboundConnections(report: BoundaryReport): CheckOutcome {
  if (report.outbound.length === 0) return passed;
  const targets = report.outbound.map(({host, port}) => `${host}:${port}`).join(', ');  // red stub
  const installed = report.outbound.some(({port}) => INSTALLED_PORTS.includes(port));
  return failed(`the runtime tried to connect to ${targets}, and the guard refused it${installed ? '; an installed service\'s port was targeted' : ''}`);
}

/** The runtime's state is the run's own directory, its home is private to the run, and the grants are owner-only. */
export function checkPrivateState(report: BoundaryReport): CheckOutcome {
  if (!report.home.startsWith(`${report.dataDir}/`)) return failed('the runtime\'s home is not private to the run');
  if (report.grantsMode !== 0o600) return failed('the run\'s grants file is not owner-only');
  return passed;
}
