import { readFileSync } from 'node:fs';
import { admit } from '@jimmie-potts/device-contracts';
import * as api from '../dist/index.js';

export const snapshot = () => JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url)));
export const principal = (overrides = {}) => ({ id: 'fixture', credential: { kind: 'machine', status: 'active', declared: true,
  devices: ['light'], scopes: ['read', 'control'], ...overrides } });
export const args = (overrides = {}) => ({ requestId: { epoch: 'requests-1', sequence: 1 }, expectedConfigurationRevision: 4,
  expectedGeneration: { epoch: 'generation-1', sequence: 3 }, percent: 40, ...overrides });
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export function fixture(serviceOverrides = {}) {
  const state = snapshot();
  const calls = [];
  const service = { readSnapshot: async context => { calls.push({ kind: 'read', context }); return structuredClone(state); },
    submit: async (request, context) => { calls.push({ kind: 'submit', request, context }); return { kind: 'receipt', receipt: {
      apiVersion: '1.0', controllerId: request.controllerId, deviceId: request.deviceId, requestId: request.requestId,
      configurationRevision: 5, generation: request.expectedGeneration, outcome: 'queued', priorEffects: 'none', completedOperations: [], uncertainOperations: [] } }; }, ...serviceOverrides };
  const registry = api.createDeviceRegistry([{ deviceId: 'light', controllerId: 'controller', service }]);
  const tools = api.bindDeviceTools(registry, { deviceId: 'light', prefix: 'fixture' });
  return { registry, tools, state, calls, service, invoke: (operation, input = {}, identity = principal(), options = {}) =>
    api.invokeDeviceTool(registry, tools.find(t => t.name === `fixture_${operation}`), input, identity, options) };
}

/** An atomic fake controller owner, shared by direct UI calls and MCP calls. */
export function owner() {
  const observation = snapshot();
  const state = { controllerId: 'controller', deviceId: 'light', epoch: 'requests-1', nextSequence: 1,
    configurationRevision: 4, generation: observation.generation, capabilities: observation.capabilities,
    maxBodyBytes: 65536, maxInFlight: 32, maxQueue: 32, maxReceipts: 2, inFlight: 0, queueDepth: 0, cache: [], pending: [] };
  const holds = new Map();
  let scheduled = 0;
  const service = {
    readSnapshot: async () => ({ ...structuredClone(observation), configurationRevision: state.configurationRevision,
      generation: state.generation, nextRequestId: { epoch: state.epoch, sequence: state.nextSequence } }),
    submit(request, context) {
      const decision = admit({ state, auth: context.authorization, request, bodyBytes: Buffer.byteLength(JSON.stringify(request)) });
      if (decision.decision === 'join') return holds.get(request.requestId.sequence).promise;
      if (decision.receipt && !decision.scheduled) {
        if (decision.reserved) { state.nextSequence = decision.nextSequence; state.cache.push({ request: structuredClone(request), receipt: decision.receipt }); }
        return Promise.resolve({ kind: 'receipt', receipt: decision.receipt });
      }
      if (!decision.reserved) return Promise.resolve({ kind: 'rejected', code: decision.decision, priorEffects: 'none' });
      scheduled++; state.nextSequence = decision.nextSequence; state.configurationRevision = decision.receipt.configurationRevision;
      state.pending.push({ request: structuredClone(request) }); state.inFlight++; state.queueDepth++;
      const hold = deferred(); holds.set(request.requestId.sequence, hold); return hold.promise;
    },
  };
  return { service, state, get scheduled() { return scheduled; }, finish(sequence = 1, outcome = 'sent', priorEffects = 'confirmed-transmission') {
    const request = state.pending.find(p => p.request.requestId.sequence === sequence).request;
    const receipt = { apiVersion: '1.0', controllerId: request.controllerId, deviceId: request.deviceId, requestId: request.requestId,
      configurationRevision: state.configurationRevision, generation: state.generation, outcome, priorEffects,
      completedOperations: priorEffects === 'confirmed-transmission' ? ['brightness'] : [], uncertainOperations: priorEffects === 'possible' ? ['brightness'] : [] };
    state.cache.push({ request, receipt }); state.cache = state.cache.slice(-state.maxReceipts);
    state.pending = state.pending.filter(p => p.request.requestId.sequence !== sequence); state.inFlight--; state.queueDepth--;
    holds.get(sequence).resolve({ kind: 'receipt', receipt }); return receipt;
  } };
}
