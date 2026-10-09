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
import type {Identity, LifecycleEvent, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createLifxModule, LIFX_SIMULATED_SECTION, PACKET, SimulatedLifx, lifxSchemas} from '@jimmie-potts/lifx';
import {createNanoleafModule, SIMULATED_SECTION as NANOLEAF_SECTION, SYNTHETIC_TOKEN as NANOLEAF_TOKEN,
  LINES_ADDRESS, SimulatedNanoleaf, nanoleafSchemas, type SimulatedState} from '@jimmie-potts/nanoleaf';
import {SIGN_SECTION, SYNTHETIC_TOKEN, SimulatedSigns, createSignModule, signSchemas} from '../../dist/tests/fixtures/sign.js';
import {connectRemote, type BunnyModule, type RemoteParticipant, type Sdk} from '@jimmie-potts/sdk';
import type {Page} from 'playwright';
import {CONFIG_SCHEMA, CREDENTIALS_SCHEMA, createCoreModule, startRuntime, tokenDigest, type LogRecord, type Runtime} from '../../dist/src/index.js';
import {observation, type ObservationOptions} from '../../dist/tests/fixtures/agents.js';
import {ModeDevice} from '../../dist/tests/fixtures/mode-devices.js';
import {createPixooModule, SimulatedPixoo, SIMULATED_SECTION as PIXOO_SECTION, pixooOwnSchemas, type PlaylistRecord, type SimulatedPixooState} from '@jimmie-potts/pixoo';
import {playbackFactory} from '@jimmie-potts/playback';
import {editorFixture} from './editor-fixture.ts';

/** The synthetic marker of the hook's token: no record, answer or page may carry it (Hub #835). */
export const TOKEN_MARKER = 'tok_SYNTHETIC835';
const HOOK_SOURCE = 'bunny/parts/hook';
/** The ports of the installed services, which a run must never touch. */
export const INSTALLED_PORTS = [8765, 8787, 8788, 8791, 41231];

export type WorldOptions = {
  /** The real Pixoo module with a fresh library and an in-memory device. */
  pixooPages?: boolean;
  /** A synthetic module principal for Desktop metadata; reads no provider files. */
  desktopMetadata?: boolean;
  /** Qualified scripted Nanoleaf/Pixoo native responders; Nanoleaf fails and Pixoo succeeds independently. */
  modeDevices?: boolean;
  /** Adds only simulated bulbs and the configured sign for the controls journey. */
  devices?: boolean;
  /** Adds the real Nanoleaf module over synthetic Lines for module editor and Automation journeys. */
  nanoleaf?: boolean;
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
  pixooState(): SimulatedPixooState;
  pixooPlaylists(): Promise<readonly PlaylistRecord[]>;
  pixooMedia(): Promise<{items: {name: string; renditionId: string}[]; catalogRevision: number}>;
  readonlyUpload(bytes: Uint8Array): Promise<number>;
  createPlaylist(name: string): Promise<void>;
  readonlyPlaylistCommand(data: object): Promise<number>;
  /** Publishes one hook observation of `event` now, and resolves once the edge took it. */
  observe(event: LifecycleEvent, options?: ObservationOptions): Promise<void>;
  /** Publishes a synthetic title from the trusted Desktop module's SDK. */
  desktopTitle(identity: Identity, title: string): Promise<void>;
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
  /** Actual synthetic controller writes and selections, including across runtime restarts. */
  nanoleafState(): SimulatedState;
  /** Changes only the simulated controller, as its physical switch would. */
  nanoleafPower(on: boolean): void;
  readonlyNanoleafEdit(data: object): Promise<number>;
  nanoleafWall(): Promise<{id: string; configurationRevision: number; settings: {rotation: number; flipX: number; flipY: number; style: string};
    tasks: {id: string; title: string; codexUrl?: string}[]; elements: {id: string; number: number; signature: number; project: string | null}[]}>;
  close(): Promise<void>;
};

async function writePrivate(file: string, text: string): Promise<void> {
  await writeFile(file, text, {mode: 0o600});
  await chmod(file, 0o600);
}

/** The runtime, the core, its gateway and the hook, in a private directory. */
export async function startWorld(options: WorldOptions = {}): Promise<World> {
  assert.equal(options.nanoleaf === true && options.modeDevices === true, false, 'one Nanoleaf writer per world');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-dash-')));
  const stateDir = join(root, 's');
  const configDir = join(root, 'c');
  await mkdir(configDir, {mode: 0o700});
  await chmod(root, 0o700);
  const token = `${TOKEN_MARKER}_${randomBytes(24).toString('base64url')}`;
  const consumerToken = `${TOKEN_MARKER}_${randomBytes(24).toString('base64url')}`;
  const readerToken = `${TOKEN_MARKER}_${randomBytes(24).toString('base64url')}`;
  const credentials = join(configDir, 'edge-credentials.json');
  await writePrivate(credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [{id: 'hook', source: HOOK_SOURCE, digest: tokenDigest(token), scopes: ['ingest']},
    {id: 'nanoleaf', source: 'bunny/parts/nanoleaf', digest: tokenDigest(consumerToken), scopes: ['read', 'control']},
    {id: 'reader', source: 'bunny/parts/reader', digest: tokenDigest(readerToken), scopes: ['read']},
  ]}));
  const bulbs = new SimulatedLifx();
  const lines = new SimulatedNanoleaf();
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
  const nanoleafToken = join(configDir, 'nanoleaf-token');
  if (options.nanoleaf === true) await writePrivate(nanoleafToken, NANOLEAF_TOKEN);
  const moduleConfig = {...options.devices === true ? {lifx: LIFX_SIMULATED_SECTION, sign: {...SIGN_SECTION, secrets: {token: signToken}}} : {},
    ...options.nanoleaf === true ? {nanoleaf: {...NANOLEAF_SECTION, qualifiedSources: [...NANOLEAF_SECTION.qualifiedSources,
      {provider: 'codex', client: 'desktop', hostId: 'host-sim', sourceId: 'desktop'}], secrets: {token: nanoleafToken}}} : {},
    ...options.pixooPages === true ? {pixoo: PIXOO_SECTION.config, playback: playbackFactory.simulatedSection.config} : {},
    ...options.modeDevices === true ? {nanoleaf: {}, pixoo: {}} : {}};
  const config = join(configDir, 'runtime-config.json');
  await writePrivate(config, JSON.stringify({schema: CONFIG_SCHEMA, modules: moduleConfig, edge: {
    credentials, mcp: options.inbox === true, launcher: options.launcher === true, ...(options.trusted === false ? {} : {browserAccess: 'trusted-loopback'}),
    ...(options.placeLinks === undefined ? {} : {placeLinks: options.placeLinks}),
  }}));
  const logs: LogRecord[] = [];
  let core = createCoreModule();
  const nano = new ModeDevice('nanoleaf', 'wall'); nano.result = 'failed';
  const pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const panel = new SimulatedPixoo();
  const editor = options.pixooPages === true ? await editorFixture() : undefined;
  let desktopSdk: Sdk | undefined;
  const desktopMetadata: BunnyModule = {
    manifest: {name: 'codex-desktop', apiVersion: '1.3'},
    start: context => { desktopSdk = context.sdk; },
    stop: () => { desktopSdk = undefined; },
  };
  const start = (port: number): Promise<Runtime> => startRuntime({
    modules: [core = createCoreModule(), ...(options.inbox === true ? [gadget.module()] : []), ...(options.devices === true ? [createLifxModule({transport: network}), createSignModule({transport: new SimulatedSigns({online: true})})] : []), ...(options.modeDevices === true ? [nano.module(), pixoo.module()] : []),
      ...(options.pixooPages === true ? [playbackFactory.simulate(), createPixooModule({transport: panel})] : []), ...(editor === undefined ? [] : [editor]),
      ...(options.desktopMetadata === true ? [desktopMetadata] : []), ...(options.nanoleaf === true ? [createNanoleafModule({transport: lines.request})] : [])],
    port, stateDir, configFile: config, edge: {schemas: {...options.inbox === true ? gadgetSchemas : {}, ...options.devices === true ? {...lifxSchemas, ...signSchemas} : {}, ...options.pixooPages === true ? pixooOwnSchemas : {}, ...options.nanoleaf === true ? nanoleafSchemas : {}}}, log: record => { logs.push(record); }, environment: 'test',
  });
  let runtime = await start(0);
  const port = Number(new URL(runtime.url).port);
  assert.equal(INSTALLED_PORTS.includes(port), false, 'never an installed service\'s port');
  let hook: RemoteParticipant | undefined;
  const connected = async (): Promise<RemoteParticipant> => hook ??= await connectRemote({url: runtime.url, source: HOOK_SOURCE, token, reconnectDelayMs: 50});
  return {
    url: runtime.url, stateDir, logs, runtime: () => runtime,
    nanoleafState: () => lines.state(),
    nanoleafPower: on => { lines.setPower(LINES_ADDRESS, on); },
    nanoleafWall: async () => {
      const reader = await connectRemote({url: runtime.url, source: 'bunny/parts/reader', token: readerToken});
      try {
        const answer = await reader.sync<Awaited<ReturnType<World['nanoleafWall']>>>(['nanoleaf-wall'], () => {}, {owner: 'bunny/modules/nanoleaf', timeoutMs: 5000});
        assert.equal(answer.status, 'synced');
        const wall = answer.copy.states().find(message => message.data.id === 'wall')?.data;
        assert.ok(wall !== undefined); return wall;
      } finally { await reader.close(); }
    },
    readonlyNanoleafEdit: async data => {
      const response = await fetch(`${runtime.url}/api/v2/commands/nanoleaf-wall-edit`, {
        method: 'POST', headers: {authorization: `Bearer ${readerToken}`, 'content-type': 'application/json'},
        body: JSON.stringify({target: 'wall', data, requestId: 'readonly-nanoleaf-denied'}),
      });
      await response.arrayBuffer(); return response.status;
    },
    pixooState: () => panel.state(),
    pixooPlaylists: async () => {
      const reader = await connectRemote({url: runtime.url, source: 'bunny/parts/reader', token: readerToken});
      try {
        const result = await reader.sync<PlaylistRecord>(['pixoo-playlist'], () => {}, {owner: 'bunny/modules/pixoo', timeoutMs: 5000});
        assert.equal(result.status, 'synced');
        return result.copy.states().map(message => message.data);
      } finally {await reader.close();}
    },
    createPlaylist: async name => {
      const answer = await core.actions.dispatch({key: `bunny.cmd.pixoo-playlist-change.${PIXOO_SECTION.config.device.id}`,
        draft: {type: 'org.bunny.pixoo-playlist.change.requested', subject: PIXOO_SECTION.config.device.id,
          dataschema: 'https://bunny.invalid/events/pixoo-playlist-change/2.0', data: {change: {operation: 'create', name}}},
        requestId: `setup-${randomBytes(8).toString('hex')}`, requestedBy: 'bunny/parts/operator'});
      assert.equal('status' in answer ? answer.status : 'rejected', 'accepted');
    },
    pixooMedia: async () => {
      const response = await fetch(`${runtime.url}/modules/pixoo/content/catalog-media`, {headers: {authorization: `Bearer ${readerToken}`}});
      assert.equal(response.status, 200);
      return await response.json() as {items: {name: string; renditionId: string}[]; catalogRevision: number};
    },
    readonlyUpload: async bytes => {
      const query = new URLSearchParams({family: 'pixoo-asset-change', target: PIXOO_SECTION.config.device.id, requestId: 'readonly-upload', name: 'Denied'});
      const response = await fetch(`${runtime.url}/api/v2/modules/pixoo/upload?${query}`, {
        method: 'POST', headers: {authorization: `Bearer ${readerToken}`, 'content-type': 'application/octet-stream'}, body: Buffer.from(bytes),
      });
      await response.arrayBuffer(); return response.status;
    },
    readonlyPlaylistCommand: async data => {
      const response = await fetch(`${runtime.url}/api/v2/commands/pixoo-playlist-change`, {
        method: 'POST', headers: {authorization: `Bearer ${readerToken}`, 'content-type': 'application/json'},
        body: JSON.stringify({target: PIXOO_SECTION.config.device.id, data, requestId: 'readonly-denied'}),
      });
      await response.arrayBuffer();
      return response.status;
    },
    observe: async (event, observed = {}) => {
      const {key, draft} = observation(event, Date.now(), observed);
      await (await connected()).publish(key, draft);
    },
    desktopTitle: async (identity, title) => {
      assert.ok(desktopSdk, 'the synthetic Desktop module is running');
      const {key, draft} = observation({kind: 'metadata-observed'}, Date.now(), {identity, turn: null, title: {value: title, source: 'provider'}});
      await desktopSdk.publish(key, draft);
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
    if (request.method() === 'POST' && (pathname === '/api/sdk/v1/request' || pathname.startsWith('/api/v2/commands/')
      || /^\/api\/v2\/modules\/[^/]+\/upload$/.test(pathname))) sent.push(pathname);
  });
  return sent;
}

/** Waits for the dashboard's main region to show `feed`. */
export async function feed(page: Page, value: string): Promise<void> {
  await page.locator(`main#main[data-feed="${value}"]`).waitFor();
}
