// A scripted device module for the tracker's tests (Hub #782): it answers `gadget-set` on `bunny.cmd.gadget-set.<id>`
// as the test scripts each command, and reports outcomes through its own outbox, which follows the core's
// acknowledgments. A test can hold a command in its handler, report more outcomes later, lose its acknowledgments, keep
// its outbox from publishing, as after a crash between a commit and its publish, or reuse an outcome's message ID.
import type {ErrorCode, ErrorDetail, Message} from '@jimmie-potts/event-contracts/v2';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {Outbox, type BunnyModule, type Command, type CommandDraft, type Sdk} from '@jimmie-potts/sdk';

const BASE = 'https://bunny.invalid/events/';
export const GADGET_SET_SCHEMA = `${BASE}gadget-set/2.0`;
export const GADGET_SET_TYPE = 'org.bunny.gadget.set.requested';
const OUTCOME_SCHEMA = `${BASE}outcome/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
/** The gadget's payload schemas, by `dataschema`. */
export const gadgetSchemas: Readonly<Record<string, object>> = {
  [GADGET_SET_SCHEMA]: {type: 'object', additionalProperties: false, required: ['requestId', 'level'], properties: {requestId: block('requestId'), level: {type: 'integer', minimum: 0, maximum: 100}}},
};

export type Reported = {result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail};
/** How the gadget answers one command: its reply, or `hold` until `release`, and then the outcome it reports, if any. */
export type Script = {reply?: 'accepted' | 'hold' | ErrorCode; outcome?: Reported | 'none'};

/** The `gadget-set` command for `device`, as `request` and the dispatcher take it. */
export const setGadget = (level: number, device = 'g1'): {key: string; draft: CommandDraft<{level: number}>} => ({
  key: `bunny.cmd.gadget-set.${device}`, draft: {type: GADGET_SET_TYPE, subject: device, dataschema: GADGET_SET_SCHEMA, data: {level}},
});

export class Gadget {
  /** Every command a handler of the gadget received, across its restarts. */
  readonly commands: Command<{level: number}>[] = [];
  /** Every outcome the gadget's outbox published, across its restarts. */
  readonly published: Message[] = [];
  /** Every acknowledgment its outbox heard, by outcome ID. */
  readonly acknowledged: string[] = [];
  /** While true, the outbox stores but never publishes: a publish never finishes, as in a process that died after its commit. */
  dead = false;
  /** While true, the core's acknowledgments are lost on their way. */
  loseAcknowledgments = false;
  readonly #scripts: Script[] = [];
  #held: (() => void)[] = [];
  #outbox: Outbox | undefined;
  #sdk: Sdk | undefined;

  /** Scripts the next commands, in order; a command beyond the scripts is accepted and succeeds. */
  script(...scripts: Script[]): void {
    this.#scripts.push(...scripts);
  }

  /** Lets every held handler go on. */
  release(): void {
    const held = this.#held;
    this.#held = [];
    for (const go of held) go();
  }

  /** Reports one more outcome for `requestId` through the outbox. */
  async report(requestId: string, outcome: Reported, device = 'g1'): Promise<Message> {
    const outbox = this.#outbox;
    if (outbox === undefined) throw new Error('the gadget has not started');
    let added: Message | undefined;
    await outbox.transaction(add => {
      added = add(`bunny.event.gadget-set.${device}`, {kind: 'outcome', type: 'org.bunny.gadget.set.completed', subject: device, dataschema: OUTCOME_SCHEMA, data: {requestId, ...outcome}});
    });
    if (added === undefined) throw new Error('nothing was added');
    return added;
  }

  /** Publishes `message` again, unchanged but for `data`: the same `(source, id)` with other content. */
  async forge(message: Message, data: object): Promise<void> {
    await this.#sdk?.publishMessage(`bunny.event.gadget-set.${message.subject}`, {...message, data});
  }

  /** A new instance of the gadget's module, sharing this state, as each runtime start builds it. */
  module(): BunnyModule {
    return {
      manifest: {name: 'gadget', apiVersion: '1.0'},
      start: async ({sdk, database, clock, log, trace}) => {
        this.#sdk = sdk;
        const outbox = new Outbox({
          sdk: {
            source: sdk.source,
            publishMessage: (key, message) => {
              if (this.dead) return new Promise(() => {});
              if (message.kind === 'outcome') this.published.push(message as Message);
              return sdk.publishMessage(key, message);
            },
            subscribe: (pattern, handler, options) => sdk.subscribe(pattern, message => {
              if (this.loseAcknowledgments) return undefined;
              const {id} = message.data as {id?: unknown};
              if (typeof id === 'string') this.acknowledged.push(id);
              return handler(message as never);
            }, options),
          },
          database: database(), clock, log, trace,
        });
        this.#outbox = outbox;
        await outbox.republish();
        await sdk.respond<{level: number}>('bunny.cmd.gadget-set.*', async command => {
          this.commands.push(command);
          const {reply = 'accepted', outcome = {result: 'succeeded', evidence: 'observed'}} = this.#scripts.shift() ?? {};
          if (reply !== 'accepted' && reply !== 'hold') return errorBody(reply, {detail: 'the gadget refused it'});
          if (reply === 'hold') await new Promise<void>(resolve => { this.#held.push(resolve); });
          // As a device module does, it replies first and reports the outcome once its work is done.
          if (outcome !== 'none') {
            setImmediate(() => {
              void outbox.transaction(add => {
                add(`bunny.event.gadget-set.${command.subject}`, {
                  kind: 'outcome', type: 'org.bunny.gadget.set.completed', subject: command.subject, dataschema: OUTCOME_SCHEMA, data: {requestId: command.data.requestId, ...outcome},
                }, {parent: command});
              }).catch(() => {});
            });
          }
          return {status: 'accepted'};
        });
      },
      stop: () => {
        this.release();
        this.#outbox = undefined;
      },
    };
  }
}
