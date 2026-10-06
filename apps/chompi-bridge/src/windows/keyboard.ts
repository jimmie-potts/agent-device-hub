import { MAX_VOLUME_PRESSES, type KeyName, type KeyRequest, type VolumeKey } from '../os-adapter.js';
import { HeldModifierError, KeyboardError } from './errors.js';

/** One injected key transition. */
export interface KeyEvent { vk: number; up: boolean }

/** The two Win32 calls the keyboard needs, injectable for tests. */
export interface KeyboardApi {
  /** `GetAsyncKeyState` high bit: the key is down now, physically or by earlier injection. */
  isKeyDown(vk: number): boolean;
  /** `SendInput`: how many events Windows inserted, and `GetLastError` when it inserted fewer. */
  sendInput(events: readonly KeyEvent[]): { inserted: number; error: number };
}

const NAMED: ReadonlyArray<readonly [KeyName, number]> = [
  ['Enter', 0x0d], ['LeftShift', 0xa0], ['LeftControl', 0xa2], ['LeftAlt', 0xa4], ['LeftWindows', 0x5b],
];

/** Platform-neutral key names this adapter can type: the named keys above, `A`-`Z` and `0`-`9`. */
export const VIRTUAL_KEYS: ReadonlyMap<KeyName, number> = new Map<KeyName, number>([
  ...NAMED,
  ...Array.from({ length: 26 }, (_, i) => [String.fromCharCode(0x41 + i), 0x41 + i] as const),
  ...Array.from({ length: 10 }, (_, i) => [String(i), 0x30 + i] as const),
]);

/**
 * The Windows volume keys (`VK_VOLUME_UP`, `VK_VOLUME_DOWN`, `VK_VOLUME_MUTE`), typed only by `tapVolume`. They are not
 * in `VIRTUAL_KEYS`, so no profile shortcut can name them and `send` refuses them.
 */
export const VOLUME_KEYS: ReadonlyMap<VolumeKey, number> = new Map<VolumeKey, number>([['VolumeUp', 0xaf], ['VolumeDown', 0xae], ['VolumeMute', 0xad]]);

const NAMES = new Map<number, KeyName>([...VIRTUAL_KEYS, ...VOLUME_KEYS].map(([name, vk]) => [vk, name]));

export function virtualKeyCode(name: KeyName): number {
  const vk = typeof name === 'string' ? VIRTUAL_KEYS.get(name) : undefined;
  if (vk === undefined) throw new KeyboardError('unknown-key', { key: typeof name === 'string' ? name.slice(0, 32) : undefined });
  return vk;
}

/** Every modifier code `GetAsyncKeyState` can report, with the side-specific codes that satisfy a generic one. */
const MODIFIERS: ReadonlyArray<readonly [number, string, readonly number[]]> = [
  [0x10, 'Shift', [0xa0, 0xa1]], [0x11, 'Control', [0xa2, 0xa3]], [0x12, 'Alt', [0xa4, 0xa5]],
  [0xa0, 'LeftShift', [0xa0]], [0xa1, 'RightShift', [0xa1]], [0xa2, 'LeftControl', [0xa2]], [0xa3, 'RightControl', [0xa3]],
  [0xa4, 'LeftAlt', [0xa4]], [0xa5, 'RightAlt', [0xa5]], [0x5b, 'LeftWindows', [0x5b]], [0x5c, 'RightWindows', [0x5c]],
];
const MODIFIER_CODES = new Set(MODIFIERS.map(([vk]) => vk));

const MAX_KEYS = 8;
const RELEASE_ATTEMPTS = 3;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const INPUT_KEYBOARD = 1;

/** Size of a Win32 `INPUT` record on 64-bit Windows: type, padding, then the 32-byte union. */
export const INPUT_SIZE = 40;

/** Navigation keys, the Windows keys and the volume keys carry the `E0` scan-code prefix. */
const isExtended = (vk: number) => (vk >= 0x21 && vk <= 0x28) || vk === 0x2d || vk === 0x2e || vk === 0x5b || vk === 0x5c || (vk >= 0xad && vk <= 0xaf);

/** Encodes keyboard `INPUT` records for `SendInput` (64-bit layout; `KEYBDINPUT` starts at offset 8). */
export function encodeKeyboardInputs(events: readonly KeyEvent[]): Buffer {
  const buffer = Buffer.alloc(events.length * INPUT_SIZE);
  events.forEach((event, index) => {
    const offset = index * INPUT_SIZE;
    buffer.writeUInt32LE(INPUT_KEYBOARD, offset);
    buffer.writeUInt16LE(event.vk, offset + 8);
    buffer.writeUInt32LE((event.up ? KEYEVENTF_KEYUP : 0) | (isExtended(event.vk) ? KEYEVENTF_EXTENDEDKEY : 0), offset + 12);
  });
  return buffer;
}

function parseRequest(request: KeyRequest): { action: KeyRequest['action']; codes: number[] } {
  const action = (request as Partial<KeyRequest> | null)?.action;
  const keys = (request as Partial<KeyRequest> | null)?.keys;
  if ((action !== 'down' && action !== 'up' && action !== 'tap') || !Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) {
    throw new KeyboardError('invalid-key-request');
  }
  const codes = keys.map(virtualKeyCode);
  if (new Set(codes).size !== codes.length) throw new KeyboardError('invalid-key-request');
  return { action, codes };
}

/**
 * Held-key tracking over `SendInput`. A tap is one complete down/up batch; `down` and `up` hold and release a chord.
 * Typing is refused while a modifier the adapter did not press is down, and after any partial insertion the inserted
 * prefix is released. Key-up recovery never replays a key-down.
 */
export class Keyboard {
  private readonly api: KeyboardApi;
  /** Keys this adapter pressed and has not released, in press order. */
  private readonly down: number[] = [];
  private pending = false;

  constructor(api: KeyboardApi) { this.api = api; }

  get held(): KeyName[] { return this.down.map(vk => NAMES.get(vk) ?? `vk-${vk}`); }

  /** True when a failed send left keys this adapter could not release; sends are refused until `releaseAll` succeeds. */
  get recoveryPending(): boolean { return this.pending; }

  send(request: KeyRequest): void {
    const { action, codes } = parseRequest(request);
    if (this.pending) throw new KeyboardError('release-pending');
    if (action === 'up') {
      const ups = codes.filter(vk => this.down.includes(vk)).reverse().map(vk => ({ vk, up: true }));
      if (ups.length > 0) this.dispatch(ups);
      return;
    }
    if (action === 'tap' && this.down.length > 0) throw new KeyboardError('keys-held');
    const already = codes.find(vk => this.down.includes(vk));
    if (already !== undefined) throw new KeyboardError('key-already-down', { key: NAMES.get(already) });
    this.checkPhysical(codes);
    const downs = codes.map(vk => ({ vk, up: false }));
    this.dispatch(action === 'tap' ? [...downs, ...[...codes].reverse().map(vk => ({ vk, up: true }))] : downs);
  }

  /**
   * Taps a volume key `presses` times in one batch of down/up pairs. Like a `tap`, it is refused while this adapter
   * holds any key, so a volume key can never join the held dictation chord, and while the user holds a modifier.
   */
  tapVolume(key: VolumeKey, presses: number): void {
    const vk = typeof key === 'string' ? VOLUME_KEYS.get(key) : undefined;
    if (vk === undefined || !Number.isInteger(presses) || presses < 1 || presses > MAX_VOLUME_PRESSES) throw new KeyboardError('invalid-volume-request');
    if (this.pending) throw new KeyboardError('release-pending');
    if (this.down.length > 0) throw new KeyboardError('keys-held');
    this.checkPhysical([vk]);
    this.dispatch(Array.from({ length: presses }, () => [{ vk, up: false }, { vk, up: true }]).flat());
  }

  /** Releases every key this adapter holds. Never throws; returns whether nothing remains held. */
  releaseAll(): boolean {
    for (let attempt = 0; attempt < RELEASE_ATTEMPTS && this.down.length > 0; attempt += 1) {
      const ups = [...this.down].reverse().map(vk => ({ vk, up: true }));
      try {
        this.track(ups, this.api.sendInput(ups).inserted);
      } catch {
        // Keep the exact outstanding set for the next attempt.
      }
    }
    this.pending = this.down.length > 0;
    return !this.pending;
  }

  private checkPhysical(codes: readonly number[]): void {
    for (const [vk, name, satisfiedBy] of MODIFIERS) {
      if (this.api.isKeyDown(vk) && !satisfiedBy.some(code => this.down.includes(code))) throw new HeldModifierError(name);
    }
    for (const vk of codes) {
      if (!MODIFIER_CODES.has(vk) && this.api.isKeyDown(vk)) throw new KeyboardError('held-key', { key: NAMES.get(vk) });
    }
  }

  private dispatch(events: readonly KeyEvent[]): void {
    let inserted: number;
    try {
      inserted = this.api.sendInput(events).inserted;
    } catch (cause) {
      // The inserted prefix is unknown: treat every attempted key-down as possibly down and recover them all.
      for (const event of events) if (!event.up && !this.down.includes(event.vk)) this.down.push(event.vk);
      this.releaseAll();
      throw new KeyboardError('send-input-failed', { inserted: 0, expected: events.length, cause });
    }
    this.track(events, inserted);
    if (inserted !== events.length) {
      this.releaseAll();
      throw new KeyboardError('send-input-failed', { inserted, expected: events.length });
    }
  }

  private track(events: readonly KeyEvent[], inserted: number): void {
    const count = Math.max(0, Math.min(events.length, Number.isInteger(inserted) ? inserted : 0));
    for (const event of events.slice(0, count)) {
      const index = this.down.indexOf(event.vk);
      if (event.up) { if (index >= 0) this.down.splice(index, 1); } else if (index < 0) this.down.push(event.vk);
    }
  }
}
