// The core alone mints coding opportunities from the first publication of a committed live reduction (Hub #1096).
// It also forwards the companions module's approved assistant commands to its tracked dispatcher (Hub #46): only the
// allowlisted family and target below, only from that module, as one operation the module requested.
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {followCopy, recordLog, SdkError, Outcome, type Sdk, type SyncedCopy} from '@jimmie-potts/sdk';
import {OPPORTUNITY_TTL_MS, type CompanionOpportunity, type SpeechDispatch} from '@jimmie-potts/event-contracts/v2/companions';
import {ASSISTANT_LIGHT_OWNER, type AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingDispatch, CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {NATIVE_SOURCE} from '@jimmie-potts/event-contracts/v2/sources';
import {coreValidator, type AgentOccurrence, type AttentionRaised, type Session30Record, type TurnEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreChange} from './store.js';
import {dispatchCatalogAction} from './assistant-actions.js';
import type {Action, ActionAnswer} from './tracker.js';
import type {InboxRecords} from './inbox.js';
import {LivePublication} from './live-publication.js';

const COMPANIONS = 'bunny/modules/companions';
const CODING_STATE = 'coding-state';
const TYPES = new Set(['org.bunny.attention.raised', 'org.bunny.turn.ended']);
export class CompanionPart implements CorePart {
  readonly #eligibility = new LivePublication();
  readonly #sessions = new Map<string, Session30Record>();
  #closed = false;
  #coding: SyncedCopy<CodingState> | undefined;
  #codingFresh = false;
  #stopCodingCopy: (() => void) | undefined;
  constructor(private readonly dispatchOperator: (action: Action) => Promise<ActionAnswer> = () => Promise.resolve(errorBody('unavailable')),
    private readonly handleInbox: InboxRecords['handle'] = () => Promise.resolve(errorBody('unavailable'))) {}
  /** Starts the session copy from every record the core store holds once it opens (#1865 step 8). */
  seed(records: readonly Session30Record[]): void {
    this.#sessions.clear();
    for (const record of records) this.#sessions.set(record.id, record);
  }
  committed(change: CoreChange): void {
    for (const message of change.messages) {
      if (message.kind === 'state' && message.type === 'org.bunny.session.updated') this.#sessions.set(message.subject, message.data as Session30Record);
      if (message.kind === 'removal') this.#sessions.delete(message.subject);
    }
    this.#eligibility.committed(change.messages, TYPES);
  }
  publishing(message: Message<unknown>): () => void {return this.#eligibility.publishing(message);}
  publicationEnded(change: CoreChange): void {this.#eligibility.ended(change.messages);}
  /** Starts only after the host verifies that the coding-state owner actually serves sync. */
  followCodingSelection(sdk: Sdk): void {
    if (this.#closed || this.#stopCodingCopy !== undefined) return;
    this.#stopCodingCopy = followCopy<CodingState>(
      (changed, {onRestarted}) => sdk.sync([CODING_STATE], changed, {owner: COMPANIONS, timeoutMs: 5000, onRestarted}),
      {
        changed: change => {if (change.type === 'synced') this.#codingFresh = true;},
        current: copy => {this.#coding = copy;},
        restarted: () => {this.#codingFresh = false;},
        refused: () => {this.#codingFresh = false; this.#coding = undefined;},
      },
    );
  }
  async start(core: CoreHandle): Promise<void> {
    const validator = coreValidator();
    await core.sdk.respond<{requestId:string;target:string;gesture:'notice'|'attention';opportunityId:string;validUntilMs:number;expectedConfigurationRevision:number;expectedGeneration:{epoch:string;sequence:number}}>('bunny.cmd.reachy-dispatch.reachy', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/reachy-mini') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      const {target, ...data} = command.data;
      const answer = await core.dispatch({key: 'bunny.cmd.reachy-auto.' + target, requestedBy: command.source, requestId: command.data.requestId, parent: command,
        draft: {type: 'org.bunny.reachy.auto.requested', subject: target, dataschema: 'https://bunny.invalid/events/reachy-auto/2.0', data}});
      return 'error' in answer ? answer : {status:'accepted'};
    });
    await core.sdk.respond<{requestId:string;target:string;gesture:'notice'|'attention';opportunityId:string;validUntilMs:number;expectedConfigurationRevision:number;expectedGeneration:{epoch:string;sequence:number}}>('bunny.cmd.microduck-dispatch.microduck', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/microduck') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      const {target, ...data} = command.data;
      const answer = await core.dispatch({key: 'bunny.cmd.microduck-auto.' + target, requestedBy: command.source, requestId: command.data.requestId, parent: command,
        draft: {type: 'org.bunny.microduck.auto.requested', subject: target, dataschema: 'https://bunny.invalid/events/microduck-auto/2.0', data}});
      return 'error' in answer ? answer : {status:'accepted'};
    });
    await core.sdk.respond<SpeechDispatch>('bunny.cmd.companion-speech-dispatch.reachy', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      const answer = await core.dispatch({key: 'bunny.cmd.companion-speech-play.reachy', requestedBy: command.source,
        requestId: command.data.requestId, parent: command,
        draft: {type: 'org.bunny.companion-speech.play.requested', subject: 'reachy',
          dataschema: 'https://bunny.invalid/events/companion-speech-play/2.0', data: command.data}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
    // A delegation (Hub #502) is one tracked operation the module requested: the core forwards it to the module's own
    // coding-run responder, which hands it to the worker endpoint; the tracked effect is "handed to the worker".
    await core.sdk.respond<CodingDispatch>('bunny.cmd.coding-dispatch.assistant', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      const record = this.#codingFresh ? this.#coding?.get({family: CODING_STATE, id: 'coding'}) : undefined;
      const state = record !== undefined && validator.validate(record).ok ? record.data : undefined;
      const selectedWorker = state?.workers?.find(worker => worker.endpointId === command.data.endpointId);
      const legacySelection = state?.availability === 'available' && state.endpointId === command.data.endpointId ? state : undefined;
      const selectionId = selectedWorker?.selectionId ?? legacySelection?.selectionId;
      if ((state?.workers !== undefined && selectedWorker === undefined && legacySelection === undefined) ||
        (command.data.harness !== undefined && selectedWorker === undefined && (legacySelection === undefined ||
          (legacySelection.capacity === 'uncapped' && selectionId === undefined)))) {
        return errorBody('unavailable', {detail: 'the selected worker could not be verified'});
      }
      if (command.data.continuation !== undefined && selectionId === undefined) return errorBody('unavailable');
      const version = command.data.continuation !== undefined ? '2.3' : selectionId === undefined ? command.data.harness === undefined ? '2.0' : '2.1' : '2.2';
      const answer = await core.dispatch({key: 'bunny.cmd.coding-run.assistant', requestedBy: command.source, requestId: command.data.requestId, parent: command,
        draft: {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: `https://bunny.invalid/events/coding-run/${version}`, data: {...command.data, ...(selectionId === undefined ? {} : {selectionId})}}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
    await core.sdk.respond<AssistantDispatch>('bunny.cmd.assistant-dispatch.assistant', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      if (command.data.family === 'catalog-action') {
        const answer = await dispatchCatalogAction(core, {...command, data: command.data}, this.dispatchOperator, async (action, input) => {
          const result = await this.handleInbox(core, {target: action.draft.subject, input, source: command.source, parent: command, resendId: input.requestId});
          return 'error' in result ? result : {status: 'accepted', requestId: input.requestId};
        });
        return 'error' in answer ? answer : {status: 'accepted'};
      }
      const action = command.data;
      const {family, target, requestId} = action;
      const type = family === 'mode-set' ? 'org.bunny.mode.set.requested' : family === 'power-set' ? 'org.bunny.power.set.requested' : 'org.bunny.brightness.set.requested';
      const answer = await core.dispatch({key: `bunny.cmd.${family}.${target}`, requestedBy: command.source, requestId, parent: command,
        ...(family === 'mode-set' ? {} : {deviceAdmission: {kind: 'conversation', owner: 'owner' in action ? action.owner : ASSISTANT_LIGHT_OWNER, expiresAt: command.expiresat}}),
        draft: {type, subject: target, dataschema: `https://bunny.invalid/events/${family}/2.0`, data: action.data}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
    await Promise.all(['attention-raised', 'turn-ended'].map(family => core.sdk.subscribe<AgentOccurrence>(`bunny.event.${family}.*`, async message => {
      if (this.#closed || message.source !== core.sdk.source || !this.#eligibility.take(message.id)) return;
      const data = message.data, record = this.#sessions.get(data.session);
      // No coding opportunity for a native assistant conversation in this slice (Hub #505, owner decision 4): Conversation
      // speaks its own question and result. This predicate is the whole exclusion, so a later companion-opportunity
      // version can lift it.
      if (data.identity.provider === NATIVE_SOURCE.provider) return;
      const occurredAtMs = data.occurredAtMs ?? null;
      const at = Math.min(data.observedAtMs, occurredAtMs ?? data.observedAtMs);
      // The window keeps the reporting host's clock (Hub #1865, decision 2): an instant after the hub's now, or one 30
      // seconds or more before it, raises nothing. Unconfirmed work, a restart or silence never withholds it.
      if (record === undefined || data.observedAtMs > core.clock.now() || (occurredAtMs !== null && occurredAtMs > core.clock.now()) || core.clock.now() >= at + OPPORTUNITY_TTL_MS) return;
      const attention = message.type === 'org.bunny.attention.raised' ? (data as AttentionRaised).attention : null;
      const opportunity: CompanionOpportunity = {
        origin: {id: message.id, source: message.source, type: message.type}, sourceKind: 'coding', context: 'live',
        category: attention === null ? 'coding-notice' : 'coding-attention', cue: attention?.kind ?? 'turn-ended',
        revision: data.revision, generation: record.generation, session: data.session, identity: data.identity, turn: data.turn, attention,
        noticeId: (data as TurnEnded).noticeId ?? null, evidence: 'lifecycle-metadata', occurredAtMs, observedAtMs: data.observedAtMs, validUntilMs: at + OPPORTUNITY_TTL_MS,
        busy: null, media: null, visitor: null, location: null,
      };
      try {
        await core.sdk.publish('bunny.event.companion-opportunity.reachy', {kind: 'occurrence', type: 'org.bunny.companion-opportunity.raised',
          subject: 'reachy', dataschema: 'https://bunny.invalid/events/companion-opportunity/2.0', data: opportunity}, {parent: message});
      } catch (error) {
        // Optional delivery cannot block or change the original core attention. Eligibility is already consumed.
        const code = error instanceof SdkError ? error.body.error.code : 'internal';
        recordLog(core.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': code}, message);
      }
    }, {onOverflow: () => {this.#eligibility.clear();}})));
  }
  close(): void {
    this.#closed = true;
    this.#stopCodingCopy?.();
    this.#coding = undefined;
    this.#codingFresh = false;
    this.#eligibility.clear();
    this.#sessions.clear();
  }
}
