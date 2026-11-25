import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, readReceiptValidator, type Lifecycle21Observation, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {connectRemote, prepareMessage, publishOnce, SdkError, type RemoteParticipant} from '@jimmie-potts/sdk';
import {readProducer} from '../hook/producer.js';
import {CLAUDE_READ_SURFACES, CLAUDE_RECEIPT_FEED, isReadReceipt, receiptSource, viewRevision, type ClaudeReadSurface, type ReceiptFeed} from './qualification.js';
import {coreSession} from './session.js';
export {CLAUDE_READ_SURFACES, CLAUDE_RECEIPT_FEED, receiptSource} from './qualification.js';

type Input = {action: 'bind'; version?: string; surface: ClaudeReadSurface; sessionId: string; promptId: string}
  | {action: 'read'; version?: string; surface: ClaudeReadSurface; target: object};
export type ReadHelperResult = {status: 'ready'; target: Message<ReadReceiptObservation>}
  | {status: 'confirmed'} | {status: 'unavailable' | 'unconfirmed'; error: ErrorBody['error']};
const id = {type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$'};
const ajv = new Ajv2020({strict: true});
// The Claude Code version is optional information; no version is required or compared (Hub #2122).
const common = {version: {type: 'string', pattern: '^[A-Za-z0-9_.+-]{1,64}$'}, surface: {enum: [...CLAUDE_READ_SURFACES]}};
const validInput = ajv.compile<Input>({oneOf: [
  {type: 'object', additionalProperties: false, required: ['action', 'surface', 'sessionId', 'promptId'],
    properties: {...common, action: {const: 'bind'}, sessionId: id, promptId: id}},
  {type: 'object', additionalProperties: false, required: ['action', 'surface', 'target'],
    properties: {...common, action: {const: 'read'}, target: {type: 'object'}}},
]});
const validFeed = ajv.compile<ReceiptFeed & {feed: string}>({type: 'object', additionalProperties: false,
  required: ['provider', 'client', 'hostId', 'sourceId', 'feed'], properties: {
    provider: {const: 'claude'}, client: {const: 'code'}, hostId: id, sourceId: id, feed: {const: CLAUDE_RECEIPT_FEED},
  }});
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SdkError(errorBody('unavailable')));
  return new Promise((resolve, reject) => {
    const aborted = () => {reject(new SdkError(errorBody('unavailable')));};
    signal.addEventListener('abort', aborted, {once: true});
    void work.then(resolve, reject).finally(() => {signal.removeEventListener('abort', aborted);});
  });
}

/** One explicit UI operation. A lost stream or deadline abandons it; nothing automatically retries a read action. */
export async function runReadHelper(path: string, raw: unknown, timeoutMs = 2400): Promise<ReadHelperResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {controller.abort();}, timeoutMs);
  let participant: RemoteParticipant | undefined;
  let sent = false;
  try {
    if (!validInput(raw)) return {status: 'unavailable', ...errorBody('invalid-request')};
    const input = raw;
    const producer = await bounded(readProducer(path), controller.signal);
    if (producer === undefined || producer.lifecycleVersion !== undefined || !validFeed(producer.configuration)) {
      return {status: 'unavailable', ...errorBody('forbidden')};
    }
    const {provider, client, hostId, sourceId} = producer.configuration;
    const feed = {provider, client, hostId, sourceId}, source = receiptSource(feed);
    let target: Message<ReadReceiptObservation> | undefined;
    if (input.action === 'read') {
      const checked = readReceiptValidator().validate<Lifecycle21Observation>(input.target);
      if (!checked.ok || checked.value.dataschema !== READ_RECEIPT_SCHEMA || !isReadReceipt(checked.value.data) ||
        checked.value.source !== source || checked.value.data.event.receipt.kind !== 'owned-ui') {
        return {status: 'unavailable', ...errorBody('invalid-message')};
      }
      target = {...checked.value, data: checked.value.data};
      if (receiptSource(target.data.identity) !== source) return {status: 'unavailable', ...errorBody('forbidden')};
    }
    const connection = connectRemote({url: producer.edge, token: producer.token, source,
      onError: () => {controller.abort();},
      onDiagnostic: diagnostic => {if (diagnostic.event === 'remote.disconnected') controller.abort();},
    });
    // Also close a connection which opens after the deadline ended this call.
    void connection.then(opened => {if (controller.signal.aborted) void opened.close();}, () => {});
    participant = await bounded(connection, controller.signal);
    const identity = input.action === 'bind' ? {...feed, sessionId: input.sessionId} : target?.data.identity;
    if (identity === undefined) return {status: 'unavailable', ...errorBody('invalid-message')};
    const entity = sessionEntityId(identity);
    let confirmed: (() => void) | undefined;
    const confirmation = new Promise<void>(resolve => {confirmed = resolve;});
    const matches = (view: SessionView | undefined): boolean => {
      const receipt = target?.data.event.receipt, read = view?.outcome.readReceipt;
      return receipt?.kind === 'owned-ui' && view?.id === entity && view.outcome.read === 'read' &&
        view.generation === target?.data.event.generation && view.turn.status === 'known' &&
        target.data.turn.status === 'known' && view.turn.id === target.data.turn.id &&
        read?.source === source && read.noticeId === target?.data.event.noticeId &&
        read.receipt.kind === 'owned-ui' && read.receipt.viewRevision === receipt.viewRevision;
    };
    const synced = await bounded(participant.sync<object>(['session'], change => {
      if (change.type === 'failed') controller.abort();
      if (change.type === 'updated' && matches(coreSession(change.message))) confirmed?.();
    }, {timeoutMs, owner: 'bunny/core', onRestarted: () => {controller.abort();}}), controller.signal);
    if (synced.status !== 'synced') return {status: 'unavailable', ...synced.error};
    const current = coreSession(synced.copy.get({family: 'session', id: entity}));
    if (input.action === 'bind') {
      if (current === undefined || current.turn.status !== 'known' || current.turn.id !== input.promptId || current.parent.status === 'known' ||
        (current.work.state !== 'idle' && current.work.state !== 'interrupted')) return {status: 'unavailable', ...errorBody('invalid-state')};
      const turn = current.turn, notice = current.outcome.notices.find(item => item.turn.status === 'known' && item.turn.id === turn.id);
      if (notice === undefined) return {status: 'unavailable', ...errorBody('invalid-state')};
      const data: ReadReceiptObservation = {identity: current.identity, turn, parent: {status: 'unknown'}, observedAtMs: Date.now(), ordering: {status: 'unknown'},
        event: {kind: 'read-receipt-observed', generation: current.generation, noticeId: notice.id,
          receipt: {kind: 'owned-ui', viewRevision: viewRevision(current)}}};
      return {status: 'ready', target: prepareMessage(source, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject: entity, dataschema: READ_RECEIPT_SCHEMA, data}, {parent: synced.message})};
    }
    if (target === undefined || target.data.event.receipt.kind !== 'owned-ui') return {status: 'unavailable', ...errorBody('invalid-message')};
    if (matches(current)) return {status: 'confirmed'};
    if (current === undefined || target.data.event.receipt.viewRevision !== viewRevision(current)) return {status: 'unavailable', ...errorBody('revision-conflict')};
    const message = prepareMessage(source, {kind: 'occurrence', type: target.type, subject: entity,
      dataschema: READ_RECEIPT_SCHEMA, data: {...target.data, observedAtMs: Date.now()}}, {parent: target});
    sent = true;
    const published = await bounded(publishOnce({url: producer.edge, token: producer.token, source, timeoutMs}, `bunny.event.lifecycle.${entity}`, message), controller.signal);
    if (published.status !== 'published') return {status: published.status === 'uncertain' ? 'unconfirmed' : 'unavailable', ...published.error};
    await bounded(confirmation, controller.signal);
    return {status: 'confirmed'};
  } catch (error) {
    return {status: sent ? 'unconfirmed' : 'unavailable', ...(sent ? errorBody('uncertain-result') : error instanceof SdkError ? error.body : errorBody('unavailable'))};
  } finally {
    clearTimeout(timer);
    await participant?.close().catch(() => {});
  }
}
