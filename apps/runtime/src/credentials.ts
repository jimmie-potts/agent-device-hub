// The edge's client credentials (Hub #835): a private secret file that the runtime's configuration file names in its
// `edge` section, carried over from the old Hub's credentials. Each credential keeps the Hub's scopes and device grants,
// acts as one source, and is checked by its token's SHA-256 digest: the file never holds a token, and no record, health
// document or error body names one. The runtime reads the file at its start and again when asked to reload it, so a
// credential is granted, revoked or rotated by changing the file.
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {chmod, open, readdir, readFile, rename, rm, stat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {PrivateFileError, RuntimeError, readPrivateFile} from './state.js';

export const CREDENTIALS_SCHEMA = 'edge-credentials/1.0';
/** The largest credentials file the runtime reads, 64 KiB, as a module's secret file. */
export const MAX_CREDENTIALS_BYTES = 65_536;
/** How many credentials one file may hold, as the old Hub allowed. */
export const MAX_CREDENTIALS = 32;
/** How many devices one credential may name. */
export const MAX_GRANTED_DEVICES = 64;
/** The old Hub's scopes, kept as they were: reading, controlling devices, sending lifecycle observations and administration. */
export const SCOPES = ['read', 'control', 'ingest', 'admin'] as const;
export type Scope = typeof SCOPES[number];

/** One client credential: who it is, the source it acts as, its token's digest, and its scopes and device grants. */
export type EdgeCredential = {
  /** 1 to 128 letters, digits, underscores, dots or hyphens, as the old Hub's credential IDs. */
  readonly id: string;
  /** The source its calls act as, never the core's or a module's. */
  readonly source: string;
  /** The lowercase hexadecimal SHA-256 of its bearer token. */
  readonly digest: string;
  readonly scopes: readonly Scope[];
  /** The devices it may command, by routing ID. */
  readonly devices: readonly string[];
};

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = (detail: string): RuntimeError => new RuntimeError('edge-credentials-invalid', `the edge's credentials file ${detail}`);

/** The digest a credential keeps for a bearer token: its SHA-256, in lowercase hexadecimal. */
export const tokenDigest = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** Whether `token` is the one whose digest is `digest`, compared in constant time. */
export function tokenMatches(token: string, digest: string): boolean {
  const presented = createHash('sha256').update(token, 'utf8').digest();
  const expected = Buffer.from(digest, 'hex');
  return expected.length === presented.length && timingSafeEqual(presented, expected);
}

/** The source every browser session acts as, which no credential may (Hub #835). */
export const DASHBOARD_SOURCE = 'bunny/parts/dashboard';

/**
 * Whether a source belongs to the runtime itself: the core's, a module's, the runtime's own or the browser sessions',
 * which no credential may act as.
 */
export const reservedSource = (source: string): boolean =>
  source === 'bunny/core' || source === DASHBOARD_SOURCE || source.startsWith('bunny/modules/') || source.startsWith('bunny/runtime/');

/**
 * Checks a credentials document, `{"schema": "edge-credentials/1.0", "credentials": [...]}`, and returns its
 * credentials. At most 32; each with a distinct ID, digest and source, a well-formed source that is not the core's, a
 * module's, the runtime's own or the browser sessions', distinct scopes from the four and distinct routing IDs for
 * devices. Throws a `RuntimeError`: `edge-credential-source` for a reserved source, `edge-credentials-invalid`
 * otherwise. No refusal quotes a digest.
 */
export function parseCredentials(document: unknown): EdgeCredential[] {
  if (!isRecord(document) || document.schema !== CREDENTIALS_SCHEMA) throw invalid(`is not ${CREDENTIALS_SCHEMA}`);
  if (Object.keys(document).some(key => key !== 'schema' && key !== 'credentials')) throw invalid('has a member other than schema and credentials');
  const listed = document.credentials;
  if (!Array.isArray(listed) || listed.length > MAX_CREDENTIALS) throw invalid(`must list at most ${MAX_CREDENTIALS} credentials`);
  const credentials = listed.map((entry: unknown): EdgeCredential => {
    if (!isRecord(entry) || Object.keys(entry).some(key => !['id', 'source', 'digest', 'scopes', 'devices'].includes(key))) {
      throw invalid('has a credential that is not {id, source, digest, scopes, devices}');
    }
    const {id, source, digest, scopes, devices} = entry;
    if (typeof id !== 'string' || !ID.test(id)) throw invalid('has a credential whose ID is not 1 to 128 letters, digits, underscores, dots or hyphens');
    if (typeof source !== 'string' || !SOURCE.test(source) || source.length > 256) throw invalid(`gives ${id} a malformed source`);
    if (reservedSource(source)) throw new RuntimeError('edge-credential-source', `${id} may not act as ${source}: the core's, the modules' and the runtime's sources are its own`);
    if (typeof digest !== 'string' || !DIGEST.test(digest)) throw invalid(`gives ${id} a digest that is not a lowercase hexadecimal SHA-256`);
    const known = (scope: unknown): scope is Scope => typeof scope === 'string' && (SCOPES as readonly string[]).includes(scope);
    if (!Array.isArray(scopes) || !scopes.every(known) || new Set(scopes).size !== scopes.length) throw invalid(`gives ${id} scopes other than distinct read, control, ingest and admin`);
    const routing = (device: unknown): device is string => typeof device === 'string' && device.length <= 128 && ROUTING_ID.test(device);
    if (!Array.isArray(devices) || devices.length > MAX_GRANTED_DEVICES || !devices.every(routing) || new Set(devices).size !== devices.length) {
      throw invalid(`gives ${id} devices that are not at most ${MAX_GRANTED_DEVICES} distinct routing IDs`);
    }
    return {id, source, digest, scopes: [...scopes], devices: [...devices]};
  });
  if (new Set(credentials.map(credential => credential.id)).size !== credentials.length) throw invalid('gives two credentials one ID');
  if (new Set(credentials.map(credential => credential.digest)).size !== credentials.length) throw invalid('gives two credentials one token');
  // One source, one credential: a record or a grant check that names a source names one caller.
  if (new Set(credentials.map(credential => credential.source)).size !== credentials.length) throw invalid('gives two credentials one source');
  return credentials;
}

/** The credentials file's refusal codes for what its path or file is. */
const FILE_CODES = {
  missing: 'edge-credentials-missing', 'too-large': 'edge-credentials-invalid',
} as const;

/**
 * Reads the edge's credentials file, a private file as `readPrivateFile` requires, of at most 64 KiB. Throws a
 * `RuntimeError`: `edge-credentials-missing`, `edge-credentials-not-private` for a file reached through a link, not a
 * regular private file with one link, inside a Git checkout or on a Windows mount, or one of `parseCredentials`'s
 * codes. No refusal quotes the file.
 */
export async function readEdgeCredentials(file: string): Promise<EdgeCredential[]> {
  let bytes: Buffer;
  try {
    bytes = await readPrivateFile(file, MAX_CREDENTIALS_BYTES);
  } catch (error) {
    if (!(error instanceof PrivateFileError)) throw error;
    const {problem} = error;
    const code = problem === 'missing' || problem === 'too-large' ? FILE_CODES[problem] : 'edge-credentials-not-private';
    throw new RuntimeError(code, `the edge's credentials file ${error.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw invalid('is not JSON');
  }
  return parseCredentials(parsed);
}

/** The credentials as the file holds them, one per line. */
export const credentialsDocument = (credentials: readonly EdgeCredential[]): string =>
  `${JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: credentials.map(({id, source, digest, scopes, devices}) => ({id, source, digest, scopes, devices}))}, null, 2)}\n`;

/** How old an empty lock file must be before a writer takes it for one a crashed writer left. */
const EMPTY_LOCK_MS = 60_000;
/** The writers of this process, one after another per file, so that a grant and a revocation never race in one process. */
const queues = new Map<string, Promise<unknown>>();

/** Whether a process with this ID still runs. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Runs `change` while this process holds the credentials file's lock, `<file>.lock`, which names its process: writers
 * in one process wait for each other, and one in another process is refused with `edge-credentials-busy`. A lock whose
 * process has gone, or an empty one older than a minute, is a crashed writer's and is taken over. Temporary files a
 * crashed writer left beside the file are removed first.
 */
async function locked<T>(file: string, change: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const turn = previous.catch(() => {}).then(async () => {
    const lock = `${file}.lock`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; handle === undefined; attempt += 1) {
      try {
        handle = await open(lock, 'wx', 0o600);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || attempt > 0) {
          throw new RuntimeError('edge-credentials-busy', 'another writer holds the edge\'s credentials file; try again');
        }
        const owner = Number((await readFile(lock, 'utf8').catch(() => '')).trim());
        const age = Date.now() - ((await stat(lock).catch(() => undefined))?.mtimeMs ?? Date.now());
        const crashed = Number.isSafeInteger(owner) && owner > 0 ? !running(owner) : age > EMPTY_LOCK_MS;
        if (!crashed) throw new RuntimeError('edge-credentials-busy', 'another writer holds the edge\'s credentials file; try again');
        await rm(lock, {force: true});
      }
    }
    try {
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.close();
      const prefix = `.${basename(file)}.`;
      for (const name of await readdir(dirname(file))) {
        if (name.startsWith(prefix) && name.endsWith('.tmp')) await rm(join(dirname(file), name), {force: true});
      }
      return await change();
    } finally {
      await rm(lock, {force: true});
    }
  });
  queues.set(file, turn);
  try {
    return await turn;
  } finally {
    if (queues.get(file) === turn) queues.delete(file);
  }
}

/** The credentials file's bytes as they are now, or undefined when it is missing. */
const bytesOf = (file: string): Promise<Buffer | undefined> => readFile(file).catch((error: unknown) => {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
  throw error;
});

/**
 * Writes the credentials, checked first, through a private temporary file of its own name beside the file that is
 * renamed over it, so a reader sees the old file or the new one, never part of one. With `before`, the file must still
 * hold those bytes just before the rename: one that another writer changed meanwhile is refused with
 * `configuration-changed`, and nothing is written.
 */
async function replace(file: string, credentials: readonly EdgeCredential[], before?: Buffer, beforeReplace?: () => Promise<void>): Promise<void> {
  const text = credentialsDocument(parseCredentials(JSON.parse(credentialsDocument(credentials))));
  const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await beforeReplace?.();
    if (before !== undefined && !before.equals(await bytesOf(file) ?? Buffer.alloc(0))) {
      throw new RuntimeError('configuration-changed', 'the edge\'s credentials file changed while it was being rewritten; read it again');
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
}

/** Writes the credentials file whole, owner-only, as the installer does, under the file's lock. */
export async function writeEdgeCredentials(file: string, credentials: readonly EdgeCredential[]): Promise<void> {
  await locked(file, () => replace(file, credentials));
}

/** What a test may run just before a writer checks the file and renames its new one over it. */
export type CredentialWriteOptions = {beforeReplace?: () => Promise<void>};

/** Reads the file under its lock, applies `change`, and writes the result unless the file changed since it was read. */
async function update<T>(
  file: string, change: (current: EdgeCredential[]) => {credentials?: EdgeCredential[]; result: T}, {beforeReplace}: CredentialWriteOptions,
): Promise<T> {
  return locked(file, async () => {
    const before = await bytesOf(file);
    const {credentials, result} = change(await readEdgeCredentials(file));
    if (credentials !== undefined) await replace(file, credentials, before ?? Buffer.alloc(0), beforeReplace);
    return result;
  });
}

/**
 * Grants a credential, as a producer's setup does (Hub #926): adds it to the file, and changes nothing when the file
 * already holds it as it is. A credential with its ID but another digest, source, scopes or devices belongs to another
 * owner, and one with another ID but its source would share it: either is refused with `edge-credential-conflict`, as
 * the old setup authority refused a credential it did not own. To rotate a token, revoke the credential and grant it
 * again. The running runtime takes it once it reloads its credentials.
 */
export async function grantCredential(file: string, credential: EdgeCredential, options: CredentialWriteOptions = {}): Promise<void> {
  const granted = parseCredentials({schema: CREDENTIALS_SCHEMA, credentials: [credential]})[0];
  if (granted === undefined) return;
  await update(file, current => {
    const same = current.find(entry => entry.id === granted.id);
    if (same !== undefined) {
      if (JSON.stringify(credentialsDocument([same])) === JSON.stringify(credentialsDocument([granted]))) return {result: undefined};
      throw new RuntimeError('edge-credential-conflict', `the credential ${granted.id} belongs to another owner; revoke it before granting it again`);
    }
    if (current.some(entry => entry.source === granted.source)) {
      throw new RuntimeError('edge-credential-conflict', `another credential already acts as ${granted.source}`);
    }
    return {credentials: [...current, granted], result: undefined};
  }, options);
}

/** Revokes the credential with this ID; true when the file held it. The running runtime drops it once it reloads. */
export async function revokeCredential(file: string, id: string, options: CredentialWriteOptions = {}): Promise<boolean> {
  return update(file, current => {
    const kept = current.filter(entry => entry.id !== id);
    return kept.length === current.length ? {result: false} : {credentials: kept, result: true};
  }, options);
}
