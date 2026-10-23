// Explicit Hub selection on existing MCP control scope; device outcomes remain separate from the saved choice.
import type {JsonSchema, ServiceExtension} from '@jimmie-potts/device-mcp';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';
import type {McpHost} from './mcp.js';

export function modeTool(host: Pick<McpHost, 'access' | 'dispatch'>, resultSchema: (output: object, id: string) => JsonSchema, individual = false): ServiceExtension {
  const id = '^[A-Za-z0-9_.-]{1,128}$';
  return {
    inputSchema: {type: 'object', additionalProperties: false, required: individual ? ['mode', 'target'] : ['mode'], properties: {
      ...(individual ? {target: {type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128}} : {}),
      mode: {enum: ['work', 'free', 'quiet']}, expectedRevision: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER}, requestId: {type: 'string', pattern: id},
    }},
    outputSchema: resultSchema({type: 'object', additionalProperties: false, required: ['status', 'requestId'], properties: {
      status: {const: 'accepted'}, requestId: {type: 'string', pattern: id},
    }}, individual ? 'urn:bunny:tool:core:set_device_mode:output' : 'urn:bunny:tool:core:set_mode:output'),
    scope: 'control',
    description: (individual
      ? "Only on the user's explicit request, save Work, Free or Quiet for one configured Nanoleaf or Pixoo participant. Selecting the current Hub mode clears only its exception. "
      : "Only on the user's explicit request, save the Hub's Work, Free or Quiet selection, clear every exception, then apply the fixed native mapping independently to participants. ")
      + 'Read the mode family first and pass its shared revision as expectedRevision. Saving intent does not prove device success; read operation and inbox records for independent results. '
      + 'Restart never applies saved choices. Never retry an uncertain result automatically. An explicit reapply needs a new requestId.',
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    async invoke(args, context) {
      const credential = host.access.current(context.principalId);
      const failure = (body: ReturnType<typeof errorBody>) => ({data: body, isError: true as const});
      if (credential === undefined) return failure(errorBody('unauthenticated', {detail: 'the credential was revoked'}));
      if (!credential.scopes.includes('control')) return failure(errorBody('forbidden', {detail: 'the credential may not control'}));
      const {mode, target, expectedRevision, requestId} = args as {mode: Mode; target?: string; expectedRevision?: number; requestId?: string};
      const answer = await host.dispatch(credential.id, {family: individual ? 'mode-override-set' : 'mode-set', target: individual ? target ?? '' : 'hub',
        data: {mode, ...(expectedRevision === undefined ? {} : {expectedRevision})}, ...(requestId === undefined ? {} : {requestId})});
      return 'error' in answer ? failure(answer) : {data: {result: answer}};
    },
  };
}
