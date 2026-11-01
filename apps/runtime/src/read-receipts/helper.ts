import {Ajv2020} from 'ajv/dist/2020.js';
import {MessageValidator, errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, registerReadReceiptFamily, type Lifecycle21Observation, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {connectRemote, prepareMessage, publishOnce, SdkError, type RemoteParticipant} from '@jimmie-potts/sdk';
import {readProducer} from '../hook/producer.js';
import {CLAUDE_RECEIPT_FEED, CLAUDE_TERMINAL_VERSION, isReadReceipt, receiptSource, viewRevision, type ReceiptFeed} from './qualification.js';
export {CLAUDE_RECEIPT_FEED, CLAUDE_TERMINAL_VERSION, receiptSource} from './qualification.js';

type Input = {action: 'bind'; version: string; surface: 'terminal'; sessionId: string; promptId: string}
  | {action: 'read'; version: string; surface: 'terminal'; target: object};
export type ReadHelperResult = {status: 'ready'; target: Message<ReadReceiptObservation>}
  | {status: 'confirmed'} | {status: 'unavailable' | 'unconfirmed'; error: ErrorBody['error']};
const id = {type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$'};
const ajv = new Ajv2020({strict: true});
const common = {version: {const: CLAUDE_TERMINAL_VERSION}, surface: {const: 'terminal'}};
const validInput = ajv.compile<Input>({oneOf: [
  {type: 'object', additionalProperties: false, required: ['action', 'version', 'surface', 'sessionId', 'promptId'],
    properties: {...common, action: {const: 'bind'}, sessionId: id, promptId: id}},
  {type: 'object', additionalProperties: false, required: ['action', 'version', 'surface', 'target'],
    properties: {...common, action: {const: 'read'}, target: {type: 'object'}}},
]});
const validFeed = ajv.compile<ReceiptFeed & {feed: string}>({type: 'object', additionalProperties: false,
  required: ['provider', 'client', 'hostId', 'sourceId', 'feed'], properties: {
    provider: {const: 'claude'}, client: {const: 'code'}, hostId: id, sourceId: id, feed: {const: CLAUDE_RECEIPT_FEED},
  }});
const validator = new MessageValidator();
registerCoreFamilies(validator);
registerReadReceiptFamily(validator);

function session(message: unknown): SessionRecord | undefined {
  const checked = validator.validate<SessionRecord>(message);
  return checked.ok && checked.value.source === 'bunny/core' && checked.value.kind === 'state' &&
    checked.value.type === 'org.bunny.session.updated' &&
    ['https://bunny.invalid/events/session/2.0', 'https://bunny.invalid/events/session/2.1'].includes(checked.value.dataschema)
    ? checked.value.data : undefined;
}

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
      const checked = validator.validate<Lifecycle21Observation>(input.target);
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
    const matches = (record: SessionRecord | undefined): boolean => {
      const receipt = target?.data.event.receipt;
      return receipt?.kind === 'owned-ui' && record?.id === entity && record.read === 'read' &&
        record.generation === target?.data.event.generation && record.turn.status === 'known' &&
        target.data.turn.status === 'known' && record.turn.id === target.data.turn.id &&
        record.readReceipt?.source === source && record.readReceipt.noticeId === target?.data.event.noticeId &&
        record.readReceipt.receipt.kind === 'owned-ui' && record.readReceipt.receipt.viewRevision === receipt.viewRevision;
    };
    const synced = await bounded(participant.sync<object>(['session'], change => {
      if (change.type === 'failed') controller.abort();
      if (change.type === 'updated' && matches(session(change.message))) confirmed?.();
    }, {timeoutMs, owner: 'bunny/core', onRestarted: () => {controller.abort();}}), controller.signal);
    if (synced.status !== 'synced') return {status: 'unavailable', ...synced.error};
    const current = session(synced.copy.get({family: 'session', id: entity}));
    if (input.action === 'bind') {
      if (current === undefined || current.turn.status !== 'known' || current.turn.id !== input.promptId || current.parent.status === 'known' ||
        (current.activity !== 'idle' && current.activity !== 'interrupted')) return {status: 'unavailable', ...errorBody('invalid-state')};
      const turn = current.turn, notice = current.notices.find(item => item.turn.status === 'known' && item.turn.id === turn.id);
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
