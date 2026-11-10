// The owner's on-demand art show on existing MCP control scope (Hub #1581): the same `art-show` command the gallery's
// Show now sends. Acceptance tracks the show; each surface keeps its own operation, which the result names.
import type {JsonSchema, ServiceExtension} from '@jimmie-potts/device-mcp';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {ART_SHOW_SUBJECT, artShowSurfaces} from '@jimmie-potts/event-contracts/v2/art-show';
import type {McpHost} from './mcp.js';

const ID = '^[A-Za-z0-9_.-]{1,128}$', ROUTING = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

export function artShowTool(host: Pick<McpHost, 'access' | 'dispatch'>, resultSchema: (output: object, id: string) => JsonSchema): ServiceExtension {
  const request = {type: 'string', pattern: ID};
  return {
    inputSchema: {type: 'object', additionalProperties: false, required: ['artworkId', 'targets'], properties: {
      artworkId: {type: 'string', pattern: ID},
      targets: {type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: {type: 'string', pattern: ROUTING, maxLength: 128}},
      coversStatus: {type: 'boolean'}, requestId: request,
    }},
    outputSchema: resultSchema({type: 'object', additionalProperties: false, required: ['status', 'requestId', 'surfaces'], properties: {
      status: {const: 'accepted'}, requestId: request,
      surfaces: {type: 'array', maxItems: 3, items: {oneOf: [
        {type: 'object', additionalProperties: false, required: ['target', 'kind', 'prepareRequestId', 'momentRequestId'], properties: {
          target: {type: 'string', pattern: ROUTING}, kind: {const: 'display'}, prepareRequestId: request, momentRequestId: request}},
        {type: 'object', additionalProperties: false, required: ['target', 'kind', 'presentRequestId'], properties: {
          target: {const: 'browser'}, kind: {const: 'browser'}, presentRequestId: request}},
      ]}},
    }}, 'urn:bunny:tool:core:art_show:output'),
    scope: 'control',
    description: "Only on the user's explicit request, show one saved artwork now on configured displays (their routing IDs) and "
      + "'browser', through the scheduled appearance's path: preparation, then one moment per display about 20 seconds later "
      + '(Pixoo 10 s, Tidbyt 30 s) and one browser selection. Saved art only: this never creates art. Quiet hours and the daily '
      + 'schedule do not apply and are not used up; attention, holds, pins and each display still decide. accepted means the core took the show; '
      + "each surface's request IDs name its own operation records, whose transmitted evidence is not proof the panel showed it. "
      + 'Any saved artwork the art owner still retains can be shown, not only the most recent. A target without a composition is skipped, '
      + 'an artwork that is not retained is not-found, and a show while another prepares is capacity. Never retry automatically.',
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    async invoke(args, context) {
      const credential = host.access.current(context.principalId);
      const failure = (body: ReturnType<typeof errorBody>) => ({data: body, isError: true as const});
      if (credential === undefined) return failure(errorBody('unauthenticated', {detail: 'the credential was revoked'}));
      if (!credential.scopes.includes('control')) return failure(errorBody('forbidden', {detail: 'the credential may not control'}));
      const {artworkId, targets, coversStatus, requestId} = args as {artworkId: string; targets: string[]; coversStatus?: boolean; requestId?: string};
      const answer = await host.dispatch(credential.id, {family: 'art-show', target: ART_SHOW_SUBJECT,
        data: {artworkId, targets, ...(coversStatus === undefined ? {} : {coversStatus})}, ...(requestId === undefined ? {} : {requestId})});
      if ('error' in answer) return failure(answer);
      return {data: {result: {...answer, surfaces: await artShowSurfaces(answer.requestId, targets)}}};
    },
  };
}
