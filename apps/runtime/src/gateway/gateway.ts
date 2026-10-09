import {historyFilter, type HistoryFilter, type HistoryRow} from '../core/history.js';
import type {AutomationControls} from '../core/automation-part.js';
import {AUTOMATION_PREFIX, automationRoute} from './automation-routes.js';
// The runtime's gateway (Hub #835): every route of its listener but health. It serves the SDK edge for remote parts,
// the `/api/v2` read routes, the core's operator action and the action routes of its dispatcher (#782), MCP, the
// modules' pages and content, the dashboard's page (#922) and browser sign-in,
// each with one error body from the 2.0 registry. Every caller is a client credential or a browser session (access.ts),
// each with the old Hub's scopes; no caller is limited to some devices (owner decision, 2026-10-07). A route of the old Hub answers `not-found` and is logged with the
// route it asked for (retired.ts), for the retirement story's check (#839).
import {randomUUID} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {coreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {MAX_DETAIL, SCHEMA_BASE, errorBody, isErrorCode, type ErrorBody, type ErrorCode, type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import type {McpHandler} from '@jimmie-potts/device-mcp';
import {MAX_RESPONSE_BYTES as WISPR_MAX_BYTES, type WisprModule} from '@jimmie-potts/wispr';
import {
  ASSETS_PATH, CALLS, CONTENT_PATH, MAX_ASSET_BYTES, MODULE_API_VERSION, REMOTE_PATH, RemoteEdge, levelOf, noSpans, startSpan, statusOf, traceFields,
  type Cancel, type Clock, type Diagnostic, type EdgeRoute, type InProcessBus, type ModulePage, type OnDiagnostic, type Participant,
  type Scheduler, type SpanRecorder, type SyncedCopy, type TraceContext,
} from '@jimmie-potts/sdk';
import {DIRECT_COMMANDS, OPERATOR_ACTIONS, type ActionAnswer, type CoreActions, type CoreOperatorActions} from '../core/tracker.js';
import type {EdgeCredential, Scope} from '../credentials.js';
import {REGISTRY_REASONS, diagnosticWriter} from '../diagnostics.js';
import {CORE_MODULE, ContributionFailed, ModuleUnavailable, sourceOf, type HostedModule, type ModuleHost} from '../host.js';
import type {Redactions, RuntimeLogger} from '../log.js';
import type {EdgeConfig} from '../state.js';
import {
  Access, BROWSER_SOURCE, REQUEST_HEADER, carriesSession, contextOf, edgePermissions, endedCookie, principalOf, sessionCookie, type Principal,
} from './access.js';
import {DASHBOARD_DIR, DASHBOARD_FILES, DASHBOARD_HEADERS, dashboardAllowed, runtimeBuild, dashboardFile} from './dashboard.js';
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
/** A device's routing ID: the last token of its keys. */
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A placeholder trace context for checking an action's command before it is sent; the command itself gets its own. */
const CHECK_TRACE = `00-${'1'.repeat(32)}-${'1'.repeat(16)}-01`;

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
/** Reviewed same-origin application code; passive pages and user content retain PAGE_HEADERS. */
const EDITOR_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
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
  /** The core's dispatcher, which the action routes call (#782); without it, every action is `unavailable`. */
  actions?: CoreActions;
  history?: {read: (filter: HistoryFilter) => HistoryRow[] | ErrorBody};
  /** Fresh rules/settings owned by the runtime core; no legacy store is opened. */
  automation?: AutomationControls;
  /** Closed file-reader exception: analytics never become SDK families or MCP tools. */
  wispr?: Pick<WisprModule, 'read' | 'browserExposed' | 'deliveryGuard'>;
  /** The authenticated control route alone uses this capability for tracked core operator actions. */
  operatorActions?: CoreOperatorActions;
  /** The built dashboard's folder (#922), `DASHBOARD_DIR` by default; tests give their own. */
  dashboard?: URL;
  /** Records the dashboard's five sign-in/read HTTP handoffs after their boundary checks (#922). */
  trace?: SpanRecorder;
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
  /** Only validated dashboard handoffs receive a context; a later refusal keeps that request's trace. */
  readonly #dashboardTraces = new WeakMap<IncomingMessage, TraceContext>();
  /** Rechecked synchronously after all route awaits, immediately before HTTP emission. */
  readonly #wisprDelivery = new WeakMap<IncomingMessage, () => void>();
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
        recover: (id, input) => this.#recoverFor(id, input), dispatch: (id, input) => this.#dispatchFor(id, input),
        scheduler: this.#options.scheduler, holdsSecret: text => this.#options.redactions.holds(text),
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
      if (Object.hasOwn(DASHBOARD_FILES, path)) answer = await this.#dashboard(request, url);
      else if (path.startsWith('/api/v2/browser/')) answer = await this.#browser(request, path.slice('/api/v2/browser/'.length));
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
      this.#wisprDelivery.get(request)?.();
      this.#write(response, answer);
    } catch (error) {
      const body = error instanceof Refused ? error.body : errorBody('internal', {detail: 'the gateway failed'});
      const {code} = body.error;
      const retired = code === 'not-found' && route === undefined ? retiredRoute(method, path) : undefined;
      this.#refused({
        'bunny.route': 'other', 'http.request.method': methodOf(method), 'bunny.code': code,
        ...(route !== undefined ? {'http.route': route} : retired !== undefined ? {'http.route': retired.path} : {}),
        ...(principal === undefined ? {} : {'bunny.participant': principal.source}),
      }, code === 'internal' ? 'error' : levelOf(code), this.#dashboardTraces.get(request));
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

  /** Bounded rule CRUD runs in the existing core flow; request errors never fail that owner. */
  async #automation(request: IncomingMessage, url: URL, principal: Principal): Promise<Answer> {
    const method = request.method ?? 'GET', controls = this.#options.automation;
    const authorize = (): void => {
      const current = this.#admit(request); // Recheck the original token too: same-ID rotation ends a pending request.
      if (!this.access.live(principal) || current.id !== principal.id) throw refuse('unauthenticated', 'the caller has ended');
      if (!current.scopes.has(method === 'GET' ? 'read' : 'control')) throw refuse('forbidden', 'the route requires its scope');
      if (method !== 'GET' && request.headers[REQUEST_HEADER] !== '1') throw refuse('forbidden', 'a change carries bunny-request: 1');
    };
    authorize();
    if (controls === undefined) throw refuse('unavailable', 'no core automation is available');
    const incoming = request.headers.traceparent;
    const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
    const parent = candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined;
    const span = startSpan(this.#options.trace ?? noSpans, method === 'GET' ? 'bunny.feed.read' : 'bunny.command.request', {
      parent, kind: 'server', attributes: {'http.route': templateOf(url.pathname) ?? '/api/v2/automation', 'http.request.method': methodOf(method)},
    });
    this.#dashboardTraces.set(request, span.context);
    try {
      const answer = await this.#options.host.invoke(CORE_MODULE, async () => {
        try {
          return await automationRoute(controls, {method, url, authorize, body: async maximum => {
            try {return await readBody(request, maximum);} catch (error) {
              if (error instanceof Refused) throw error;
              throw refuse('invalid-request', 'the request body could not be read');
            }
          }});
        } catch (error) {
          if (error instanceof Refused) return {status: statusOf(error.body.error.code), body: error.body};
          throw error;
        }
      });
      if (answer === undefined) throw refuse('not-found', 'no such automation route');
      if ('error' in answer.body) {
        const body = answer.body as ErrorBody;
        throw refuse(body.error.code, 'the automation request was refused');
      }
      if (method === 'GET') authorize();
      if (this.#options.redactions.holds(JSON.stringify(answer.body))) throw refuse('internal', 'automation holds a secret');
      return json(answer.status, answer.body);
    } catch (error) {
      if (error instanceof ModuleUnavailable) throw refuse('unavailable', 'the core is not running');
      if (!(error instanceof Refused)) span.end('error');
      throw error;
    } finally {span.end();}
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
    if (path.startsWith(AUTOMATION_PREFIX)) {
      needs(method === 'GET' ? 'read' : 'control');
      return this.#automation(request, url, principal);
    }
    const uploadModule = /^\/api\/v2\/modules\/([^/]+)\/upload$/.exec(path)?.[1];
    if (method === 'POST' && uploadModule !== undefined) {
      needs('control');
      return this.#upload(request, uploadModule, url.searchParams, principal);
    }
    if (method === 'GET' && path === '/api/v2/authority') {
      const scope = url.searchParams.get('scope');
      if (query.length !== 1 || scope === null || !['read', 'control', 'ingest', 'admin'].includes(scope)) throw refuse('invalid-request', 'name one scope: read, control, ingest or admin');
      needs(scope as Scope);
      return this.#dashboardRequest(request, path, () => json(200, {schema: 'authority/2.0', scope}));
    }
    if (method === 'POST' && path === '/api/v2/commands/approval-recover') {
      noQuery();
      needs('control');
      const input = await readBody(request);
      const answer = await this.#recover(principal, recoveryInput(input));
      return 'error' in answer ? json(statusOf(answer.error.code), answer) : json(200, {schema: 'command-reply/2.0', ...answer});
    }
    const commandFamily = /^\/api\/v2\/commands\/([^/]+)$/.exec(path)?.[1];
    if (method === 'POST' && commandFamily !== undefined) {
      noQuery();
      needs('control');
      const input = actionInput(await readBody(request));
      const answer = await this.#dispatch(principal, commandFamily, input, request);
      return 'error' in answer ? json(statusOf(answer.error.code), answer) : json(200, {schema: 'command-reply/2.0', ...answer});
    }
    if (method !== 'GET') throw refuse('not-found', 'no such route');
    needs('read');
    if (path === '/api/v2/history') {
      if (query.some(key => url.searchParams.getAll(key).length !== 1)) throw refuse('invalid-request', 'history filters appear once');
      const values = Object.fromEntries(url.searchParams);
      const filter = historyFilter(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === 'fromAtMs' || key === 'toAtMs' ? (/^[0-9]+$/.test(value) ? Number(value) : NaN) : value])));
      if (filter === undefined) throw refuse('invalid-request', 'invalid history filters');
      const rows = this.#options.history?.read(filter) ?? errorBody('unavailable', {detail: 'no core history is available'});
      if (this.#options.redactions.holds(JSON.stringify(rows))) throw refuse('internal', 'history holds a secret, which the gateway never serves');
      return this.#dashboardRequest(request, path, () => Array.isArray(rows) ? json(200, {schema: 'history/2.0', rows}) : json(statusOf(rows.error.code), rows));
    }
    if (path === '/api/v2/build') {
      noQuery();
      return json(200, runtimeBuild());
    }
    if (path === '/api/v2/modules') {
      noQuery();
      return json(200, {schema: 'module-list/2.0', moduleApiVersion: MODULE_API_VERSION, modules: this.#options.host.modules().map(module => this.#describe(module, principal))});
    }
    if (path === '/api/v2/links') {
      noQuery();
      const {editorLinks, placeLinks} = this.#options.edge;
      return this.#dashboardRequest(request, path, () => json(200, {schema: 'links/2.0', editors: editorLinks, places: placeLinks}));
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
    const asset = /^\/modules\/([^/]+)\/assets\/([^/]+)$/.exec(path);
    if (asset !== null) {
      noQuery();
      return this.#asset(asset[1] ?? '', asset[2] ?? '');
    }
    const content = /^\/modules\/([^/]+)\/content\/([^/]+)$/.exec(path);
    if (content !== null) {
      if (content[1] === 'wispr') return this.#wisprRead(request, principal, content[2] ?? '', url.searchParams);
      return this.#content(content[1] ?? '', content[2] ?? '', url.searchParams);
    }
    const page = /^\/modules\/([^/]+)\/([^/]+)$/.exec(path);
    if (page !== null) {
      noQuery();
      if (page[1] === 'wispr') this.#wisprExposure(principal);
      return this.#page(page[1] ?? '', page[2] ?? '');
    }
    throw refuse('not-found', 'no such route');
  }

  /**
   * A module as `/api/v2/modules` lists it: its state, the families it serves through sync now (`serves`, as health lists
   * them, for a browser, which cannot read health: Hub #922), and what it contributes, which is nothing until it is
   * admitted.
   */
  #describe(module: HostedModule, principal: Principal): object {
    const {name, manifest, state, admitted} = module;
    const serves = this.#options.bus.served(sourceOf(name));
    return {
      name, apiVersion: manifest.apiVersion, state, ...(serves.length === 0 ? {} : {serves}),
      pages: admitted && (name !== 'wispr' || principal.kind !== 'browser' || this.#options.wispr?.browserExposed() === true)
        ? (manifest.pages ?? []).map((page: ModulePage) => ({id: page.id, title: page.title, path: `/modules/${name}/${page.id}`, presentation: page.presentation ?? 'passive'})) : [],
      tools: admitted ? [...(manifest.tools ?? []).map(tool => `${name}_${tool.name}`), ...(name === 'core' ? ['core_recover_approval', 'core_send_command'] : [])] : [],
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
    if (page === undefined || id === CONTENT_PATH || id === ASSETS_PATH) throw refuse('not-found', 'no such page');
    if (page.presentation === 'react') {
      // Enforce the same running-module boundary without calling feature code.
      await this.#call(name, () => undefined);
      return {status: 303, body: '', headers: {...PAGE_HEADERS, location: `/#/module/${name}/${id}`}};
    }
    const html = await this.#call(name, () => page.render());
    if (typeof html !== 'string') throw refuse('internal', 'the module\'s page is not HTML text');
    if (this.#options.redactions.holds(html)) throw refuse('internal', 'the module\'s page holds a secret, which the gateway never serves');
    const trusted = page.presentation === 'trusted-editor';
    const assets = trusted
      ? page.styles.map(asset => `<link rel="stylesheet" href="/modules/${name}/assets/${asset}">`).join('')
        + page.scripts.map(asset => `<script type="module" src="/modules/${name}/assets/${asset}"></script>`).join('')
      : '';
    const document = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<title>${escapeHtml(page.title)}</title>${assets}</head><body>\n${html}\n</body></html>\n`;
    if (trusted && Buffer.byteLength(document) > MAX_ASSET_BYTES) throw refuse('internal', 'the module\'s editor page exceeds 16 MiB');
    return {status: 200, body: document, headers: {'content-type': 'text/html; charset=utf-8', ...PAGE_HEADERS,
      'x-frame-options': 'SAMEORIGIN', 'content-security-policy': trusted ? EDITOR_POLICY : PAGE_HEADERS['content-security-policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    }};
  }

  #wisprExposure(principal: Principal): void {
    if (principal.kind === 'browser' && this.#options.wispr?.browserExposed() !== true)
      throw refuse('forbidden', 'Wispr browser exposure is off');
  }

  /** The fixed Wispr file handoff, with caller and privacy checks through the final HTTP handoff. */
  async #wisprRead(request: IncomingMessage, principal: Principal, ref: string, query: URLSearchParams): Promise<Answer> {
    this.#module('wispr');
    const reader = this.#options.wispr;
    if (reader === undefined) throw refuse('unavailable', 'Wispr is unavailable');
    this.#wisprExposure(principal);
    if (!['status', 'summary', 'series', 'heatmap', 'apps', 'language', 'export'].includes(ref))
      throw refuse('not-found', 'no such Wispr read');
    const keys = [...query.keys()];
    if (keys.length > 16 || new Set(keys).size !== keys.length ||
        [...query].some(([key, value]) => key.length === 0 || key.length > 64 || value.length > 512))
      throw refuse('invalid-request', 'invalid Wispr query fields');
    const incoming = request.headers.traceparent;
    const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
    const span = startSpan(this.#options.trace ?? noSpans, 'bunny.feed.read', {
      parent: candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined, kind: 'server',
      attributes: {'http.route': '/modules/{module}/content/{ref}', 'http.request.method': 'GET'},
    });
    this.#dashboardTraces.set(request, span.context);
    const current = reader.deliveryGuard();
    const deliver = (): void => {
      const admitted = this.#admit(request);
      if (admitted.id !== principal.id || admitted.kind !== principal.kind || admitted.source !== principal.source || !this.access.live(principal))
        throw refuse('unauthenticated', 'the original Wispr caller is no longer admitted');
      if (!admitted.scopes.has('read')) throw refuse('forbidden', 'Wispr requires read scope');
      this.#wisprExposure(admitted);
      if (request.aborted) throw refuse('cancelled', 'the Wispr read was cancelled');
      if (this.#closed || !current()) throw refuse('unavailable', 'the Wispr read is no longer current');
    };
    this.#wisprDelivery.set(request, deliver);
    const controller = new AbortController(), aborted = (): void => {controller.abort();};
    request.once('aborted', aborted);
    if (request.aborted) controller.abort();
    try {
      const found = await this.#call('wispr', () => reader.read(ref, query.toString(), controller.signal));
      deliver();
      if ('error' in found) {
        if (!isErrorCode(found.error.code) || this.#options.redactions.holds(JSON.stringify(found)))
          throw refuse('internal', 'Wispr returned an invalid refusal');
        throw refuse(found.error.code, 'the Wispr read was refused');
      }
      if (!['application/json', 'text/csv; charset=utf-8'].includes(found.type) || !(found.bytes instanceof Uint8Array) ||
          found.bytes.byteLength > WISPR_MAX_BYTES || this.#options.redactions.holdsBytes(found.bytes))
        throw refuse('internal', 'Wispr returned invalid content');
      return {status: 200, body: found.bytes, headers: {...PAGE_HEADERS, 'content-type': found.type,
        ...(ref === 'export' ? {'content-disposition': `attachment; filename="wispr-analytics.${found.type === 'text/csv; charset=utf-8' ? 'csv' : 'json'}"`} : {})}};
    } catch (error) {
      span.end(error instanceof Refused ? 'unset' : 'error'); throw error;
    } finally {request.off('aborted', aborted); controller.abort(); span.end();}
  }

  /** A reviewed build asset resolved only from its finite declaration, never a caller's filesystem path. */
  async #asset(name: string, id: string): Promise<Answer> {
    const module = this.#module(name);
    const asset = module.manifest.assets?.find(candidate => candidate.id === id);
    if (asset === undefined) throw refuse('not-found', 'no such asset');
    const bytes = await this.#call(name, () => asset.read());
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ASSET_BYTES) {
      throw refuse('internal', 'the module\'s asset is not bytes of at most 16 MiB');
    }
    if (this.#options.redactions.holdsBytes(bytes)) throw refuse('internal', 'the module\'s asset holds a secret, which the gateway never serves');
    return {status: 200, body: bytes, headers: {'content-type': asset.type, ...PAGE_HEADERS}};
  }

  /** Prepare binary input, then use the unchanged tracked dispatcher and its exact reply. */
  async #upload(request: IncomingMessage, name: string, params: URLSearchParams, principal: Principal): Promise<Answer> {
    const {upload} = this.#module(name).manifest;
    if (upload === undefined) throw refuse('not-found', 'the module accepts no upload');
    const keys = [...params.keys()];
    const label = params.get('name');
    const family = params.get('family');
    const requestId = params.get('requestId');
    if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some(key => !['name', 'family', 'requestId', 'target'].includes(key))
      || label === null || label.trim().length === 0 || label.length > 120 || family !== upload.family || requestId === null) {
      throw refuse('invalid-request', 'an upload names its declared family, target, requestId and display name');
    }
    const input = actionInput({target: params.get('target'), requestId, data: {}});
    const bytes = await readUpload(request, upload.maxBytes);
    this.#admit(request);
    const incoming = request.headers.traceparent;
    const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
    const parent = candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined;
    const span = startSpan(this.#options.trace ?? noSpans, 'bunny.command.request', {parent, kind: 'server',
      attributes: {'http.route': '/api/v2/modules/{module}/upload', 'http.request.method': 'POST'}});
    this.#dashboardTraces.set(request, span.context);
    try {
      const controller = new AbortController();
      let prepared;
      try {
        prepared = await this.#call(name, () => upload.stage({target: input.target, requestId, name: label, bytes, signal: controller.signal}));
      } finally {controller.abort();}
      if (typeof prepared !== 'object' || prepared === null) throw refuse('internal', 'the module returned invalid upload preparation');
      if ('error' in prepared) {
        const code = prepared.error?.code;
        throw refuse(isErrorCode(code) ? code : 'internal', 'the module refused upload preparation');
      }
      if (typeof prepared.finish !== 'function') throw refuse('internal', 'the upload has no preparation cleanup');
      let answer: ActionAnswer;
      let dispatching = false;
      try {
        this.#admit(request);
        const action = actionInput({target: input.target, requestId, data: prepared.data});
        const encoded = JSON.stringify(action);
        if (Buffer.byteLength(encoded) > MAX_BODY_BYTES) throw refuse('too-large', 'the prepared command exceeds the JSON command limit');
        if (this.#options.redactions.holds(encoded)) throw refuse('internal', 'the prepared command holds a secret');
        dispatching = true;
        answer = await this.#dispatch(principal, family, action, request);
      } catch (error) {
        answer = error instanceof Refused ? error.body : errorBody(dispatching ? 'uncertain-result' : 'internal', {
          requestId, detail: dispatching ? 'the upload command has no reliable reply; it was not sent again' : 'upload admission failed',
        });
        const code = 'error' in answer ? answer.error.code : 'internal';
        this.#refused({'bunny.route': 'other', 'http.route': '/api/v2/modules/{module}/upload', 'http.request.method': 'POST',
          'bunny.participant': principal.source, 'bunny.code': code}, levelOf(code), span.context);
      }
      try {await this.#call(name, () => prepared.finish(answer));}
      catch {
        // An upload cleanup failure cannot turn a known accepted command into a claim that nothing happened.
        this.#refused({'bunny.route': 'other', 'http.route': '/api/v2/modules/{module}/upload', 'http.request.method': 'POST', 'bunny.code': 'internal'}, 'error', span.context);
      }
      return 'error' in answer ? json(statusOf(answer.error.code), answer) : json(200, {schema: 'command-reply/2.0', ...answer});
    } finally {span.end();}
  }

  /** A module's content by reference, such as a preview frame its page shows. */
  async #content(name: string, ref: string, params: URLSearchParams): Promise<Answer> {
    const module = this.#module(name);
    const {content} = module.manifest;
    if (!ID.test(ref)) throw refuse('invalid-request', 'a content reference is 1 to 128 letters, digits, underscores, dots or hyphens');
    if (content === undefined) throw refuse('not-found', 'the module serves no content');
    const modern = Number(module.manifest.apiVersion.split('.')[1]) >= 3;
    const keys = [...params.keys()];
    if ((!modern && keys.length > 0) || keys.length > 16 || new Set(keys).size !== keys.length
      || [...params].some(([key, value]) => key.length === 0 || key.length > 64 || value.length > 512)) {
      throw refuse('invalid-request', 'content query fields must be distinct and within the module API limits');
    }
    const controller = new AbortController();
    let found;
    try {found = await this.#call(name, () => content(ref, modern ? {query: Object.freeze(Object.fromEntries(params)), signal: controller.signal} : undefined));}
    finally {controller.abort();}
    if (found === undefined) throw refuse('not-found', 'no such content');
    if ('error' in found) {
      const error: unknown = found.error;
      if (!modern || typeof error !== 'object' || error === null || !('code' in error) || !isErrorCode(error.code)
        || this.#options.redactions.holds(JSON.stringify(found))) throw refuse('internal', 'the module returned invalid content');
      throw refuse(error.code, 'the module refused the content read');
    }
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

  /** The dispatcher's action for a client credential, by its ID, as MCP calls it. */
  async #dispatchFor(id: string, input: ActionInput & {family: string}): Promise<ActionAnswer> {
    const credential = this.access.current(id);
    if (credential === undefined) return errorBody('unauthenticated', {detail: 'the credential was revoked'});
    return this.#dispatch(principalOf(credential), input.family, input);
  }

  /**
   * Sends one command through the core's dispatcher (#782) for the caller: a device's command, a moment or a mode
   * change, by its family and target, as `bunny.cmd.<family>.<target>`. The command is checked first against its
   * family's schema, as the SDK edge checks a remote part's, so invalid input is refused with a registry code and
   * nothing is tracked. The answer is the dispatcher's: `accepted`, the owner's or the bus's refusal, or
   * `uncertain-result`, which is never retried.
   */
  async #dispatch(principal: Principal, family: string, input: ActionInput, request?: IncomingMessage): Promise<ActionAnswer> {
    if (!this.access.live(principal)) return errorBody('unauthenticated', {detail: 'the caller\'s credential or session has ended'});
    if (!principal.scopes.has('control')) return errorBody('forbidden', {detail: 'control authority is required'});
    const command = this.#command(principal.source, family, input);
    if ('error' in command) return command;
    if (family === 'inbox-handle') {
      const requestId = input.requestId ?? randomUUID();
      const incoming = request?.headers.traceparent;
      const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
      const parent = candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined;
      // Only this authenticated, validated HTTP handling path owns an HTTP-to-SDK handoff.
      const span = request === undefined ? undefined : startSpan(this.#options.trace ?? noSpans, 'bunny.command.request', {
        parent, kind: 'server', attributes: {'http.route': '/api/v2/commands/{family}', 'http.request.method': 'POST'},
      });
      if (request !== undefined && span !== undefined) this.#dashboardTraces.set(request, span.context);
      try {
        const result = await this.#participant(principal.source).request(command.key, command.draft, {
          requestId, timeoutMs: COMMAND_TIMEOUT_MS, ...(span === undefined ? {} : {parent: span.context}),
        });
        return result.status === 'accepted' ? {status: 'accepted', requestId} : result.error;
      } catch (error) {
        span?.end('error');
        throw error;
      } finally { span?.end(); }
    }
    const actions = OPERATOR_ACTIONS.includes(family) ? this.#options.operatorActions : this.#options.actions;
    if (actions === undefined) return errorBody('unavailable', {detail: 'this runtime hosts no core to send actions'});
    // Mode requests and the admitted upload boundary continue their trace in the tracker's existing request span.
    const incoming = family === 'mode-set' ? request?.headers.traceparent : undefined;
    const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
    const parent = (request === undefined ? undefined : this.#dashboardTraces.get(request))
      ?? (candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined);
    try {
      return await this.#options.host.invoke(CORE_MODULE, () => !this.access.live(principal)
        ? Promise.resolve(errorBody('unauthenticated', {detail: 'the caller\'s credential or session has ended'})) : actions.dispatch({
        ...command, requestedBy: principal.source, ...(input.requestId === undefined ? {} : {requestId: input.requestId}),
        ...(parent === undefined ? {} : {parent}),
      }));
    } catch (error) {
      if (error instanceof ModuleUnavailable) return errorBody('unavailable', {detail: 'the core is not running'});
      return errorBody('internal', {detail: 'the core failed'});
    }
  }

  /**
   * The command an action names: its key, and a draft whose type, `org.bunny.<entity>.<verb>.requested`, and schema,
   * `<family>/2.0`, follow from the family (ADR 0012's command naming), checked against the family's schema. A family
   * whose schema the runtime does not know is `not-found`. A known family that no running module answers passes here: the
   * dispatcher tracks it, and the bus refuses it with `unavailable`.
   */
  #command(source: string, family: string, {target, data, requestId}: ActionInput): {key: string; draft: {type: string; subject: string; dataschema: string; data: object}} | ErrorBody {
    const verb = family.lastIndexOf('-');
    if (!FAMILY.test(family) || family.length > 64 || verb < 0) return errorBody('invalid-request', {detail: 'a command family is lowercase words joined by hyphens, its verb last'});
    if (DIRECT_COMMANDS.includes(family) && family !== 'inbox-handle') return errorBody('invalid-request', {detail: 'this command is the core\'s own and has its own route; it is not a tracked action'});
    const type = `org.bunny.${family.slice(0, verb)}.${family.slice(verb + 1)}.requested`;
    const dataschema = `${SCHEMA_BASE}${family}/2.0`;
    const now = this.#options.clock.now();
    const checked = this.#options.validator.validate({
      specversion: '1.0', bunnyprofile: '2.0', id: 'action-check', source, type, subject: target, time: new Date(now).toISOString(), kind: 'command',
      datacontenttype: 'application/json', dataschema, traceparent: CHECK_TRACE, expiresat: new Date(now + COMMAND_TIMEOUT_MS).toISOString(),
      data: {...data, requestId: requestId ?? 'action-check'},
    }, {nowMs: now});
    if (!checked.ok) {
      return checked.error.code === 'unknown-schema'
        ? errorBody('not-found', {detail: 'this runtime knows no schema for this command family'})
        : errorBody('invalid-request', {detail: 'the command does not fit its family\'s schema'});
    }
    return {key: `bunny.cmd.${family}.${target}`, draft: {type, subject: target, dataschema, data}};
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

  /**
   * The dashboard's page and assets (#922). They hold no secret and load without a session, from this origin, a bookmark
   * or the launcher, and the page also from a link on another local app's page (`dashboardAllowed`); the page signs in
   * through the routes below.
   */
  async #dashboard(request: IncomingMessage, url: URL): Promise<Answer> {
    if (request.method !== 'GET') throw refuse('not-found', 'no such route');
    if (url.search !== '') throw refuse('invalid-request', 'this route takes no query');
    if (!dashboardAllowed(request, this.#originOf(request), url.pathname)) {
      throw refuse('forbidden', 'the dashboard opens from this origin\'s own pages, a bookmark, the launcher or a link from another local app');
    }
    const found = await dashboardFile(this.#options.dashboard ?? DASHBOARD_DIR, url.pathname);
    if (found === undefined) throw refuse('not-found', 'the dashboard is not built');
    return {status: 200, body: found.bytes, headers: {'content-type': found.type, ...DASHBOARD_HEADERS}};
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
    /**
     * A new session replaces the one the browser's cookie names, which ends with its streams (#922): every tab of the
     * origin shares one cookie, so a session no cookie names any more would outlive every logout until its expiry.
     */
    const replace = (): Answer => {
      const previous = this.access.endSession(request);
      if (previous !== undefined) this.edge.disconnectPrincipal(previous);
      return json(200, {schema: 'browser-session/2.0', source: BROWSER_SOURCE}, {'set-cookie': sessionCookie(this.access.openSession())});
    };
    if (action === 'launch') {
      const {code} = input as {code?: unknown};
      if (Object.keys(input).length !== 1 || typeof code !== 'string' || !this.access.takeLaunch(code)) throw refuse('unauthenticated', 'the launch code is not good');
      return this.#dashboardRequest(request, '/api/v2/browser/launch', () => { closed(); return replace(); });
    }
    if (Object.keys(input).length > 0) throw refuse('invalid-request', 'the body is an empty object');
    if (action === 'session') {
      return this.#dashboardRequest(request, '/api/v2/browser/session', () => { closed(); return replace(); });
    }
    // Logout remains harmless without a live cookie, but that caller cannot supply an authenticated parent.
    const admission = this.access.admit(request, origin);
    return this.#dashboardRequest(request, '/api/v2/browser/logout', () => {
      const ended = this.access.endSession(request);
      if (ended !== undefined) this.edge.disconnectPrincipal(ended);
      return json(200, {schema: 'browser-session/2.0', ended: ended !== undefined}, {'set-cookie': endedCookie});
    }, 'principal' in admission && admission.principal.kind === 'browser');
  }

  /** Runs only after the route's authentication, ownership and input checks; no incoming context grants authority. */
  #dashboardRequest(request: IncomingMessage, route: string, handle: () => Answer, authenticated = true): Answer {
    const incoming = request.headers.traceparent;
    const candidate = typeof incoming === 'string' ? {traceparent: incoming} : undefined;
    const parent = authenticated && candidate !== undefined && traceFields(candidate) !== undefined ? candidate : undefined;
    const span = startSpan(this.#options.trace ?? noSpans, request.method === 'GET' ? 'bunny.feed.read' : 'bunny.command.request', {
      parent, kind: 'server', attributes: {'http.route': route, 'http.request.method': methodOf(request.method ?? 'GET')},
    });
    this.#dashboardTraces.set(request, span.context);
    try {
      return handle();
    } catch (error) {
      span.end(error instanceof Refused ? 'unset' : 'error');
      throw error;
    } finally {
      span.end();
    }
  }

  #write(response: ServerResponse, answer: Answer): void {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(answer.status, answer.headers).end(answer.body);
  }

  /**
   * Records a refusal by the repetition rule (ADR 0012, "Repetition"): the first of a run at once, then its repeats as
   * one summary a minute with their count, until a quiet minute. A record never holds what the caller sent.
   */
  #refused(fields: Record<string, string | number>, level: 'debug' | 'info' | 'warn' | 'error', trace?: TraceContext): void {
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
    this.#log[severity]('runtime.edge.refused', record, trace);
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
  if (Object.hasOwn(DASHBOARD_FILES, path)) return path;
  if (path === '/api/v2/history' || path === '/api/v2/build' || path === '/api/v2/authority' || path === '/api/v2/modules' || path === '/api/v2/links' || path === '/api/v2/snapshot') return path;
  if (path === '/api/v2/commands/approval-recover') return path;
  if (/^\/api\/v2\/automation\/(rules|interrupt-set|settings|log)$/.test(path)) return path;
  if (/^\/api\/v2\/automation\/rules\/[A-Za-z0-9_.-]{1,128}$/.test(path)) return '/api/v2/automation/rules/{id}';
  if (/^\/api\/v2\/automation\/rules\/[A-Za-z0-9_.-]{1,128}\/(enable|disable)$/.test(path)) return '/api/v2/automation/rules/{id}/{action}';
  if (/^\/api\/v2\/commands\/[^/]+$/.test(path)) return '/api/v2/commands/{family}';
  if (/^\/api\/v2\/browser\/(launch|session|logout)$/.test(path)) return path;
  if (/^\/api\/v2\/families\/[^/]+$/.test(path)) return '/api/v2/families/{family}';
  if (/^\/api\/v2\/modules\/[^/]+\/settings$/.test(path)) return '/api/v2/modules/{module}/settings';
  if (/^\/api\/v2\/modules\/[^/]+\/upload$/.test(path)) return '/api/v2/modules/{module}/upload';
  if (/^\/modules\/[^/]+\/content\/[^/]+$/.test(path)) return '/modules/{module}/content/{ref}';
  if (/^\/modules\/[^/]+\/assets\/[^/]+$/.test(path)) return '/modules/{module}/assets/{asset}';
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

/** An action's input (#782): its target's routing ID, the command's payload without its request ID, and an optional request ID. */
type ActionInput = {target: string; data: Record<string, unknown>; requestId?: string};

function actionInput(input: Record<string, unknown>): ActionInput {
  const {target, data, requestId} = input;
  if (Object.keys(input).some(key => !['target', 'data', 'requestId'].includes(key)) || typeof target !== 'string' || target.length > 128 ||
    !ROUTING_ID.test(target) || typeof data !== 'object' || data === null || Array.isArray(data) || Object.hasOwn(data, 'requestId') ||
    (requestId !== undefined && (typeof requestId !== 'string' || !ID.test(requestId)))) {
    throw refuse('invalid-request', 'an action is {target, data, requestId?}: the device\'s routing ID, the command\'s payload without a request ID, and an identifier');
  }
  return {target, data: data as Record<string, unknown>, ...(typeof requestId === 'string' ? {requestId} : {})};
}

/** Reads bounded binary media without raising the JSON command limit or accepting multipart paths. */
async function readUpload(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/octet-stream') throw refuse('invalid-request', 'the upload body is application/octet-stream');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({destroyOnReturn: false}) as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {request.resume(); throw refuse('too-large', 'the upload exceeds the declared byte limit');}
    chunks.push(chunk);
  }
  if (size === 0) throw refuse('invalid-request', 'the upload is empty');
  return Buffer.concat(chunks);
}

/** Reads a JSON object body of at most 16 KiB, sent as `application/json`. */
async function readBody(request: IncomingMessage, maximumBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw refuse('invalid-request', 'the body is application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maximumBytes) throw refuse('too-large', `the body is over ${maximumBytes} bytes`);
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
