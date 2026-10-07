// Who may use the runtime's gateway, and what each caller may do (Hub #835). Two kinds of caller reach it: a client
// credential, from the edge's credentials file, which presents its bearer token from outside any browser page; and a
// browser session, which the launcher or a trusted loopback page opens and a cookie carries. Each acts as one source
// with the old Hub's scopes and device grants, from which this file derives the calls and routing-key patterns the SDK
// edge allows it. The Origin and fetch-metadata checks keep a page on another site, or on a rebinding name, out.
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {Call, Clock, EdgePrincipal} from '@jimmie-potts/sdk';
import {tokenMatches, type EdgeCredential, type Scope} from '../credentials.js';

/** The source every browser session acts as: the dashboard's grant (Hub #835, #922). */
export const BROWSER_SOURCE = 'bunny/parts/dashboard';
/** The cookie that carries a browser session. */
export const SESSION_COOKIE = 'bunny-session';
/** The header a browser's unsafe request carries, which a page on another site cannot send without the gateway's leave. */
export const REQUEST_HEADER = 'bunny-request';
/** A browser session lasts eight hours, as the old Hub's did; at most 16 are open, the oldest going first. */
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const MAX_SESSIONS = 16;
/** A launch code is good once, for 30 seconds; at most eight wait. */
export const LAUNCH_MS = 30_000;
export const MAX_LAUNCH_CODES = 8;
/** A bearer token or session token: 1 to 512 characters a header can carry without spaces. */
const TOKEN = /^[A-Za-z0-9\-._~+/]{1,512}={0,2}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Who a gateway call acts as. */
export type Principal = {
  /** The credential's ID, or the browser session's own. */
  readonly id: string;
  readonly kind: 'credential' | 'browser';
  readonly source: string;
  readonly scopes: ReadonlySet<Scope>;
  readonly devices: ReadonlySet<string>;
};

/** A refusal before anything else happens, with the registry code and a fixed sentence. */
export type Refusal = {readonly code: ErrorCode; readonly detail: string};
export type Admission = {readonly principal: Principal} | {readonly refusal: Refusal};

/**
 * The core's operator commands that the `control` scope may request, besides each granted device's commands: an
 * approval recovery and a consumer's notice acknowledgment, which the core still checks against the sender's source.
 */
const CONTROL_KEYS = ['bunny.cmd.approval-recover.*', 'bunny.cmd.notice-acknowledge.*'];

/**
 * The SDK edge's permissions for a caller's scopes and devices (Hub #835): `read` subscribes to and syncs every state and
 * event key; `ingest` publishes lifecycle observations only, so a hook can do nothing else; `control` requests the
 * core's operator commands and the commands of its granted devices; `admin` adds nothing at the edge. A part may serve
 * or respond to nothing yet: a remote owner's grant comes with its own story.
 */
export function edgePermissions(principal: Principal): EdgePrincipal {
  const calls = new Set<Call>();
  const keys = new Set<string>();
  if (principal.scopes.has('read')) {
    calls.add('subscribe').add('sync');
    keys.add('bunny.state.*.*').add('bunny.event.*.*');
  }
  if (principal.scopes.has('ingest')) {
    calls.add('publish');
    keys.add('bunny.event.lifecycle.*');
  }
  if (principal.scopes.has('control')) {
    calls.add('request');
    for (const key of CONTROL_KEYS) keys.add(key);
    for (const device of principal.devices) keys.add(`bunny.cmd.*.${device}`);
  }
  return {id: principal.id, source: principal.source, calls: [...calls], keys: [...keys]};
}

/**
 * Where a request comes from, as its `Origin` and `Sec-Fetch-Site` say: `none` for a client outside any page (no
 * Origin, and no fetch metadata or `none`), `same` for a page of this listener's own origin, and `cross` for any other
 * page, including a top-level navigation from another site.
 */
export function contextOf(request: IncomingMessage, origin: string): 'none' | 'same' | 'cross' {
  const given = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if (given === undefined && (site === undefined || site === 'none')) return 'none';
  if ((given === undefined || given === origin) && (site === undefined || site === 'same-origin' || site === 'none')) return 'same';
  return 'cross';
}

const unsafe = (request: IncomingMessage): boolean => request.method !== 'GET' && request.method !== 'HEAD';

/** The session token a request's cookie carries, if any. */
function sessionToken(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return undefined;
}

type Session = {principal: Principal; digest: string; expiresAtMs: number};
const digestOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** The gateway's callers: the configured credentials, the open browser sessions and the waiting launch codes. */
export class Access {
  #credentials: readonly EdgeCredential[];
  readonly #devices: () => readonly string[];
  readonly #clock: Clock;
  readonly #sessions = new Map<string, Session>();
  readonly #launchCodes = new Map<string, number>();

  /** `devices` are the devices a browser session may command: every device an admitted module names. */
  constructor(credentials: readonly EdgeCredential[], devices: () => readonly string[], clock: Clock) {
    this.#credentials = credentials;
    this.#devices = devices;
    this.#clock = clock;
  }

  /**
   * Replaces the credentials, as a reload of the credentials file does, and returns the IDs of those that went or
   * changed, whose streams the caller ends. A credential kept whole keeps its streams.
   */
  replace(credentials: readonly EdgeCredential[]): string[] {
    const kept = new Set(credentials.map(credential => JSON.stringify(credential)));
    const gone = this.#credentials.filter(credential => !kept.has(JSON.stringify(credential))).map(credential => credential.id);
    this.#credentials = credentials;
    return gone;
  }

  get credentials(): readonly EdgeCredential[] {
    return this.#credentials;
  }

  /** The credential a bearer token names, compared with every digest in constant time, or undefined. */
  credential(token: string): EdgeCredential | undefined {
    if (!TOKEN.test(token)) return undefined;
    let found: EdgeCredential | undefined;
    for (const credential of this.#credentials) if (tokenMatches(token, credential.digest)) found = credential;
    return found;
  }

  /** The credential with this ID, while it is still configured. */
  current(id: string): EdgeCredential | undefined {
    return this.#credentials.find(credential => credential.id === id);
  }

  /**
   * Who the request acts as. A bearer token is a client credential, which a browser page may never present: the request
   * must carry no `Origin` and no fetch metadata other than `none`. Without one, a session cookie is a browser session,
   * which only this listener's own pages and the browser itself may present; an unsafe request with it must name this
   * origin and carry `bunny-request: 1`. Anything else is `unauthenticated`, and a page on another site `forbidden`.
   */
  admit(request: IncomingMessage, origin: string): Admission {
    const context = contextOf(request, origin);
    const header = request.headers.authorization;
    if (typeof header === 'string') {
      if (context !== 'none') return {refusal: {code: 'forbidden', detail: 'a client credential is never used from a browser page'}};
      const token = /^Bearer (\S+)$/.exec(header)?.[1];
      const credential = token === undefined ? undefined : this.credential(token);
      if (credential === undefined) return {refusal: {code: 'unauthenticated', detail: 'the token is not granted'}};
      return {principal: principalOf(credential)};
    }
    const token = sessionToken(request);
    if (token === undefined) return {refusal: {code: 'unauthenticated', detail: 'a granted bearer token or a browser session is required'}};
    if (context === 'cross') return {refusal: {code: 'forbidden', detail: 'a browser session is used only by this listener\'s own pages'}};
    if (unsafe(request) && (request.headers.origin !== origin || request.headers[REQUEST_HEADER] !== '1')) {
      return {refusal: {code: 'forbidden', detail: `a browser session's change names this origin and carries ${REQUEST_HEADER}: 1`}};
    }
    const session = this.#session(token);
    if (session === undefined) return {refusal: {code: 'unauthenticated', detail: 'the browser session has ended'}};
    return {principal: session.principal};
  }

  /** Whether the principal still stands: a configured credential that is still configured as it was, or a live session. */
  live(principal: Principal): boolean {
    if (principal.kind === 'browser') return [...this.#sessions.values()].some(session => session.principal === principal && session.expiresAtMs > this.#clock.now());
    const credential = this.current(principal.id);
    return credential !== undefined && sameGrant(principalOf(credential), principal);
  }

  /** Opens a browser session with the dashboard's grant and returns its token, which only the cookie carries. */
  openSession(): string {
    this.#prune();
    while (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
    const token = randomBytes(32).toString('base64url');
    const principal: Principal = {
      id: `browser-${randomUUID()}`, kind: 'browser', source: BROWSER_SOURCE, scopes: new Set<Scope>(['read', 'control']), devices: new Set(this.#devices()),
    };
    const digest = digestOf(token);
    this.#sessions.set(digest, {principal, digest, expiresAtMs: this.#clock.now() + SESSION_MS});
    return token;
  }

  /** Ends the session a request's cookie carries, and returns its principal's ID so its streams can end too. */
  endSession(request: IncomingMessage): string | undefined {
    const token = sessionToken(request);
    const session = token === undefined ? undefined : this.#session(token);
    if (session === undefined) return undefined;
    this.#sessions.delete(session.digest);
    return session.principal.id;
  }

  /** Issues a launch code, good once for 30 seconds, as the launcher hands it to the browser it opens. */
  issueLaunch(): string {
    this.#prune();
    if (this.#launchCodes.size >= MAX_LAUNCH_CODES) throw new Error('launch-capacity');
    const code = randomBytes(32).toString('base64url');
    this.#launchCodes.set(digestOf(code), this.#clock.now() + LAUNCH_MS);
    return code;
  }

  /** Takes a launch code once: true when it was issued and is still good. */
  takeLaunch(code: string): boolean {
    this.#prune();
    if (!SESSION_TOKEN.test(code)) return false;
    return this.#launchCodes.delete(digestOf(code));
  }

  /** Ends every browser session and forgets every launch code, as the runtime's stop does. */
  close(): void {
    this.#sessions.clear();
    this.#launchCodes.clear();
  }

  /** Counts for health-like checks in tests: never a token or an ID. */
  counts(): {sessions: number; launchCodes: number} {
    this.#prune();
    return {sessions: this.#sessions.size, launchCodes: this.#launchCodes.size};
  }

  #session(token: string): Session | undefined {
    if (!SESSION_TOKEN.test(token)) return undefined;
    this.#prune();
    return this.#sessions.get(digestOf(token));
  }

  #prune(): void {
    const now = this.#clock.now();
    for (const [digest, session] of this.#sessions) if (session.expiresAtMs <= now) this.#sessions.delete(digest);
    for (const [digest, expiresAtMs] of this.#launchCodes) if (expiresAtMs <= now) this.#launchCodes.delete(digest);
  }
}

/** A configured credential as a principal. */
export function principalOf(credential: EdgeCredential): Principal {
  return {id: credential.id, kind: 'credential', source: credential.source, scopes: new Set(credential.scopes), devices: new Set(credential.devices)};
}

function sameGrant(a: Principal, b: Principal): boolean {
  const same = (x: ReadonlySet<string>, y: ReadonlySet<string>): boolean => x.size === y.size && [...x].every(item => y.has(item));
  return a.id === b.id && a.source === b.source && same(a.scopes, b.scopes) && same(a.devices, b.devices);
}

/** The `Set-Cookie` value that carries a new session, and the one that ends it. */
export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
export const endedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
