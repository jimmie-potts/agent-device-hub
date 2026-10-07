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
export function pySum(values: readonly number[]): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return compensation !== 0 && Number.isFinite(compensation) ? total + compensation : total;
}

const VELTKAMP = 134217729.0; // 2 ** 27 + 1
const DBL_MIN = 2.2250738585072014e-308;

/** x * x and its exact rounding error, as CPython's dl_mul(x, x) computes with fma, by Dekker's splitting. */
function square(x: number): [number, number] {
  const product = x * x;
  const t = x * VELTKAMP;
  const high = t - (t - x);
  const low = x - high;
  return [product, ((high * high - product) + high * low + low * high) + low * low];
}

/** The exponent frexp() gives: value = m * 2 ** e with 0.5 <= m < 1. */
function frexpExponent(value: number): number {
  let exponent = Math.floor(Math.log2(value)) + 1;
  if (value * 2 ** -exponent >= 1) exponent += 1;
  if (value * 2 ** -exponent < 0.5) exponent -= 1;
  return exponent;
}

/** CPython's vector_norm: the correctly rounded length nearly always, where Math.hypot differs in the last bit. */
function vectorNorm(vector: readonly number[], max: number): number {
  if (max === Infinity) return max;
  if (vector.some(Number.isNaN)) return Number.NaN;
  if (max === 0 || vector.length <= 1) return max;
  const exponent = frexpExponent(max);
  if (exponent < -1023) return DBL_MIN * vectorNorm(vector.map(value => value / DBL_MIN), max / DBL_MIN);
  const scale = 2 ** -exponent;
  let sum = 1.0;
  let fraction1 = 0.0;
  let fraction2 = 0.0;
  const add = ([high, low]: [number, number]): void => {
    const next = sum + high;
    fraction2 += (sum - next) + high;
    sum = next;
    fraction1 += low;
  };
  for (const value of vector) add(square(value * scale));
  let length = Math.sqrt(sum - 1.0 + (fraction1 + fraction2));
  const [high, low] = square(length);
  add([-high, -low]);
  length += (sum - 1.0 + (fraction1 + fraction2)) / (2.0 * length);
  return length / scale;
}

/** Python's math.hypot. */
export function pyHypot(...coordinates: readonly number[]): number {
  const vector = coordinates.map(Math.abs);
  return vectorNorm(vector, Math.max(0, ...vector.filter(value => !Number.isNaN(value))));
}

/** Python's math.dist. */
export function pyDist(p: readonly number[], q: readonly number[]): number {
  if (p.length !== q.length) throw new ValueError('both points must have the same number of dimensions');
  return pyHypot(...p.map((value, index) => value - (q[index] ?? Number.NaN)));
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
  /** Python's allow_nan: write infinities and NaN as JavaScript literals instead of refusing them. */
  readonly allowNan?: boolean;
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

function encodeNumber(value: number, allowNan = false): string {
  if (!Number.isFinite(value)) {
    if (!allowNan) throw new TypeError('Out of range float values are not JSON compliant.');
    return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
  }
  // JSON gives no int/float distinction; whole numbers are written as Python writes an int.
  return Number.isInteger(value) ? BigInt(value).toString() : floatText(value);
}

function encode(value: unknown, format: JsonFormat, level: number): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return encodeNumber(value, format.allowNan);
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

/** Python's json.dumps(value) with its default allow_nan, for text only this module reads back. */
export const pyJsonAllowNan = (value: unknown): string =>
  encode(value, {sortKeys: false, ensureAscii: true, itemSeparator: ', ', keySeparator: ': ', indent: null, allowNan: true}, 0);

/** Python's json.dumps(value, separators=(',', ':'), allow_nan=False), as rendering receipts are saved. */
export const pyJsonCompact = (value: unknown): string =>
  encode(value, {sortKeys: false, ensureAscii: true, itemSeparator: ',', keySeparator: ':', indent: null}, 0);

/** Python's json.dumps(value, indent=2), as the private JSON files are written. */
export const pyJsonIndented = (value: unknown): string =>
  encode(value, {sortKeys: false, ensureAscii: true, itemSeparator: ',', keySeparator: ': ', indent: 2}, 0);

/** shared_input.dumps: sorted keys, compact separators and unescaped text. Identity keys and eviction tokens hash this text. */
export const dumps = (value: unknown): string =>
  encode(value, {sortKeys: true, ensureAscii: false, itemSeparator: ',', keySeparator: ':', indent: null}, 0);

/** controller_state.encoded: sorted keys, compact separators and ASCII escapes, as saved favorite recipes are stored. */
export const encoded = (value: unknown): string =>
  encode(value, {sortKeys: true, ensureAscii: true, itemSeparator: ',', keySeparator: ':', indent: null}, 0);

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

/**
 * Python's json.loads(text): malformed JSON is a ValueError. A leading byte order mark is kept, so it fails as in Python.
 * The ValueError has fixed text: the parser's message quotes part of the text, which may be a device's reply or a saved
 * credential (ADR 0012, "Safe errors"). The parser's error stays its cause.
 */
export function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValueError('Malformed JSON.', {cause: error});
    throw error;
  }
}

/** Text read with Python's utf-8-sig codec: one leading byte order mark is dropped. */
export const withoutBom = (text: string): string => (text.startsWith('﻿') ? text.slice(1) : text);

/** A deep copy of parsed JSON. */
export const copyJson = <T extends Json>(value: T): T => structuredClone(value);
