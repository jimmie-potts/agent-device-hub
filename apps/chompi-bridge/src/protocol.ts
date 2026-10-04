/**
 * CHOMPI HID protocol version 1 codec. The contract and its fixture vectors live in
 * packages/chompi-protocol; this module implements them exactly and adds no task meaning.
 */

export const PROTOCOL_VERSION = 1;
export const REPORT_BYTES = 64;
export const CONTROL_COUNT = 34;
export const ENCODER_COUNT = 6;
export const LED_COUNT = 35;
/** Part 0 carries LEDs 0-18, part 1 carries LEDs 19-34. */
export const LED_PARTS = [{ first: 0, count: 19 }, { first: 19, count: 16 }] as const;

const TYPE = { hello: 0x01, input: 0x02, heartbeat: 0x03, leds: 0x81, hostHeartbeat: 0x82 } as const;
const KIND_CODES = { press: 1, release: 2, turn: 3 } as const;
const KINDS = ['press', 'release', 'turn'] as const;

export const REJECT_REASONS = [
  'unknown-type', 'unsupported-version', 'invalid-length', 'invalid-control', 'invalid-kind',
  'invalid-delta', 'invalid-led-range', 'invalid-brightness', 'incompatible-device',
] as const;
export type RejectReason = typeof REJECT_REASONS[number];

export type Rgb = readonly [number, number, number];
export type InputKind = typeof KINDS[number];

export interface HelloMessage { type: 'hello'; version: 1; epoch: number; firmware: [number, number, number]; controls: number; encoders: number; leds: number }
export interface InputMessage { type: 'input'; version: 1; epoch: number; sequence: number; control: number; kind: InputKind; delta: number }
export interface HeartbeatMessage { type: 'heartbeat'; version: 1; epoch: number; ledFrame: number; hostAlive: boolean }
export interface LedsMessage { type: 'leds'; version: 1; frame: number; part: 0 | 1; first: number; colors: Rgb[] }
export interface HostHeartbeatMessage { type: 'host-heartbeat'; version: 1; profileVersion: number; brightnessPercent: number }

export type DeviceMessage = HelloMessage | InputMessage | HeartbeatMessage;
export type HostMessage = LedsMessage | HostHeartbeatMessage;
export type Message = DeviceMessage | HostMessage;
export type DecodeResult<T> = { ok: true; message: T } | { ok: false; reason: RejectReason };

/** IDs 1-34: key and encoder clicks, which press and release. */
export function isPressControl(id: number): boolean { return Number.isInteger(id) && id >= 1 && id <= CONTROL_COUNT; }
/** IDs 41-46: encoder turns. */
export function isTurnControl(id: number): boolean { return Number.isInteger(id) && id >= 41 && id < 41 + ENCODER_COUNT; }

const reject = (reason: RejectReason): { ok: false; reason: RejectReason } => ({ ok: false, reason });
const u16 = (r: Uint8Array, at: number) => r[at]! | (r[at + 1]! << 8);
const u32 = (r: Uint8Array, at: number) => (r[at]! | (r[at + 1]! << 8) | (r[at + 2]! << 16) | (r[at + 3]! << 24)) >>> 0;
const i8 = (value: number) => (value << 24) >> 24;

/** Shared header checks, in the contract's order: length, version, then type. Field checks follow. */
function header(report: Uint8Array, types: readonly number[]): RejectReason | undefined {
  if (report.length !== REPORT_BYTES) return 'invalid-length';
  if (report[1] !== PROTOCOL_VERSION) return 'unsupported-version';
  if (!types.includes(report[0]!)) return 'unknown-type';
  return undefined;
}

function inputProblem(control: number, kind: number, delta: number): RejectReason | undefined {
  if (!isPressControl(control) && !isTurnControl(control)) return 'invalid-control';
  if (kind < 1 || kind > 3) return 'invalid-kind';
  const turn = kind === KIND_CODES.turn;
  if (turn !== isTurnControl(control)) return 'invalid-kind';
  if (turn ? delta === 0 : delta !== 0) return 'invalid-delta';
  return undefined;
}

/** Decodes a report received from the controller. Unknown fields stay ignored; invalid reports carry the contract reason. */
export function decodeDeviceReport(report: Uint8Array): DecodeResult<DeviceMessage> {
  const problem = header(report, [TYPE.hello, TYPE.input, TYPE.heartbeat]);
  if (problem) return reject(problem);
  const epoch = u16(report, 2);
  switch (report[0]) {
    case TYPE.hello: {
      const [controls, encoders, leds] = [report[7]!, report[8]!, report[9]!];
      if (epoch === 0 || controls !== CONTROL_COUNT || encoders !== ENCODER_COUNT || leds !== LED_COUNT) return reject('incompatible-device');
      return { ok: true, message: { type: 'hello', version: 1, epoch, firmware: [report[4]!, report[5]!, report[6]!], controls, encoders, leds } };
    }
    case TYPE.input: {
      const [control, kind, delta] = [report[6]!, report[7]!, i8(report[8]!)];
      const invalid = inputProblem(control, kind, delta);
      if (invalid) return reject(invalid);
      return { ok: true, message: { type: 'input', version: 1, epoch, sequence: u16(report, 4), control, kind: KINDS[kind - 1]!, delta } };
    }
    default:
      return { ok: true, message: { type: 'heartbeat', version: 1, epoch, ledFrame: u16(report, 4), hostAlive: (report[6]! & 1) === 1 } };
  }
}

/** Decodes a report sent by the host; the simulator uses it to play the device side. */
export function decodeHostReport(report: Uint8Array): DecodeResult<HostMessage> {
  const problem = header(report, [TYPE.leds, TYPE.hostHeartbeat]);
  if (problem) return reject(problem);
  if (report[0] === TYPE.hostHeartbeat) {
    const brightnessPercent = report[6]!;
    if (brightnessPercent > 100) return reject('invalid-brightness');
    return { ok: true, message: { type: 'host-heartbeat', version: 1, profileVersion: u32(report, 2), brightnessPercent } };
  }
  const part = report[4]!;
  if (part !== 0 && part !== 1) return reject('invalid-led-range');
  const { first, count } = LED_PARTS[part];
  if (report[5] !== count) return reject('invalid-led-range');
  const colors: Rgb[] = [];
  for (let i = 0; i < count; i++) colors.push([report[6 + i * 3]!, report[7 + i * 3]!, report[8 + i * 3]!]);
  return { ok: true, message: { type: 'leds', version: 1, frame: u16(report, 2), part, first, colors } };
}

function check(condition: boolean, what: string): void { if (!condition) throw new RangeError(`invalid ${what}`); }
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** Validates one RGB triple of integers 0-255. */
export function isRgb(value: unknown): value is Rgb {
  return Array.isArray(value) && value.length === 3 && value.every(channel => isInt(channel, 0, 255));
}

/**
 * Encodes a message to a zero-filled 64-byte report. Throws RangeError for any message a receiver would reject,
 * except `hello` compatibility (epoch 0, other counts), which tests need to produce.
 */
export function encodeReport(message: Message): Uint8Array {
  const r = new Uint8Array(REPORT_BYTES);
  const put16 = (at: number, value: number) => { r[at] = value & 0xff; r[at + 1] = value >> 8; };
  check(message.version === PROTOCOL_VERSION, 'version');
  r[1] = PROTOCOL_VERSION;
  switch (message.type) {
    case 'hello':
      check(isInt(message.epoch, 0, 0xffff) && message.firmware.length === 3 && message.firmware.every(n => isInt(n, 0, 255))
        && [message.controls, message.encoders, message.leds].every(n => isInt(n, 0, 255)), 'hello');
      r[0] = TYPE.hello; put16(2, message.epoch); r.set(message.firmware, 4); r.set([message.controls, message.encoders, message.leds], 7);
      return r;
    case 'input': {
      const kind = KIND_CODES[message.kind];
      check(isInt(message.epoch, 0, 0xffff) && isInt(message.sequence, 0, 0xffff) && isInt(message.delta, -128, 127)
        && kind !== undefined && inputProblem(message.control, kind, message.delta) === undefined, 'input');
      r[0] = TYPE.input; put16(2, message.epoch); put16(4, message.sequence); r[6] = message.control; r[7] = kind; r[8] = message.delta & 0xff;
      return r;
    }
    case 'heartbeat':
      check(isInt(message.epoch, 0, 0xffff) && isInt(message.ledFrame, 0, 0xffff), 'heartbeat');
      r[0] = TYPE.heartbeat; put16(2, message.epoch); put16(4, message.ledFrame); r[6] = message.hostAlive ? 1 : 0;
      return r;
    case 'leds': {
      const layout = LED_PARTS[message.part];
      check(layout !== undefined && message.first === layout.first && message.colors.length === layout.count && isInt(message.frame, 0, 0xffff)
        && message.colors.every(isRgb), 'leds');
      r[0] = TYPE.leds; put16(2, message.frame); r[4] = message.part; r[5] = layout.count;
      message.colors.forEach((color, i) => r.set(color, 6 + i * 3));
      return r;
    }
    case 'host-heartbeat':
      check(isInt(message.profileVersion, 0, 0xffffffff) && isInt(message.brightnessPercent, 0, 100), 'host-heartbeat');
      r[0] = TYPE.hostHeartbeat;
      put16(2, message.profileVersion & 0xffff); put16(4, message.profileVersion >>> 16); r[6] = message.brightnessPercent;
      return r;
    default:
      throw new RangeError('invalid message type');
  }
}

/** Splits one 35-color frame into its two `leds` reports. */
export function ledFrameReports(frame: number, colors: readonly Rgb[]): [Uint8Array, Uint8Array] {
  check(colors.length === LED_COUNT && colors.every(isRgb), 'LED frame');
  const part = (index: 0 | 1) => {
    const { first, count } = LED_PARTS[index];
    return encodeReport({ type: 'leds', version: 1, frame, part: index, first, colors: colors.slice(first, first + count) as Rgb[] });
  };
  return [part(0), part(1)];
}
