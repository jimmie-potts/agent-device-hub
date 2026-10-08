// Scripted native responders for #924's focused core/browser checks; no controller or physical transport is used.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {DeviceModeSetRequest} from '@jimmie-potts/event-contracts/v2/devices';
import type {BunnyModule, Command, ModuleContext} from '@jimmie-potts/sdk';
import {deviceRecord, deviceState} from './device.js';

export class ModeDevice {
  readonly commands: Command<DeviceModeSetRequest>[] = [];
  readonly name: 'nanoleaf' | 'pixoo';
  readonly id: string;
  result: 'succeeded' | 'failed' | 'none' = 'succeeded';
  failStart = false;
  refuse = false;
  #context: ModuleContext | undefined;
  constructor(name: 'nanoleaf' | 'pixoo', id: string) {this.name = name; this.id = id;}
  module(): BunnyModule {
    return {
      manifest: {name: this.name, apiVersion: '1.2', configure: section => this.refuse ? errorBody('invalid-request', {detail: 'fixture admission refused'}) : {config: section, devices: [this.id]}},
      start: async context => {
        if (this.failStart) throw new Error('synthetic mode module failed');
        this.#context = context;
        await context.sdk.respond<DeviceModeSetRequest>(`bunny.cmd.device-mode-set.${this.id}`, async command => {
          this.commands.push(command);
          context.log.info('command.executing', {'bunny.request.id': command.data.requestId});
          if (this.result !== 'none') await context.sdk.publish(`bunny.event.device-mode-set.${this.id}`, {
            kind: 'outcome', type: 'org.bunny.device-mode.set.completed', subject: this.id, dataschema: 'https://bunny.invalid/events/outcome/2.0',
            data: {requestId: command.data.requestId, result: this.result, evidence: this.result === 'succeeded' ? 'observed' : 'none',
              ...this.result === 'succeeded' ? {} : {error: errorBody('unavailable').error}},
          }, {parent: command});
          return {status: 'accepted'};
        });
      },
      stop: () => {this.#context = undefined;},
    };
  }
  /** A native change is independently observed; it never selects the Hub mode or triggers correction. */
  async observe(): Promise<void> {
    const record = deviceRecord(this.id, 1, this.name, 'available');
    record.capabilities.modes = {supported: true, values: this.name === 'nanoleaf' ? ['work', 'free', 'quiet'] : ['monitor', 'media']};
    record.desired.mode = {status: 'known', value: this.name === 'nanoleaf' ? 'quiet' : 'media'};
    await this.#context?.sdk.publish(`bunny.state.device.${this.id}`, {kind: 'state', ...deviceState(record)});
  }
}
