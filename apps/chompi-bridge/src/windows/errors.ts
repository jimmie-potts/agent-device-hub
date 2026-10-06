import type { KeyName } from '../os-adapter.js';

export type KeyboardErrorCode =
  | 'invalid-key-request' | 'invalid-volume-request' | 'unknown-key' | 'held-modifier' | 'held-key' | 'key-already-down' | 'keys-held'
  | 'release-pending' | 'send-input-failed' | 'win32-unavailable' | 'adapter-closed';

/** A refused or failed keystroke. `code` is stable; messages carry key names only, never desktop content. */
export class KeyboardError extends Error {
  readonly code: KeyboardErrorCode;
  readonly key: KeyName | undefined;
  readonly inserted: number | undefined;
  readonly expected: number | undefined;
  constructor(code: KeyboardErrorCode, detail: { key?: KeyName; inserted?: number; expected?: number; cause?: unknown } = {}) {
    super(detail.key ? `${code}: ${detail.key}` : code, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.code = code;
    this.key = detail.key;
    this.inserted = detail.inserted;
    this.expected = detail.expected;
  }
}

/** A modifier the adapter did not press is down, so typing now would produce a different shortcut. */
export class HeldModifierError extends KeyboardError {
  constructor(key: KeyName) { super('held-modifier', { key }); }
}

export type OpenUriErrorCode = 'invalid-deep-link' | 'open-uri-failed' | 'win32-unavailable' | 'adapter-closed';

/** A refused or failed deep link. The message never repeats the URI. */
export class OpenUriError extends Error {
  readonly code: OpenUriErrorCode;
  readonly shellResult: number | undefined;
  constructor(code: OpenUriErrorCode, detail: { shellResult?: number; cause?: unknown } = {}) {
    super(code, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.code = code;
    this.shellResult = detail.shellResult;
  }
}
