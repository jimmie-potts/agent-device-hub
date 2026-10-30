// Filtered exception fields for a private diagnostic record (ADR 0012 "Safe errors", amended 2026-10-30; Hub #777).
// This is the one place that reads an exception's message and stack. It reads only an `Error`'s own `message` and the
// stack V8 itself formats, never a getter a value supplies, a cause or anything else on the object. The text it keeps
// is bounded and filtered: registered secrets, authorization values, credential-bearing URL parts, well-known key
// shapes and long opaque tokens become `[redacted]`, and long quoted or JSON-shaped segments, which may be a request
// body, a prompt or a transcript, become `[omitted]`. The record says how many segments it replaced and whether it cut
// the text. Error bodies, health, history and span names keep their registry codes and fixed text; this is only for
// the private diagnostic path of the diagnostic contract's profile 1.7. Every step is linear in a pre-cut input, so a
// module's message of any size costs a bounded amount of the runtime's time.
import {types} from 'node:util';

/** The longest `exception.message` a record carries, in characters and in serialized (JSON-escaped) UTF-8 bytes. */
export const MAX_EXCEPTION_MESSAGE = 1024;
/** The longest `exception.stacktrace` a record carries, in characters and in serialized (JSON-escaped) UTF-8 bytes. */
export const MAX_EXCEPTION_STACKTRACE = 4096;
/** What replaces a credential-like segment. */
export const REDACTED = '[redacted]';
/** What replaces a segment that may be a payload: a long quoted string or a long JSON-shaped block. */
export const OMITTED = '[omitted]';
const TRUNCATED = '[truncated]';
/** How much raw text is read before filtering, as a multiple of the limit: omission and redaction only shorten it. */
const PRECUT = 4;
/** The longest payload-like segment the scanner looks for; a longer one is cut by the limit anyway. */
const MAX_SEGMENT = 4096;
/** A quoted string or JSON-shaped block of this many characters or more is a payload, not a value. */
const PAYLOAD_LENGTH = 128;

/** The attributes `exceptionFields` adds to a record, registered by profile 1.7 of the diagnostic contract. */
export type ExceptionFields = Readonly<{
  'exception.message'?: string;
  'exception.stacktrace'?: string;
  /** How many segments the filters replaced, with `[redacted]` or `[omitted]`, across both texts. Absent with no text. */
  'bunny.exception.redacted_count'?: number;
  /** Whether either text was cut to its limit. Absent with no text. */
  'bunny.exception.truncated'?: boolean;
}>;

/**
 * A caller's own filter, run before the built-in rules: the runtime passes the secrets its modules read, so a token a
 * library quoted whole is replaced even when no rule recognizes its shape. It returns the text and how many segments it
 * replaced.
 */
export type ExceptionFilter = (text: string) => {text: string; replaced: number};

export type ExceptionOptions = {
  readonly filter?: ExceptionFilter;
  /**
   * The text is a stack whose header, the error's name and this message, ends before its frames. A payload in the header
   * is bounded by the header's end, one in a frame by the next frame; without this, the whole text is one message and a
   * payload may run to its end. A stack whose header holds no such message is bounded at its first frame.
   */
  readonly stackOf?: string;
};

/** One text after the filters and the bound: what it became, how many segments were replaced, whether it was cut. */
export type FilteredText = {text: string; replaced: number; truncated: boolean};

type Rule = readonly [pattern: RegExp, replacement: string | ((match: string) => string)];

// Each rule runs once over the text, with the global flag and no nested quantifier over the same characters, so a
// replacement count is a count of segments and the cost grows with the text's length.
const CREDENTIAL_RULES: readonly Rule[] = [
  // A cookie header takes the whole line: every pair in it is a credential.
  [/\b((?:set-)?cookie\s*[:=]\s*)[^\n]+/gi, `$1${REDACTED}`],
  // An authorization-like header or key with its value, in `name: value` or `name=value` form, keeping a scheme word.
  [/\b((?:proxy-)?authorization|x-api-key|api[-_]?key|x-auth-token)(\s*[:=]\s*)((?:(?:bearer|basic|digest)\s+)?)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, `$1$2$3${REDACTED}`],
  // A scheme and its credential: `Bearer <token>`, `Basic <base64>`.
  [/\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // A URL's user information.
  [/(\/\/)[^/\s@]{1,256}@/g, `$1${REDACTED}@`],
  // A parameter, field or YAML-style member that names a credential, as `name=value`, `name: value` or `name="value"`.
  [/\b((?:access_?token|refresh_?token|id_?token|token|secret|client_?secret|password|passwd|pwd|api_?key|apikey|private_?key)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^&\s"';,]+)/gi, `$1${REDACTED}`],
  // A name a library's prose also uses (`unexpected server response: 502`, `invalid key: brightness`) is a credential
  // only as a parameter, `name=value`, or with a quoted value.
  [/\b((?:key|auth|signature|sig|response)\s*(?:=\s*|:\s*(?=["'])))(?:"[^"\n]*"|'[^'\n]*'|[^&\s"';,]+)/gi, `$1${REDACTED}`],
  // A JSON member that names a credential, in double or single quotes.
  [/((["'])(?:accessToken|refreshToken|idToken|token|secret|clientSecret|client_secret|password|passwd|authorization|apiKey|api_key|key|privateKey|private_key)\2\s*:\s*)(?:"[^"\n]*"|'[^'\n]*')/gi, `$1"${REDACTED}"`],
  // Well-known credential shapes: API keys, personal access tokens, cloud keys, JWTs and this repository's `tok_` tokens.
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|tok_[A-Za-z0-9_-]{6,})\b/g, REDACTED],
  // A long opaque run of token characters outside a path, when it holds both letters and digits: a key, a hash or a
  // signature. The run is matched once and checked in the replacer, so no position is scanned twice.
  [/(?<![\w/.-])[A-Za-z0-9_+/=-]{40,}(?![\w/.-])/g, match => (/[A-Za-z]/.test(match) && /\d/.test(match) ? REDACTED : match)],
];
// Control characters other than tab and newline never help a reader and may hide a replacement; so do the zero-width
// format characters that split a token in two.
const CONTROL = /(?![\t\n])[\p{Cc}\p{Cf}]/gu;
// V8 installs one shared accessor for `stack` on every error it captures; it is taken here, once, from an error of this
// module's own, and an accessor is read only when it is that very function. A bound function or a getter a caller
// installed prints as native code too, so a text comparison would admit it; an identity comparison does not.
const stackAccessor: unknown = (Object.getOwnPropertyDescriptor(new Error('probe'), 'stack') as {readonly get?: unknown} | undefined)?.get;
const isNative = (candidate: unknown): boolean => typeof stackAccessor === 'function' && candidate === stackAccessor;

/**
 * An error's own `message` or `stack` as a string, or undefined. A data property is read as it is. An accessor is read
 * only when it is V8's own native stack accessor, which formats the stack it captured when the error was created: a
 * getter the error's class or a caller defined is never invoked. A value that is not a string is left out.
 */
function ownText(error: Error, name: 'message' | 'stack'): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, name);
  if (descriptor === undefined) return undefined;
  if ('value' in descriptor) return typeof descriptor.value === 'string' ? descriptor.value : undefined;
  // The accessor is read as a plain value, not as a method of its descriptor, so it is checked before anything runs it.
  const getter: unknown = (descriptor as {readonly get?: unknown}).get;
  if (typeof getter !== 'function' || !isNative(getter)) return undefined;
  try {
    const value: unknown = Reflect.apply(getter, error, []);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

const QUOTES = new Set(['"', '\'', '`']);
const WORD = /[\p{L}\p{N}_]/u;
// A stack frame as V8 formats it; a payload in an error's message never continues into one.
const FRAME = '\n    at ';
// An `util.inspect`-style member, `{ prompt: ...`, which Node's assertion and template messages print without quotes.
const MEMBER = /^\s*[A-Za-z_$][\w$]*\s*:/;

/**
 * The index of the bracket that closes the one at `start`, counting brackets only, or -1 within `MAX_SEGMENT` and before
 * `limit`. A bracket inside a quoted value ends the block early; what follows is still text the credential rules see, and
 * an escaped body (`{\"name\":...}`, as a library quotes JSON inside JSON) is a block like any other.
 */
function closingBracket(text: string, start: number, limit: number): number {
  const stop = Math.min(limit, start + MAX_SEGMENT);
  let depth = 0;
  for (let index = start; index < stop; index += 1) {
    const character = text[index];
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Whether the text after `start`, past spaces and escaping backslashes, begins as JSON or an inspected object does: a
 * quote, a bracket or an unquoted member name with its colon.
 */
function opensLikeJson(text: string, start: number): boolean {
  let index = start;
  while (index < text.length && (text[index] === '\\' || /\s/.test(text[index] ?? ''))) index += 1;
  const next = text[index];
  return next === '"' || next === '[' || next === '{' || MEMBER.test(text.slice(index, index + 64));
}

/**
 * Where a stack's header ends: after `message` when the stack begins with a name and that message, else at its first
 * frame, else at its end. A message text is all header.
 */
function headerEnd(text: string, message: string | undefined): number {
  if (message === undefined) return text.length;
  if (message !== '') {
    const at = text.indexOf(message);
    if (at !== -1 && at <= MAX_NAME) return at + message.length;
  }
  const frame = text.indexOf(FRAME);
  return frame === -1 ? text.length : frame;
}
// The longest error name, with its colon and space, a stack's header may start with before its message.
const MAX_NAME = 128;

/**
 * Replaces, in one pass, each JSON-shaped block and each quoted string of `PAYLOAD_LENGTH` characters or more with
 * `[omitted]`: a request body, a prompt or a transcript that an exception quoted, on one line or across several. A block
 * goes whole, so its member names go with its values. Each start scans at most `MAX_SEGMENT` characters. No payload
 * runs into a stack frame: one in the header (the text before `header`) ends with the header, so a quote or block the
 * message leaves open, as `Unexpected token " in JSON` does, is omitted to the header's end when enough follows and every
 * frame stays, while a frame-like line inside a quoted body is still the body's; one in a frame ends with that frame.
 */
function omitPayloads(text: string, header: number): {text: string; replaced: number} {
  let out = '';
  let replaced = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? '';
    const bracket = (character === '{' || character === '[') && opensLikeJson(text, index + 1);
    // A quote opens a string when nothing of a word precedes it; the apostrophe of a contraction opens nothing.
    const quote = QUOTES.has(character) && (index === 0 || !WORD.test(text[index - 1] ?? ''));
    if (!bracket && !quote) {
      out += character;
      index += 1;
      continue;
    }
    // The header's end bounds a payload in it; the next frame bounds one in a frame: a closer past the bound is none.
    const frame = index < header ? -1 : text.indexOf(FRAME, index);
    const limit = index < header ? header : frame === -1 ? text.length : frame;
    const close = bracket ? closingBracket(text, index, limit) : text.indexOf(character, index + 1);
    const end = close === -1 || close >= limit || close - index > MAX_SEGMENT ? -1 : close;
    if (end !== -1 && end - index + 1 >= PAYLOAD_LENGTH) {
      out += OMITTED;
      replaced += 1;
      index = end + 1;
      continue;
    }
    // A JSON-shaped start or a quote with no closer in the window, followed by a payload's worth of text before the next
    // frame, is a payload the pre-cut or the window has already shortened: the rest of it goes too, since an unclosed
    // body is still a body. The frames after it stay.
    if (end === -1 && limit - index >= PAYLOAD_LENGTH) {
      out += OMITTED;
      replaced += 1;
      index = limit;
      continue;
    }
    if (end !== -1 && quote) {
      // A short quoted string is kept whole, so its closing quote opens nothing.
      out += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    out += character;
    index += 1;
  }
  return {text: out, replaced};
}

function filtered(text: string, header: number): {text: string; replaced: number} {
  let out = text;
  let replaced = 0;
  // Payload-like segments go first and whole, so a credential inside one counts once; then each credential rule.
  const omitted = omitPayloads(out, header);
  out = omitted.text;
  replaced += omitted.replaced;
  for (const [pattern, replacement] of CREDENTIAL_RULES) {
    out = out.replace(pattern, (...match: unknown[]) => {
      const part = (position: number): string => {
        const value = match[position];
        return typeof value === 'string' ? value : '';
      };
      // The replacement template's `$1`, `$2` and `$&` are the match's groups and text; this applies them as String#replace
      // would. A match the rule leaves as it is, such as a value already replaced on an earlier pass, is not counted, so
      // the filter is idempotent on its own output while a marker followed by more text is still replaced whole.
      const result = typeof replacement === 'function' ? replacement(part(0))
        : replacement.replace(/\$(\d|&)/g, (_token, index: string) => (index === '&' ? part(0) : part(Number(index))));
      if (result !== part(0)) replaced += 1;
      return result;
    });
  }
  return {text: out, replaced: Math.min(Number.MAX_SAFE_INTEGER, replaced)};
}

/** The bytes `text` takes inside a JSON document, escapes included: what the record's 8 KiB bound counts. */
const serializedBytes = (text: string): number => Buffer.byteLength(JSON.stringify(text)) - 2;

/**
 * Cuts `text` to at most `limit` characters and serialized bytes, keeping whole lines when there are several, with a
 * marker. A text of quotes and backslashes doubles when serialized, so the bound is measured on the escaped form.
 */
function bounded(text: string, limit: number): {text: string; truncated: boolean} {
  if (text.length <= limit && serializedBytes(text) <= limit) return {text, truncated: false};
  const room = limit - TRUNCATED.length - 1;
  let cut = text.slice(0, room);
  // Each round removes a tenth of what remains, so a text that escapes to twice its length settles in a few rounds.
  while (cut.length > 0 && serializedBytes(cut) > room) cut = cut.slice(0, Math.max(0, cut.length - Math.ceil(cut.length / 10)));
  const line = cut.lastIndexOf('\n');
  // A stack is cut between its frames; a one-line message is cut where the room ends.
  if (line > 0) return {text: `${cut.slice(0, line)}\n${TRUNCATED}`, truncated: true};
  return {text: cut === '' ? TRUNCATED : `${cut} ${TRUNCATED}`, truncated: true};
}

/**
 * One text as a record may carry it: read up to `PRECUT` times the limit, filtered, then bounded. The runtime applies
 * this to an exception field a module wrote itself, so the module path and `exceptionFields` meet the same rules.
 */
export function filterExceptionText(raw: string, limit: number, options: ExceptionOptions = {}): FilteredText {
  // Control and format characters go first, so a secret one of them splits is whole when the caller's filter sees it;
  // the filter sees the whole text, so a registered secret that straddles the pre-cut leaves no fragment.
  const plain = raw.replace(CONTROL, '');
  const own = options.filter?.(plain) ?? {text: plain, replaced: 0};
  // The header is found in the filtered text with the message filtered the same way, so a replaced secret in it still lines up.
  const message = options.stackOf === undefined ? undefined : (options.filter?.(options.stackOf.replace(CONTROL, '')) ?? {text: options.stackOf.replace(CONTROL, '')}).text;
  const clean = filtered(own.text.slice(0, limit * PRECUT), headerEnd(own.text, message));
  const cut = bounded(clean.text, limit);
  // A text the pre-cut shortened is cut, whatever the filter then left of it.
  return {text: cut.text, replaced: own.replaced + clean.replaced, truncated: cut.truncated || own.text.length > limit * PRECUT};
}

/**
 * The private diagnostic fields of an exception, or `{}` when `error` is no `Error`, is a proxy, or has no text of its
 * own: its filtered, bounded message and stack with the count of replaced segments and whether either was cut. The caller
 * adds `error.type` and `error.code` as before. Nothing here is read from a cause, an `errors` list or any other property.
 */
export function exceptionFields(error: unknown, options: ExceptionOptions = {}): ExceptionFields {
  // A proxy runs its traps on every read, `instanceof` included: it is no error of this process's own.
  if (types.isProxy(error) || !(error instanceof Error)) return {};
  let replaced = 0;
  let truncated = false;
  const fields: Record<string, string> = {};
  for (const [name, attribute, limit] of [['message', 'exception.message', MAX_EXCEPTION_MESSAGE], ['stack', 'exception.stacktrace', MAX_EXCEPTION_STACKTRACE]] as const) {
    const raw = ownText(error, name);
    if (raw === undefined) continue;
    const clean = filterExceptionText(raw, limit, name === 'stack' ? {...options, stackOf: ownText(error, 'message') ?? ''} : options);
    replaced = Math.min(Number.MAX_SAFE_INTEGER, replaced + clean.replaced);
    truncated ||= clean.truncated;
    if (clean.text !== '') fields[attribute] = clean.text;
  }
  if (Object.keys(fields).length === 0) return {};
  return {...fields, 'bunny.exception.redacted_count': replaced, 'bunny.exception.truncated': truncated};
}
