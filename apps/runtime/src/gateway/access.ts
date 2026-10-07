// Who may use the runtime's gateway, and what each caller may do (Hub #835). Two kinds of caller reach it: a client
// credential, from the edge's credentials file, which presents its bearer token from outside any browser page; and a
// browser session, which the launcher or a trusted loopback page opens and a cookie carries. Each acts as one source
// with the old Hub's scopes and device grants, from which this file derives the calls and routing-key patterns the SDK
// edge allows it. The Origin and fetch-metadata checks keep a page on another site, or on a rebinding name, out.
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {Call, Cancel, Clock, EdgePrincipal, Scheduler} from '@jimmie-potts/sdk';
import {DASHBOARD_SOURCE, tokenMatches, type EdgeCredential, type Scope} from '../credentials.js';

/** The source every browser session acts as: the dashboard's grant (Hub #835, #922), which no credential may take. */
export const BROWSER_SOURCE = DASHBOARD_SOURCE;
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
 * The devices a caller may not see: every device an admitted module names that its grant does not (Hub #835). A device's
 * records and messages carry its routing ID as their key's last token, so they are what these leave out.
 */
export function hiddenDevices(principal: Principal, known: readonly string[]): string[] {
  return [...new Set(known)].filter(device => !principal.devices.has(device));
}

/**
 * The SDK edge's permissions for a caller's scopes and devices (Hub #835): `read` subscribes to and syncs every state and
 * event key but those of the devices its grant does not name, as the old Hub narrowed reads by device; `ingest`
 * publishes lifecycle observations only, on lifecycle keys, so a hook can do nothing else; `control` requests the
 * core's operator commands and the commands of its granted devices; `admin` adds nothing at the edge. A part may serve
 * or respond to nothing yet: a remote owner's grant comes with its own story. `known` are the devices the admitted
 * modules name.
 */
export function edgePermissions(principal: Principal, known: readonly string[]): EdgePrincipal {
  const calls = new Set<Call>();
  const keys = new Set<string>();
  const publishes: string[] = [];
  if (principal.scopes.has('read')) {
    calls.add('subscribe').add('sync');
    keys.add('bunny.state.*.*').add('bunny.event.*.*');
  }
  if (principal.scopes.has('ingest')) {
    calls.add('publish');
    keys.add('bunny.event.lifecycle.*');
    publishes.push('lifecycle');
  }
  if (principal.scopes.has('control')) {
    calls.add('request');
    for (const key of CONTROL_KEYS) keys.add(key);
    for (const device of principal.devices) keys.add(`bunny.cmd.*.${device}`);
  }
  const excluded = hiddenDevices(principal, known).map(device => `bunny.*.*.${device}`);
  return {id: principal.id, source: principal.source, calls: [...calls], keys: [...keys], publishes, excluded};
}

/** Whether a caller may use a module's pages, content, settings and tools: its grant names every device the module names. */
export const mayUseModule = (principal: Principal, devices: readonly string[]): boolean => devices.every(device => principal.devices.has(device));

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

/**
 * Every session token a request's cookie header carries. A browser may send several cookies of the name, such as one a
 * page on another loopback port set, since a cookie does not separate ports; the caller takes the one that validates.
 */
function sessionTokens(request: IncomingMessage): string[] {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return [];
  const tokens: string[] = [];
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE && tokens.length < MAX_SESSIONS) tokens.push(value.join('='));
  }
  return tokens;
}

/** Whether a request carries a session cookie, valid or not. */
export const carriesSession = (request: IncomingMessage): boolean => sessionTokens(request).length > 0;

type Session = {principal: Principal; digest: string; expiresAtMs: number; cancel: Cancel};
const digestOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** What the gateway's callers need of the runtime: the devices the modules name, its clock and scheduler. */
export type AccessOptions = {
  /** The devices a browser session may command: every device an admitted module names. */
  devices: () => readonly string[];
  clock: Clock;
  scheduler: Scheduler;
  /** Told the ID of each browser session that ended without a logout, evicted or expired, so its streams end too. */
  ended: (id: string) => void;
};

/** The gateway's callers: the configured credentials, the open browser sessions and the waiting launch codes. */
export class Access {
  #credentials: readonly EdgeCredential[];
  readonly #options: AccessOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #launchCodes = new Map<string, number>();

  constructor(credentials: readonly EdgeCredential[], options: AccessOptions) {
    this.#credentials = credentials;
    this.#options = options;
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
   * `origin` is the request's own: `http://` and the listener's host name the request named, either loopback name.
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
    const tokens = sessionTokens(request);
    if (tokens.length === 0) return {refusal: {code: 'unauthenticated', detail: 'a granted bearer token or a browser session is required'}};
    if (context === 'cross') return {refusal: {code: 'forbidden', detail: 'a browser session is used only by this listener\'s own pages'}};
    if (unsafe(request) && (request.headers.origin !== origin || request.headers[REQUEST_HEADER] !== '1')) {
      return {refusal: {code: 'forbidden', detail: `a browser session's change names this origin and carries ${REQUEST_HEADER}: 1`}};
    }
    const session = tokens.map(token => this.#session(token)).find(found => found !== undefined);
    if (session === undefined) return {refusal: {code: 'unauthenticated', detail: 'the browser session has ended'}};
    return {principal: session.principal};
  }

  /** Whether the principal still stands: a configured credential that is still configured as it was, or a live session. */
  live(principal: Principal): boolean {
    if (principal.kind === 'browser') return [...this.#sessions.values()].some(session => session.principal === principal && session.expiresAtMs > this.#options.clock.now());
    const credential = this.current(principal.id);
    return credential !== undefined && sameGrant(principalOf(credential), principal);
  }

  /**
   * Opens a browser session with the dashboard's grant and returns its token, which only the cookie carries. The oldest
   * session goes when 16 are open, and each goes at its expiry; either way its streams end at once (`ended`), as a
   * logout's do.
   */
  openSession(): string {
    this.#prune();
    while (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = this.#sessions.values().next().value;
      if (oldest === undefined) break;
      this.#end(oldest, true);
    }
    const token = randomBytes(32).toString('base64url');
    const principal: Principal = {
      id: `browser-${randomUUID()}`, kind: 'browser', source: BROWSER_SOURCE, scopes: new Set<Scope>(['read', 'control']), devices: new Set(this.#options.devices()),
    };
    const digest = digestOf(token);
    const session: Session = {principal, digest, expiresAtMs: this.#options.clock.now() + SESSION_MS, cancel: () => {}};
    session.cancel = this.#options.scheduler.after(SESSION_MS, () => { if (this.#sessions.get(digest) === session) this.#end(session, true); });
    this.#sessions.set(digest, session);
    return token;
  }

  /** Ends the session a request's cookie carries, and returns its principal's ID so its streams can end too. */
  endSession(request: IncomingMessage): string | undefined {
    const session = sessionTokens(request).map(token => this.#session(token)).find(found => found !== undefined);
    if (session === undefined) return undefined;
    this.#end(session, false);
    return session.principal.id;
  }

  /** Forgets a session and its expiry timer; one that ended without its logout has its streams ended too. */
  #end(session: Session, unasked: boolean): void {
    session.cancel();
    if (this.#sessions.get(session.digest) === session) this.#sessions.delete(session.digest);
    if (!unasked) return;
    try {
      this.#options.ended(session.principal.id);
    } catch {
      // Ending a session's streams must not stop the session from ending.
    }
  }

  /** Issues a launch code, good once for 30 seconds, as the launcher hands it to the browser it opens. */
  issueLaunch(): string {
    this.#prune();
    if (this.#launchCodes.size >= MAX_LAUNCH_CODES) throw new Error('launch-capacity');
    const code = randomBytes(32).toString('base64url');
    this.#launchCodes.set(digestOf(code), this.#options.clock.now() + LAUNCH_MS);
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
    for (const session of this.#sessions.values()) session.cancel();
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
    const now = this.#options.clock.now();
    for (const session of [...this.#sessions.values()]) if (session.expiresAtMs <= now) this.#end(session, true);
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
