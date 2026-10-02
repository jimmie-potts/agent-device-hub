import { randomBytes } from 'node:crypto';
import { validate } from '@jimmie-potts/device-contracts';

async function receiptBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(value));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return validate('receipt', value) ? value : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** Exact synthetic brightness workload. An attempt consumes its ordinal even
 * when the response is lost; no response can authorize a replay. */
export function createBrightnessOperation(ready, { fetchImpl = fetch } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(ready?.url ?? '') ||
    Number(new URL(ready.url).port) > 65535 || ready.token !== 's'.repeat(43) ||
    !validate('request', ready.request) || ready.request.command.kind !== 'brightness.set' ||
    ready.request.command.percent !== 42 || typeof fetchImpl !== 'function') throw new Error('Workload application invalid');
  const initial = structuredClone(ready.request), url = ready.url + '/api/controllers/v1/wall/commands';
  let nextOrdinal = 0;
  return async ({ ordinal, signal }) => {
    if (!Number.isInteger(ordinal) || ordinal !== nextOrdinal || ordinal >= 1800) throw new Error('Workload ordinal invalid');
    nextOrdinal++;
    const request = { ...initial, requestId: { ...initial.requestId, sequence: initial.requestId.sequence + ordinal },
      expectedConfigurationRevision: initial.expectedConfigurationRevision + ordinal };
    if (!validate('request', request)) throw new Error('Workload request invalid');
    const traceId = randomBytes(16).toString('hex'), parentId = randomBytes(8).toString('hex');
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal,
      headers: { authorization: 'Bearer ' + ready.token, 'content-type': 'application/json', 'x-pixoo-request': '1',
        traceparent: `00-${traceId}-${parentId}-01` }, body: JSON.stringify(request) });
    const receipt = await receiptBody(response);
    const matches = receipt && receipt.requestId.epoch === request.requestId.epoch &&
      receipt.requestId.sequence === request.requestId.sequence && receipt.controllerId === request.controllerId && receipt.deviceId === request.deviceId;
    return { requestId: request.requestId, controllerId:request.controllerId,deviceId:request.deviceId,
      traceId, parentId, status: response.status, validReceipt: !!matches,
      receipt: matches ? { requestId: receipt.requestId, outcome: receipt.outcome, priorEffects: receipt.priorEffects,
        configurationRevision: receipt.configurationRevision, completedOperations: receipt.completedOperations,
        uncertainOperations: receipt.uncertainOperations, failure: receipt.failure?.code ?? null } : null };
  };
}
