import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { authorize, schema, validate } from '@jimmie-potts/device-contracts';
import type { Request, Ticket } from '@jimmie-potts/device-contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DeviceRegistry } from './registry.js';
import type { ControllerContext, DeviceTool, JsonSchema, MachinePrincipal, ServiceExtension } from './types.js';

type Binding = { registry: DeviceRegistry; operation: 'list' | 'status' | 'power' | 'brightness' | 'extension';
  deviceId?: string; extension?: ServiceExtension; checkInput: (data: unknown) => boolean; checkOutput?: (data: unknown) => boolean };
const bindings = new WeakMap<DeviceTool, Binding>();
const ajv = new Ajv2020({ strict: true, allErrors: false });
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const baseProperties = { requestId: ref('ticket'), expectedConfigurationRevision: ref('counter'), expectedGeneration: ref('ticket') };
const outputBase = { type: 'object' as const, $defs: schema.$defs, additionalProperties: false,
  properties: { kind: { enum: ['snapshot', 'receipt', 'devices', 'gateway-error', 'extension'] }, snapshot: ref('snapshot'), receipt: ref('receipt'),
    devices: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false,
      properties: { deviceId: ref('id'), controllerId: ref('id'), label: { type: 'string', maxLength: 80 } }, required: ['deviceId', 'controllerId'] } },
    code: { type: 'string' }, priorEffects: { enum: ['none', 'possible'] }, retry: { const: 'never-automatically' },
    requestId: { anyOf: [ref('ticket'), { type: 'string', maxLength: 128 }] }, data: { type: 'object' } }, required: ['kind'] };
// An extension tool returns only its extension data or a gateway error, never a snapshot, receipt or device list.
const extensionOutputBase = { type: 'object' as const, $defs: schema.$defs, additionalProperties: false,
  properties: { kind: { enum: ['extension', 'gateway-error'] }, code: outputBase.properties.code, priorEffects: outputBase.properties.priorEffects,
    retry: outputBase.properties.retry, requestId: outputBase.properties.requestId, data: { type: 'object' } }, required: ['kind'] };

/** Keep only the root definitions a schema reaches, so each published tool stays proportional to what it uses.
 * References inside a nested `$id` resource resolve against that resource and are skipped. A reference this
 * cannot classify keeps every definition, so pruning can only remove what is provably unused. */
export function referencedDefinitions(value: JsonSchema): JsonSchema {
  const defs = value.$defs as Record<string, unknown> | undefined;
  if (!defs) return value;
  const kept = new Set<string>(); let unclassified = false;
  const reach = (reference: string) => {
    const match = /^#\/(?:\$|%24)defs\/([^/]+)/.exec(reference);
    if (!match) { if (reference !== '#' && !reference.startsWith('#/')) unclassified = true; return; }
    let name: string;
    try { name = decodeURIComponent(match[1]).replace(/~1/g, '/').replace(/~0/g, '~'); } catch { unclassified = true; return; }
    if (!Object.hasOwn(defs, name)) { unclassified = true; return; }
    if (kept.has(name)) return;
    kept.add(name); visit(defs[name], false);
  };
  const visit = (node: unknown, root: boolean): void => {
    if (Array.isArray(node)) { node.forEach(item => visit(item, false)); return; }
    if (!node || typeof node !== 'object') return;
    if (!root && typeof (node as JsonSchema).$id === 'string') return;
    for (const [key, child] of Object.entries(node)) {
      if (root && key === '$defs') continue;
      if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string') reach(child);
      else visit(child, false);
    }
  };
  visit(value, true);
  if (unclassified) return value;
  const { $defs: _unused, ...rest } = value;
  return kept.size ? { ...rest, $defs: Object.fromEntries(Object.entries(defs).filter(([name]) => kept.has(name))) } as JsonSchema : rest as JsonSchema;
}

const verifiedSchemas = new Set<string>();
/** Publish a schema only if it resolves on its own; prune package-owned roots first. Identical schemas compile once. */
export function publishedSchema(value: JsonSchema, prune = true): JsonSchema {
  const candidate = prune ? referencedDefinitions(value) : value;
  const key = JSON.stringify(candidate);
  if (!verifiedSchemas.has(key)) {
    new Ajv2020({ strict: true }).compile(candidate);
    verifiedSchemas.add(key);
  }
  return candidate;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}

/** Reject oversized, cyclic or non-JSON values before serializing them. */
export function boundedJson(value: unknown, maximum: number): boolean {
  let size = 0;
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (depth > 32 || pending.length > maximum) return false;
    if (item === null || typeof item === 'boolean') size += 5;
    else if (typeof item === 'number') { if (!Number.isFinite(item)) return false; size += 25; }
    else if (typeof item === 'string') size += Buffer.byteLength(item) * 6 + 2;
    else if (typeof item === 'object' && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype)) {
      size += 2;
      for (const [key, child] of Object.entries(item)) {
        size += Array.isArray(item) ? 1 : Buffer.byteLength(key) * 6 + 4;
        pending.push({ value: child, depth: depth + 1 });
      }
    } else return false;
    if (size > maximum) return false;
  }
  return true;
}

export function toolResult(data: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError };
}
export function gatewayFailure(code: string, priorEffects: 'none' | 'possible' = 'none', requestId?: Ticket | string): CallToolResult {
  return toolResult({ kind: 'gateway-error', code, priorEffects, retry: 'never-automatically', ...(requestId === undefined ? {} : { requestId }) }, true);
}
export function validPrincipal(value: unknown): value is MachinePrincipal {
  const p = value as MachinePrincipal | null;
  return !!p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 128
    && Object.keys(p).every(key => ['id', 'credential'].includes(key))
    && !!p.credential && p.credential.kind === 'machine' && p.credential.declared === true && ['active', 'overlap'].includes(p.credential.status)
    && Object.keys(p.credential).every(key => ['kind', 'status', 'declared', 'devices', 'scopes'].includes(key))
    && Array.isArray(p.credential.devices) && p.credential.devices.length <= 64 && p.credential.devices.every(d => validate('id', d))
    && Array.isArray(p.credential.scopes) && p.credential.scopes.length <= 2 && p.credential.scopes.every(s => ['read', 'control'].includes(s));
}
function context(principal: MachinePrincipal, deviceId: string, scope: 'read' | 'control'): ControllerContext {
  return { principalId: principal.id, authorization: { credential: structuredClone(principal.credential), deviceId, scope,
    hostAllowed: true, originPresent: false, originAllowed: true, fetchMetadataAllowed: true } };
}
function createTool(registry: DeviceRegistry, name: string, operation: Binding['operation'], deviceId?: string, extension?: ServiceExtension): DeviceTool {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new Error('Invalid tool name');
  const target: Record<string, object> = operation !== 'list' && deviceId === undefined
    ? { deviceId: { type: 'string', enum: registry.list().filter(r => r.service).map(r => r.deviceId) } } : {};
  const write = operation === 'power' || operation === 'brightness' || extension?.scope === 'control';
  let inputSchema: JsonSchema = { type: 'object', additionalProperties: false, $defs: schema.$defs,
    properties: { ...target, ...(write && !extension ? baseProperties : {}),
      ...(operation === 'power' ? { on: { type: 'boolean' } } : {}),
      ...(operation === 'brightness' ? { percent: { type: 'integer', minimum: 0, maximum: 100 } } : {}) } };
  inputSchema.required = Object.keys(inputSchema.properties!);
  if (extension) {
    if (extension.inputSchema.type !== 'object' || extension.inputSchema.additionalProperties !== false || extension.outputSchema.type !== 'object'
        || extension.outputSchema.additionalProperties !== false
        || typeof extension.invoke !== 'function' || !['read', 'control'].includes(extension.scope)
        || typeof extension.description !== 'string' || extension.description.length > 1024
        || extension.annotations.readOnlyHint !== !write || extension.annotations.destructiveHint !== write
        || extension.annotations.openWorldHint !== true || typeof extension.annotations.idempotentHint !== 'boolean'
        || Object.keys(extension.inputSchema.properties ?? {}).some(key => ['deviceId', 'controllerId', 'url', 'ip', 'path', 'credential', 'authorization'].includes(key))) throw new Error('Invalid extension');
    inputSchema = structuredClone(extension.inputSchema);
  }
  // Only the shared definitions this package injects are pruned; an extension's own input schema is kept as declared.
  inputSchema = publishedSchema(inputSchema, !extension);
  const outputSchema: JsonSchema & { properties: Record<string, unknown> } = structuredClone(extension ? extensionOutputBase : outputBase);
  if (extension) {
    const embedded = structuredClone(extension.outputSchema);
    // A compound schema resource preserves fragment references relative to the extension root.
    embedded.$id ??= `urn:agent-device-mcp:output:${createHash('sha256').update(JSON.stringify(embedded)).digest('hex')}`;
    outputSchema.properties.data = embedded;
  }
  // Every published schema must resolve on its own, so a pruning or contract change cannot ship an unusable catalog.
  const tool = deepFreeze({ name, inputSchema, outputSchema: publishedSchema(outputSchema),
    description: extension?.description ?? (operation === 'list' ? 'List authorized configured device IDs. No network discovery or agent/session state.'
      : operation === 'status' ? 'Read the owning controller snapshot. Unknown observation stays unknown; transmission is not visible-device verification.'
      : `Set optional device ${operation} through its owner. Read status for request identity and revisions first. Reuse an exact identity only for replay; never retry an ambiguous write with a new identity. Acceptance is not visible-device verification.`),
    annotations: extension?.annotations ?? { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: true } });
  bindings.set(tool, { registry, operation, deviceId, extension, checkInput: ajv.compile(inputSchema),
    ...(extension ? { checkOutput: ajv.compile(extension.outputSchema) } : {}) });
  return tool;
}
export function createDeviceTools(registry: DeviceRegistry): readonly DeviceTool[] {
  if (!registry.list().some(r => r.service)) throw new Error('Generic tools require a shared controller service');
  return Object.freeze([createTool(registry, 'device_list', 'list'), createTool(registry, 'device_status', 'status'),
    createTool(registry, 'device_power_set', 'power'), createTool(registry, 'device_brightness_set', 'brightness')]);
}
export function bindDeviceTools(registry: DeviceRegistry, binding: { deviceId: string; prefix: string }): readonly DeviceTool[] {
  if (!registry.get(binding.deviceId)?.service) throw new Error('Bound device has no shared service');
  return Object.freeze([createTool(registry, `${binding.prefix}_status`, 'status', binding.deviceId),
    createTool(registry, `${binding.prefix}_power_set`, 'power', binding.deviceId),
    createTool(registry, `${binding.prefix}_brightness_set`, 'brightness', binding.deviceId)]);
}
export function bindServiceTools(registry: DeviceRegistry, binding: { deviceId: string; bindings: readonly { extension: string; name: string }[] }): readonly DeviceTool[] {
  const registration = registry.get(binding.deviceId);
  if (!registration) throw new Error('Unknown bound device');
  const tools = binding.bindings.map(({ extension: key, name }) => {
    const extension = Object.hasOwn(registration.extensions ?? {}, key) ? registration.extensions![key] : undefined;
    if (!extension) throw new Error('Unknown service extension');
    return createTool(registry, name, 'extension', binding.deviceId, extension);
  });
  if (new Set(tools.map(t => t.name)).size !== tools.length) throw new Error('Duplicate tool name');
  return Object.freeze(tools);
}
export function isRegisteredTool(registry: DeviceRegistry, tool: DeviceTool): boolean { return bindings.get(tool)?.registry === registry; }

/** Discovery reflects the authenticated request, including the enums of generic tools. */
export function authorizedTools(registry: DeviceRegistry, tools: readonly DeviceTool[], principal: MachinePrincipal): readonly DeviceTool[] {
  return tools.flatMap(tool => {
    const binding = bindings.get(tool);
    if (!binding || binding.registry !== registry) return [];
    const scope = binding.operation === 'power' || binding.operation === 'brightness' || binding.extension?.scope === 'control' ? 'control' : 'read';
    const allowed = registry.list().filter(device => (binding.deviceId ? device.deviceId === binding.deviceId : !!device.service)
      && authorize(context(principal, device.deviceId, scope).authorization).decision === 'allowed');
    if (!allowed.length) return [];
    if (binding.deviceId || binding.operation === 'list') return [tool];
    const discovered = structuredClone(tool);
    discovered.inputSchema.properties!.deviceId = { type: 'string', enum: allowed.map(device => device.deviceId) };
    return [discovered];
  });
}

export async function invokeDeviceTool(registry: DeviceRegistry, tool: DeviceTool, args: unknown, principal: MachinePrincipal,
  options: { signal?: AbortSignal; maxResponseBytes?: number; onDispatch?: () => void } = {}): Promise<CallToolResult> {
  const binding = bindings.get(tool);
  if (!binding || binding.registry !== registry) return gatewayFailure('unknown-tool');
  if (!validPrincipal(principal)) return gatewayFailure('unauthenticated');
  if (!boundedJson(args, 65536) || !binding.checkInput(args)) return gatewayFailure('invalid-request');
  const input = args as Record<string, unknown>;
  if (binding.operation === 'list') {
    const devices = registry.list().filter(r => r.service && authorize(context(principal, r.deviceId, 'read').authorization).decision === 'allowed')
      .map(({ deviceId, controllerId, label }) => ({ deviceId, controllerId, ...(label === undefined ? {} : { label }) }));
    return toolResult({ kind: 'devices', devices });
  }
  const deviceId = binding.deviceId ?? input.deviceId as string;
  const write = binding.operation === 'power' || binding.operation === 'brightness' || binding.extension?.scope === 'control';
  const current = context(principal, deviceId, write ? 'control' : 'read');
  const decision = authorize(current.authorization).decision;
  if (decision !== 'allowed') return gatewayFailure(decision);
  const registration = registry.get(deviceId);
  if (!registration) return gatewayFailure('unknown-device');
  const identity = validate('ticket', input.requestId) ? input.requestId as Ticket
    : typeof input.request_id === 'string' && input.request_id.length <= 128 ? input.request_id : undefined;
  if (options.signal?.aborted) return gatewayFailure('cancelled', 'none', identity);
  let dispatched = false;
  try {
    options.onDispatch?.();
    dispatched = true;
    if (binding.extension) {
      const result = await binding.extension.invoke(structuredClone(input), current);
      if (!boundedJson(result, options.maxResponseBytes ?? 1048576) || !result || !binding.checkOutput!(result.data)
          || (result.isError !== undefined && typeof result.isError !== 'boolean')) throw new Error('Invalid extension response');
      return toolResult({ kind: 'extension', data: result.data }, result.isError ?? false);
    }
    if (!write) {
      if (!registration.service) return gatewayFailure('unsupported-capability');
      const snapshot = await registration.service.readSnapshot(current);
      if (!boundedJson(snapshot, options.maxResponseBytes ?? 1048576) || !validate('snapshot', snapshot)
          || snapshot.identity.controllerId !== registration.controllerId || snapshot.identity.deviceId !== deviceId) throw new Error('Invalid snapshot');
      return toolResult({ kind: 'snapshot', snapshot });
    }
    const request: Request = { apiVersion: '1.0', controllerId: registration.controllerId, deviceId, requestId: input.requestId as Ticket,
      expectedConfigurationRevision: input.expectedConfigurationRevision as number, expectedGeneration: input.expectedGeneration as Ticket,
      command: binding.operation === 'power' ? { kind: 'power.set', on: input.on as boolean } : { kind: 'brightness.set', percent: input.percent as number } };
    if (!validate('request', request)) return gatewayFailure('invalid-request');
    if (!registration.service) return gatewayFailure('unsupported-capability');
    const result = await registration.service.submit(structuredClone(request), current);
    if (!boundedJson(result, options.maxResponseBytes ?? 1048576)) throw new Error('Invalid result');
    if (result?.kind === 'receipt') {
      const receipt = result.receipt;
      if (!validate('receipt', receipt) || receipt.controllerId !== registration.controllerId || receipt.deviceId !== deviceId
          || receipt.requestId.epoch !== request.requestId.epoch || receipt.requestId.sequence !== request.requestId.sequence) throw new Error('Invalid receipt');
      return toolResult({ kind: 'receipt', receipt }, !['queued', 'sent'].includes(receipt.outcome));
    }
    if (result?.kind === 'rejected' && result.priorEffects === 'none' && validate('failureCode', result.code)) return gatewayFailure(result.code, 'none', identity);
    if (result?.kind === 'unavailable' && ['transport-failure', 'uncertain-result'].includes(result.code)
        && ['none', 'possible'].includes(result.priorEffects)) return gatewayFailure(result.code, result.priorEffects, identity);
    throw new Error('Invalid result');
  } catch {
    return gatewayFailure(write && dispatched ? 'uncertain-result' : 'transport-failure', write && dispatched ? 'possible' : 'none', identity);
  }
}
