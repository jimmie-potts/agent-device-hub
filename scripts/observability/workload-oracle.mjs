const ticketKey = ticket => typeof ticket?.epoch === 'string' && ticket.epoch.length <= 128 &&
  Number.isSafeInteger(ticket.sequence) && ticket.sequence >= 0 ? JSON.stringify([ticket.epoch,ticket.sequence]) : null;

/** Reconcile the driver's responses with the fake's independent execution
 * history. This is the successful brightness workload, not fault classification. */
export function reconcileWorkload({ events, closed }) {
  if (!Array.isArray(events) || events.length > 4000 || !Array.isArray(closed?.executions) ||
    closed.executions.length > 2000) throw new Error('Workload evidence invalid');
  const dispatches = new Map(), completions = new Map(), expected = new Map(), observed = new Map();
  let invalid = 0, omitted = 0, unexpectedExecutions = 0, duplicateExecutions = 0, missingExecutions = 0;
  for (const event of events) {
    if (event.kind === 'omitted') { omitted++; continue; }
    if (!['dispatch','completion'].includes(event.kind) || !Number.isInteger(event.ordinal) || event.ordinal < 0 ||
      event.ordinal >= 1800 || !Number.isInteger(event.slot) || event.slot < 0 || event.slot >= 1800) { invalid++; continue; }
    const target = event.kind === 'dispatch' ? dispatches : completions;
    if (target.has(event.ordinal)) invalid++;
    else target.set(event.ordinal,event);
  }
  const outcomes = [];
  for (const [ordinal, dispatched] of dispatches) {
    const completion = completions.get(ordinal), outcome = completion?.outcome;
    const key = ticketKey(outcome?.requestId);
    if (completion?.slot !== dispatched.slot || completion.failed !== false || outcome?.status !== 202 ||
      outcome.validReceipt !== true || outcome.receipt?.outcome !== 'queued' || !key ||
      ticketKey(outcome.receipt.requestId) !== key || expected.has(key)) { invalid++; continue; }
    expected.set(key,ordinal);
    outcomes.push({ ordinal,slot:dispatched.slot,requestId:outcome.requestId,status:outcome.status,receipt:outcome.receipt });
  }
  if (completions.size !== dispatches.size || dispatches.size === 0) invalid++;
  for (const [index, execution] of closed.executions.entries()) {
    const key = ticketKey(execution.requestId);
    if (!key || !expected.has(key)) unexpectedExecutions++;
    if (observed.has(key)) duplicateExecutions++;
    observed.set(key,(observed.get(key) ?? 0)+1);
    if (execution.receipt?.outcome !== 'sent' || ticketKey(execution.receipt.requestId) !== key ||
      execution.receipt.priorEffects !== 'confirmed-transmission' || execution.receipt.failure ||
      JSON.stringify(execution.receipt.completedOperations) !== '["brightness"]' ||
      JSON.stringify(execution.receipt.uncertainOperations) !== '[]' || execution.effects !== index+1) invalid++;
  }
  for (const key of expected.keys()) if (!observed.has(key)) missingExecutions++;
  const oracle = closed.result?.oracle;
  if (closed.code !== 0 || closed.reason !== null || closed.result?.complete !== true || closed.result.quiescent !== true ||
    oracle?.historyDropped !== 0 || oracle.queued !== 0 || oracle.cancelled !== 0 || oracle.diagnosticFailures !== 0 ||
    oracle.effects !== dispatches.size || oracle.executed !== dispatches.size) invalid++;
  return { complete: invalid+omitted+unexpectedExecutions+duplicateExecutions+missingExecutions === 0,
    dispatched:dispatches.size,completed:completions.size,executed:closed.executions.length,
    invalid,omitted,unexpectedExecutions,duplicateExecutions,missingExecutions,outcomes:outcomes.sort((a,b)=>a.ordinal-b.ordinal) };
}
