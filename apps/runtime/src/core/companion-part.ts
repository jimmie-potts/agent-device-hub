// The core alone mints coding opportunities from the first publication of a committed live reduction (Hub #1096).
import {MessageValidator, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {recordLog, SdkError, Outcome} from '@jimmie-potts/sdk';
import {OPPORTUNITY_TTL_MS, type CompanionOpportunity, type SpeechDispatch} from '@jimmie-potts/event-contracts/v2/companions';
import {registerCoreFamilies, type AgentOccurrence, type AttentionRaised, type SessionRecord, type TurnEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreChange} from './store.js';
import {LivePublication} from './live-publication.js';

const TYPES = new Set(['org.bunny.attention.raised', 'org.bunny.turn.ended']);
export class CompanionPart implements CorePart {
  readonly #eligibility = new LivePublication();
  readonly #sessions = new Map<string, SessionRecord>();
  #closed = false;
  committed(change: CoreChange): void {
    for (const message of change.messages) {
      if (message.kind === 'state' && message.type === 'org.bunny.session.updated') this.#sessions.set(message.subject, message.data as SessionRecord);
      if (message.kind === 'removal') this.#sessions.delete(message.subject);
    }
    this.#eligibility.committed(change.messages, TYPES);
  }
  publishing(message: Message<unknown>): () => void {return this.#eligibility.publishing(message);}
  publicationEnded(change: CoreChange): void {this.#eligibility.ended(change.messages);}
  async start(core: CoreHandle): Promise<void> {
    const validator = new MessageValidator(); registerCoreFamilies(validator);
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
    await Promise.all(['attention-raised', 'turn-ended'].map(family => core.sdk.subscribe<AgentOccurrence>(`bunny.event.${family}.*`, async message => {
      if (this.#closed || message.source !== core.sdk.source || !this.#eligibility.take(message.id)) return;
      const data = message.data, record = this.#sessions.get(data.session);
      const occurredAtMs = data.occurredAtMs ?? null;
      const at = Math.min(data.observedAtMs, occurredAtMs ?? data.observedAtMs);
      if (record === undefined || record.freshness !== 'current' || record.restartUncertain || data.observedAtMs > core.clock.now() || (occurredAtMs !== null && occurredAtMs > core.clock.now()) || core.clock.now() >= at + OPPORTUNITY_TTL_MS) return;
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
