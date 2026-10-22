import {createHash, randomUUID} from 'node:crypto';
import {MessageValidator, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {AssistantInput} from '@jimmie-potts/event-contracts/v2/assistant';
import {assistantStateDraft, type AssistantEngine} from '../assistant/engine.js';
import {Outcome, fullDisk, type Command, type ModuleContent, type ModuleContentRequest, type ModuleContext, type ModuleStagedUpload,
  type ModuleUploadRequest, type Outbox, type Reply, type Subscription} from '@jimmie-potts/sdk';
import {KnowledgeLibrary} from './library.js';
import {inputOf, persona, type KnowledgeInput} from './validation.js';
import {PAGE_BYTES} from './model.js';
import {preferenceStateDraft} from '../preferences/engine.js';
import {PreferenceStore} from '../preferences/store.js';
import {PreferenceFault, fail, id} from '../preferences/validation.js';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const codeOf = (error: unknown) => error instanceof PreferenceFault ? error.code : fullDisk(error) ? 'capacity' : 'internal';
const CONTROL_MS = 5000;
const UPLOAD_BYTES = 10 * 1024 * 1024;
/** Explicit owner input only. No provider, background learning or device authority. */
export class Knowledge {
  readonly store: PreferenceStore<KnowledgeInput>;
  readonly library: KnowledgeLibrary;
  readonly #validator = new MessageValidator();
  #subscription: Subscription | undefined;
  #closed = false;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly assistant: AssistantEngine, preferences: PreferenceStore) {
    this.library = new KnowledgeLibrary(context.database(), assistant, preferences); this.store = this.library.entries; registerCoreFamilies(this.#validator);
  }
  async start(): Promise<void> {this.#subscription = await this.context.sdk.respond<AssistantInput>('bunny.cmd.assistant-input.knowledge', command => this.#input(command));}
  async stop(): Promise<void> {this.#closed = true; await this.#subscription?.close();}
  stage(request: ModuleUploadRequest): ModuleStagedUpload | ErrorBody {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (request.target !== 'knowledge' || request.name !== 'knowledge.json' || !id(request.requestId) || request.signal.aborted || request.bytes.byteLength > UPLOAD_BYTES) return errorBody('invalid-request');
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
    if (command.subject !== 'knowledge') return errorBody('not-found');
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
        if (staged.input.expectedRevision !== this.assistant.store.meta().revision) fail('revision-conflict');
        this.library.apply(staged.input, this.context.clock.now());
        if (staged.input.action === 'import-archive') add('bunny.state.preference-state.preferences', preferenceStateDraft({id: 'preferences', revision: this.library.preferences.revision()}), {parent: command});
        this.store.discard(staged.ref); this.store.remember(command.data.requestId, fingerprint); this.store.bump();
        this.assistant.store.bump();
        add('bunny.state.assistant-state.assistant', assistantStateDraft(this.assistant.inspect()), {parent: command});
        add('bunny.event.assistant-input.knowledge', {kind: 'outcome', type: 'org.bunny.assistant.input.completed', subject: 'knowledge',
          dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: command.data.requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
        return {status: 'accepted'} as const;
      });
    } catch (error) {return errorBody(codeOf(error), {detail: 'The knowledge change was not saved.'});}
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (!['knowledge', 'companion-profiles', 'companion-history', 'companion-context', 'companion-archive'].includes(ref)) return undefined;
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    const query = request?.query ?? {};
    try {
      if (request?.signal.aborted === true) fail('unavailable');
      let document: unknown;
      if (ref === 'knowledge') {
        const view = query.view ?? 'active';
        if (Object.keys(query).some(key => key !== 'view') || !['active', 'manage', 'export'].includes(view)) fail('invalid-request');
        const value = view === 'manage' ? this.store.view() : view === 'export' ? this.store.library() : this.store.active();
        document = {...value, schema: view === 'manage' ? 'knowledge-view/1.0' : view === 'export' ? 'knowledge-library/1.0' : 'knowledge/1.0',
          ...(view === 'export' ? {} : {revision: this.assistant.store.meta().revision})};
      } else if (ref === 'companion-profiles' || ref === 'companion-archive') {
        if (Object.keys(query).length > 0) fail('invalid-request');
        document = ref === 'companion-profiles' ? {schema: 'companion-profiles/1.0', revision: this.assistant.store.meta().revision, profiles: this.library.profiles()} : this.library.archive();
        if (ref === 'companion-archive') this.library.capacity();
      } else {
        const profile = query.profile;
        if (!persona(profile)) fail('invalid-request');
        const conversationId = query.conversationId;
        if (conversationId !== undefined && !id(conversationId)) fail('invalid-request');
        if (ref === 'companion-context') {
          if (Object.keys(query).some(key => !['profile', 'conversationId', 'messages', 'destination'].includes(key))) fail('invalid-request');
          if (!['local', 'claude', 'codex'].includes(query.destination ?? 'local')) fail('forbidden');
          const selected = query.messages === undefined || query.messages === '' ? [] : query.messages.split(',');
          if (!selected.every(id)) fail('invalid-request');
          document = this.library.context(profile, conversationId, selected);
        } else {
          if (Object.keys(query).some(key => !['profile', 'conversationId', 'after', 'latest'].includes(key))) fail('invalid-request');
          const after = Number(query.after ?? 0);
          if (!Number.isSafeInteger(after) || after < 0 || (query.latest !== undefined && !persona(query.latest))) fail('invalid-request');
          document = this.assistant.store.messages.page(profile, conversationId, after, this.assistant.store.meta().revision, query.latest);
          if (Buffer.byteLength(JSON.stringify(document)) > PAGE_BYTES) fail('capacity');
        }
      }
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify(document))};
    } catch (error) {return errorBody(error instanceof PreferenceFault ? error.code : 'unavailable');}
  }
}
