import {MessageValidator, SCHEMA_BASE, type ErrorDetail} from './index.js';
import {coreFamilies, registerCoreFamilies, sessionEntityId, type Identity, type LifecycleObservation, type Ordering, type SessionRecord} from './families.js';
import {defineFamily, registerFamilies} from './registry.js';

/** Opaque revisions identify an observed action; they are neither clocks nor proof of human comprehension. */
export type ReadReceipt =
  | {kind: 'provider-client'; client: 'desktop'; seenRevision: string; acceptedRevision: string}
  | {kind: 'owned-ui'; viewRevision: string};

/** Freeze the owner's target at the action. Never rebind a delayed receipt to a newer turn or notice. */
export type ReadReceiptObservation = {
  identity: Identity; turn: {status: 'known'; id: string}; parent: {status: 'unknown'};
  event: {kind: 'read-receipt-observed'; generation: number; noticeId: string; receipt: ReadReceipt};
  observedAtMs: number; ordering: Ordering;
};
export type Lifecycle21Observation = LifecycleObservation | ReadReceiptObservation;
export const SESSION_RECEIPT_SCHEMA = `${SCHEMA_BASE}session/2.1`;
export const READ_RECEIPT_SCHEMA = `${SCHEMA_BASE}lifecycle/2.1`;

const lifecycleCheck = coreFamilies.find(family => family.dataschema === `${SCHEMA_BASE}lifecycle/2.0`)?.check;
if (lifecycleCheck === undefined) throw new Error('lifecycle/2.0 semantic check is required');
const receiptFamily = defineFamily('lifecycle', 'occurrence', 'org.bunny.lifecycle.observed', lifecycleCheck, '2.1');

/** Default core-family/SDK registration excludes this extension; the adopting runtime calls this explicitly afterward. */
export function registerReadReceiptFamily(validator: MessageValidator): void {
  registerFamilies(validator, [receiptFamily]);
}

/** Trusted caller input. The receiver must establish authenticated source and version qualification separately. */
export type ReadReceiptQualification = {
  source: string;
  feed: Pick<Identity, 'provider' | 'client' | 'hostId' | 'sourceId'>;
  kind: ReadReceipt['kind'];
};
export type ReceiptSession = Pick<SessionRecord, 'identity' | 'generation' | 'turn' | 'parent' | 'activity' | 'notices'>;
export type ReadReceiptDecision =
  | {status: 'invalid'; error: ErrorDetail}
  | {status: 'ineligible'; reason: 'not-receipt' | 'unqualified-source' | 'unknown-session' | 'stale-target' | 'unfinished' | 'child'}
  | {status: 'eligible'; noticeId: string};

let receiptValidator: MessageValidator | undefined;
function validator(): MessageValidator {
  if (receiptValidator === undefined) {
    receiptValidator = new MessageValidator();
    registerCoreFamilies(receiptValidator);
    registerReadReceiptFamily(receiptValidator);
  }
  return receiptValidator;
}

/**
 * Pure eligibility reference, not a state transition. A later owner must recheck inside its serialized operation.
 * Source qualification is independent of payload validity. Lifecycle freshness and attention are not read evidence.
 */
export function decideReadReceipt(input: unknown, session: ReceiptSession | undefined,
  qualification: ReadReceiptQualification | undefined): ReadReceiptDecision {
  const result = validator().validate<Lifecycle21Observation>(input);
  if (!result.ok) return {status: 'invalid', error: result.error};
  const {data, source, dataschema} = result.value;
  if (dataschema !== READ_RECEIPT_SCHEMA || data.event.kind !== 'read-receipt-observed') {
    return {status: 'ineligible', reason: 'not-receipt'};
  }
  const {identity, event, turn} = data;
  if (qualification === undefined || qualification.source !== source || qualification.kind !== event.receipt.kind ||
    qualification.feed.provider !== identity.provider || qualification.feed.client !== identity.client ||
    qualification.feed.hostId !== identity.hostId || qualification.feed.sourceId !== identity.sourceId) {
    return {status: 'ineligible', reason: 'unqualified-source'};
  }
  if (session === undefined) return {status: 'ineligible', reason: 'unknown-session'};
  if (sessionEntityId(session.identity) !== sessionEntityId(identity) || session.generation !== event.generation ||
    turn.status !== 'known' || session.turn.status !== 'known' || session.turn.id !== turn.id ||
    !session.notices.some(notice => notice.id === event.noticeId && notice.kind === 'turn-ended' &&
      notice.turn.status === 'known' && notice.turn.id === turn.id)) {
    return {status: 'ineligible', reason: 'stale-target'};
  }
  if (session.parent.status === 'known') return {status: 'ineligible', reason: 'child'};
  if (session.activity !== 'idle' && session.activity !== 'interrupted') return {status: 'ineligible', reason: 'unfinished'};
  return {status: 'eligible', noticeId: event.noticeId};
}
