// Python behaviors the saved Nanoleaf state depends on: number and JSON text, rounding, path and string rules.
// The Python bridge wrote the installed state, so keys, hashes and stored text must come out the same here.
import {createHash} from 'node:crypto';
import {ValueError} from './errors.js';

/** A parsed JSON value. Objects keep their keys in insertion order, except that JavaScript lists integer-like keys first. */
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type JsonObject = {[key: string]: Json};

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Python's dict.get(key) on parsed JSON: only the object's own keys, never inherited ones such as `constructor`. */
export const own = (object: JsonObject | undefined, key: string): Json | undefined =>
  object !== undefined && Object.hasOwn(object, key) ? object[key] : undefined;

export const sha256Hex =(text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Python's `str < str`: code point order, which differs from UTF-16 order above U+FFFF. */
export function compareText(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** Python's `value % divisor` for floats: the result takes the divisor's sign, where JavaScript's takes the dividend's. */
export function pyMod(value: number, divisor: number): number {
  const mod = value % divisor;
  if (mod === 0) return divisor < 0 ? -0 : 0;
  return (divisor < 0) !== (mod < 0) ? mod + divisor : mod;
}

/**
 * Python's sum() of floats, which since 3.12 compensates rounding (Neumaier). A plain loop differs in the last bit for
 * about half of all float lists. Python sums ints exactly, which this matches below 2 ** 53.
 */
export function pySum(_values: readonly number[]): number {
  throw new Error('Not ported yet (Hub #26, slice 2).');
}

/** Python's math.hypot. */
export function pyHypot(..._coordinates: readonly number[]): number {
  throw new Error('Not ported yet (Hub #26, slice 2).');
}

/** Python's math.dist. */
export function pyDist(_p: readonly number[], _q: readonly number[]): number {
  throw new Error('Not ported yet (Hub #26, slice 2).');
}

/** Python's round() for a float: halves go to the even neighbour. */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's math.radians. */
export const radians = (degrees: number): number => degrees * (Math.PI / 180);

/** Python's repr of a float: shortest round-trip digits, exponent below 1e-4 and from 1e16, and `.0` on whole values. */
export function floatText(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa = '', exponentText = '0'] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const sign = negative ? '-' : '';
  if (exponent < -4 || exponent >= 16) {
    const fraction = digits.slice(1);
    const power = `${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
    return `${sign}${digits.slice(0, 1)}${fraction === '' ? '' : '.' + fraction}e${power}`;
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}.${fraction === '' ? '0' : fraction}`;
}

/** Python's float() of saved text, including `inf`, `-inf` and `nan`. */
export function parseFloatText(text: string): number {
  const trimmed = text.trim();
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(trimmed);
  if (special !== null) {
    if ((special[2] ?? '').toLowerCase() === 'nan') return Number.NaN;
    return special[1] === '-' ? -Infinity : Infinity;
  }
  const plain = trimmed.replace(/(?<=\d)_(?=\d)/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(plain)) {
    throw new ValueError(`could not convert string to float: '${text}'`);
  }
  return Number(plain);
}

/** Python's int() of saved text. */
export function parseIntText(text: string): number {
  const trimmed = text.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(trimmed)) throw new ValueError(`invalid literal for int() with base 10: '${text}'`);
  return Number(trimmed.replaceAll('_', ''));
}

interface JsonFormat {
  readonly sortKeys: boolean;
  readonly ensureAscii: boolean;
  readonly itemSeparator: string;
  readonly keySeparator: string;
  readonly indent: number | null;
}

const SHORT_ESCAPES: Record<string, string> = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'};

function quote(text: string, ensureAscii: boolean): string {
  let output = '"';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const character = text.charAt(index);
    const short = SHORT_ESCAPES[character];
    if (short !== undefined) output += short;
    else if (unit < 0x20 || (ensureAscii && unit > 0x7e)) output += '\\u' + unit.toString(16).padStart(4, '0');
    else output += character;
  }
  return output + '"';
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Out of range float values are not JSON compliant.');
  // JSON gives no int/float distinction; whole numbers are written as Python writes an int.
  return Number.isInteger(value) ? BigInt(value).toString() : floatText(value);
}

function encode(value: unknown, format: JsonFormat, level: number): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return quote(value, format.ensureAscii);
  const newline = format.indent === null ? '' : '\n' + ' '.repeat(format.indent * (level + 1));
  const closing = format.indent === null ? '' : '\n' + ' '.repeat(format.indent * level);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item: unknown) => newline + encode(item, format, level + 1));
    return '[' + items.join(format.itemSeparator) + closing + ']';
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (format.sortKeys) keys.sort(compareText);
    if (keys.length === 0) return '{}';
    const items = keys.map(key => newline + quote(key, format.ensureAscii) + format.keySeparator + encode(value[key], format, level + 1));
    return '{' + items.join(format.itemSeparator) + closing + '}';
  }
  throw new TypeError(`Object of type ${typeof value} is not JSON serializable`);
}

/** Python's json.dumps(value) with its default separators and ASCII escapes. */
export const pyJson = (value: unknown): string =>
  encode(value, {sortKeys: false, ensureAscii: true, itemSeparator: ', ', keySeparator: ': ', indent: null}, 0);

/** Python's json.dumps(value, indent=2), as the private JSON files are written. */
export const pyJsonIndented = (value: unknown): string =>
  encode(value, {sortKeys: false, ensureAscii: true, itemSeparator: ',', keySeparator: ': ', indent: 2}, 0);

/** shared_input.dumps: sorted keys, compact separators and unescaped text. Identity keys and eviction tokens hash this text. */
export const dumps = (value: unknown): string =>
  encode(value, {sortKeys: true, ensureAscii: false, itemSeparator: ',', keySeparator: ':', indent: null}, 0);

/** Python's str.split(separator, maxsplit). */
export function splitText(text: string, separator: string, maxsplit: number): string[] {
  const parts = text.split(separator);
  if (parts.length <= maxsplit + 1) return parts;
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(separator)];
}

/** Python's posixpath.normpath. */
export function normpath(path: string): string {
  if (path === '') return '.';
  let initial = path.startsWith('/') ? 1 : 0;
  if (initial === 1 && path.startsWith('//') && !path.startsWith('///')) initial = 2;
  const kept: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..' || (initial === 0 && kept.length === 0) || (kept.length > 0 && kept[kept.length - 1] === '..')) kept.push(part);
    else if (kept.length > 0) kept.pop();
  }
  const joined = '/'.repeat(initial) + kept.join('/');
  return joined === '' ? '.' : joined;
}

/** Python's str.title() for the provider names this module shows. */
export function titleCase(text: string): string {
  let output = '';
  let previousCased = false;
  for (const character of text) {
    const cased = character.toLowerCase() !== character.toUpperCase();
    output += cased ? (previousCased ? character.toLowerCase() : character.toUpperCase()) : character;
    previousCased = cased;
  }
  return output;
}

/** Python's `a == b` for parsed JSON values and SQLite rows. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item: unknown, index) => sameValue(item, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  }
  return false;
}

/** Python's json.loads(text): malformed JSON is a ValueError. A leading byte order mark is kept, so it fails as in Python. */
export function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValueError(error.message);
    throw error;
  }
}

/** Text read with Python's utf-8-sig codec: one leading byte order mark is dropped. */
export const withoutBom = (text: string): string => (text.startsWith('﻿') ? text.slice(1) : text);

/** A deep copy of parsed JSON. */
export const copyJson = <T extends Json>(value: T): T => structuredClone(value);
