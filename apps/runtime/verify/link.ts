// How a disposable run drives each registered module's simulated devices (Hub #999): the module's registration names a
// half for each process (`simulation.run`). The supervisor holds what outlives a runtime and answers the calls the
// runtime's module makes over the child's IPC channel; the child builds the module with a link to it. Neither half knows
// which module it serves, so the run names no module. A call the module abandons, or one whose runtime ended, aborts the
// supervisor's own call; an answer that comes after is dropped.
import type {DeviceAction, DeviceLink, DeviceSimulation, LinkAnswer, ModuleRegistration, SimulationOptions} from '@jimmie-potts/sdk';
import {admitted} from '../tests/scenarios/parts.js';
import type {ChildMessage, SupervisorMessage} from './protocol.js';

/** The child's end: one link per registered module, the calls they wait on, and the handlers that hear pushes. */
export class ChildLinks {
  readonly #send: (message: ChildMessage) => void;
  readonly #handovers: Readonly<Record<string, unknown>>;
  readonly #waiting = new Map<number, (answer: LinkAnswer) => void>();
  readonly #pushes = new Map<string, ((simulation: DeviceAction) => void)[]>();
  #next = 0;

  /** `handovers` are what the last runtime left with the supervisor, by module name. */
  constructor(send: (message: ChildMessage) => void, handovers: Readonly<Record<string, unknown>>) {
    this.#send = send;
    this.#handovers = handovers;
  }

  /** The link the module `device` reaches its simulated device with. */
  link(device: string): DeviceLink {
    return {
      call: (method, args, signal) => this.#call(device, method, args, signal),
      handover: this.#handovers[device],
      onPush: handler => { this.#pushes.set(device, [...this.#pushes.get(device) ?? [], handler]); },
    };
  }

  /** Takes a supervisor message meant for a link. */
  hear(message: Extract<SupervisorMessage, {type: 'device.answered' | 'device.failed' | 'device.push'}>): void {
    switch (message.type) {
      case 'device.answered':
        this.#settle(message.id, {status: 'answered', value: message.value});
        return;
      case 'device.failed':
        this.#settle(message.id, {status: 'failed'});
        return;
      case 'device.push':
        for (const handler of this.#pushes.get(message.device) ?? []) handler(message.simulation);
        this.#send({type: 'applied', id: message.id});
        return;
    }
  }

  #call(device: string, method: string, args: unknown, signal: AbortSignal | undefined): Promise<LinkAnswer> {
    if (signal?.aborted === true) return Promise.resolve({status: 'abandoned'});
    this.#next += 1;
    const id = this.#next;
    return new Promise(resolve => {
      const abandon = (): void => {
        if (!this.#waiting.delete(id)) return;
        this.#send({type: 'device.abandon', id});
        resolve({status: 'abandoned'});
      };
      this.#waiting.set(id, answer => {
        signal?.removeEventListener('abort', abandon);
        resolve(answer);
      });
      signal?.addEventListener('abort', abandon, {once: true});
      // Sent at once, so the call keeps its place among the child's messages, before a later flush's answer.
      this.#send({type: 'device.call', id, device, method, args: args ?? null});
    });
  }

  #settle(id: number, answer: LinkAnswer): void {
    const settle = this.#waiting.get(id);
    this.#waiting.delete(id);
    settle?.(answer);
  }
}

type Held = {simulation: DeviceSimulation['run']; held: unknown};

/** The supervisor's end: each registered module's simulated device, and the calls each runtime still waits on. */
export class SupervisorDevices {
  readonly #devices: ReadonlyMap<string, Held & {admits: (request: Readonly<Record<string, unknown>>) => boolean}>;
  /** Each call a device still serves, by the runtime's generation and the child's ID, so the child can abandon it. */
  readonly #serving = new Map<string, AbortController>();

  constructor(registrations: readonly ModuleRegistration[], options: SimulationOptions) {
    this.#devices = new Map(registrations.flatMap(({name, simulation}) => simulation === undefined ? [] : [[name, {
      simulation: simulation.run, held: simulation.run.create(options), admits: (request: Readonly<Record<string, unknown>>) => admitted(simulation, request),
    }] as const]));
  }

  /** Whether `request` names a registered device and one of its actions, with only the fields it takes. */
  admits(request: Readonly<Record<string, unknown>>): request is DeviceAction {
    const device = typeof request.device === 'string' ? this.#devices.get(request.device) : undefined;
    return device?.admits(request) ?? false;
  }

  has(device: string): boolean {
    return this.#devices.has(device);
  }

  /** What each device shows now, by its module's name. */
  states(): Record<string, unknown> {
    return Object.fromEntries([...this.#devices].map(([name, {simulation, held}]) => [name, simulation.state(held)]));
  }

  /** What the next runtime's links start with, by module name. */
  handovers(): Record<string, unknown> {
    return Object.fromEntries([...this.#devices].flatMap(([name, {simulation, held}]) => simulation.handover === undefined ? [] : [[name, simulation.handover(held)]]));
  }

  /** Acts on an admitted simulation; `push` hands it to the current runtime's links. */
  async act(request: DeviceAction, push: (simulation: DeviceAction) => Promise<void>): Promise<void> {
    const device = this.#devices.get(request.device);
    if (device !== undefined) await device.simulation.act(device.held, request, push);
  }

  /**
   * Serves one call from the runtime `generation`, which is `current` unless a restart replaced it, and answers it with
   * `tell` unless it was abandoned meanwhile. A device that throws or rejects answers `failed`.
   */
  serve(generation: number, current: boolean, message: Extract<ChildMessage, {type: 'device.call'}>, tell: (message: SupervisorMessage) => void): void {
    const key = `${generation} ${message.id}`;
    const controller = new AbortController();
    this.#serving.set(key, controller);
    const device = this.#devices.get(message.device);
    const answer = (reply: SupervisorMessage): void => { if (this.#serving.delete(key)) tell(reply); };
    if (device === undefined) {
      answer({type: 'device.failed', id: message.id});
      return;
    }
    let served: unknown;
    try {
      // Called at once, so what a call changes is in place before the child's next message, such as a flush, is heard.
      served = device.simulation.serve(device.held, {method: message.method, args: message.args, signal: controller.signal, current});
    } catch {
      answer({type: 'device.failed', id: message.id});
      return;
    }
    Promise.resolve(served).then(
      value => { answer({type: 'device.answered', id: message.id, value: value ?? null}); },
      () => { answer({type: 'device.failed', id: message.id}); },
    );
  }

  /** The runtime `generation` stopped waiting for its call `id`. */
  abandon(generation: number, id: number): void {
    const key = `${generation} ${id}`;
    const controller = this.#serving.get(key);
    this.#serving.delete(key);
    controller?.abort();
  }

  /** The runtime `generation` ended, so it waits on none of its calls. */
  ended(generation: number): void {
    for (const [key, controller] of this.#serving) {
      if (!key.startsWith(`${generation} `)) continue;
      this.#serving.delete(key);
      controller.abort();
    }
  }
}
