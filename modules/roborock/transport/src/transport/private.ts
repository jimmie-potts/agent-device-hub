import {randomBytes} from 'node:crypto';
import {constants, type BigIntStats} from 'node:fs';
import {lstat, open, rename, unlink, type FileHandle} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
export type Region = 'us' | 'eu' | 'cn' | 'asia';
export type Config = {schemaVersion: 1; deviceId: string; address: string; broker: string; region: Region};
export type Session = {schemaVersion: 1; deviceId: string; model: 'roborock.vacuum.a97'; protocol: '1.0'; localKey: string; rriot: {u: string; s: string; k: string}; broker: string};
const MAX_BYTES = 64 * 1024;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK;
class PrivateFailure extends Error {
  constructor(readonly reason: 'invalid' | 'unsupported') { super('The private Roborock operation was refused.'); }
}
function invalid(): never { throw new PrivateFailure('invalid'); }
function unsupported(): never { throw new PrivateFailure('unsupported'); }
function publicFailure(error: unknown, committed = false): SdkError {
  if (committed) return new SdkError(errorBody('invalid-request', {detail: 'The private session was replaced, but its durability could not be confirmed. Do not retry automatically.'}));
  if (error instanceof PrivateFailure && error.reason === 'unsupported') return new SdkError(errorBody('unsupported-capability', {detail: 'The Roborock session model or protocol is unsupported.'}));
  return new SdkError(errorBody('invalid-request', {detail: 'The private Roborock input or storage is unsafe or invalid.'}));
}
function hasCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
/** Closed objects with data properties; do not invoke input getters or toJSON. */
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) { const descriptor = descriptors[key]; if (descriptor === undefined || !('value' in descriptor)) invalid(); result[key] = descriptor.value as unknown; }
  return result;
}
function segment(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[^A-Za-z0-9_-]/.test(value)) invalid(); return value; }
function printable(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[^\x20-\x7e]/.test(value)) invalid(); return value; }
function localKey(value: unknown): string { if (typeof value !== 'string' || value.length !== 16 || /[^\x20-\x7e]/.test(value)) invalid(); return value; }
/** No subnet prefix is available: refuse common .0/.255 endpoints, not every directed broadcast. */
function address(value: unknown): string {
  if (typeof value !== 'string' || value.length > 15) invalid();
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => part.length < 1 || part.length > 3 || /[^0-9]/.test(part) || (part.length > 1 && part.startsWith('0')) || Number(part) > 255)) invalid();
  const [a, b, c, d] = parts.map(Number);
  if (a === undefined || b === undefined || c === undefined || d === undefined) invalid();
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127) || d === 0 || d === 255) invalid();
  return value;
}
function broker(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[^\x21-\x7e]/.test(value) || !/^(?:mqtts|ssl):\/\/[A-Za-z0-9.-]+(?::8883)?\/?$/.test(value)) invalid();
  const parsed = new URL(value); const host = parsed.hostname.toLowerCase();
  const labels = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!labels || (host !== 'roborock.com' && !host.endsWith('.roborock.com')) || parsed.username !== '' || parsed.password !== '' || (parsed.port !== '' && parsed.port !== '8883') || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search !== '' || parsed.hash !== '') invalid();
  return `mqtts://${host}:8883`;
}
function parseConfig(value: unknown): Config {
  const fields = exactObject(value, ['schemaVersion', 'deviceId', 'address', 'broker', 'region']);
  const region = fields.region;
  if (fields.schemaVersion !== 1 || (region !== 'us' && region !== 'eu' && region !== 'cn' && region !== 'asia')) invalid();
  return {schemaVersion: 1, deviceId: segment(fields.deviceId), address: address(fields.address), broker: broker(fields.broker), region};
}
function parseSession(value: unknown, target?: Config): Session {
  const fields = exactObject(value, ['schemaVersion', 'deviceId', 'model', 'protocol', 'localKey', 'rriot', 'broker']);
  if (fields.schemaVersion !== 1 || typeof fields.model !== 'string' || typeof fields.protocol !== 'string') invalid();
  if (fields.model !== 'roborock.vacuum.a97' || fields.protocol !== '1.0') unsupported();
  const rriot = exactObject(fields.rriot, ['u', 's', 'k']);
  const result: Session = {schemaVersion: 1, deviceId: segment(fields.deviceId), model: 'roborock.vacuum.a97', protocol: '1.0', localKey: localKey(fields.localKey), rriot: {u: segment(rriot.u), s: printable(rriot.s), k: printable(rriot.k)}, broker: broker(fields.broker)};
  if (target !== undefined && (result.deviceId !== target.deviceId || result.broker !== target.broker)) invalid();
  return result;
}
export function validateConfig(value: unknown): Config { try { return parseConfig(value); } catch (error) { throw publicFailure(error); } }
export function validateSession(value: unknown, config?: Config): Session { try { return parseSession(value, config === undefined ? undefined : parseConfig(config)); } catch (error) { throw publicFailure(error); } }
type Directory = {handle: FileHandle; name: string; initial: BigIntStats};
type Anchor = {directories: Directory[]; parent: Directory; basename: string; uid: bigint};
type PrivateRead = {value: unknown; stat: BigIntStats};
type Temporary = {handle: FileHandle; name: string; initial: BigIntStats | undefined};
function uid(): bigint {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || typeof process.geteuid !== 'function') invalid();
  const owner = process.getuid(); if (owner !== process.geteuid()) invalid(); return BigInt(owner);
}
function identity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: BigIntStats, b: BigIntStats): boolean { return identity(a, b) && a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs; }
function requireDirectory(stat: BigIntStats, owner: bigint, parent: boolean): void {
  if (!stat.isDirectory() || stat.nlink === 0n || (stat.mode & 0o6000n) !== 0n) invalid();
  if (parent) { if (stat.uid !== owner || (stat.mode & 0o7777n) !== 0o700n) invalid(); return; }
  if (stat.uid !== owner && stat.uid !== 0n) invalid();
  // Trusted sticky ancestors permit synthetic private test directories under /tmp.
  if ((stat.mode & 0o022n) !== 0n && (stat.mode & 0o1000n) === 0n) invalid();
}
function requireFile(stat: BigIntStats, owner: bigint, allowEmpty = false): void {
  const mode = stat.mode & 0o7777n;
  if (!stat.isFile() || stat.uid !== owner || stat.nlink !== 1n || (mode !== 0o600n && mode !== 0o400n) || stat.size < (allowEmpty ? 0n : 1n) || stat.size > BigInt(MAX_BYTES)) invalid();
}
function child(directory: Directory, name: string): string { return `/proc/self/fd/${directory.handle.fd}/${name}`; }
async function maybeStat(path: string): Promise<BigIntStats | undefined> { try { return await lstat(path, {bigint: true}); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; } }
async function noGit(directory: Directory): Promise<void> { if (await maybeStat(child(directory, '.git')) !== undefined) invalid(); }
async function closeQuietly(handle: FileHandle): Promise<void> { try { await handle.close(); } catch {} }
async function closeAnchor(anchor: Anchor | undefined): Promise<void> { if (anchor !== undefined) for (const directory of anchor.directories.slice().reverse()) await closeQuietly(directory.handle); }
async function openDirectory(path: string, name: string, owner: bigint, expected?: BigIntStats): Promise<Directory> {
  const handle = await open(path, DIRECTORY_FLAGS);
  try {
    const initial = await handle.stat({bigint: true}); requireDirectory(initial, owner, false);
    if (expected !== undefined && (!identity(expected, initial) || expected.uid !== initial.uid || expected.mode !== initial.mode)) invalid();
    return {handle, name, initial};
  } catch (error) { await closeQuietly(handle); throw error; }
}
async function openAnchor(path: string): Promise<Anchor> {
  const owner = uid();
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || Buffer.byteLength(path) > 4095) invalid();
  const components = path.slice(1).split('/');
  if (components.length > 64 || components.some(part => part === '' || part === '.' || part === '..' || Buffer.byteLength(part) > 255)) invalid();
  const basename = components.pop(); if (basename === undefined || basename === '.git') invalid();
  const directories: Directory[] = [];
  try {
    let parent = await openDirectory('/', '', owner); directories.push(parent); await noGit(parent);
    for (const part of components) { const entry = await lstat(child(parent, part), {bigint: true}); requireDirectory(entry, owner, false); parent = await openDirectory(child(parent, part), part, owner, entry); directories.push(parent); await noGit(parent); }
    requireDirectory(parent.initial, owner, true);
    const anchor = {directories, parent, basename, uid: owner}; await verifyAnchor(anchor); return anchor;
  } catch (error) { for (const directory of directories.slice().reverse()) await closeQuietly(directory.handle); throw error; }
}
async function verifyAnchor(anchor: Anchor): Promise<void> {
  let previous: Directory | undefined;
  for (const directory of anchor.directories) {
    const current = await directory.handle.stat({bigint: true}); requireDirectory(current, anchor.uid, directory === anchor.parent);
    if (!identity(directory.initial, current) || directory.initial.uid !== current.uid || directory.initial.mode !== current.mode) invalid();
    if (previous !== undefined) { const entry = await lstat(child(previous, directory.name), {bigint: true}); if (!entry.isDirectory() || !identity(entry, current) || entry.uid !== current.uid || entry.mode !== current.mode) invalid(); }
    await noGit(directory); previous = directory;
  }
}
async function readJson(anchor: Anchor, name: string, allowMissing: boolean): Promise<PrivateRead | undefined> {
  await verifyAnchor(anchor); const path = child(anchor.parent, name); const entry = await maybeStat(path);
  if (entry === undefined) { if (allowMissing) return undefined; invalid(); }
  requireFile(entry, anchor.uid);
  const handle = await open(path, READ_FLAGS);
  try {
    const before = await handle.stat({bigint: true}); requireFile(before, anchor.uid); if (!sameFile(entry, before)) invalid();
    const buffer = Buffer.alloc(Number(before.size)); let offset = 0; let calls = 0;
    while (offset < buffer.length) { if (++calls > 256) invalid(); const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (result.bytesRead <= 0) invalid(); offset += result.bytesRead; }
    const after = await handle.stat({bigint: true}); requireFile(after, anchor.uid); if (!sameFile(before, after)) invalid();
    await verifyAnchor(anchor); const named = await lstat(path, {bigint: true}); requireFile(named, anchor.uid); if (!sameFile(after, named)) invalid();
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer);
    const value: unknown = JSON.parse(text); return {value, stat: after};
  } finally { await closeQuietly(handle); }
}
async function createTemporary(anchor: Anchor): Promise<Temporary> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const name = `.roborock-session-${randomBytes(16).toString('hex')}.tmp`;
    try { const handle = await open(child(anchor.parent, name), CREATE_FLAGS, 0o600); return {handle, name, initial: undefined}; } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
  }
  return invalid();
}
async function removeTemporary(anchor: Anchor, temporary: Temporary): Promise<void> {
  try { if (temporary.initial === undefined) return; const path = child(anchor.parent, temporary.name); const current = await maybeStat(path); if (current !== undefined && current.isFile() && current.uid === anchor.uid && identity(current, temporary.initial)) await unlink(path); } catch {}
}
export async function loadPrivateConfig(path: string): Promise<Config> {
  let anchor: Anchor | undefined;
  try { anchor = await openAnchor(path); const input = await readJson(anchor, anchor.basename, false); if (input === undefined) invalid(); return parseConfig(input.value); } catch (error) { throw publicFailure(error); } finally { await closeAnchor(anchor); }
}
export async function loadPrivateSession(path: string, config: Config): Promise<Session> {
  let anchor: Anchor | undefined;
  try { const target = parseConfig(config); anchor = await openAnchor(path); const input = await readJson(anchor, anchor.basename, false); if (input === undefined) invalid(); return parseSession(input.value, target); } catch (error) { throw publicFailure(error); } finally { await closeAnchor(anchor); }
}
export async function savePrivateSession(path: string, session: Session): Promise<void> {
  let anchor: Anchor | undefined; let temporary: Temporary | undefined; let committed = false;
  try {
    const validated = parseSession(session); const bytes = Buffer.from(`${JSON.stringify(validated)}\n`);
    if (bytes.length > MAX_BYTES) invalid();
    anchor = await openAnchor(path); const previous = await readJson(anchor, anchor.basename, true);
    if (previous !== undefined) { const old = parseSession(previous.value); if (old.deviceId !== validated.deviceId || old.broker !== validated.broker) invalid(); }
    await verifyAnchor(anchor); temporary = await createTemporary(anchor); temporary.initial = await temporary.handle.stat({bigint: true}); requireFile(temporary.initial, anchor.uid, true);
    if ((temporary.initial.mode & 0o7777n) !== 0o600n || temporary.initial.size !== 0n) invalid();
    let offset = 0; let calls = 0;
    while (offset < bytes.length) { if (++calls > 256) invalid(); const result = await temporary.handle.write(bytes, offset, bytes.length - offset, offset); if (result.bytesWritten <= 0) invalid(); offset += result.bytesWritten; }
    await temporary.handle.sync(); const staged = await temporary.handle.stat({bigint: true}); requireFile(staged, anchor.uid);
    if (!identity(staged, temporary.initial) || (staged.mode & 0o7777n) !== 0o600n || staged.size !== BigInt(bytes.length)) invalid();
    await temporary.handle.close(); await anchor.parent.handle.sync(); await verifyAnchor(anchor);
    const targetPath = child(anchor.parent, anchor.basename); const current = await maybeStat(targetPath);
    if (previous === undefined) { if (current !== undefined) invalid(); } else { if (current === undefined) invalid(); requireFile(current, anchor.uid); if (!sameFile(previous.stat, current)) invalid(); }
    const stagedPath = child(anchor.parent, temporary.name); const named = await lstat(stagedPath, {bigint: true}); requireFile(named, anchor.uid); if (!sameFile(staged, named)) invalid();
    await rename(stagedPath, targetPath); committed = true; await anchor.parent.handle.sync(); await verifyAnchor(anchor);
    const installed = await lstat(targetPath, {bigint: true}); requireFile(installed, anchor.uid);
    if (!identity(installed, staged) || installed.size !== staged.size || installed.mode !== staged.mode || installed.mtimeNs !== staged.mtimeNs) invalid();
  } catch (error) { throw publicFailure(error, committed); } finally {
    if (temporary !== undefined) { await closeQuietly(temporary.handle); if (!committed && anchor !== undefined) await removeTemporary(anchor, temporary); }
    await closeAnchor(anchor);
  }
}
/** Setup-only preflight. It creates nothing and never clears an existing session. */
export async function checkPrivateDestination(path: string, config: Config): Promise<void> {
  let anchor: Anchor | undefined;
  try {
    const target = parseConfig(config); anchor = await openAnchor(path);
    const previous = await readJson(anchor, anchor.basename, true);
    if (previous !== undefined) parseSession(previous.value, target);
  } catch (error) {throw publicFailure(error);} finally {await closeAnchor(anchor);}
}
