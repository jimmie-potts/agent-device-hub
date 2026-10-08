// The SDK's decisions in the runtime's log (ADR 0012, "Observability"; Hub #949). The bus and the edge report each
// decision once, through `onDiagnostic`, at the level they set; the runtime writes it as one contract record under its
// own scope, `runtime.<event>`, with the work's trace. The diagnostic carries values the SDK already checked, and the
// record holds only registered attributes: never a payload, a credential or an exception's message.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {Diagnostic, LogFields} from '@jimmie-potts/sdk';
import type {RuntimeLogger} from './log.js';

/**
 * Each 2.0 registry code's fixed meaning as the diagnostic contract's registered `bunny.reason`. `internal` has none, and
 * neither has `uncertain-result`, whose effect may have happened, which no transport failure explains; such a record
 * carries only the code. A test keeps this in step with the registry and the catalog.
 */
export const REGISTRY_REASONS: Readonly<Record<ErrorCode, string | undefined>> = {
  'invalid-request': 'invalid-input', 'invalid-message': 'invalid-input', 'too-large': 'oversize', 'unsupported-version': 'unsupported-version',
  'unknown-schema': 'invalid-input', 'unsupported-capability': 'invalid-input', 'unauthenticated': 'unauthorized', 'forbidden': 'unauthorized',
  'not-found': 'invalid-input', 'invalid-state': 'invalid-input', 'revision-conflict': 'stale', 'duplicate-conflict': 'duplicate',
  'expired': 'timeout', 'cancelled': 'cancelled', 'capacity': 'busy', 'unavailable': 'unavailable', 'uncertain-result': undefined,
  'internal': undefined,
};

/** The record's event for a diagnostic, or undefined for one the runtime never writes: a remote client's own. */
function eventOf(diagnostic: Diagnostic): string | undefined {
  switch (diagnostic.event) {
    case 'command.admitted':
    case 'command.refused':
    case 'command.cancelled':
    case 'command.replied':
    case 'command.uncertain':
    case 'sync.served':
    case 'sync.refused':
    case 'sync.restarted':
    case 'edge.connected':
    case 'edge.disconnected':
    case 'edge.refused':
    case 'edge.failed':
      return `runtime.${diagnostic.event}`;
    case 'remote.disconnected':
    case 'remote.reconnected':
    case 'remote.refused':
    case 'remote.command.uncertain':
      return undefined;
  }
}

/** A diagnostic's values as the catalog's registered attributes. A refusal's code brings its fixed reason. */
export function diagnosticFields({source, key, pattern, requestId, messageId, outcome, code, route, errorType, attempts}: Diagnostic): LogFields {
  const reason = code === undefined ? undefined : REGISTRY_REASONS[code];
  return {
    ...(source === undefined ? {} : {'bunny.participant': source}),
    ...(key === undefined ? {} : {'bunny.routing.key': key}),
    ...(pattern === undefined ? {} : {'bunny.pattern': pattern}),
    ...(requestId === undefined ? {} : {'bunny.request.id': requestId}),
    ...(messageId === undefined ? {} : {'bunny.message.id': messageId}),
    ...(outcome === undefined ? {} : {'bunny.outcome': outcome}),
    ...(code === undefined ? {} : {'bunny.code': code}),
    ...(reason === undefined ? {} : {'bunny.reason': reason}),
    ...(route === undefined ? {} : {'bunny.route': route}),
    ...(errorType === undefined ? {} : {'error.type': errorType}),
    ...(attempts === undefined ? {} : {'bunny.attempt_count': attempts}),
  };
}

/**
 * Writes each diagnostic as one record of `log`, the runtime's own scope, at the diagnostic's level. The writer counts a
 * record it drops or its sink loses, so a failing sink never reaches the bus or the edge.
 */
export function diagnosticWriter(log: RuntimeLogger): (diagnostic: Diagnostic) => void {
  return diagnostic => {
    const event = eventOf(diagnostic);
    if (event === undefined) return;
    log[diagnostic.level](event, diagnosticFields(diagnostic), diagnostic.trace);
  };
}
