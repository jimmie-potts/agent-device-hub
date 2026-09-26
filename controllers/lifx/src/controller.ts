import {
  readFileSync,
  renameSync,
  mkdirSync,
  lstatSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeSync,
  unlinkSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { randomUUID, createHash } from "node:crypto";
import {
  admit,
  validate,
  schema as contractSchema,
  type Request,
  type Receipt,
  type Snapshot,
  type Ticket,
  type FailureCode,
  type AdmissionState,
  type Mode,
} from "@jimmie-potts/device-contracts";
import {
  UdpTransport,
  encodeColor,
  encodePower,
  decodeState,
  type Transport,
  type LightState,
} from "./protocol.js";

export const LIFX_PROFILE = Object.freeze({
  profileId: "lifx-light",
  profileVersion: "1.0.0",
} as const);
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(contractSchema);
const profileRequest = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL("../schemas/lifx-light-1.0.0.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
export type LightingCommand =
  | { kind: "lifx.color.set"; hue: number; saturation: number }
  | { kind: "lifx.temperature.set"; kelvin: number };
export type LightingRequest = Omit<Request, "command"> & {
  profile: typeof LIFX_PROFILE;
  command: LightingCommand;
};
type AnyRequest = Request | LightingRequest;
export type Submission =
  | { decision: FailureCode; reserved: false }
  | {
      decision: FailureCode | "queued" | "join" | "replay";
      reserved: boolean;
      receipt: Receipt;
      done: Promise<Receipt>;
    };
export type BulbConfig = {
  deviceId: string;
  address: string;
  vendor?: number;
  product?: number;
  firmwareMajor?: number;
  firmwareMinor?: number;
};
export type Options = {
  controllerId: string;
  sourceId: string;
  bulbs: BulbConfig[];
  timeoutMs?: number;
  retries?: number;
  maxPending?: number;
  now?: () => number;
  transportFactory?: (bulb: Readonly<BulbConfig>) => Transport;
  /** Where per-bulb Work/Quiet/Free modes persist. Without one, no bulb has modes: a
   * qualified bulb still advertises `modes: {supported: false}` and `mode.set` is
   * `unsupported-capability`. The owning host supplies this path; the package has no
   * default of its own, so source tests never touch a real home directory. */
  modeStateRoot?: string;
};
/** Qualified bulbs advertise these modes only when `modeStateRoot` is configured; unqualified bulbs never do. */
export const SUPPORTED_MODES: readonly Mode[] = ["Work", "Quiet", "Free"];
/** Absolute integer HSBK in LIFX wire units, mirroring `protocol.ts`'s `Hsbk`. */
export type PaintHsbk = { hue: number; saturation: number; brightness: number; kelvin: number };
/** A private, non-public command kind: never accepted by `parsed()`/`submit()` or the public
 * lighting profile schema, so no external caller can reach it. It exists only so the automatic
 * status paint shares the bulb's queue, request namespace and generation/cancellation rules.
 * It is never listed in `lighting.pending`, which `lifx-light` 1.0.0 cannot express (#450);
 * its receipt still reaches `lastOutcome` and `lastSuccessfulSend`. */
const PAINT_KIND = "lifx.internal.status-paint" as const;
type PaintCommand = { kind: typeof PAINT_KIND } & PaintHsbk;
type PaintRequest = { profile: typeof LIFX_PROFILE; requestId: Ticket; command: PaintCommand };
type Entry = {
  request: AnyRequest | PaintRequest;
  receipt: Receipt;
  done: Promise<Receipt>;
  resolve: (r: Receipt) => void;
};
type Job = { run: () => Promise<void> };
function modeFile(root: string, deviceId: string): string {
  return join(root, createHash("sha256").update(deviceId).digest("hex") + ".json");
}
const MAX_MODE_FILE_BYTES = 256;
/** Creates the directory if missing, then requires it be a real directory owned by this
 * process with no group/world permission bits. A pre-existing unsafe directory (wrong
 * owner, symlink or group/world readable) fails closed rather than being reused. */
function safeModeDir(root: string): boolean {
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(root);
    return (
      stat.isDirectory() &&
      stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0
    );
  } catch {
    return false;
  }
}
/** Missing file, symlink, wrong owner/permissions, oversize or invalid JSON all default to
 * Free, per the owner's decision. Opened with `O_NOFOLLOW` so a symlinked path never
 * resolves outside the mode directory. */
function readPersistedMode(root: string, deviceId: string): Mode {
  if (!safeModeDir(root)) return "Free";
  let fd: number | undefined;
  try {
    fd = openSync(
      modeFile(root, deviceId),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > MAX_MODE_FILE_BYTES
    )
      return "Free";
    const buffer = Buffer.alloc(MAX_MODE_FILE_BYTES + 1);
    let count = 0;
    for (;;) {
      const size = readSync(fd, buffer, count, buffer.length - count, null);
      if (size === 0) break;
      count += size;
      if (count > MAX_MODE_FILE_BYTES) return "Free";
    }
    const value = JSON.parse(buffer.subarray(0, count).toString("utf8"));
    if (object(value) && SUPPORTED_MODES.includes(value.mode as Mode)) {
      return value.mode as Mode;
    }
  } catch {
    /* missing, symlinked, unreadable or invalid: default to Free */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return "Free";
}
/** Atomic, owner-only write: an exclusive, non-following temp file at 0600 in the same
 * directory, then an atomic rename. Throws (causing a failed receipt) when the directory
 * is unsafe or the write itself fails; never falls back to an unsafe location. */
function writePersistedMode(root: string, deviceId: string, mode: Mode): void {
  if (!safeModeDir(root)) throw new Error("unsafe-mode-directory");
  const path = modeFile(root, deviceId);
  const tmp = `${path}.tmp-${randomUUID()}`;
  let fd: number | undefined;
  try {
    fd = openSync(
      tmp,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    );
    const bytes = Buffer.from(JSON.stringify({ mode }), "utf8");
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed or invalid: nothing more to release */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw error;
  }
}
const clone = <T>(x: T): T => structuredClone(x);
const same = (a: Ticket, b: Ticket) =>
  a.epoch === b.epoch && a.sequence === b.sequence;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!object(a) || !object(b)) return false;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
}
function parsed(v: unknown): v is AnyRequest {
  if (validate("request", v)) return true;
  if (!object(v) || !object(v.profile) || !object(v.command)) return false;
  const { profile, command, ...rest } = v;
  return (
    validate("request", {
      ...rest,
      command: { kind: "power.set", on: true },
    }) && (profileRequest(v) as boolean)
  );
}
function normalized(r: AnyRequest): Request {
  if (!("profile" in r)) return r;
  const { profile, command, ...rest } = r;
  return { ...rest, command: { kind: "power.set", on: true } };
}
class Bulb {
  readonly epoch = randomUUID();
  readonly transport: Transport;
  readonly qualified: boolean;
  revision = 0;
  generation: Ticket = { epoch: this.epoch, sequence: 0 };
  next = 0;
  cursor = 0;
  closed = false;
  jobs: Job[] = [];
  running = false;
  pending: Entry[] = [];
  cache: { request: AnyRequest | PaintRequest; receipt: Receipt }[] = [];
  active?: AbortController;
  observation?: { state: LightState; at: number };
  /** The persisted Work/Quiet/Free mode. Read once at construction; changed only by an
   * admitted, successfully persisted `mode.set`. A bulb with no recorded mode starts Free. */
  mode: Mode;
  readonly #modeRoot?: string;
  readonly #modeListeners = new Set<() => void>();
  /** Modes exist only for a qualified bulb whose owner configured a mode state root. */
  get #modesEnabled(): boolean {
    return this.qualified && this.#modeRoot !== undefined;
  }
  desired: Snapshot["state"]["desired"] = {
    power: { status: "unknown" },
    brightness: { status: "unknown" },
    mode: { status: "unknown" },
  };
  lastSend: Snapshot["state"]["lastSuccessfulSend"] = { status: "unknown" };
  lastOutcome: Snapshot["state"]["lastOutcome"] = { status: "unknown" };
  health: Snapshot["serviceHealth"] = "unknown";
  constructor(
    readonly config: BulbConfig,
    readonly options: Required<
      Pick<
        Options,
        | "controllerId"
        | "sourceId"
        | "timeoutMs"
        | "retries"
        | "maxPending"
        | "now"
      >
    >,
    factory: (b: Readonly<BulbConfig>) => Transport,
    modeRoot: string | undefined,
  ) {
    this.qualified =
      config.vendor === 1 &&
      config.product === 27 &&
      config.firmwareMajor === 2 &&
      config.firmwareMinor === 90;
    this.transport = factory(Object.freeze({ ...config }));
    this.#modeRoot = modeRoot;
    this.mode =
      this.qualified && modeRoot !== undefined
        ? readPersistedMode(modeRoot, config.deviceId)
        : "Free";
    if (this.#modesEnabled) {
      this.desired.mode = { status: "known", value: this.mode };
    }
  }
  /** Subscribe to a successful `mode.set`. Returns an unsubscribe function. */
  onModeChange(listener: () => void): () => void {
    this.#modeListeners.add(listener);
    return () => this.#modeListeners.delete(listener);
  }
  clock() {
    return {
      domain: "controller-monotonic" as const,
      epoch: this.epoch,
      sampledAtMs: this.options.now(),
    };
  }
  capabilities(): Snapshot["capabilities"] {
    return {
      power: { supported: this.qualified },
      brightness: this.qualified
        ? { supported: true, minimum: 0, maximum: 100 }
        : { supported: false },
      media: { supported: false },
      zones: { supported: false },
      scenes: { supported: false },
      preview: { supported: false },
      modes: this.#modesEnabled
        ? { supported: true, values: [...SUPPORTED_MODES] }
        : { supported: false },
    };
  }
  snapshot() {
    const clock = this.clock();
    const obs = this.observation;
    const controller: Snapshot = {
      apiVersion: "1.0",
      identity: {
        controllerId: this.options.controllerId,
        sourceId: this.options.sourceId,
        deviceId: this.config.deviceId,
        controllerEpoch: this.epoch,
      },
      configurationRevision: this.revision,
      generation: clone(this.generation),
      nextRequestId: { epoch: this.epoch, sequence: this.next },
      cursor: { epoch: this.epoch, sequence: this.cursor },
      sampleClock: clock,
      serviceHealth: this.health,
      capabilities: this.capabilities(),
      limits: {
        maxPending: this.options.maxPending,
        maxBodyBytes: 65536,
        maxInFlight: this.options.maxPending,
        maxReceipts: 256,
        maxEvents: 1,
        maxStreams: 1,
        authenticationTimeoutMs: 1,
      },
      state: {
        desired: clone(this.desired),
        pending: this.pending
          .filter((e) => !("profile" in e.request))
          .map((e) => ({
            requestId: clone(e.request.requestId),
            command: clone(e.request.command) as Request["command"],
            generation: clone(e.receipt.generation),
          })),
        lastSuccessfulSend: clone(this.lastSend),
        lastOutcome: clone(this.lastOutcome),
        externalControl: { status: "unknown" },
        observation: obs
          ? {
              status: "known",
              clock: { ...clock, sampledAtMs: obs.at },
              evidenceAgeMs: Math.max(0, clock.sampledAtMs - obs.at),
              power: { status: "known", value: obs.state.power },
              brightness: {
                status: "known",
                value: Math.round((obs.state.color.brightness * 100) / 65535),
              },
            }
          : { status: "unknown" },
      },
    };
    return {
      profile: LIFX_PROFILE,
      controller,
      lighting: {
        capabilities: {
          color: this.qualified,
          temperature: this.qualified ? { minimum: 1500, maximum: 9000 } : null,
          effects: false,
        },
        pending: this.pending
          .filter((e) => "profile" in e.request && e.request.command.kind !== PAINT_KIND)
          .map((e) => ({
            requestId: clone(e.request.requestId),
            command: clone(e.request.command),
          })),
        observation: obs
          ? {
              status: "known" as const,
              color: clone(obs.state.color),
              readAt: { ...clock, sampledAtMs: obs.at },
              evidenceAgeMs: Math.max(0, clock.sampledAtMs - obs.at),
            }
          : { status: "unknown" as const },
        visible: { status: "unknown" as const },
      },
    };
  }
  retain(request: AnyRequest | PaintRequest, receipt: Receipt) {
    this.cache.push({ request: clone(request), receipt: clone(receipt) });
    if (this.cache.length > 256) this.cache.shift();
    this.lastOutcome = { status: "known", receipt: clone(receipt) };
    this.cursor++;
  }
  submit(value: AnyRequest): Submission {
    const r = clone(value);
    const cached = this.cache.find((e) =>
      same(e.request.requestId, r.requestId),
    );
    if (cached)
      return equal(cached.request, r)
        ? {
            decision: "replay",
            reserved: false,
            receipt: clone(cached.receipt),
            done: Promise.resolve(clone(cached.receipt)),
          }
        : { decision: "request-conflict", reserved: false };
    const pending = this.pending.find((e) =>
      same(e.request.requestId, r.requestId),
    );
    if (pending)
      return equal(pending.request, r)
        ? {
            decision: "join",
            reserved: false,
            receipt: clone(pending.receipt),
            done: pending.done.then(clone),
          }
        : { decision: "request-conflict", reserved: false };
    const req = normalized(r);
    const state: AdmissionState = {
      controllerId: this.options.controllerId,
      deviceId: this.config.deviceId,
      epoch: this.epoch,
      nextSequence: this.next,
      configurationRevision: this.revision,
      generation: this.generation,
      capabilities: this.capabilities(),
      maxBodyBytes: 65536,
      maxInFlight: this.options.maxPending,
      maxQueue: this.options.maxPending,
      maxReceipts: 256,
      inFlight: this.jobs.length,
      queueDepth: this.closed ? this.options.maxPending : this.jobs.length,
      cache: [],
      pending: [],
    };
    const auth = {
      credential: {
        kind: "machine" as const,
        status: "active" as const,
        declared: true,
        devices: [this.config.deviceId],
        scopes: ["control" as const],
      },
      deviceId: this.config.deviceId,
      scope: "control" as const,
      hostAllowed: true,
      originPresent: false,
      originAllowed: false,
      fetchMetadataAllowed: true,
    };
    const result = admit({
      state,
      auth,
      request: req,
      bodyBytes: Buffer.byteLength(JSON.stringify(r)),
    });
    if (!result.reserved || !result.receipt)
      return { decision: result.decision as FailureCode, reserved: false };
    const receipt = result.receipt;
    this.next = result.nextSequence;
    this.revision = receipt.configurationRevision;
    if (result.decision !== "queued") {
      this.retain(r, receipt);
      return {
        decision: result.decision as FailureCode,
        reserved: true,
        receipt: clone(receipt),
        done: Promise.resolve(clone(receipt)),
      };
    }
    if (r.command.kind === "power.set")
      this.desired.power = { status: "known", value: r.command.on };
    if (r.command.kind === "brightness.set")
      this.desired.brightness = { status: "known", value: r.command.percent };
    let resolve!: (r: Receipt) => void;
    const done = new Promise<Receipt>((res) => (resolve = res));
    const entry = { request: r, receipt, done, resolve };
    this.pending.push(entry);
    this.cursor++;
    this.enqueue(async () => {
      await this.execute(entry);
      this.pending.splice(this.pending.indexOf(entry), 1);
      this.retain(r, receipt);
      resolve(clone(receipt));
    });
    return {
      decision: "queued",
      reserved: true,
      receipt: clone(receipt),
      done: done.then(clone),
    };
  }
  /** The current drain-to-empty cycle, if one is running; used by `closeGracefully` to wait
   * for an active job (and every job queued behind it) without aborting the active one. */
  draining?: Promise<void>;
  enqueue(run: () => Promise<void>) {
    this.jobs.push({ run });
    if (!this.running) this.draining = this.drain();
  }
  async drain() {
    this.running = true;
    while (this.jobs.length) {
      await this.jobs[0].run();
      this.jobs.shift();
    }
    this.running = false;
  }
  async exchange(
    type: number,
    payload: Buffer,
    expected: number,
    generation: Ticket,
  ): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      if (this.closed || !same(generation, this.generation))
        throw new Error("cancelled");
      const abort = new AbortController();
      this.active = abort;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort!: () => void;
      const stop = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("cancelled"));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          reject(new Error("timeout"));
          abort.abort();
        }, this.options.timeoutMs);
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            if (abort.signal.aborted) throw new Error("cancelled");
            return this.transport.exchange(
              type,
              payload,
              expected,
              abort.signal,
            );
          }),
          stop,
        ]);
      } catch {
        if (this.closed || !same(generation, this.generation))
          throw new Error("cancelled");
        if (attempt >= this.options.retries)
          throw new Error("transport-failure");
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", onAbort);
        abort.abort();
        if (this.active === abort) this.active = undefined;
      }
    }
  }
  async read(generation: Ticket) {
    const raw = await this.exchange(101, Buffer.alloc(0), 107, generation);
    const observed = decodeState(raw);
    this.observation = { state: observed, at: this.clock().sampledAtMs };
    this.health = "ready";
    this.cursor++;
    return observed;
  }
  async execute(entry: Entry) {
    const { receipt, request } = entry;
    let writeStarted = false;
    try {
      if (this.closed || !same(receipt.generation, this.generation))
        throw new Error("cancelled");
      if (request.command.kind === "mode.set") {
        // The controller owns the mode: no bulb traffic, no LightGet. The in-memory mode
        // and desired.mode change only after the persisted write succeeds. The contract's
        // receipt schema ties outcome "sent" to priorEffects "confirmed-transmission": there
        // is no valid combination for "succeeded with certainty, nothing was transmitted", so
        // a fully persisted mode change (its own point of effect, with no possibility of a
        // lost transmission) reports the same pairing every genuinely completed write does.
        // admit() already gates mode.set on modes.supported, which requires #modeRoot; this
        // is an extra defensive check, not a reachable path.
        if (this.#modeRoot === undefined) throw new Error("mode-not-configured");
        writePersistedMode(this.#modeRoot, this.config.deviceId, request.command.mode);
        this.mode = request.command.mode;
        this.desired.mode = { status: "known", value: this.mode };
        receipt.outcome = "sent";
        receipt.priorEffects = "confirmed-transmission";
        receipt.completedOperations = ["set"];
        for (const listener of this.#modeListeners) listener();
        return;
      }
      let type: number, payload: Buffer;
      if (request.command.kind === "power.set") {
        type = 21;
        payload = encodePower(request.command.on);
      } else {
        const observed = await this.read(receipt.generation);
        const color = { ...observed.color };
        const command = request.command;
        if (command.kind === "brightness.set")
          color.brightness = Math.round((command.percent * 65535) / 100);
        else if (command.kind === "lifx.color.set") {
          color.hue = Math.round((command.hue * 65535) / 360);
          color.saturation = Math.round((command.saturation * 65535) / 100);
        } else if (command.kind === "lifx.temperature.set")
          color.kelvin = command.kelvin;
        else throw new Error("unsupported");
        type = 102;
        payload = encodeColor(color);
      }
      if (this.closed || !same(receipt.generation, this.generation))
        throw new Error("cancelled");
      writeStarted = true;
      await this.exchange(type, payload, 45, receipt.generation);
      receipt.outcome = "sent";
      receipt.priorEffects = "confirmed-transmission";
      receipt.completedOperations = ["set"];
      this.lastSend = {
        status: "known",
        requestId: clone(request.requestId),
        clock: this.clock(),
        operationIds: ["set"],
      };
      this.health = "ready";
    } catch {
      const cancelled =
        this.closed || !same(receipt.generation, this.generation);
      receipt.outcome = cancelled
        ? "cancelled"
        : writeStarted
          ? "uncertain"
          : "failed";
      receipt.priorEffects = writeStarted ? "possible" : "none";
      receipt.uncertainOperations = writeStarted ? ["set"] : [];
      receipt.failure = {
        code: cancelled
          ? "stale-generation"
          : writeStarted
            ? "uncertain-result"
            // A persisted-mode write failure never touches the bulb; `transport-failure` is the
            // closest code in the closed set for "the attempt could not complete" with no
            // capability, request-shape or generation problem, since the contract has no
            // dedicated local-storage failure code.
            : "transport-failure",
      };
      if (request.command.kind !== "mode.set") this.health = "degraded";
    }
  }
  refresh(): Promise<{ ok: boolean; failure?: FailureCode }> {
    if (this.closed || this.jobs.length >= this.options.maxPending)
      return Promise.resolve({ ok: false, failure: "capacity" });
    const generation = clone(this.generation);
    return new Promise((resolve) =>
      this.enqueue(async () => {
        try {
          await this.read(generation);
          resolve({ ok: true });
        } catch {
          this.health = "degraded";
          resolve({
            ok: false,
            failure:
              this.closed || !same(generation, this.generation)
                ? "stale-generation"
                : "transport-failure",
          });
        }
      }),
    );
  }
  /**
   * The internal absolute status paint: one zero-duration LightSetColor with full HSBK,
   * no LightGet, and no effect on power. It mints its own envelope from this bulb's own
   * next request ID, current revision and generation, exactly like an admitted public
   * command, and shares the same queue, generation-cancellation and receipt shape. Its
   * private command kind is never accepted by `parsed()`/`submit()` or the HTTP routes,
   * so no external caller can reach it. A paint that loses a race for queue capacity is
   * a failed attempt and is not retried; the next transition tries again.
   */
  paintStatus(hsbk: PaintHsbk): Submission {
    // Defense in depth: an unqualified bulb is never painted, even if a caller reaches this
    // directly. No traffic, no pending entry.
    if (!this.qualified) return { decision: "unsupported-capability", reserved: false };
    if (this.closed || this.jobs.length >= this.options.maxPending) {
      return { decision: "capacity", reserved: false };
    }
    const requestId: Ticket = { epoch: this.epoch, sequence: this.next };
    this.next += 1;
    // Transient, like a moment: it paints a color, not a desired configuration change.
    const receipt: Receipt = {
      apiVersion: "1.0",
      controllerId: this.options.controllerId,
      deviceId: this.config.deviceId,
      requestId: clone(requestId),
      configurationRevision: this.revision,
      generation: clone(this.generation),
      outcome: "queued",
      priorEffects: "none",
      completedOperations: [],
      uncertainOperations: [],
    };
    const request: PaintRequest = {
      profile: LIFX_PROFILE,
      requestId,
      command: { kind: PAINT_KIND, ...hsbk },
    };
    let resolve!: (r: Receipt) => void;
    const done = new Promise<Receipt>((res) => (resolve = res));
    const entry: Entry = { request, receipt, done, resolve };
    this.pending.push(entry);
    this.cursor++;
    this.enqueue(async () => {
      await this.executePaint(entry, hsbk);
      this.pending.splice(this.pending.indexOf(entry), 1);
      this.retain(request, receipt);
      resolve(clone(receipt));
    });
    return {
      decision: "queued",
      reserved: true,
      receipt: clone(receipt),
      done: done.then(clone),
    };
  }
  async executePaint(entry: Entry, hsbk: PaintHsbk) {
    const { receipt } = entry;
    let writeStarted = false;
    try {
      if (this.closed || !same(receipt.generation, this.generation))
        throw new Error("cancelled");
      writeStarted = true;
      await this.exchange(102, encodeColor(hsbk), 45, receipt.generation);
      receipt.outcome = "sent";
      receipt.priorEffects = "confirmed-transmission";
      receipt.completedOperations = ["set"];
      this.lastSend = {
        status: "known",
        requestId: clone(entry.request.requestId),
        clock: this.clock(),
        operationIds: ["set"],
      };
      this.health = "ready";
    } catch {
      const cancelled =
        this.closed || !same(receipt.generation, this.generation);
      receipt.outcome = cancelled
        ? "cancelled"
        : writeStarted
          ? "uncertain"
          : "failed";
      receipt.priorEffects = writeStarted ? "possible" : "none";
      receipt.uncertainOperations = writeStarted ? ["set"] : [];
      receipt.failure = {
        code: cancelled
          ? "stale-generation"
          : writeStarted
            ? "uncertain-result"
            : "transport-failure",
      };
      this.health = "degraded";
    }
  }
  cancel() {
    this.generation = {
      epoch: this.epoch,
      sequence: this.generation.sequence + 1,
    };
    this.cursor++;
    this.active?.abort();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
    this.transport.close();
  }
  /**
   * Stops admission and retires every queued (not yet started) job by bumping the
   * generation, but does not abort a job already in flight: unlike `cancel()`/`close()`,
   * it never touches `this.active`. The in-flight job settles on its own, already bounded
   * by `timeoutMs * (retries + 1)`; each job still queued behind it then finds itself
   * cancelled (stale generation) the instant it starts, sending no traffic. Only once every
   * job has settled does it close the transport.
   */
  async closeGracefully(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation = { epoch: this.epoch, sequence: this.generation.sequence + 1 };
    this.cursor++;
    if (this.draining) await this.draining.catch(() => {});
    this.transport.close();
  }
}
/** Trusted in-process owner. An exposing host must authenticate before calling it. */
export class LifxController {
  readonly #bulbs = new Map<string, Bulb>();
  constructor(options: Options) {
    const timeoutMs = options.timeoutMs ?? 500,
      retries = options.retries ?? 1,
      maxPending = options.maxPending ?? 8;
    if (
      !validate("id", options.controllerId) ||
      !validate("id", options.sourceId) ||
      !Array.isArray(options.bulbs) ||
      !int(options.bulbs.length, 1, 32) ||
      !int(timeoutMs, 10, 5000) ||
      !int(retries, 0, 3) ||
      !int(maxPending, 1, 32)
    )
      throw new Error("invalid-lifx-options");
    const seen = new Set<string>(),
      addresses = new Set<string>();
    for (const b of options.bulbs) {
      if (
        !validate("id", b.deviceId) ||
        seen.has(b.deviceId) ||
        addresses.has(b.address)
      )
        throw new Error("invalid-lifx-target");
      new UdpTransport({ address: b.address });
      seen.add(b.deviceId);
      addresses.add(b.address);
    }
    const now = options.now ?? (() => performance.now());
    const modeRoot = options.modeStateRoot;
    const common = {
      controllerId: options.controllerId,
      sourceId: options.sourceId,
      timeoutMs,
      retries,
      maxPending,
      now,
    };
    try {
      for (const b of options.bulbs)
        this.#bulbs.set(
          b.deviceId,
          new Bulb(
            { ...b },
            common,
            options.transportFactory ??
              ((config) => new UdpTransport({ address: config.address })),
            modeRoot,
          ),
        );
    } catch {
      this.close();
      throw new Error("invalid-lifx-transport");
    }
  }
  snapshot(deviceId: string) {
    const b = this.#bulbs.get(deviceId);
    if (!b) throw new Error("unknown-device");
    return b.snapshot();
  }
  submit(value: unknown): Submission {
    if (!parsed(value)) return { decision: "invalid-request", reserved: false };
    const b = this.#bulbs.get(value.deviceId);
    if (!b || value.controllerId !== b.options.controllerId)
      return { decision: "unknown-device", reserved: false };
    return b.submit(value);
  }
  async submitMany(
    requests: unknown[],
  ): Promise<
    { deviceId: string | null; result: Receipt | { decision: FailureCode } }[]
  > {
    if (!Array.isArray(requests) || !int(requests.length, 1, 32))
      throw new Error("invalid-lifx-batch");
    return Promise.all(
      requests.map(async (r) => {
        const sub = this.submit(r);
        return {
          deviceId:
            object(r) &&
            typeof r.deviceId === "string" &&
            validate("id", r.deviceId)
              ? r.deviceId
              : null,
          result: "done" in sub ? await sub.done : { decision: sub.decision },
        };
      }),
    );
  }
  refresh(deviceId: string) {
    return (
      this.#bulbs.get(deviceId)?.refresh() ??
      Promise.resolve({ ok: false, failure: "unknown-device" as const })
    );
  }
  /** The internal absolute status paint for one qualified bulb; see `Bulb#paintStatus`. */
  paintStatus(deviceId: string, hsbk: PaintHsbk): Submission {
    const b = this.#bulbs.get(deviceId);
    if (!b) return { decision: "unknown-device", reserved: false };
    return b.paintStatus(hsbk);
  }
  /** Notifies a listener after a successful `mode.set` for one bulb. Returns an unsubscribe
   * function; throws `unknown-device` for a device this controller does not own. */
  onModeChange(deviceId: string, listener: () => void): () => void {
    const b = this.#bulbs.get(deviceId);
    if (!b) throw new Error("unknown-device");
    return b.onModeChange(listener);
  }
  cancel(deviceId: string) {
    const b = this.#bulbs.get(deviceId);
    if (!b) throw new Error("unknown-device");
    b.cancel();
  }
  close() {
    for (const b of this.#bulbs.values()) b.close();
  }
  /** Graceful shutdown for every bulb: see `Bulb#closeGracefully`. */
  async closeGracefully(): Promise<void> {
    await Promise.all([...this.#bulbs.values()].map((b) => b.closeGracefully()));
  }
}
