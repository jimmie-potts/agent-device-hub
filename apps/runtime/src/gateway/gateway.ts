// The runtime's gateway (Hub #835): every route of its listener but health. It serves the SDK edge for remote parts,
// the `/api/v2` read routes and the core's operator action, MCP, the modules' pages and content, and browser sign-in,
// each with one error body from the 2.0 registry. Every caller is a client credential or a browser session (access.ts),
// each with the old Hub's scopes; no caller is limited to some devices (owner decision, 2026-10-07). A route of the old Hub answers `not-found` and is logged with the
// route it asked for (retired.ts), for the retirement story's check (#839).
import {randomUUID} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {coreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import type {McpHandler} from '@jimmie-potts/device-mcp';
import {
  CALLS, CONTENT_PATH, MODULE_API_VERSION, REMOTE_PATH, RemoteEdge, levelOf, statusOf, type Cancel, type Clock, type Diagnostic, type EdgeRoute,
  type InProcessBus, type ModulePage, type OnDiagnostic, type Participant, type Scheduler, type SyncedCopy,
} from '@jimmie-potts/sdk';
import type {EdgeCredential, Scope} from '../credentials.js';
import {REGISTRY_REASONS, diagnosticWriter} from '../diagnostics.js';
import {ContributionFailed, ModuleUnavailable, sourceOf, type HostedModule, type ModuleHost} from '../host.js';
import type {Redactions, RuntimeLogger} from '../log.js';
import type {EdgeConfig} from '../state.js';
import {
  Access, BROWSER_SOURCE, REQUEST_HEADER, carriesSession, contextOf, edgePermissions, endedCookie, principalOf, sessionCookie, type Principal,
} from './access.js';
import {startLauncher} from './launcher.js';
import {TOOL_TIMEOUT_MS, createGatewayMcp} from './mcp.js';
import {retiredRoute} from './retired.js';

/** The gateway's own participant, which keeps its synced copies and is no caller's. */
export const GATEWAY_SOURCE = 'bunny/runtime/gateway';
/** How long a read waits for a family's first sync, and a command for its reply. */
const SYNC_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 5000;
/** At most this many kept copies at once, one per family and owner. */
const MAX_COPIES = 32;
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
/** A refusal that repeats with the same route, code and caller is logged once, then once a minute with its count. */
const REFUSAL_WINDOW_MS = 60_000;
/** The largest JSON body a gateway route reads. */
const MAX_BODY_BYTES = 16_384;
/** The largest settings document a module may show, and the largest content it may serve. */
const MAX_SETTINGS_BYTES = 65_536;
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
/** The media types a module's content may have: images, plain text and JSON. */
const CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain; charset=utf-8', 'application/json']);
const FAMILY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SESSION = /^[0-9a-f]{64}$/;
const RECOVER_SCHEMA = `${SCHEMA_BASE}approval-recover/2.0`;

/** A route's answer: its HTTP status, headers and body. */
type Answer = {status: number; body: string | Uint8Array; headers: Record<string, string>};
/** A refusal the gateway answers with the shared error body. */
class Refused extends Error {
  readonly body: ErrorBody;

  constructor(code: ErrorCode, detail: string) {
    super(code);
    this.body = errorBody(code, {detail: detail.slice(0, MAX_DETAIL)});
  }
}
const refuse = (code: ErrorCode, detail: string): Refused => new Refused(code, detail);

const JSON_HEADERS = {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};
const json = (status: number, body: object, headers: Record<string, string> = {}): Answer => ({status, body: JSON.stringify(body), headers: {...JSON_HEADERS, ...headers}});
/**
 * A module's page and content may load only images and styles from the runtime itself: no script, frame, form or base,
 * and no page may frame them.
 */
const PAGE_HEADERS = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': 'default-src \'none\'; img-src \'self\'; style-src \'self\' \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'',
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export type GatewayOptions = {
  bus: InProcessBus;
  host: ModuleHost;
  /** The edge's validator: profile 2.0, the core families and the modules' own payload schemas. */
  validator: MessageValidator;
  /** The families that `/api/v2` may read: the core's and the modules' state families. */
  families: ReadonlySet<string>;
  edge: EdgeConfig;
  credentials: readonly EdgeCredential[];
  /** The runtime's own log, where the gateway's and the edge's refusals are recorded. */
  log: RuntimeLogger;
  /** The secrets the modules read, which no answer may carry. */
  redactions: Redactions;
  clock: Clock;
  scheduler: Scheduler;
  stateDir: string;
  /** The SDK edge's liveness limits, for tests. */
  liveness?: {heartbeatMs?: number; stallMs?: number; scheduler?: Scheduler};
  /** Hears each of the edge's decisions too, after the log does, as a test harness collects them. */
  onDiagnostic?: OnDiagnostic;
};

/** One repeated refusal: its record, the repeats since, and its window. */
type Repeats = {fields: Record<string, string | number>; level: 'info' | 'warn' | 'error'; count: number; cancel: Cancel};

export class Gateway {
  readonly edge: RemoteEdge;
  readonly access: Access;
  readonly #options: GatewayOptions;
  readonly #log: RuntimeLogger;
  /** The principal each SDK request was admitted as, which the edge's `authenticate` reads. */
  readonly #admitted = new WeakMap<IncomingMessage, Principal>();
  readonly #participants = new Map<string, Participant>();
  readonly #copies = new Map<string, Promise<SyncedCopy<Record<string, unknown>>>>();
  readonly #repeats = new Map<string, Repeats>();
  #own: Participant | undefined;
  #mcp: McpHandler | undefined;
  #closeLauncher: (() => Promise<void>) | undefined;
  #origin = '';
  #hosts: readonly string[] = [];
  #closed = false;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.#log = options.log;
    this.access = new Access(options.credentials, {
      clock: options.clock, scheduler: options.scheduler,
      // A browser session that ends without its logout, evicted or expired, takes its streams with it.
      ended: id => { this.edge.disconnectPrincipal(id); },
    });
    this.edge = new RemoteEdge({
      bus: options.bus, validator: options.validator, now: () => options.clock.now(), scheduler: options.scheduler,
      onDiagnostic: options.onDiagnostic === undefined ? diagnosticWriter(options.log) : (writer => (diagnostic: Diagnostic) => {
        writer(diagnostic);
        options.onDiagnostic?.(diagnostic);
      })(diagnosticWriter(options.log)),
      authenticate: request => {
        const principal = this.#admitted.get(request);
        return principal === undefined ? undefined : edgePermissions(principal);
      },
      ...(options.liveness?.heartbeatMs === undefined ? {} : {heartbeatMs: options.liveness.heartbeatMs}),
      ...(options.liveness?.stallMs === undefined ? {} : {stallMs: options.liveness.stallMs}),
      ...(options.liveness?.scheduler === undefined ? {} : {liveness: options.liveness.scheduler}),
    });
  }

  /**
   * Starts serving on the listener's origin: MCP for its host names, and the launcher's socket in the state directory,
   * which hands the launcher a code that signs one browser in.
   */
  async start(origin: string, hosts: readonly string[]): Promise<void> {
    this.#origin = origin;
    this.#hosts = hosts.map(host => host.toLowerCase());
    this.#own = this.#options.bus.connect(GATEWAY_SOURCE);
    // MCP serves only when the edge section turns it on, as the old Hub's `mcp` did.
    if (this.#options.edge.mcp) {
      this.#mcp = createGatewayMcp({
        modules: () => this.#options.host.modules(), invoke: (name, call) => this.#options.host.invoke(name, call), access: this.access,
        recover: (id, input) => this.#recoverFor(id, input), scheduler: this.#options.scheduler, holdsSecret: text => this.#options.redactions.holds(text),
      }, hosts);
    }
    if (this.#options.edge.launcher) this.#closeLauncher = await startLauncher(this.#options.stateDir, () => ({url: `${this.#origin}/`, code: this.access.issueLaunch()}));
  }

  /**
   * The request's own origin: `http://` and the host it named, either of the listener's loopback names, so a bookmark on
   * `localhost` signs in as one on `127.0.0.1` does (Hub #276). The runtime refuses any other host before this.
   */
  #originOf(request: IncomingMessage): string {
    const host = (request.headers.host ?? '').toLowerCase();
    return this.#hosts.includes(host) ? `http://${host}` : this.#origin;
  }

  /** Replaces the credentials, and ends the streams and MCP use of every credential that went or changed. */
  reload(credentials: readonly EdgeCredential[]): void {
    for (const id of this.access.replace(credentials)) this.edge.disconnectPrincipal(id);
  }

  /** Stops serving: the launcher, MCP, the edge's streams, the copies and every browser session. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const repeats of this.#repeats.values()) {
      repeats.cancel();
      this.#summarize(repeats);
    }
    this.#repeats.clear();
    await this.#closeLauncher?.().catch(() => {});
    await this.#mcp?.close();
    await this.edge.close();
    this.access.close();
    const copies = await Promise.allSettled([...this.#copies.values()]);
    await Promise.all(copies.flatMap(result => result.status === 'fulfilled' ? [result.value.close()] : []));
    await Promise.all([...this.#participants.values(), ...(this.#own === undefined ? [] : [this.#own])].map(participant => participant.close()));
  }

  /** Serves one request on the listener; health is the runtime's own. */
  readonly handle = (request: IncomingMessage, response: ServerResponse): void => {
    void this.#serve(request, response);
  };

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://gateway');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    if (path.startsWith(`${REMOTE_PATH}/`)) {
      this.#remote(request, response, path.slice(REMOTE_PATH.length + 1));
      return;
    }
    const route = templateOf(path);
    let principal: Principal | undefined;
    try {
      if (path === '/mcp') {
        if (!this.#options.edge.mcp) throw refuse('not-found', 'MCP is off');
        principal = this.#admit(request, {credential: true});
        if (this.#mcp === undefined) throw refuse('unavailable', 'MCP serves once the gateway has started');
        await this.#mcp.handle(request, response);
        return;
      }
      let answer: Answer;
      if (path.startsWith('/api/v2/browser/')) answer = await this.#browser(request, path.slice('/api/v2/browser/'.length));
      else {
        if (route === undefined) {
          const retired = retiredRoute(method, path);
          const owner = retired?.owner === undefined ? '' : ` (${retired.owner})`;
          throw refuse('not-found', retired === undefined ? 'no such route'
            : retired.status === 'kept' ? `this route is not served yet: ${retired.replacement}${owner}` : `this route was retired; use ${retired.replacement}${owner}`);
        }
        principal = this.#admit(request);
        answer = await this.#route(request, url, principal);
      }
      this.#write(response, answer);
    } catch (error) {
      const body = error instanceof Refused ? error.body : errorBody('internal', {detail: 'the gateway failed'});
      const {code} = body.error;
      const retired = code === 'not-found' && route === undefined ? retiredRoute(method, path) : undefined;
      this.#refused({
        'bunny.route': 'other', 'http.request.method': methodOf(method), 'bunny.code': code,
        ...(route !== undefined ? {'http.route': route} : retired !== undefined ? {'http.route': retired.path} : {}),
        ...(principal === undefined ? {} : {'bunny.participant': principal.source}),
      }, code === 'internal' ? 'error' : levelOf(code));
      this.#write(response, json(statusOf(code), body));
    }
  }

  /**
   * Admits the caller of a route, or refuses it before anything happens. `credential` routes, MCP among them, take a
   * client credential only, never a browser session.
   */
  #admit(request: IncomingMessage, {credential = false}: {credential?: boolean} = {}): Principal {
    // A browser session on a credential's route is told so first, whatever else it lacks.
    const session = typeof request.headers.authorization !== 'string' && carriesSession(request);
    if (credential && session) throw refuse('forbidden', 'this route takes a client credential, not a browser session');
    const admission = this.access.admit(request, this.#originOf(request));
    if ('refusal' in admission) throw refuse(admission.refusal.code, admission.refusal.detail);
    const {principal} = admission;
    if (credential && principal.kind !== 'credential') throw refuse('forbidden', 'this route takes a client credential, not a browser session');
    return principal;
  }

  /** The SDK edge's routes: the gateway admits the caller, and the edge checks each call against its permissions. */
  #remote(request: IncomingMessage, response: ServerResponse, call: string): void {
    const route: EdgeRoute = (CALLS as readonly string[]).includes(call) || call === 'stream' ? call as EdgeRoute : 'other';
    const admission = this.access.admit(request, this.#originOf(request));
    if ('refusal' in admission) {
      const {code, detail} = admission.refusal;
      this.#refused({'bunny.route': route, 'bunny.code': code}, levelOf(code));
      this.#write(response, json(statusOf(code), errorBody(code, {detail})));
      return;
    }
    this.#admitted.set(request, admission.principal);
    this.edge.handle(request, response);
  }

  async #route(request: IncomingMessage, url: URL, principal: Principal): Promise<Answer> {
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const query = [...url.searchParams.keys()];
    const noQuery = (): void => { if (query.length > 0) throw refuse('invalid-request', 'this route takes no query'); };
    const needs = (scope: Scope): void => { if (!principal.scopes.has(scope)) throw refuse('forbidden', `this route needs the ${scope} scope`); };
    if (method === 'GET' && path === '/api/v2/authority') {
      const scope = url.searchParams.get('scope');
      if (query.length !== 1 || scope === null || !['read', 'control', 'ingest', 'admin'].includes(scope)) throw refuse('invalid-request', 'name one scope: read, control, ingest or admin');
      needs(scope as Scope);
      return json(200, {schema: 'authority/2.0', scope});
    }
    if (method === 'POST' && path === '/api/v2/commands/approval-recover') {
      noQuery();
      needs('control');
      const input = await readBody(request);
      const answer = await this.#recover(principal, recoveryInput(input));
      return 'error' in answer ? json(statusOf(answer.error.code), answer) : json(200, {schema: 'command-reply/2.0', ...answer});
    }
    if (method !== 'GET') throw refuse('not-found', 'no such route');
    needs('read');
    if (path === '/api/v2/modules') {
      noQuery();
      return json(200, {schema: 'module-list/2.0', moduleApiVersion: MODULE_API_VERSION, modules: this.#options.host.modules().map(module => this.#describe(module))});
    }
    if (path === '/api/v2/links') {
      noQuery();
      const {editorLinks, placeLinks} = this.#options.edge;
      return json(200, {schema: 'links/2.0', editors: editorLinks, places: placeLinks});
    }
    if (path === '/api/v2/snapshot') return this.#snapshot(url);
    const family = /^\/api\/v2\/families\/([^/]+)$/.exec(path)?.[1];
    if (family !== undefined) {
      noQuery();
      return this.#family(family);
    }
    const settings = /^\/api\/v2\/modules\/([^/]+)\/settings$/.exec(path)?.[1];
    if (settings !== undefined) {
      noQuery();
      return this.#settings(settings);
    }
    const content = /^\/modules\/([^/]+)\/content\/([^/]+)$/.exec(path);
    if (content !== null) {
      noQuery();
      return this.#content(content[1] ?? '', content[2] ?? '');
    }
    const page = /^\/modules\/([^/]+)\/([^/]+)$/.exec(path);
    if (page !== null) {
      noQuery();
      return this.#page(page[1] ?? '', page[2] ?? '');
    }
    throw refuse('not-found', 'no such route');
  }

  /** A module as `/api/v2/modules` lists it: its state and what it contributes, which is nothing until it is admitted. */
  #describe(module: HostedModule): object {
    const {name, manifest, state, admitted} = module;
    return {
      name, apiVersion: manifest.apiVersion, state,
      pages: admitted ? (manifest.pages ?? []).map((page: ModulePage) => ({id: page.id, title: page.title, path: `/modules/${name}/${page.id}`})) : [],
      tools: admitted ? [...(manifest.tools ?? []).map(tool => `${name}_${tool.name}`), ...(name === 'core' ? ['core_recover_approval'] : [])] : [],
      settings: admitted && manifest.settings !== undefined,
    };
  }

  /**
   * A family's owners: those that serve it now, as the bus knows them, and the hosted modules that served it and do not
   * serve it now, which are down. A kept copy of a module that is down is closed.
   */
  #ownersOf(family: string): {serving: string[]; down: string[]} {
    const serving = this.#options.bus.syncOwners(family);
    const down = this.#options.host.modules().filter(module => module.served.includes(family)).map(module => sourceOf(module.name))
      .filter(owner => !serving.includes(owner));
    for (const owner of down) this.#forget(family, owner);
    return {serving, down};
  }

  /**
   * The records of one family. Several owners may serve a family, as every device module serves
   * `device` for its own devices (Hub #967): the read combines each owner's kept copy, in the order the owners started,
   * so a reader such as the dashboard gets every device in one answer. An owner that is down, or whose copy cannot be
   * read, never fails the others (ADR 0012, policy A): the answer names it, by its source alone, in `unavailable`, so a
   * reader never takes its records for absent. A family whose every owner is down or unreadable is `unavailable`, and
   * one no module serves or served is `not-found`.
   */
  async #family(family: string): Promise<Answer> {
    if (!FAMILY.test(family) || family.length > 64) throw refuse('invalid-request', 'a family name is lowercase letters and digits with single hyphens');
    if (!this.#options.families.has(family)) throw refuse('not-found', 'no such family');
    const {serving, down} = this.#ownersOf(family);
    if (serving.length === 0 && down.length === 0) throw refuse('not-found', 'no module in this runtime serves this family');
    const settled = await Promise.allSettled(serving.map(owner => this.#copy(family, owner)));
    const records: Record<string, unknown>[] = [];
    const unavailable: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') records.push(...result.value.states().map(state => state.data));
      else unavailable.push(serving[index] ?? '');
    });
    if (settled.every(result => result.status === 'rejected')) {
      // An only owner's own refusal keeps its code; otherwise the family has no owner to read from now.
      const [only] = settled;
      if (only?.status === 'rejected' && serving.length === 1 && down.length === 0) throw only.reason;
      throw refuse('unavailable', serving.length === 0 ? 'the module that serves this family is not running' : 'no owner of this family could be read');
    }
    return json(200, {schema: 'family-read/2.0', family, records, unavailable: [...unavailable, ...down]});
  }

  /** Closes and forgets a kept copy, as of an owner that is down. */
  #forget(family: string, owner: string): void {
    const key = `${family}\n${owner}`;
    const kept = this.#copies.get(key);
    if (kept === undefined) return;
    this.#copies.delete(key);
    void kept.then(copy => copy.close(), () => {});
  }

  /**
   * The kept copy of a family from one owner, synced once and then following that owner alone; a copy whose sync fails
   * is dropped, and the next read syncs again from the owners there are then.
   */
  #copy(family: string, owner: string): Promise<SyncedCopy<Record<string, unknown>>> {
    const key = `${family}\n${owner}`;
    const kept = this.#copies.get(key);
    if (kept !== undefined) return kept;
    if (this.#copies.size >= MAX_COPIES) return Promise.reject(refuse('capacity', 'the gateway keeps as many copies as it can'));
    const own = this.#own;
    if (own === undefined) return Promise.reject(refuse('unavailable', 'the gateway has not started'));
    const syncing = own.sync<Record<string, unknown>>([family], change => {
      if (change.type === 'failed') this.#copies.delete(key);
    }, {timeoutMs: SYNC_TIMEOUT_MS, owner}).then(result => {
      if (result.status === 'synced') return result.copy;
      this.#copies.delete(key);
      // The owner's own detail is not served: it may say anything, a secret included. Its code stands.
      throw syncRefusal(result.error.error.code);
    }, (error: unknown) => {
      this.#copies.delete(key);
      throw error;
    });
    this.#copies.set(key, syncing);
    return syncing;
  }

  /**
   * The snapshot read API (ADR 0012, "Portability"): one owner's current state of the named families, at its revision,
   * as one sync answers it, with no copy kept. `owner=<source>` names the owner, as for `device`, which several serve.
   * It is the gateway's one-off sync: the second implementation of the snapshot read API that the ADR asks for, here
   * for a caller of this one process.
   */
  async #snapshot(url: URL): Promise<Answer> {
    const keys = [...url.searchParams.keys()];
    const listed = url.searchParams.get('families');
    const named = url.searchParams.get('owner');
    if (listed === null || keys.some(key => key !== 'families' && key !== 'owner') || new Set(keys).size !== keys.length) {
      throw refuse('invalid-request', 'name the families as families=<a>,<b>, and optionally their owner as owner=<source>');
    }
    if (named !== null && (named.length > 256 || !SOURCE.test(named))) throw refuse('invalid-request', 'owner is a participant source, such as bunny/modules/<name>');
    const families = listed.split(',');
    if (families.length > 32 || families.some(family => !FAMILY.test(family) || family.length > 64) || new Set(families).size !== families.length) {
      throw refuse('invalid-request', 'the families are distinct family names, at most 32');
    }
    if (families.some(family => !this.#options.families.has(family))) throw refuse('not-found', 'a named family does not exist');
    const owners = families.map(family => this.#ownersOf(family));
    if (owners.some(({serving, down}) => serving.length === 0 && down.length === 0)) throw refuse('not-found', 'no module in this runtime serves a named family');
    // One snapshot is one owner's state at its revision: the named owner, or the one owner of every named family.
    if (named !== null) {
      if (owners.some(({serving, down}) => !serving.includes(named) && !down.includes(named))) throw refuse('not-found', 'the named owner does not serve every named family');
      if (owners.some(({down}) => down.includes(named))) throw refuse('unavailable', 'the named owner is not running');
    } else {
      if (new Set(owners.flatMap(({serving, down}) => [...serving, ...down])).size > 1) {
        throw refuse('invalid-request', 'one snapshot reads one owner\'s families: name families that one module serves, or name it as owner=<source>');
      }
      if (owners.some(({serving}) => serving.length === 0)) throw refuse('unavailable', 'the module that serves these families is not running');
    }
    const own = this.#own;
    if (own === undefined) throw refuse('unavailable', 'the gateway has not started');
    const result = await own.sync<Record<string, unknown>>(families, () => {}, {timeoutMs: SYNC_TIMEOUT_MS, ...(named === null ? {} : {owner: named})});
    if (result.status === 'rejected') throw syncRefusal(result.error.error.code);
    // A record belongs to the family its schema names, at whatever version.
    const records = Object.fromEntries(families.map(family => [family, result.copy.states().filter(state => familyOf(state.dataschema) === family).map(state => state.data)]));
    await result.copy.close();
    return json(200, {schema: 'snapshot-read/2.0', families, revision: result.message.data.revision, records});
  }

  /** What a module shows of its settings: `show` over the configuration `configure` accepted, never a secret. */
  async #settings(name: string): Promise<Answer> {
    const module = this.#module(name);
    const {settings} = module.manifest;
    if (settings === undefined) throw refuse('not-found', 'the module declares no settings');
    const shown = await this.#call(name, () => settings.show(module.config));
    const text = JSON.stringify(shown);
    if (typeof shown !== 'object' || Array.isArray(shown) || Buffer.byteLength(text, 'utf8') > MAX_SETTINGS_BYTES) {
      throw refuse('internal', 'the module showed settings that are not an object of at most 64 KiB');
    }
    if (this.#options.redactions.holds(text)) throw refuse('internal', 'the module showed a secret, which the gateway never serves');
    return json(200, {schema: 'module-settings/2.0', module: name, settings: shown, describedBy: settings.schema});
  }

  /** A module's page, its HTML in a document with the gateway's policy. */
  async #page(name: string, id: string): Promise<Answer> {
    const module = this.#module(name);
    const page = (module.manifest.pages ?? []).find(candidate => candidate.id === id);
    if (page === undefined || id === CONTENT_PATH) throw refuse('not-found', 'no such page');
    const html = await this.#call(name, () => page.render());
    if (typeof html !== 'string') throw refuse('internal', 'the module\'s page is not HTML text');
    if (this.#options.redactions.holds(html)) throw refuse('internal', 'the module\'s page holds a secret, which the gateway never serves');
    const document = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<title>${escapeHtml(page.title)}</title></head><body>\n${html}\n</body></html>\n`;
    return {status: 200, body: document, headers: {'content-type': 'text/html; charset=utf-8', ...PAGE_HEADERS}};
  }

  /** A module's content by reference, such as a preview frame its page shows. */
  async #content(name: string, ref: string): Promise<Answer> {
    const module = this.#module(name);
    const {content} = module.manifest;
    if (!ID.test(ref)) throw refuse('invalid-request', 'a content reference is 1 to 128 letters, digits, underscores, dots or hyphens');
    if (content === undefined) throw refuse('not-found', 'the module serves no content');
    const found = await this.#call(name, () => content(ref));
    if (found === undefined) throw refuse('not-found', 'no such content');
    if (!CONTENT_TYPES.has(found.type) || !(found.bytes instanceof Uint8Array) || found.bytes.byteLength > MAX_CONTENT_BYTES) {
      throw refuse('internal', 'the module\'s content is not an image, text or JSON of at most 16 MiB');
    }
    // The bytes are checked for a secret the module read, whatever their type: an image's metadata can carry text too.
    if (this.#options.redactions.holdsBytes(found.bytes)) {
      throw refuse('internal', 'the module\'s content holds a secret, which the gateway never serves');
    }
    return {status: 200, body: found.bytes, headers: {'content-type': found.type, ...PAGE_HEADERS}};
  }

  /** The module named in a path, when it is hosted and admitted. */
  #module(name: string): HostedModule {
    const module = this.#options.host.modules().find(candidate => candidate.name === name && candidate.admitted);
    if (module === undefined) throw refuse('not-found', 'no such module');
    return module;
  }

  /** One of a module's contributions, bounded by the tool limit, each failure as a refusal. */
  async #call<T>(name: string, call: () => T | Promise<T>): Promise<T> {
    let cancel = (): void => {};
    const late = new Promise<never>((_resolve, reject) => {
      cancel = this.#options.scheduler.after(TOOL_TIMEOUT_MS, () => { reject(refuse('unavailable', `the module did not answer within ${TOOL_TIMEOUT_MS} ms`)); });
    });
    try {
      return await Promise.race([this.#options.host.invoke(name, call), late]);
    } catch (error) {
      if (error instanceof ModuleUnavailable) throw refuse('unavailable', 'the module is not running');
      if (error instanceof ContributionFailed) throw refuse('internal', 'the module failed');
      throw error;
    } finally {
      cancel();
    }
  }

  /** The core's operator action for a client credential, by its ID, as MCP calls it. */
  async #recoverFor(id: string, input: RecoveryInput): Promise<{status: 'accepted'; requestId: string} | ErrorBody> {
    const credential = this.access.current(id);
    if (credential === undefined) return errorBody('unauthenticated', {detail: 'the credential was revoked'});
    return this.#recover(principalOf(credential), input);
  }

  /**
   * Sends `approval-recover` to the core as the caller's source (Hub #835), and answers with the core's reply: `accepted`
   * once the recovery committed, or its refusal. A request whose fate the bus cannot know is `uncertain-result`.
   */
  async #recover(principal: Principal, input: RecoveryInput): Promise<{status: 'accepted'; requestId: string} | ErrorBody> {
    if (!this.access.live(principal)) return errorBody('unauthenticated', {detail: 'the caller\'s credential or session has ended'});
    const requestId = input.requestId ?? randomUUID();
    const result = await this.#participant(principal.source).request(`bunny.cmd.approval-recover.${input.session}`, {
      type: 'org.bunny.approval.recover.requested', subject: input.session, dataschema: RECOVER_SCHEMA,
      data: {turnId: input.turnId, expectedRevision: input.expectedRevision},
    }, {timeoutMs: COMMAND_TIMEOUT_MS, requestId});
    return result.status === 'accepted' ? {status: 'accepted', requestId} : result.error;
  }

  /** The bus participant a caller's commands come from: its own source, so the core and the records name it. */
  #participant(source: string): Participant {
    let participant = this.#participants.get(source);
    if (participant === undefined) {
      participant = this.#options.bus.connect(source);
      this.#participants.set(source, participant);
    }
    return participant;
  }

  /** Browser sign-in: the launcher's code, a trusted loopback page, and the end of a session. */
  async #browser(request: IncomingMessage, action: string): Promise<Answer> {
    const known = ['launch', 'session', 'logout'].includes(action);
    if (request.method !== 'POST' || !known) throw refuse('not-found', 'no such route');
    if (action === 'session' && this.#options.edge.browserAccess !== 'trusted-loopback') throw refuse('not-found', 'trusted loopback sign-in is off');
    // Only this listener's own page may sign a browser in or out, on either loopback name.
    const origin = this.#originOf(request);
    if (contextOf(request, origin) === 'cross' || request.headers.origin !== origin || request.headers[REQUEST_HEADER] !== '1') {
      throw refuse('forbidden', `sign-in takes a request from this origin's own page with ${REQUEST_HEADER}: 1`);
    }
    const input = await readBody(request);
    const closed = (): void => { if (this.#closed) throw refuse('unavailable', 'the runtime is stopping'); };
    if (action === 'launch') {
      const {code} = input as {code?: unknown};
      if (Object.keys(input).length !== 1 || typeof code !== 'string' || !this.access.takeLaunch(code)) throw refuse('unauthenticated', 'the launch code is not good');
      closed();
      return json(200, {schema: 'browser-session/2.0', source: BROWSER_SOURCE}, {'set-cookie': sessionCookie(this.access.openSession())});
    }
    if (Object.keys(input).length > 0) throw refuse('invalid-request', 'the body is an empty object');
    if (action === 'session') {
      closed();
      return json(200, {schema: 'browser-session/2.0', source: BROWSER_SOURCE}, {'set-cookie': sessionCookie(this.access.openSession())});
    }
    const ended = this.access.endSession(request);
    if (ended !== undefined) this.edge.disconnectPrincipal(ended);
    return json(200, {schema: 'browser-session/2.0', ended: ended !== undefined}, {'set-cookie': endedCookie});
  }

  #write(response: ServerResponse, answer: Answer): void {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(answer.status, answer.headers).end(answer.body);
  }

  /**
   * Records a refusal by the repetition rule (ADR 0012, "Repetition"): the first of a run at once, then its repeats as
   * one summary a minute with their count, until a quiet minute. A record never holds what the caller sent.
   */
  #refused(fields: Record<string, string | number>, level: 'debug' | 'info' | 'warn' | 'error'): void {
    const severity = level === 'debug' ? 'info' : level;
    const key = JSON.stringify(fields);
    const open = this.#repeats.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    const code = fields['bunny.code'] as ErrorCode;
    const reason = REGISTRY_REASONS[code];
    const record = {...fields, ...(reason === undefined ? {} : {'bunny.reason': reason})};
    this.#log[severity]('runtime.edge.refused', record);
    if (this.#closed) return;
    const repeats: Repeats = {fields: record, level: severity, count: 0, cancel: () => {}};
    this.#repeats.set(key, repeats);
    this.#window(key, repeats);
  }

  #window(key: string, repeats: Repeats): void {
    repeats.cancel = this.#options.scheduler.after(REFUSAL_WINDOW_MS, () => {
      if (repeats.count === 0) {
        this.#repeats.delete(key);
        return;
      }
      this.#summarize(repeats);
      this.#window(key, repeats);
    });
  }

  #summarize(repeats: Repeats): void {
    const {count} = repeats;
    repeats.count = 0;
    if (count > 0) this.#log[repeats.level]('runtime.edge.refused', {...repeats.fields, 'bunny.attempt_count': count});
  }
}

/** The routes the gateway serves, as the templates its records name; undefined for a path it does not serve. */
function templateOf(path: string): string | undefined {
  if (path === '/mcp') return '/mcp';
  if (path === '/api/v2/authority' || path === '/api/v2/modules' || path === '/api/v2/links' || path === '/api/v2/snapshot') return path;
  if (path === '/api/v2/commands/approval-recover') return path;
  if (/^\/api\/v2\/browser\/(launch|session|logout)$/.test(path)) return path;
  if (/^\/api\/v2\/families\/[^/]+$/.test(path)) return '/api/v2/families/{family}';
  if (/^\/api\/v2\/modules\/[^/]+\/settings$/.test(path)) return '/api/v2/modules/{module}/settings';
  if (/^\/modules\/[^/]+\/content\/[^/]+$/.test(path)) return '/modules/{module}/content/{ref}';
  if (/^\/modules\/[^/]+\/[^/]+$/.test(path)) return '/modules/{module}/{page}';
  return undefined;
}

/** A method as the records name it: one of the common ones, or `_OTHER`. */
const methodOf = (method: string): string => ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(method) ? method : '_OTHER';

/** An approval recovery's input: the session, its turn, the record's revision the operator read and an optional request ID. */
type RecoveryInput = {session: string; turnId: string; expectedRevision: number; requestId?: string};

function recoveryInput(input: Record<string, unknown>): RecoveryInput {
  const {session, turnId, expectedRevision, requestId} = input;
  const keys = Object.keys(input);
  if (keys.some(key => !['session', 'turnId', 'expectedRevision', 'requestId'].includes(key)) || typeof session !== 'string' || !SESSION.test(session) ||
    typeof turnId !== 'string' || !ID.test(turnId) || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
    (requestId !== undefined && (typeof requestId !== 'string' || !ID.test(requestId)))) {
    throw refuse('invalid-request', 'the recovery is {session, turnId, expectedRevision, requestId?}: a session ID, a turn ID, the record\'s revision and an identifier');
  }
  return {session, turnId, expectedRevision, ...(typeof requestId === 'string' ? {requestId} : {})};
}

/** Reads a JSON object body of at most 16 KiB, sent as `application/json`. */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw refuse('invalid-request', 'the body is application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw refuse('too-large', `the body is over ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } catch {
    throw refuse('invalid-request', 'the body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw refuse('invalid-request', 'the body is a JSON object');
  return parsed as Record<string, unknown>;
}

/**
 * An owner's sync refusal as the gateway serves it: its code, with fixed text for that code, never the owner's detail,
 * which may say anything.
 */
function syncRefusal(code: ErrorCode): Refused {
  const detail = code === 'unavailable' ? 'the family\'s owner did not answer the sync'
    : code === 'capacity' ? 'the family\'s owner is busy; try again' : 'the family\'s owner refused the sync';
  return refuse(code, detail);
}

/** The family a `dataschema` names, `https://bunny.invalid/events/<family>/<major>.<minor>`, or undefined. */
function familyOf(dataschema: string): string | undefined {
  const rest = dataschema.startsWith(SCHEMA_BASE) ? dataschema.slice(SCHEMA_BASE.length) : '';
  const family = rest.slice(0, rest.lastIndexOf('/'));
  return FAMILY.test(family) ? family : undefined;
}

/** The state families `/api/v2` may read: the core's, the device families every device module answers, and those of the modules' own schemas. */
export function readableFamilies(schemas: Readonly<Record<string, object>>): ReadonlySet<string> {
  const families = new Set([...coreFamilies, ...deviceFamilies].filter(family => family.kind === 'state').map(family => family.family));
  for (const dataschema of Object.keys(schemas)) {
    const family = familyOf(dataschema);
    if (family !== undefined) families.add(family);
  }
  return families;
}
