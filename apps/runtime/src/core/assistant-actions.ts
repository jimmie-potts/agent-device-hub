import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {CONVERSATION_ART_SCHEMA} from '@jimmie-potts/event-contracts/v2/art';
import {artDescription, catalogProposal, catalogRoute, SHOW_SAVE_WINDOW_MS, type CatalogProposal} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {CoreHandle} from './core.js';
import type {InboxHandleRequest} from './inbox.js';
import type {Action, ActionAnswer} from './tracker.js';
import {OPERATOR_ACTIONS} from './tracker.js';

export async function dispatchCatalogAction(core: Pick<CoreHandle, 'dispatch' | 'clock'>, command: Message<{requestId: string; admitByMs?: number} & CatalogProposal>,
  dispatchOperator: (action: Action) => Promise<ActionAnswer>,
  handleInbox: (action: Action, input: InboxHandleRequest) => Promise<ActionAnswer>): Promise<ActionAnswer> {
  const approved = catalogProposal(command.data);
  if (approved === undefined) return errorBody('invalid-request');
  const {target, binding, data, command: family} = approved, {requestId} = command.data;
  const route = catalogRoute(family);
  if (family === 'art-request') {
    if (command.data.admitByMs !== undefined || !artDescription(data.description) || (data.format !== 'still' && data.format !== 'gif')) return errorBody('invalid-request');
    return core.dispatch({key: 'bunny.cmd.art-request.art', requestedBy: command.source, requestId, parent: command,
      draft: {type: 'org.bunny.art.request.requested', subject: 'art', dataschema: CONVERSATION_ART_SCHEMA,
        data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: [data.format === 'gif' ? 'pixoo' : 'ui'], text: data.description}}});
  }
  let payload: object = data;
  if (route.binding === 'device' && binding.kind === 'device') {
    payload = {...data, expectedConfigurationRevision: binding.configurationRevision, expectedGeneration: binding.generation};
  }
  if (binding.kind === 'record') payload = family === 'volcano-session-gap'
    ? {...data, expectedConfigurationRevision: binding.revision} : {...data, expectedRevision: binding.revision};
  const verb = family.lastIndexOf('-');
  const type = `org.bunny.${family.slice(0, verb)}.${family.slice(verb + 1)}.requested`;
  const admitByMs = command.data.admitByMs;
  if (family === 'nanoleaf-show-save') {
    if (admitByMs === undefined || admitByMs > core.clock.now() + SHOW_SAVE_WINDOW_MS) return errorBody('invalid-request');
    if (admitByMs <= core.clock.now()) return errorBody('expired');
    payload = {...data, admitByMs};
  } else if (admitByMs !== undefined) return errorBody('invalid-request');
  const minor = family === 'nanoleaf-show-save' || family === 'art-show' && 'guards' in data ? '2.1' : route.binding === 'device' ? route.guardedMinor ?? '2.0' : '2.0';
  const action: Action = {key: `bunny.cmd.${family}.${target}`, requestedBy: command.source, requestId, parent: command,
    ...(binding.kind === 'device' ? {deviceAdmission: {kind: 'conversation', owner: binding.owner, expiresAt: command.expiresat}} : {}),
    draft: {type, subject: target, dataschema: `https://bunny.invalid/events/${family}/${minor}`, data: payload}};
  if (family === 'inbox-handle') {
    if (binding.kind !== 'record' || data.action !== 'dismiss' && data.action !== 'send-again') return errorBody('invalid-request');
    return handleInbox(action, {requestId, action: data.action, expectedRevision: binding.revision});
  }
  return OPERATOR_ACTIONS.includes(family) ? dispatchOperator(action) : core.dispatch(action);
}
