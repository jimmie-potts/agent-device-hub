// One controller as the module reaches it (Hub #844): every request the worker, the observer and the scene restorer make
// goes through its link. The link gives the request the device's configured address and the token the module read from
// its secret file, ends it within its own deadline on the module's scheduler, and turns the device's timeouts into the
// device's availability (policy A, ADR 0012 "Failure isolation"), logging one degradation and one recovery per outage. A
// device that answers with an HTTP error status was reached: the error goes back to the caller as the transport's
// `HttpError`, and a 401 or 403 marks the device as refusing the module's token, logged once each way. The link keeps
// what only the device can say: the power and brightness a `GET /state` read, with the time of the reading that first
// showed them, and it reports each write that reached the device, with the command it served. A write made for a
// command records a `bunny.device.call` span in that command's trace. Its context never reaches the device.
import type {Clock, DeviceAvailability, Logger, ModuleScheduler, TraceContext, Tracing} from '@jimmie-potts/sdk';
import {isObject} from '../compat.js';
import {HttpError, LIGHT_TIMEOUT_SECONDS, type LightAddress, type LightRequest} from '../transport.js';

/** How long one request to a device may take: the Python client's light request timeout. */
export const REQUEST_MS = Math.round(LIGHT_TIMEOUT_SECONDS * 1000);

/**
 * The device did not answer within its deadline or could not be reached. The message is fixed, so it never quotes an
 * address or a reply; the transport's own error stays its cause, in memory (ADR 0012, "Safe errors").
 */
export class DeviceUnreachable extends Error {
  override name = 'DeviceUnreachable';
  constructor(cause?: unknown) {
    super('The device did not answer.', cause === undefined ? undefined : {cause});
  }
}

/** The module stopped while a request was out; the request's result no longer matters. */
export class LinkStopped extends Error {
  override name = 'LinkStopped';
  constructor() {
    super('The module stopped.');
  }
}

/** Power and brightness as the device reported them, and when it first reported them (`observedAtMs`, on the runtime's clock). */
export type Observation = {observedAtMs: number; power: boolean | undefined; brightness: number | undefined};

/** The command a device write serves: its request ID, its trace and the operation it is, for the write's span. */
export type CommandWrite = {requestId: string; traceparent: string; operation: string};

/** A write that reached the device: when, on the runtime's clock, and the command it served, if it served one. */
export type Transmission = {atMs: number; requestId?: string};

export type LinkOptions = {
  device: string;
  address: string;
  /** The token the module read with `secrets.read`. It stays in memory, in this link only. */
  token: string;
  transport: LightRequest;
  clock: Clock;
  scheduler: ModuleScheduler;
  /** The module's stop signal: a request still out when it aborts is abandoned. */
  signal: AbortSignal;
  availability: DeviceAvailability;
  log: Logger;
  trace: Tracing;
  /** The command the device's write in progress serves, if any: the journal row its worker marked attempting. */
  commandWrite: (device: string) => CommandWrite | undefined;
  /**
   * Hears of every write that reached the device, before its request settles: any answer shows it did, an HTTP error
   * status included. A poll writes nothing.
   */
  onWrite: (device: string, write: Transmission) => void;
  /** Hears of every request that settled, so the module can publish what changed. */
  onSettled: (device: string) => void;
};

const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const level = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined);
/** A 401 or 403: the device refuses the module's token, not one request. */
export const refusesToken = (status: number): boolean => status === 401 || status === 403;

export class DeviceLink {
  readonly device: string;
  /**
   * Whether the device has answered (`reached`), answered by refusing the module's token (`refusing`), failed its last
   * request (`failing`), or not been asked yet.
   */
  status: 'unknown' | 'reached' | 'refusing' | 'failing' = 'unknown';
  observation: Observation | undefined;
  readonly #options: LinkOptions;
  /** Requests in the order they were sent, and the newest one that reached the device. */
  #sent = 0;
  #reachedBy = 0;

  constructor(options: LinkOptions) {
    this.device = options.device;
    this.#options = options;
  }

  /**
   * The device's light transport, as the port's worker, scene restorer and layout reads take it. The address the port
   * passes is ignored: the device's configured address and token are used, so no credential lives in a saved file.
   */
  readonly request: LightRequest = (_address: LightAddress, method: string, endpoint = '', payload: unknown = null): Promise<unknown> => {
    const {address, token, transport, scheduler, signal, availability, onSettled} = this.#options;
    if (signal.aborted) return Promise.reject(new LinkStopped());
    this.#sent += 1;
    const order = this.#sent;
    // A write for a command names it: its span joins the command's trace, and its transmission carries the request ID.
    const command = method === 'GET' ? undefined : this.#options.commandWrite(this.device);
    const call = command === undefined ? undefined : this.#span(command);
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let cancel = (): void => {};
      const finish = (outcome: () => void, failedCall: boolean): void => {
        if (settled) return;
        settled = true;
        cancel();
        signal.removeEventListener('abort', stopped);
        call?.end(failedCall ? 'error' : 'unset');
        outcome();
        onSettled(this.device);
      };
      const stopped = (): void => { finish(() => { reject(new LinkStopped()); }, true); };
      const failed = (cause?: unknown): void => {
        finish(() => {
          // A request sent before one that reached the device says nothing newer about it.
          if (!signal.aborted && order > this.#reachedBy) {
            this.status = 'failing';
            availability.unreachable(this.device, 'unavailable');
          }
          reject(new DeviceUnreachable(cause));
        }, true);
      };
      const reached = (status: number | undefined): void => {
        this.#reachedBy = Math.max(this.#reachedBy, order);
        availability.reached(this.device);
        this.#answered(status !== undefined && refusesToken(status) ? status : undefined);
      };
      signal.addEventListener('abort', stopped, {once: true});
      cancel = scheduler.after(REQUEST_MS, () => { failed(); });
      let sent: Promise<unknown>;
      try {
        sent = transport({ip: address, token}, method, endpoint, payload);
      } catch (error) {
        sent = Promise.reject(error);
      }
      sent.then(reply => {
        finish(() => {
          reached(undefined);
          if (method === 'GET' && endpoint === '/state' && isObject(reply)) this.#observed(reply);
          if (method !== 'GET') this.#wrote(command);
          resolve(reply);
        }, false);
      }, (error: unknown) => {
        // The device answered with an error status: it was reached, and heard the request.
        if (error instanceof HttpError) {
          finish(() => {
            reached(error.status);
            if (method !== 'GET') this.#wrote(command);
            reject(error);
          }, true);
          return;
        }
        failed(error);
      });
    });
  };

  /** A write the device answered reached it, for the command it served, if any. */
  #wrote(command: CommandWrite | undefined): void {
    try {
      this.#options.onWrite(this.device, {atMs: this.#options.clock.now(), ...(command === undefined ? {} : {requestId: command.requestId})});
    } catch {
      // The listener's failure is its own: the request still settles.
    }
  }

  /** A write for a command records its span, a child of the command's trace; the device never sees the context. */
  #span(write: CommandWrite): {end: (status: 'unset' | 'error') => void} {
    const parent: TraceContext = {traceparent: write.traceparent};
    return this.#options.trace.start('bunny.device.call', {
      parent, kind: 'client', attributes: {'bunny.device.id': this.device, 'bunny.operation': write.operation, 'bunny.request.id': write.requestId},
    });
  }

  /** The device answered: a 401 or 403 starts a run of refusals of the module's token, and any other answer ends one. */
  #answered(refusal: number | undefined): void {
    const {log} = this.#options;
    if (refusal !== undefined) {
      if (this.status !== 'refusing') {
        log.warn('operation.failed', {'bunny.device.id': this.device, 'bunny.operation': 'status', 'bunny.code': refusal === 401 ? 'unauthenticated' : 'forbidden'});
      }
      this.status = 'refusing';
      return;
    }
    if (this.status === 'refusing') log.info('operation.completed', {'bunny.device.id': this.device, 'bunny.operation': 'status', 'bunny.outcome': 'current'});
    this.status = 'reached';
  }

  /** A reading changes the observation only when its power or brightness differs, so a poll that changed nothing publishes nothing. */
  #observed(reply: Record<string, unknown>): void {
    const on = isObject(reply.on) ? reply.on.value : undefined;
    const brightness = isObject(reply.brightness) ? reply.brightness.value : undefined;
    const power = bool(on), percent = level(brightness);
    const current = this.observation;
    if (current !== undefined && current.power === power && current.brightness === percent) return;
    this.observation = {observedAtMs: this.#options.clock.now(), power, brightness: percent};
  }
}
