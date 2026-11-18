import {DeviceAvailability, Outcome, recordLog, type BunnyModule, type Cancel, type ModuleContext} from '@jimmie-potts/sdk';
import {configurePresence, type PresenceConfig, type SensorConfig} from './configuration.js';
import {FAMILY, SCHEMA, TYPE, keyOf, type PresenceObservation} from './contracts.js';
import {NativeFault, nativeFactory, type NativeFactory, type NativeSession} from './native.js';
import {Projection} from './projection.js';

export const CONNECT_LIMIT_MS = 5000;
export const BACKOFF_MAX_MS = 30_000;
export function createPresenceModule(options: {native?: NativeFactory} = {}): BunnyModule<PresenceConfig> {
  let owner: Owner | undefined;
  return {manifest: {name: 'presence-pro', apiVersion: '1.3', configure: configurePresence},
    start: async context => { owner = new Owner(context, options.native ?? nativeFactory); await owner.start(); }, stop: () => owner?.stop()};
}
type Sensor = {config: SensorConfig; projection: Projection; generation: number; session: NativeSession | undefined; timer: Cancel | undefined;
  abort: AbortController | undefined; failures: number; starting: boolean; staged: Projection | undefined};
class Owner {
  readonly #context: ModuleContext<PresenceConfig>;
  readonly #factory: NativeFactory;
  readonly #sensors: Sensor[];
  readonly #availability: DeviceAvailability;
  #revision: number;
  #stopped = false;
  #draining = false;
  readonly #dirty = new Set<Sensor>();
  #write: Promise<void> = Promise.resolve();
  constructor(context: ModuleContext<PresenceConfig>, factory: NativeFactory) {
    this.#context = context; this.#factory = factory;
    this.#availability = new DeviceAvailability(context);
    const database = context.database();
    database.exec('CREATE TABLE IF NOT EXISTS presence_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL) STRICT; INSERT OR IGNORE INTO presence_revision VALUES(1,0)');
    this.#revision = (database.prepare('SELECT revision FROM presence_revision WHERE id=1').get() as {revision: number}).revision;
    this.#sensors = (context.config?.sensors ?? []).map(config => ({config, projection: new Projection(config), generation: 0, session: undefined, timer: undefined,
      abort: undefined, failures: 0, starting: false, staged: undefined}));
    for (const sensor of this.#sensors) sensor.projection.current.revision = ++this.#revision;
    database.prepare('UPDATE presence_revision SET revision=? WHERE id=1').run(this.#revision);
  }
  async start(): Promise<void> {
    await this.#context.sdk.serveSync([FAMILY], () => ({revision: this.#revision,
      states: this.#sensors.map(sensor => ({type: TYPE, subject: sensor.config.id, dataschema: SCHEMA, data: structuredClone(sensor.projection.current)}))}));
    for (const sensor of this.#sensors) { this.#mark(sensor); this.#schedule(sensor, 0); }
    await this.#write;
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const sensor of this.#sensors) this.#retire(sensor);
    await this.#write;
  }
  #retire(sensor: Sensor): void {
    sensor.generation += 1;
    sensor.timer?.(); sensor.timer = undefined;
    sensor.abort?.abort(); sensor.abort = undefined;
    sensor.session?.close(); sensor.session = undefined;
    sensor.starting = false; sensor.staged = undefined;
  }
  #schedule(sensor: Sensor, delay: number): void {
    if (this.#stopped) return;
    sensor.timer = this.#context.scheduler.after(delay, () => { sensor.timer = undefined; void this.#connect(sensor); });
  }
  async #connect(sensor: Sensor): Promise<void> {
    this.#retire(sensor);
    const generation = sensor.generation;
    const current = (): boolean => !this.#stopped && sensor.generation === generation;
    const abort = new AbortController(); sensor.abort = abort; sensor.starting = true;
    sensor.staged = new Projection(sensor.config); sensor.staged.connected();
    let rejectAbort: ((error: NativeFault) => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = (): void => { rejectAbort?.(new NativeFault('unavailable')); };
    abort.signal.addEventListener('abort', onAbort, {once: true});
    const cancel = this.#context.scheduler.after(CONNECT_LIMIT_MS, () => { abort.abort(); });
    const work = async (): Promise<void> => {
      const security = sensor.config.security;
      const key = security.keySecret === undefined ? undefined : await this.#context.secrets.read(security.keySecret);
      const password = security.passwordSecret === undefined ? undefined : await this.#context.secrets.read(security.passwordSecret);
      if (!current() || abort.signal.aborted) return;
      const session = this.#factory(sensor.config, {...(key === undefined ? {} : {key}), ...(password === undefined ? {} : {password})}, {
        report: report => {
          if (!current()) return;
          const at = this.#context.clock.now();
          if (sensor.starting) {
            sensor.staged?.report(report, at);
            return;
          }
          sensor.projection.report(report, at); this.#mark(sensor);
        },
        disconnected: code => { if (current()) this.#failed(sensor, code); },
      });
      sensor.session = session;
      await session.open(AbortSignal.any([abort.signal, this.#context.signal]));
      if (!current()) return;
      cancel(); sensor.starting = false; sensor.failures = 0;
      if (sensor.staged !== undefined) sensor.projection = sensor.staged;
      sensor.staged = undefined;
      this.#availability.reached(sensor.config.id); this.#mark(sensor);
    };
    try { await Promise.race([work(), aborted]); } catch (error) {
      if (current()) this.#failed(sensor, error instanceof NativeFault ? error.code : 'unavailable');
    } finally { cancel(); abort.signal.removeEventListener('abort', onAbort); }
  }
  #failed(sensor: Sensor, code: NativeFault['code']): void {
    this.#retire(sensor);
    sensor.projection.disconnected(code);
    this.#availability.unreachable(sensor.config.id, code); this.#mark(sensor);
    sensor.failures = Math.min(sensor.failures + 1, 16);
    this.#schedule(sensor, Math.min(BACKOFF_MAX_MS, 1000 * 2 ** (sensor.failures - 1)));
  }
  #mark(sensor: Sensor): void {
    sensor.projection.current.revision = ++this.#revision;
    this.#dirty.add(sensor);
    this.#drain();
  }
  #drain(): void {
    if (this.#draining || this.#stopped) return;
    this.#draining = true;
    this.#write = this.#write.then(async () => {
      while (this.#dirty.size > 0 && !this.#stopped) {
        const next = this.#dirty.values().next().value as Sensor;
        this.#dirty.delete(next);
        const state: PresenceObservation = structuredClone(next.projection.current);
        try {
          this.#context.database().prepare('UPDATE presence_revision SET revision=? WHERE id=1').run(this.#revision);
          await this.#context.sdk.publish(keyOf(state.id), {kind: 'state', type: TYPE, subject: state.id, dataschema: SCHEMA, data: state});
        } catch {
          // No durable replay: current sync state stands, and a missed publication/history row stays a gap.
          recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': 'unavailable'});
        }
      }
    }).finally(() => { this.#draining = false; if (this.#dirty.size > 0) this.#drain(); });
  }
}
