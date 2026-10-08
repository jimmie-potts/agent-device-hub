import {Gadget, gadgetSchemas, setGadget} from '../../dist/tests/fixtures/gadget.js';
// The runtime dashboard's browser suites' world (Hub #922): the built runtime in this process with the core and its
// gateway on a free loopback port, a private state directory under the system temporary directory, which lies outside
// every checkout, and a synthetic hook part that publishes lifecycle observations through the SDK edge, as an agent's
// hook would. Nothing reaches an installed service, a device or personal state. Run `npm run build` first.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {LifecycleEvent, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createLifxModule, LIFX_SIMULATED_SECTION, PACKET, SimulatedLifx, lifxSchemas} from '@jimmie-potts/lifx';
import {SIGN_SECTION, SYNTHETIC_TOKEN, SimulatedSigns, createSignModule, signSchemas} from '../../dist/tests/fixtures/sign.js';
import {connectRemote, type RemoteParticipant} from '@jimmie-potts/sdk';
import type {Page} from 'playwright';
import {CONFIG_SCHEMA, CREDENTIALS_SCHEMA, createCoreModule, startRuntime, tokenDigest, type LogRecord, type Runtime} from '../../dist/src/index.js';
import {observation, type ObservationOptions} from '../../dist/tests/fixtures/agents.js';

/** The synthetic marker of the hook's token: no record, answer or page may carry it (Hub #835). */
export const TOKEN_MARKER = 'tok_SYNTHETIC835';
const HOOK_SOURCE = 'bunny/parts/hook';
/** The ports of the installed services, which a run must never touch. */
export const INSTALLED_PORTS = [8765, 8787, 8788, 8791, 41231];

export type WorldOptions = {
  /** Adds only simulated bulbs and the configured sign for the controls journey. */
  devices?: boolean;
  inbox?: boolean;
  /** Lets a trusted loopback page sign a browser in without a code (Hub #276). On by default. */
  trusted?: boolean;
  /** Serves the launcher's socket in the state directory. Off by default. */
  launcher?: boolean;
  /** The edge's place links (Hub #495). */
  placeLinks?: Record<string, string>;
};

export type World = {
  readonly url: string;
  readonly stateDir: string;
  /** Every record the runtime wrote, across restarts. */
  readonly logs: LogRecord[];
  runtime(): Runtime;
  /** Publishes one hook observation of `event` now, and resolves once the edge took it. */
  observe(event: LifecycleEvent, options?: ObservationOptions): Promise<void>;
  /** How many browser sessions the runtime holds. */
  browserSessions(): number;
  /** A synthetic Nanoleaf consumer acknowledges its notice through the real core command. */
  acknowledge(session: string): Promise<void>;
  /** Ends the dashboard's streams, as a lost connection would; its browser session stays. */
  dropDashboardStreams(): void;
  /** Stops the runtime cleanly and starts it again on the same state directory and port; every browser session ends. */
  restart(): Promise<void>;
  holdDeviceWrites(hold: boolean): void;
  loseDeviceReply(): void;
  restoreDeviceReply(): void;
  failCommand(): Promise<void>;
  inboxViaMcp(): Promise<unknown[]>;
  close(): Promise<void>;
};

async function writePrivate(file: string, text: string): Promise<void> {
  await writeFile(file, text, {mode: 0o600});
  await chmod(file, 0o600);
}

/** The runtime, the core, its gateway and the hook, in a private directory. */
export async function startWorld(options: WorldOptions = {}): Promise<World> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-dash-')));
  const stateDir = join(root, 's');
  const configDir = join(root, 'c');
  await mkdir(configDir, {mode: 0o700});
  await chmod(root, 0o700);
  const token = `${TOKEN_MARKER}_${randomBytes(24).toString('base64url')}`;
  const consumerToken = `${TOKEN_MARKER}_${randomBytes(24).toString('base64url')}`;
  const credentials = join(configDir, 'edge-credentials.json');
  await writePrivate(credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [{id: 'hook', source: HOOK_SOURCE, digest: tokenDigest(token), scopes: ['ingest']},
    {id: 'nanoleaf', source: 'bunny/parts/nanoleaf', digest: tokenDigest(consumerToken), scopes: ['read', 'control']},
  ]}));
  const bulbs = new SimulatedLifx();
  const gadget = new Gadget();
  let releaseWrite: (() => void) | undefined;
  let heldWrite: Promise<void> | undefined;
  let loseWriteReplies = false;
  const network = {connect: (address: string) => ({
    exchange: async (packet: number, payload: Uint8Array, expected: number, signal: AbortSignal): Promise<Buffer> => {
      if (packet !== PACKET.lightGet && heldWrite !== undefined) await heldWrite;
      if (packet !== PACKET.lightGet && loseWriteReplies) bulbs.loseNextAcknowledgment(address);
      return bulbs.exchange(address, packet, payload, expected, signal);
    }, close: () => {},
  })};
  const signToken = join(configDir, 'sign-token');
  if (options.devices === true) await writePrivate(signToken, SYNTHETIC_TOKEN);
  const moduleConfig = options.devices === true ? {lifx: LIFX_SIMULATED_SECTION, sign: {...SIGN_SECTION, secrets: {token: signToken}}} : {};
  const config = join(configDir, 'runtime-config.json');
  await writePrivate(config, JSON.stringify({schema: CONFIG_SCHEMA, modules: moduleConfig, edge: {
    credentials, mcp: options.inbox === true, launcher: options.launcher === true, ...(options.trusted === false ? {} : {browserAccess: 'trusted-loopback'}),
    ...(options.placeLinks === undefined ? {} : {placeLinks: options.placeLinks}),
  }}));
  const logs: LogRecord[] = [];
  let core = createCoreModule();
  const start = (port: number): Promise<Runtime> => startRuntime({
    modules: [core = createCoreModule(), ...(options.inbox === true ? [gadget.module()] : []), ...(options.devices === true ? [createLifxModule({transport: network}), createSignModule({transport: new SimulatedSigns({online: true})})] : [])],
    port, stateDir, configFile: config, edge: {schemas: {...options.inbox === true ? gadgetSchemas : {}, ...options.devices === true ? {...lifxSchemas, ...signSchemas} : {}}}, log: record => { logs.push(record); }, environment: 'test',
  });
  let runtime = await start(0);
  const port = Number(new URL(runtime.url).port);
  assert.equal(INSTALLED_PORTS.includes(port), false, 'never an installed service\'s port');
  let hook: RemoteParticipant | undefined;
  const connected = async (): Promise<RemoteParticipant> => hook ??= await connectRemote({url: runtime.url, source: HOOK_SOURCE, token, reconnectDelayMs: 50});
  return {
    url: runtime.url, stateDir, logs, runtime: () => runtime,
    observe: async (event, observed = {}) => {
      const {key, draft} = observation(event, Date.now(), observed);
      await (await connected()).publish(key, draft);
    },
    acknowledge: async session => {
      const consumer = await connectRemote({url: runtime.url, source: 'bunny/parts/nanoleaf', token: consumerToken});
      try {
        const synced = await consumer.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
        assert.equal(synced.status, 'synced');
        if (synced.status !== 'synced') return;
        const record = synced.copy.states().map(message => message.data).find(item => item.id === session);
        const notice = record?.notices.find(item => item.acknowledgedBy.length === 0);
        assert.ok(notice, 'an unread notice for the synthetic device');
        const result = await consumer.request(`bunny.cmd.notice-acknowledge.${session}`, {
          type: 'org.bunny.notice.acknowledge.requested', subject: session,
          dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0', data: {consumerId: 'nanoleaf', noticeId: notice.id},
        }, {timeoutMs: 5000});
        assert.equal(result.status, 'accepted');
        await synced.copy.close();
      } finally {
        await consumer.close();
      }
    },
    holdDeviceWrites: hold => {
      if (hold) heldWrite = new Promise(resolve => { releaseWrite = resolve; });
      else { releaseWrite?.(); releaseWrite = undefined; heldWrite = undefined; }
    },
    loseDeviceReply: () => { loseWriteReplies = true; },
    restoreDeviceReply: () => { loseWriteReplies = false; },
    failCommand: async () => {
      gadget.script({outcome: {result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true}}});
      await core.actions.dispatch({...setGadget(42), requestedBy: 'bunny/parts/operator'});
    },
    inboxViaMcp: async () => {
      const headers: Record<string, string> = {authorization: `Bearer ${consumerToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'};
      const call = async (body: object) => fetch(`${runtime.url}/mcp`, {method: 'POST', headers, body: JSON.stringify(body)});
      const init = await call({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'inbox-browser-test', version: '1.0.0'}}});
      headers['mcp-session-id'] = init.headers.get('mcp-session-id') ?? ''; headers['mcp-protocol-version'] = '2025-11-25';
      await call({jsonrpc: '2.0', method: 'notifications/initialized'});
      const answer = await (await call({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'core_inbox', arguments: {}}})).json() as {result: {structuredContent: {data: {result: {items: unknown[]}}}}};
      await fetch(`${runtime.url}/mcp`, {method: 'DELETE', headers});
      return answer.result.structuredContent.data.result.items;
    },
    browserSessions: () => runtime.gateway()?.access.counts().sessions ?? 0,
    dropDashboardStreams: () => { runtime.gateway()?.edge.disconnect('bunny/parts/dashboard'); },
    restart: async () => {
      await hook?.close();
      hook = undefined;
      await runtime.stop();
      runtime = await start(port);
    },
    close: async () => {
      releaseWrite?.();
      await hook?.close();
      await runtime.stop();
      await rm(root, {recursive: true, force: true});
      assert.equal(JSON.stringify(logs).includes(TOKEN_MARKER), false, 'no record holds the hook\'s token');
    },
  };
}

/** The page's own calls that could change something, SDK requests and the action and command routes, kept in `sent`. */
export function changes(page: Page, sent: string[] = []): string[] {
  page.on('request', request => {
    const {pathname} = new URL(request.url());
    if (request.method() === 'POST' && (pathname === '/api/sdk/v1/request' || pathname.startsWith('/api/v2/commands/'))) sent.push(pathname);
  });
  return sent;
}

/** Waits for the dashboard's main region to show `feed`. */
export async function feed(page: Page, value: string): Promise<void> {
  await page.locator(`main#main[data-feed="${value}"]`).waitFor();
}
