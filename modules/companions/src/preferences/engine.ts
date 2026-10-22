import {createHash, randomUUID} from 'node:crypto';
import {MessageValidator, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {AssistantInput} from '@jimmie-potts/event-contracts/v2/assistant';
import type {PreferenceState} from '@jimmie-potts/event-contracts/v2/companions';
import {Outcome, fullDisk, type Command, type ModuleContent, type ModuleContentRequest, type ModuleContext, type ModuleStagedUpload,
  type ModuleUploadRequest, type Outbox, type Reply, type Subscription} from '@jimmie-potts/sdk';
import {PreferenceStore} from './store.js';
import {PreferenceFault, fail, id, inputOf} from './validation.js';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const codeOf = (error: unknown) => error instanceof PreferenceFault ? error.code : fullDisk(error) ? 'capacity' : 'internal';
const CONTROL_MS = 5000;
export const PREFERENCE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const preferenceStateDraft = (data: PreferenceState) => ({kind: 'state' as const, type: 'org.bunny.preference-state.updated',
  subject: 'preferences', dataschema: 'https://bunny.invalid/events/preference-state/2.0', data});

/** Explicit owner input only. No provider, background learning or device authority. */
export class Preferences {
  readonly store: PreferenceStore;
  readonly #validator = new MessageValidator();
  #subscription: Subscription | undefined;
  #closed = false;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox) {
    this.store = new PreferenceStore(context.database()); registerCoreFamilies(this.#validator);
  }
  inspect(): PreferenceState {return {id: 'preferences', revision: this.store.revision()};}
  async start(): Promise<void> {this.#subscription = await this.context.sdk.respond<AssistantInput>('bunny.cmd.assistant-input.preferences', command => this.#input(command));}
  async stop(): Promise<void> {this.#closed = true; await this.#subscription?.close();}
  stage(request: ModuleUploadRequest): ModuleStagedUpload | ErrorBody {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (request.target !== 'preferences' || request.name !== 'preferences.json' || !id(request.requestId) || request.signal.aborted || request.bytes.byteLength > PREFERENCE_UPLOAD_BYTES) return errorBody('invalid-request');
    try {
      let value: unknown;
      try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(request.bytes));} catch {fail('invalid-request');}
      const input = inputOf(value);
      this.store.expireStages(this.context.clock.now());
      const previous = this.store.inputFor(request.requestId);
      if (previous !== undefined && digest(previous.input) !== digest(input)) fail('duplicate-conflict');
      if (previous === undefined && this.store.stagedCount() >= 8) fail('capacity');
      const staged = previous ?? {ref: randomUUID(), requestId: request.requestId, input, expires: this.context.clock.now() + CONTROL_MS};
      if (previous === undefined) this.store.stage(staged);
      return {data: {inputRef: staged.ref}, finish: reply => {
        if ('error' in reply && reply.error.code !== 'uncertain-result') this.store.discard(staged.ref);
      }};
    } catch (error) {return errorBody(codeOf(error));}
  }
  async #input(command: Command<AssistantInput>): Promise<Reply> {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/core') return errorBody('forbidden');
    if (command.subject !== 'preferences') return errorBody('not-found');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    if (this.context.clock.now() - Date.parse(command.time) >= CONTROL_MS) return errorBody('expired');
    try {
      return await this.outbox.transaction(add => {
        const fingerprint = digest(command.data), previous = this.store.receipt(command.data.requestId);
        if (previous !== undefined) {if (previous !== fingerprint) fail('duplicate-conflict'); return {status: 'accepted'} as const;}
        const staged = this.store.input(command.data.inputRef) ?? fail('invalid-request');
        if (staged.requestId !== command.data.requestId) fail('invalid-request');
        if (staged.expires <= this.context.clock.now()) fail('expired');
        this.store.apply(staged.input, this.context.clock.now());
        this.store.discard(staged.ref); this.store.remember(command.data.requestId, fingerprint); this.store.bump();
        add('bunny.state.preference-state.preferences', preferenceStateDraft(this.inspect()), {parent: command});
        add('bunny.event.assistant-input.preferences', {kind: 'outcome', type: 'org.bunny.assistant.input.completed', subject: 'preferences',
          dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: command.data.requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
        return {status: 'accepted'} as const;
      });
    } catch (error) {return errorBody(codeOf(error), {detail: 'The preference change was not saved.'});}
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref !== 'preferences') return undefined;
    const query = request?.query ?? {}, view = query.view ?? 'active';
    if (request?.signal.aborted === true || Object.keys(query).some(key => key !== 'view') || !['active', 'manage', 'export'].includes(view)) return errorBody('invalid-request');
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    try {return {type: 'application/json', bytes: Buffer.from(JSON.stringify(view === 'manage' ? this.store.view() : view === 'export' ? this.store.library() : this.store.active()))};}
    catch {return errorBody('unavailable');}
  }
}
