// MCP on the runtime (Hub #835), through `packages/mcp` unchanged: each module's read tools from its manifest, named
// `<module>_<tool>`, the core's operator action, `core_recover_approval`, which sends the 2.0 `approval-recover`
// command, and `core_send_command`, which sends a device's command, a moment or a mode change through the core's
// dispatcher, so it is tracked (#782). A tool's result is `{result}`, and a refusal is the shared error body, `{error}`; MCP's own protocol errors
// keep the MCP specification. The refusals `packages/mcp` makes itself, before a tool runs, keep its released 1.x
// `gateway-error` result with no detail, since the package is reused unchanged. Only a client credential reaches MCP:
// `read` lists and calls every module's read tools, and `control` the actions.
import {
  bindServiceTools, createDeviceRegistry, createMcpHandler, type DeviceRegistration, type JsonSchema, type MachinePrincipal,
  type McpHandler, type ServiceExtension,
} from '@jimmie-potts/device-mcp';
import {RETRYABLE, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleTool} from '@jimmie-potts/sdk';
import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import type {ActionAnswer} from '../core/tracker.js';
import {ContributionFailed, ModuleUnavailable, type HostedModule} from '../host.js';
import type {Access} from './access.js';

/** How long a module's read tool may take before the call is answered `unavailable`. */
export const TOOL_TIMEOUT_MS = 5000;
const CONTROLLER = 'runtime';
const ID = '^[A-Za-z0-9_.-]{1,128}$';

/** The shared error body's `error` member, as a tool's result publishes it. */
const ERROR_DETAIL: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'retryable'],
  properties: {
    code: {enum: Object.keys(RETRYABLE)}, retryable: {type: 'boolean'}, requestId: {type: 'string', pattern: ID},
    traceId: {type: 'string', pattern: '^[0-9a-f]{32}$'}, detail: {type: 'string', minLength: 1, maxLength: 1024},
  },
};

/** A tool's published result: `{result}` with the tool's own output, or `{error}`. */
const resultSchema = (output: object, id: string): JsonSchema => ({
  type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 1,
  properties: {result: {...output, $id: id}, error: ERROR_DETAIL},
});

/** What the MCP gateway asks of the runtime: its modules, a call in a module's flow, and the core's recovery. */
export type McpHost = {
  modules: () => readonly HostedModule[];
  invoke: <T>(name: string, call: () => T | Promise<T>) => Promise<T>;
  /** Sends `approval-recover` to the core as the credential's source; resolves with the reply or a refusal. */
  recover: (credentialId: string, input: {session: string; turnId: string; expectedRevision: number; requestId?: string}) => Promise<{status: 'accepted'; requestId: string} | ErrorBody>;
  /** Sends one action through the core's dispatcher as the credential's source (#782); resolves with its answer. */
  dispatch: (credentialId: string, input: {family: string; target: string; data: Record<string, unknown>; requestId?: string}) => Promise<ActionAnswer>;
  access: Access;
  scheduler: {after: (delayMs: number, callback: () => void) => () => void};
  /** Whether text holds a secret a module read, which no result may carry. */
  holdsSecret: (text: string) => boolean;
};

const failure = (body: ErrorBody): {data: Record<string, unknown>; isError: true} => ({data: body, isError: true});

/** A module's call, bounded by `TOOL_TIMEOUT_MS`, with each way it can end as an error body. */
async function bounded<T>(host: McpHost, name: string, call: () => T | Promise<T>): Promise<{value: T} | {refused: ErrorBody}> {
  let cancel = (): void => {};
  const late = new Promise<{refused: ErrorBody}>(resolve => {
    cancel = host.scheduler.after(TOOL_TIMEOUT_MS, () => { resolve({refused: errorBody('unavailable', {detail: `the module did not answer within ${TOOL_TIMEOUT_MS} ms`})}); });
  });
  const work = host.invoke(name, call).then(value => ({value}), (error: unknown) => {
    if (error instanceof ModuleUnavailable) return {refused: errorBody('unavailable', {detail: 'the module is not running'})};
    if (error instanceof ContributionFailed) return {refused: errorBody('internal', {detail: 'the module failed'})};
    return {refused: errorBody('internal', {detail: 'the gateway failed'})};
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    cancel();
  }
}

/** The extension that publishes one module's read tool. */
function readTool(host: McpHost, module: string, tool: ModuleTool, check: ValidateFunction): ServiceExtension {
  return {
    inputSchema: tool.input, outputSchema: resultSchema(tool.output, `urn:bunny:tool:${module}:${tool.name}:output`), scope: 'read',
    description: tool.description, annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    async invoke(args, context) {
      if (host.access.current(context.principalId) === undefined) return failure(errorBody('unauthenticated', {detail: 'the credential was revoked'}));
      const answered = await bounded(host, module, () => tool.read(args));
      if ('refused' in answered) return failure(answered.refused);
      const value: unknown = answered.value;
      // Nothing the module answers is served before the secret check, a refusal's detail included.
      if (host.holdsSecret(JSON.stringify(value) ?? '')) return failure(errorBody('internal', {detail: 'the module\'s answer holds a secret, which the gateway never serves'}));
      const refusal = refusedBody(value);
      if (refusal !== undefined) return failure(refusal);
      if (!check(value)) return failure(errorBody('internal', {detail: 'the module answered outside its tool\'s schema'}));
      return {data: {result: value}};
    },
  };
}

/**
 * A tool's answer as a refusal, when it has an `error` member: the shared error body with a registry code and its flag,
 * or `internal` for anything else there, `null` included.
 */
function refusedBody(value: unknown): ErrorBody | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'error')) return undefined;
  const error: unknown = (value as {error: unknown}).error;
  if (typeof error !== 'object' || error === null) return errorBody('internal', {detail: 'the module answered with a malformed refusal'});
  const {code, retryable, detail} = error as {code?: unknown; retryable?: unknown; detail?: unknown};
  if (typeof code !== 'string' || !Object.hasOwn(RETRYABLE, code) || RETRYABLE[code as keyof typeof RETRYABLE] !== retryable) {
    return errorBody('internal', {detail: 'the module answered with a malformed refusal'});
  }
  return errorBody(code as keyof typeof RETRYABLE, typeof detail === 'string' && detail.length > 0 ? {detail: detail.slice(0, 1024)} : {});
}

/** The core's operator action: retire one uncertain approval marker, as the old Hub's `hub_recover_approval` did. */
function recoverTool(host: McpHost): ServiceExtension {
  return {
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['session', 'turnId', 'expectedRevision'],
      properties: {
        session: {type: 'string', pattern: '^[0-9a-f]{64}$'}, turnId: {type: 'string', pattern: ID},
        expectedRevision: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER}, requestId: {type: 'string', pattern: ID},
      },
    },
    outputSchema: resultSchema({
      type: 'object', additionalProperties: false, required: ['status', 'requestId'],
      properties: {status: {const: 'accepted'}, requestId: {type: 'string', pattern: ID}},
    }, 'urn:bunny:tool:core:recover_approval:output'),
    scope: 'control',
    description: 'Only on the user\'s explicit request, retire the one uncertain approval marker without an attention ID that a session holds on one turn, '
      + 'while its evidence is uncertain. Read core_sessions first and pass the session\'s id, its turn and its revision as expectedRevision. '
      + 'This approves or denies nothing at the agent, and fresh approval evidence can raise a new marker. Never retry an uncertain result automatically.',
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    async invoke(args, context) {
      const credential = host.access.current(context.principalId);
      if (credential === undefined) return failure(errorBody('unauthenticated', {detail: 'the credential was revoked'}));
      if (!credential.scopes.includes('control')) return failure(errorBody('forbidden', {detail: 'the credential may not control'}));
      const {session, turnId, expectedRevision, requestId} = args as {session: string; turnId: string; expectedRevision: number; requestId?: string};
      const answer = await host.recover(credential.id, {session, turnId, expectedRevision, ...(requestId === undefined ? {} : {requestId})});
      return 'error' in answer ? failure(answer) : {data: {result: answer}};
    },
  };
}

/**
 * The core's dispatcher as an MCP action (#782): one device command, moment or mode change, tracked from sent to its
 * outcome. Its answer is the owner's reply, `accepted`, or a refusal; an uncertain result is never retried.
 */
function commandTool(host: McpHost, handling = false): ServiceExtension {
  return {
    inputSchema: handling ? {type: 'object', additionalProperties: false, required: ['id', 'expectedRevision', 'action'], properties: {id: {type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 128}, expectedRevision: {type: 'integer', minimum: 0}, action: {enum: ['dismiss', 'send-again']}}} : {
      type: 'object', additionalProperties: false, required: ['family', 'target', 'data'],
      properties: {
        family: {type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)+$', maxLength: 64}, target: {type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 128},
        data: {type: 'object'}, requestId: {type: 'string', pattern: ID},
      },
    },
    outputSchema: resultSchema({
      type: 'object', additionalProperties: false, required: ['status', 'requestId'],
      properties: {status: {const: 'accepted'}, requestId: {type: 'string', pattern: ID}},
    }, 'urn:bunny:tool:core:send_command:output'),
    scope: 'control',
    description: handling ? 'Only on explicit user request, dismiss one inbox item or send its saved command again as a new tracked operation. Pass its current revision. Handling does not release a held device. Never retry automatically.' : 'Only on the user\'s explicit request, send one command to one device, such as power-set {"on": true}, brightness-set {"percent": 40} '
      + 'or playback-control {"action": "pause"}, or label a session with session-label-set {"label": "Name", "expectedRevision": 1} '
      + '(null clears the label), through the core, which tracks it until its outcome. family is the command family, target the device\'s '
      + 'routing ID or qualified session ID, and data the command\'s payload without a requestId. accepted means the owner took responsibility; read its state to confirm the change. '
      + 'Never retry an uncertain or failed result automatically, and never reuse a requestId for another command.',
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    async invoke(args, context) {
      const credential = host.access.current(context.principalId);
      if (credential === undefined) return failure(errorBody('unauthenticated', {detail: 'the credential was revoked'}));
      if (!credential.scopes.includes('control')) return failure(errorBody('forbidden', {detail: 'the credential may not control'}));
      const selected = handling ? {family: 'inbox-handle', target: args.id, data: {expectedRevision: args.expectedRevision, action: args.action}} : args;
      const {family, target, data, requestId} = selected as {family: string; target: string; data: Record<string, unknown>; requestId?: string};
      if (Object.hasOwn(data, 'requestId')) return failure(errorBody('invalid-request', {detail: 'the command\'s payload names no requestId; pass it beside data'}));
      const answer = await host.dispatch(credential.id, {family, target, data, ...(requestId === undefined ? {} : {requestId})});
      return 'error' in answer ? failure(answer) : {data: {result: answer}};
    },
  };
}

/**
 * The MCP handler at `/mcp`, for the listener's host names. It authenticates every request again with the credential's
 * token, so a revoked credential stops at once; a browser session never reaches it.
 */
export function createGatewayMcp(host: McpHost, hosts: readonly string[]): McpHandler {
  const ajv = new Ajv2020({strict: true, allErrors: false});
  const registrations: DeviceRegistration[] = [];
  const bindings: {deviceId: string; bindings: {extension: string; name: string}[]}[] = [];
  for (const module of host.modules()) {
    if (!module.admitted) continue;
    const extensions: Record<string, ServiceExtension> = {};
    for (const tool of module.manifest.tools ?? []) extensions[tool.name] = readTool(host, module.name, tool, ajv.compile(tool.output));
    if (module.name === 'core') {
      extensions.recover_approval = recoverTool(host);
      extensions.send_command = commandTool(host);
      extensions.handle_inbox = commandTool(host, true);
    }
    if (Object.keys(extensions).length === 0) continue;
    registrations.push({controllerId: CONTROLLER, deviceId: module.name, extensions});
    bindings.push({deviceId: module.name, bindings: Object.keys(extensions).map(extension => ({extension, name: `${module.name}_${extension}`}))});
  }
  const registry = createDeviceRegistry(registrations);
  const tools = bindings.flatMap(binding => [...bindServiceTools(registry, binding)]);
  // MCP's registrations are the modules, and a credential's MCP devices are every one of them: no credential is limited
  // to some devices (owner decision, 2026-10-07). The package checks its scopes per tool.
  const devices = registrations.map(registration => registration.deviceId);
  return createMcpHandler({
    enabled: true, registry, tools, allowedHosts: [...hosts], allowedOrigins: [],
    authenticate: token => {
      const credential = host.access.credential(token);
      if (credential === undefined) return Promise.resolve(null);
      const scopes = credential.scopes.filter((scope): scope is 'read' | 'control' => scope === 'read' || scope === 'control');
      const principal: MachinePrincipal = {id: credential.id, credential: {kind: 'machine', status: 'active', declared: true, devices: [...devices], scopes}};
      return Promise.resolve(principal);
    },
  });
}
