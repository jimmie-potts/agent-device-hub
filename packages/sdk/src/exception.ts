// Filtered exception fields for a private diagnostic record (ADR 0012 "Safe errors", amended 2026-10-30; Hub #777).
// This is the one place that reads an exception's message and stack. It reads only an `Error`'s own `message` and the
// stack V8 itself formats, never a getter a value supplies, a cause or anything else on the object. The text it keeps
// is bounded and filtered: registered secrets, authorization values, credential-bearing URL parts, well-known key
// shapes and long opaque tokens become `[redacted]`, and long quoted or JSON-shaped segments, which may be a request
// body, a prompt or a transcript, become `[omitted]`. The record says how many segments it replaced and whether it cut
// the text. Error bodies, health, history and span names keep their registry codes and fixed text; this is only for
// the private diagnostic path of the diagnostic contract's profile 1.7.

/** The longest `exception.message` a record carries, in characters and in UTF-8 bytes. */
export const MAX_EXCEPTION_MESSAGE = 1024;
/** The longest `exception.stacktrace` a record carries, in characters and in UTF-8 bytes. */
export const MAX_EXCEPTION_STACKTRACE = 4096;
/** What replaces a credential-like segment. */
export const REDACTED = '[redacted]';
/** What replaces a segment that may be a payload: a long quoted string or a long JSON-shaped block. */
export const OMITTED = '[omitted]';
const TRUNCATED = '[truncated]';

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
};

type Rule = readonly [pattern: RegExp, replacement: string];

// Each rule runs once over the whole text, with the global flag, so a replacement count is a count of segments.
const CREDENTIAL_RULES: readonly Rule[] = [
  // An authorization-like header or key with its value, in `name: value` or `name=value` form, keeping a scheme word.
  [/\b((?:proxy-)?authorization|x-api-key|api[-_]?key|x-auth-token|cookie|set-cookie)(\s*[:=]\s*)((?:(?:bearer|basic|digest)\s+)?)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, `$1$2$3${REDACTED}`],
  // A scheme and its credential: `Bearer <token>`, `Basic <base64>`.
  [/\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // A URL's user information.
  [/(\/\/)[^/\s@]{1,256}@/g, `$1${REDACTED}@`],
  // A parameter, field or YAML-style member that names a credential, as `name=value`, `name: value` or `name="value"`.
  [/\b((?:access_?token|refresh_?token|id_?token|token|secret|client_?secret|password|passwd|pwd|api_?key|apikey|auth|signature|sig|private_?key|response)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^&\s"';,]+)/gi, `$1${REDACTED}`],
  // A JSON member that names a credential, in double or single quotes.
  [/((["'])(?:accessToken|refreshToken|idToken|token|secret|clientSecret|client_secret|password|passwd|authorization|apiKey|api_key|privateKey|private_key)\2\s*:\s*)(?:"[^"\n]*"|'[^'\n]*')/gi, `$1"${REDACTED}"`],
  // Well-known credential shapes: API keys, personal access tokens, cloud keys, JWTs and this repository's `tok_` tokens.
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|tok_[A-Za-z0-9_-]{6,})\b/g, REDACTED],
  // A long opaque run of token characters with both letters and digits, not inside a path: a key, a hash or a signature.
  [/(?<![\w/.-])(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{40,}(?![\w/.-])/g, REDACTED],
];
// A long JSON-shaped block or quoted string, on one line or across several, may be a request body, a prompt or a
// transcript. The block goes first, whole, so its member names go with its values; it starts as JSON does, so a
// `[redacted]` marker never does. Each spans at most 16 KiB, so a stack full of frames is never one block.
const CONTENT_RULES: readonly Rule[] = [
  [/[[{](?=\s*["[{])[\s\S]{128,16384}?[\]}](?![\s\S]{0,2}[\]}])/g, OMITTED],
  [/(["'`])(?:(?!\1)[\s\S]){129,16384}?\1/g, OMITTED],
];
// Control characters other than tab and newline never help a reader and may hide a replacement.
const CONTROL = /(?![\t\n])\p{Cc}/gu;
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

function filtered(text: string, filter: ExceptionFilter | undefined): {text: string; replaced: number} {
  let out = text.replace(CONTROL, '');
  let replaced = 0;
  if (filter !== undefined) {
    const own = filter(out);
    out = own.text;
    replaced += own.replaced;
  }
  // Payload-like segments go first and whole, so a credential inside one counts once; then each credential rule.
  for (const [pattern, replacement] of [...CONTENT_RULES, ...CREDENTIAL_RULES]) {
    out = out.replace(pattern, (...match: unknown[]) => {
      replaced += 1;
      // The replacement template's `$1`, `$2` and `$&` are the match's groups and text; this applies them as String#replace would.
      const part = (index: number): string => {
        const value = match[index];
        return typeof value === 'string' ? value : '';
      };
      return replacement.replace(/\$(\d|&)/g, (_token, index: string) => (index === '&' ? part(0) : part(Number(index))));
    });
  }
  return {text: out, replaced: Math.min(Number.MAX_SAFE_INTEGER, replaced)};
}

/** Cuts `text` to at most `limit` characters and UTF-8 bytes, keeping whole lines when there are several, with a marker. */
function bounded(text: string, limit: number): {text: string; truncated: boolean} {
  if (text.length <= limit && Buffer.byteLength(text) <= limit) return {text, truncated: false};
  const room = limit - TRUNCATED.length - 1;
  let cut = text.slice(0, room);
  while (Buffer.byteLength(cut) > room) cut = cut.slice(0, -1);
  const line = cut.lastIndexOf('\n');
  // A stack is cut between its frames; a one-line message is cut where the room ends.
  if (line > 0) return {text: `${cut.slice(0, line)}\n${TRUNCATED}`, truncated: true};
  return {text: cut === '' ? TRUNCATED : `${cut} ${TRUNCATED}`, truncated: true};
}

/**
 * The private diagnostic fields of an exception, or `{}` when `error` is no `Error` or has no text of its own: its
 * filtered, bounded message and stack with the count of replaced segments and whether either was cut. The caller adds
 * `error.type` and `error.code` as before. Nothing here is read from a cause, an `errors` list or any other property.
 */
export function exceptionFields(error: unknown, options: ExceptionOptions = {}): ExceptionFields {
  if (!(error instanceof Error)) return {};
  let replaced = 0;
  let truncated = false;
  const fields: Record<string, string> = {};
  for (const [name, attribute, limit] of [['message', 'exception.message', MAX_EXCEPTION_MESSAGE], ['stack', 'exception.stacktrace', MAX_EXCEPTION_STACKTRACE]] as const) {
    const raw = ownText(error, name);
    if (raw === undefined) continue;
    const clean = filtered(raw, options.filter);
    replaced = Math.min(Number.MAX_SAFE_INTEGER, replaced + clean.replaced);
    const cut = bounded(clean.text, limit);
    truncated ||= cut.truncated;
    if (cut.text !== '') fields[attribute] = cut.text;
  }
  if (Object.keys(fields).length === 0) return {};
  return {...fields, 'bunny.exception.redacted_count': replaced, 'bunny.exception.truncated': truncated};
}
