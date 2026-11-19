// The core alone mints coding opportunities from the first publication of a committed live reduction (Hub #1096).
// It also forwards the companions module's approved assistant commands to its tracked dispatcher (Hub #46): only the
// allowlisted family and target below, only from that module, as one operation the module requested.
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {recordLog, SdkError, Outcome} from '@jimmie-potts/sdk';
import {OPPORTUNITY_TTL_MS, type CompanionOpportunity, type SpeechDispatch} from '@jimmie-potts/event-contracts/v2/companions';
import {ASSISTANT_LIGHT_OWNER, type AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {CodingDispatch} from '@jimmie-potts/event-contracts/v2/coding';
import {coreValidator, type AgentOccurrence, type AttentionRaised, type Session30Record, type TurnEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreChange} from './store.js';
import {dispatchCatalogAction} from './assistant-actions.js';
import type {Action, ActionAnswer} from './tracker.js';
import {LivePublication} from './live-publication.js';

const TYPES = new Set(['org.bunny.attention.raised', 'org.bunny.turn.ended']);
export class CompanionPart implements CorePart {
  readonly #eligibility = new LivePublication();
  readonly #sessions = new Map<string, Session30Record>();
  #closed = false;
  constructor(private readonly device: (id: string) => Message<DeviceRecord> | undefined = () => undefined,
    private readonly dispatchLighting: (action: Action) => Promise<ActionAnswer> = () => Promise.resolve(errorBody('unavailable'))) {}
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
      const answer = await core.dispatch({key: 'bunny.cmd.coding-run.assistant', requestedBy: command.source, requestId: command.data.requestId, parent: command,
        draft: {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
    await core.sdk.respond<AssistantDispatch>('bunny.cmd.assistant-dispatch.assistant', async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      if (command.data.family === 'catalog-action') {
        const answer = await dispatchCatalogAction(core, {...command, data: command.data}, this.device, this.dispatchLighting);
        return 'error' in answer ? answer : {status: 'accepted'};
      }
      const action = command.data;
      const {family, target, requestId} = action;
      if (family !== 'mode-set' && core.operation(requestId) === undefined) {
        const message = this.device(target);
        if (message === undefined) return errorBody('unavailable');
        if (message.source !== ('owner' in action ? action.owner : ASSISTANT_LIGHT_OWNER)) return errorBody('forbidden');
        const record = message.data;
        const capability = family === 'power-set' ? record.capabilities.power : record.capabilities.brightness;
        if (!capability.supported) return errorBody('unsupported-capability');
        const {expectedConfigurationRevision, expectedGeneration} = action.data;
        if (record.configurationRevision !== expectedConfigurationRevision || record.generation.epoch !== expectedGeneration.epoch ||
          record.generation.sequence !== expectedGeneration.sequence) return errorBody('revision-conflict');
        if (record.availability !== 'available' || record.held !== undefined) return errorBody('unavailable');
      }
      const type = family === 'mode-set' ? 'org.bunny.mode.set.requested' : family === 'power-set' ? 'org.bunny.power.set.requested' : 'org.bunny.brightness.set.requested';
      const answer = await core.dispatch({key: `bunny.cmd.${family}.${target}`, requestedBy: command.source, requestId, parent: command,
        draft: {type, subject: target, dataschema: `https://bunny.invalid/events/${family}/2.0`, data: action.data}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
    await Promise.all(['attention-raised', 'turn-ended'].map(family => core.sdk.subscribe<AgentOccurrence>(`bunny.event.${family}.*`, async message => {
      if (this.#closed || message.source !== core.sdk.source || !this.#eligibility.take(message.id)) return;
      const data = message.data, record = this.#sessions.get(data.session);
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
  close(): void {this.#closed = true; this.#eligibility.clear(); this.#sessions.clear();}
}
