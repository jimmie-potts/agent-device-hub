import {createHash} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {connectRemote, prepareMessage, publishOnce, type RemoteParticipant, type SyncedCopy} from '@jimmie-potts/sdk';
import {canonical, readProducer} from '../hook/producer.js';
import {CODEX_RECEIPT_FEED, codexReceiptSource, type ReceiptFeed} from './qualification.js';
import type {AcceptedCodexRead, CodexReadTarget} from './codex-observer.js';
import {coreSession} from './session.js';

export type CodexReadPublisher = {
  bind(threadId: string, turnId: string): CodexReadTarget | undefined;
  accept(receipt: AcceptedCodexRead): void;
  close(): Promise<void>;
};

const id = {type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$'};
const validFeed = new Ajv2020({strict: true}).compile<ReceiptFeed & {feed: string}>({
  type: 'object', additionalProperties: false, required: ['provider', 'client', 'hostId', 'sourceId', 'feed'],
  properties: {provider: {const: 'codex'}, client: {const: 'local'}, hostId: id, sourceId: id, feed: {const: CODEX_RECEIPT_FEED}},
});
/** A session state message the core published, with its view, or undefined for anything `coreSession` does not accept. */
function session(message: Message<object> | undefined): {message: Message<object>; view: SessionView} | undefined {
  const view = coreSession(message);
  return message === undefined || view === undefined ? undefined : {message, view};
}

/** Opens a live owner copy, never polling or replaying native actions missed during an outage. */
export async function openCodexReadPublisher(path: string, onGap: () => void, timeoutMs = 2400): Promise<CodexReadPublisher | undefined> {
  let participant: RemoteParticipant | undefined, copy: SyncedCopy<object> | undefined;
  let fresh = false, closed = false, sending = 0;
  const invalidate = () => {fresh = false; try {onGap();} catch { /* Collection remains unavailable. */ }};
  const close = async () => {closed = true; invalidate(); await participant?.close().catch(() => {});};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {timer = setTimeout(() => {void close(); reject(new Error('unavailable'));}, timeoutMs);});
  const bounded = <T>(work: Promise<T>) => Promise.race([work, deadline]);
  try {
    const producer = await bounded(readProducer(path));
    if (producer === undefined || producer.lifecycleVersion !== undefined || !validFeed(producer.configuration)) return undefined;
    const {provider, client, hostId, sourceId} = producer.configuration, feed = {provider, client, hostId, sourceId};
    const source = codexReceiptSource(feed);
    const connection = connectRemote({url: producer.edge, token: producer.token, source, maxQueued: 128,
      onError: invalidate, onDiagnostic: diagnostic => {if (diagnostic.event === 'remote.disconnected') invalidate();},
    });
    void connection.then(opened => {if (closed) void opened.close();}, () => {});
    participant = await bounded(connection);
    const synced = await bounded(participant.sync<object>(['session'], change => {
      if (change.type === 'synced' && !closed) fresh = true;
      if (change.type === 'failed') invalidate();
    }, {owner: 'bunny/core', timeoutMs, maxBuffered: 128, onRestarted: invalidate}));
    if (synced.status !== 'synced' || closed) {await close(); return undefined;}
    copy = synced.copy;

    const current = (threadId: string) => fresh && !closed ? session(copy?.get({family: 'session', id: sessionEntityId({...feed, sessionId: threadId})})) : undefined;
    const bind = (threadId: string, turnId: string): CodexReadTarget | undefined => {
      const view = current(threadId)?.view;
      if (view === undefined || view.identity.provider !== provider || view.identity.client !== client ||
        view.identity.hostId !== hostId || view.identity.sourceId !== sourceId || view.identity.sessionId !== threadId ||
        view.turn.status !== 'known' || view.turn.id !== turnId || view.parent.status === 'known' ||
        (view.work.state !== 'idle' && view.work.state !== 'interrupted')) return undefined;
      const notice = view.outcome.notices.find(item => item.kind === 'turn-ended' && item.turn.status === 'known' && item.turn.id === turnId);
      return notice === undefined ? undefined : {identity: {...view.identity}, turnId, generation: view.generation, noticeId: notice.id};
    };
    return {bind, close, accept: receipt => {
      const target = receipt.target, latest = bind(target.identity.sessionId, target.turnId);
      if (sending >= 4 || latest === undefined || canonical(latest) !== canonical(target) ||
        receipt.seenRevision === receipt.acceptedRevision || Date.now() - receipt.observedAtMs >= 30_000) return;
      const data: ReadReceiptObservation = {identity: target.identity, turn: {status: 'known', id: target.turnId},
        parent: {status: 'unknown'}, observedAtMs: receipt.observedAtMs, ordering: {status: 'unknown'},
        event: {kind: 'read-receipt-observed', generation: target.generation, noticeId: target.noticeId,
          receipt: {kind: 'provider-client', client: 'desktop', seenRevision: receipt.seenRevision, acceptedRevision: receipt.acceptedRevision}}};
      const subject = sessionEntityId(target.identity), parent = current(target.identity.sessionId)?.message;
      const message = prepareMessage(source, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: READ_RECEIPT_SCHEMA, data},
        parent === undefined ? {} : {parent});
      message.id = createHash('sha256').update(canonical({source, target, seen: receipt.seenRevision, accepted: receipt.acceptedRevision})).digest('hex');
      sending += 1;
      // No retries or queue: uncertain publication remains uncertain, and a gap discards other pending native actions.
      void publishOnce({url: producer.edge, source, token: producer.token, timeoutMs}, `bunny.event.lifecycle.${subject}`, message)
        .then(result => {if (result.status !== 'published') invalidate();}, invalidate).finally(() => {sending -= 1;});
    }};
  } catch {await close(); return undefined;}
  finally {clearTimeout(timer);}
}
