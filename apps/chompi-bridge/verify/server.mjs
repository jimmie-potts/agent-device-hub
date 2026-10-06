// The CHOMPI bridge verification run's application (Hub #853). One loopback listener serves:
//
// - the control page (page/) and its harness API (/api/harness/...), guarded by Host, Origin and a JSON content type;
// - the synthetic Hub feed (/api/monitor/v1/sessions and /changes) with the run-generated token from the seed;
// - after handoff, the app-verify proof links (createProofHandler) for this run's frozen captures.
//
// In the same process it runs the real bridge CLI, `chompi-bridge run --simulate --desktop sim`, against that
// feed, and keeps the simulated controller and desktop the flags create so the page and the scenarios can drive
// them. The module guard (guard.mjs) refuses node-hid and koffi, and the bridge's fetch reaches only this
// listener, so a run cannot open a HID device, call Win32 or UI Automation, or contact an installed Hub. Each of
// those is reported at /api/harness/boundaries for the plug-in's boundary checks (boundaries.mjs).
//
// A seed may name a `fault` that crosses one boundary, only so tests can prove its check fails:
// `hid-device` (no --simulate: the HID transport is created and node-hid is refused), `desktop-calls` (no --desktop
// sim: the platform adapter is created, which on Linux is the unsupported adapter, so nothing is refused) and `installed-hub` (the feed origin is the installed Hub's port; every
// request is refused before it is sent).
//
// A catalog scenario started from the page waits until the run is ready (controller connected, feed current, every
// seeded task on a lit slot key), so its first press is never lost to a controller that is still connecting.
import { blockedModules } from './guard.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProofHandler } from '@jimmie-potts/app-verify';
import { main } from '../dist/cli.js';
import { defaultLockPath } from '../dist/lock.js';
import { createNodeHidTransport } from '../dist/node-hid-transport.js';
import { isPressControl, isTurnControl } from '../dist/protocol.js';
import { loadOsAdapter } from '../dist/routing/index.js';
import { DEFAULT_CARD_STEP_COUNTS, DEFAULT_EFFORT_SETTINGS, DEFAULT_MODEL_SETTINGS, DEFAULT_PAGE_SETTINGS, DEFAULT_PROFILE_PATH, DEFAULT_VOLUME_SETTINGS } from '../dist/routing/profile.js';
import { SyntheticHub } from '../dist/sim/hub.js';
import { CONTROL, PANEL_ENCODERS, PANEL_KEYS, describeLights } from '../dist/sim/panel.js';
import { READY_STEP, SCENARIOS, ready, readiness, runScenario, seedDesktop, seedHub, taskIds } from '../dist/sim/scenarios.js';
import { RUN_SCENARIOS } from './seed.mjs';

export { RUN_SCENARIOS, seedRun } from './seed.mjs';

const PAGE = fileURLToPath(new URL('page/', import.meta.url));
/** @typedef {import('../dist/cli.js').SimulationParts} SimulationParts */
/** @typedef {import('../dist/sim/scenarios.js').Harness} Harness */
/** @typedef {import('../dist/sim/scenarios.js').StepResult} StepResult */
/** @typedef {import('../dist/sim/scenarios.js').BridgeLogLine} BridgeLogLine */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {{id: string, title: string, state: 'running' | 'passed' | 'failed', steps: StepResult[], error?: string}} ScenarioRun */

/** @type {Readonly<Record<string, [string, string]>>} */
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/page.js': ['page.js', 'text/javascript; charset=utf-8'], '/page.css': ['page.css', 'text/css; charset=utf-8'] };
const FAULTS = new Set(['hid-device', 'desktop-calls', 'installed-hub']);
const INSTALLED_HUB = 'http://127.0.0.1:8788';
const MAX_BODY = 8 * 1024;
const MAX_LOG = 2000;
const TEXT = /^[\x20-\x7e]{1,200}$/;
/** @type {Record<'approval' | 'question', Record<'codex' | 'claude', string[]>>} */
const CARD_STOPS = {
  approval: { codex: ['Deny', 'Approve'], claude: ['Allow once', 'Allow always', 'Deny'] },
  question: { codex: ['Synthetic answer A', 'Synthetic answer B', 'Other'], claude: ['Synthetic answer A', 'Synthetic answer B', 'Synthetic answer C', 'Other'] },
};

class Refusal extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) { super(code); this.status = status; }
}

/** @param {number} ms @returns {Promise<void>} */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Starts the run's listener and bridge.
 * @param {{dataDir: string, port?: number, proof?: {proofDir: string, runId: string} | null, echo?: (line: string) => void,
 *   processHooks?: import('../dist/cli.js').ProcessHooks, readyTimeoutMs?: number}} options
 */
export async function startServer({ dataDir, port = 0, proof = null, echo = () => {}, processHooks, readyTimeoutMs = 20_000 }) {
  if (process.platform === 'win32') throw new Error('chompi-start-failed: unsupported-platform');
  const config = JSON.parse(await readFile(join(dataDir, 'scenario.json'), 'utf8'));
  const definition = RUN_SCENARIOS[config.name];
  if (!definition || (definition.fault && !FAULTS.has(definition.fault))) throw new Error('chompi-start-failed: unknown-scenario');
  const token = (await readFile(join(dataDir, 'feed-token'), 'utf8')).trim();
  const paths = { profile: join(dataDir, 'profile.json'), token: join(dataDir, 'feed-token'), state: join(dataDir, 'state') };
  const env = { XDG_RUNTIME_DIR: dataDir };
  const lockPath = defaultLockPath({ env });
  if (Buffer.byteLength(lockPath) > 107) throw new Error('chompi-start-failed: socket-path-too-long');
  const proofHandler = proof ? createProofHandler(proof) : null;

  /** @type {SimulationParts} */
  let parts = { simulator: undefined, desktop: undefined };
  /** @type {Record<string, any>} */
  let profile = JSON.parse(await readFile(paths.profile, 'utf8'));
  /** @type {BridgeLogLine[]} */
  const logs = [];
  let logCount = 0;
  /** @type {{hidTransports: number, platformAdapters: number, requests: {origin: string, path: string}[], refused: string[]}} */
  const boundary = { hidTransports: 0, platformAdapters: 0, requests: [], refused: [] };
  /** @type {ScenarioRun | null} */
  let scenarioRun = null;
  /** @type {number | null} */
  let exit = null;

  const hub = new SyntheticHub({ token });
  seedHub(hub, definition.seed);

  const server = createServer((request, response) => { void handle(request, response); });
  await /** @type {Promise<void>} */ (new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }));
  const bound = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const origin = `http://127.0.0.1:${bound}`;
  const feedOrigin = definition.fault === 'installed-hub' ? INSTALLED_HUB : origin;

  // The bridge's only network path: this listener. Anything else is refused before a connection is made.
  /** @type {typeof fetch} */
  const guardedFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    boundary.requests.push({ origin: url.origin, path: url.pathname });
    if (boundary.requests.length > 200) boundary.requests.shift();
    if (url.origin !== origin) {
      if (!boundary.refused.includes(url.origin)) boundary.refused.push(url.origin);
      throw new TypeError('refused-by-verification-run');
    }
    return fetch(input, init);
  };

  const sink = {
    /** @param {string} text */
    write(text) {
      for (const line of String(text).split('\n')) {
        if (!line) continue;
        echo(line);
        /** @type {BridgeLogLine} */
        let value;
        try { value = JSON.parse(line); } catch { value = { type: 'stderr', text: line.slice(0, 200) }; }
        logs.push(value);
        logCount++;
        if (logs.length > MAX_LOG) logs.splice(0, logs.length - MAX_LOG);
      }
      return true;
    },
  };
  const abort = new AbortController();
  const argv = ['run',
    ...(definition.fault === 'hid-device' ? [] : ['--simulate']),
    ...(definition.fault === 'desktop-calls' ? [] : ['--desktop', 'sim']),
    '--profile', paths.profile, '--hub', feedOrigin, '--token-file', paths.token, '--state', paths.state];
  /** @type {Promise<number>} */
  let bridgeDone = Promise.resolve(1);
  /** @type {Promise<boolean>} */
  const simulated = new Promise(resolve => {
    const running = main(argv, {
      stdout: sink, stderr: sink, env, fetch: guardedFetch, signal: abort.signal,
      ...(processHooks ? { process: processHooks } : {}),
      createHidTransport: () => { boundary.hidTransports++; return createNodeHidTransport(); },
      createOsAdapter: async () => { boundary.platformAdapters++; return loadOsAdapter(); },
      onSimulation: value => {
        parts = value;
        if (value.desktop) seedDesktop(value.desktop, definition.seed);
        resolve(true);
      },
    });
    running.then(code => { exit = code; resolve(false); }, (/** @type {any} */ error) => { exit = 1; sink.write(`chompi-bridge-crashed: ${error?.message ?? error}`); resolve(false); });
    bridgeDone = running.catch(() => 1);
  });
  const started = await Promise.race([simulated, sleep(15_000).then(() => false)]);
  if (!started) {
    abort.abort();
    hub.close();
    server.close();
    server.closeAllConnections();
    throw new Error(`chompi-start-failed: bridge-not-started${exit === null ? '' : `-${exit}`}`);
  }

  /** The live harness for the scenario catalog: real time, this run's parts (both exist for a catalog scenario). */
  /** @type {Harness} */
  const harness = {
    tier: 'run',
    get simulator() { return /** @type {NonNullable<SimulationParts['simulator']>} */ (parts.simulator); },
    get desktop() { return /** @type {NonNullable<SimulationParts['desktop']>} */ (parts.desktop); },
    hub,
    logs: () => logs,
    profile: () => profile,
    async writeProfile(edit) {
      profile = edit(structuredClone(profile));
      await writeFile(paths.profile, JSON.stringify(profile, null, 2), { mode: 0o600 });
    },
    wait: sleep,
  };

  async function slotsFile() {
    try {
      const value = JSON.parse(await readFile(join(paths.state, 'slots.json'), 'utf8'));
      return Array.isArray(value.slots) ? value.slots.map((/** @type {any} */ s) => ({ slot: s.slot, client: s.client, taskId: s.taskId })) : [];
    } catch {
      return [];
    }
  }

  function boundaries() {
    return {
      hid: { simulated: !!parts.simulator, transportsCreated: boundary.hidTransports, simulatorConnections: parts.simulator?.connections.length ?? 0, blockedModules: blockedModules.filter(m => m.startsWith('node-hid')) },
      desktop: { simulated: parts.desktop !== undefined, platformAdaptersCreated: boundary.platformAdapters, blockedModules: blockedModules.filter(m => !m.startsWith('node-hid')) },
      feed: {
        origin: feedOrigin, requests: [...boundary.requests], refused: [...boundary.refused],
        unauthorized: hub.requests.filter(r => !r.authorized).length, authorized: hub.authorizedRequests,
        lockInRun: lockPath.startsWith(`${dataDir}/`),
      },
    };
  }

  /** Whether a catalog scenario may start: the run is simulated and ready, or why not. */
  function runReady() {
    if (!parts.simulator || !parts.desktop) return 'this run has no simulated controller or desktop';
    return readiness(harness, definition.seed);
  }

  async function state() {
    const simulator = parts.simulator;
    const desktop = parts.desktop;
    return {
      ready: runReady(),
      run: { scenario: config.name, description: definition.description, catalog: definition.catalog ?? null, fault: definition.fault ?? null, bridge: exit === null ? 'running' : `exited ${exit}` },
      controller: simulator ? {
        plugged: simulator.plugged, display: simulator.display, epoch: simulator.epoch, profileVersion: simulator.profileVersion,
        brightness: simulator.brightnessPercent, pressed: simulator.pressed, leds: simulator.leds,
        // Each LED named by what its role can show (slot state, record, wheel error), not by the first matching color.
        lights: describeLights(/** @type {any} */ (profile), simulator.leds),
      } : null,
      colors: profile.colors,
      profileVersion: profile.profileVersion,
      desktop: desktop ? { ...desktop.snapshot(), log: desktop.log.slice(-40) } : null,
      hub: { revision: hub.revision, openStreams: hub.openStreams, sessions: hub.sessions() },
      slots: await slotsFile(),
      log: logs.slice(-40).map((line, i, tail) => ({ n: logCount - tail.length + i, line })),
      feed: logs.findLast(line => line.type === 'feed') ?? null,
      scenario: scenarioRun,
    };
  }

  /** @param {'codex' | 'claude'} client */
  function nextTask(client) {
    const used = hub.sessions().map(s => Number(/(\d+)$/.exec(s.sessionId)?.[1] ?? 0));
    const n = Math.max(0, ...used) + 1;
    if (n > 30) throw new Refusal(409, 'too-many-tasks');
    const ids = taskIds(client, n);
    if (client === 'codex') parts.desktop?.addCodexThread(ids.desktopId, ids.title);
    else parts.desktop?.addClaudeSession(ids.desktopId, ids.title);
    hub.addSession({ provider: client, sessionId: ids.sessionId, title: ids.title, ...(client === 'claude' ? { hostSessionId: ids.desktopId } : {}) });
    return { sessionId: ids.sessionId };
  }

  /** @param {unknown} value @returns {'codex' | 'claude'} */
  const client = value => {
    if (value !== 'codex' && value !== 'claude') throw new Refusal(400, 'invalid-client');
    return value;
  };
  /** @param {unknown} value @returns {string} */
  const session = value => {
    if (typeof value !== 'string' || !hub.session(value)) throw new Refusal(404, 'unknown-session');
    return value;
  };

  /**
   * One operator action. Every value is checked; nothing here can reach outside the run.
   * @param {string} area @param {Record<string, any>} input @returns {Promise<unknown>}
   */
  async function act(area, input) {
    const { simulator, desktop } = parts;
    if (area === 'controller') {
      if (!simulator) throw new Refusal(409, 'no-simulated-controller');
      const { op, control, delta } = input;
      if (op === 'plug') return simulator.plug();
      if (op === 'unplug') return simulator.unplug();
      if (['press', 'release', 'click'].includes(op)) {
        if (!isPressControl(control)) throw new Refusal(400, 'invalid-control');
        return simulator[/** @type {'press' | 'release' | 'click'} */ (op)](control);
      }
      if (op === 'turn') {
        if (!isTurnControl(control) || !Number.isInteger(delta) || delta === 0 || delta < -127 || delta > 127) throw new Refusal(400, 'invalid-turn');
        return simulator.turn(control, delta);
      }
      throw new Refusal(400, 'invalid-op');
    }
    if (area === 'desktop') {
      if (!desktop) throw new Refusal(409, 'no-simulated-desktop');
      const { op } = input;
      if (op === 'front') {
        if (![null, 'codex', 'claude', 'other'].includes(input.window)) throw new Refusal(400, 'invalid-window');
        return desktop.bringToFront(input.window);
      }
      if (op === 'type') {
        if (typeof input.text !== 'string' || !TEXT.test(input.text)) throw new Refusal(400, 'invalid-text');
        return desktop.typeText(client(input.client), input.text);
      }
      if (op === 'clear') return desktop.clearComposer(client(input.client));
      if (op === 'composer-focus') return desktop.focusComposer(client(input.client), input.focused === true);
      if (op === 'open-card') {
        /** @type {'question' | 'approval' | null} */
        const kind = input.kind === 'question' ? 'question' : input.kind === 'approval' ? 'approval' : null;
        if (!kind) throw new Refusal(400, 'invalid-card');
        const c = client(input.client);
        return void desktop.openCard(c, { kind, stops: CARD_STOPS[kind][c] });
      }
      if (op === 'close-card') return desktop.closeCard(client(input.client));
      if (op === 'select') {
        const c = client(input.client);
        if (typeof input.task !== 'string' || !TEXT.test(input.task)) throw new Refusal(400, 'invalid-task');
        return desktop.select(c, input.task);
      }
      throw new Refusal(400, 'invalid-op');
    }
    if (area === 'hub') {
      const { op } = input;
      if (op === 'add-task') return nextTask(client(input.client));
      if (op === 'attention') {
        const kinds = input.kind === null ? [] : ['question', 'approval', 'input'].includes(input.kind) ? [input.kind] : undefined;
        if (!kinds) throw new Refusal(400, 'invalid-attention');
        return hub.update(session(input.sessionId), { attention: kinds });
      }
      if (op === 'activity') {
        if (!['active', 'idle', 'interrupted', 'ended', 'unknown'].includes(input.activity)) throw new Refusal(400, 'invalid-activity');
        return hub.update(session(input.sessionId), { activity: input.activity });
      }
      if (op === 'end-turn') return hub.endTurn(session(input.sessionId));
      if (op === 'drop-stream') return hub.dropStreams();
      throw new Refusal(400, 'invalid-op');
    }
    if (area === 'profile') {
      if (input.op !== 'alternate' && input.op !== 'default') throw new Refusal(400, 'invalid-op');
      const shipped = JSON.parse(await readFile(DEFAULT_PROFILE_PATH, 'utf8'));
      await harness.writeProfile((/** @type {Record<string, any>} */ current) => ({
        ...current, profileVersion: current.profileVersion + 1,
        colors: { ...current.colors, idle: input.op === 'alternate' ? [120, 0, 120] : shipped.colors.idle },
      }));
      return { profileVersion: profile.profileVersion };
    }
    if (area === 'scenario') {
      if (input.op !== 'run') throw new Refusal(400, 'invalid-op');
      const scenario = SCENARIOS.find(s => s.id === definition.catalog);
      if (!scenario) throw new Refusal(409, 'no-catalog-scenario-seeded');
      if (!parts.simulator || !parts.desktop) throw new Refusal(409, 'run-not-simulated');
      if (scenarioRun?.state === 'running') throw new Refusal(409, 'scenario-running');
      if (scenarioRun) throw new Refusal(409, 'scenario-already-ran; reseed the run to run it again');
      /** @type {ScenarioRun} */
      const run = { id: scenario.id, title: scenario.title, state: 'running', steps: [] };
      scenarioRun = run;
      void (async () => {
        // Like Tier 1: the first step acts only once the run is ready. A run that never gets there records a failed
        // readiness step with what it saw, rather than a press the controller never received.
        const ok = await ready(harness, definition.seed, readyTimeoutMs);
        if (ok !== true) {
          run.steps.push({ name: READY_STEP, kind: 'expect', outcome: 'failed', detail: ok });
          run.state = 'failed';
          return;
        }
        const result = await runScenario(scenario, harness, step => run.steps.push(step));
        run.state = result.outcome;
      })().catch((/** @type {any} */ error) => { run.state = 'failed'; run.error = String(error?.message ?? error); });
      return { id: scenario.id };
    }
    throw new Refusal(404, 'not-found');
  }

  const SECURITY = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin',
  };
  /** @param {ServerResponse} response @param {number} status @param {any} body */
  const send = (response, status, body, type = 'application/json') => {
    response.writeHead(status, { ...SECURITY, 'content-type': type });
    response.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  /** @param {IncomingMessage} request @returns {Promise<Record<string, any>>} */
  async function readJson(request) {
    if (!/^application\/json(?:;|$)/.test(request.headers['content-type'] ?? '')) throw new Refusal(415, 'json-required');
    const site = request.headers['sec-fetch-site'];
    if ((request.headers.origin !== undefined && request.headers.origin !== origin) || (site !== undefined && site !== 'same-origin' && site !== 'none')) throw new Refusal(403, 'cross-origin');
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_BODY) throw new Refusal(413, 'too-large');
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const value = JSON.parse(body || '{}');
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw new Refusal(400, 'invalid-json');
    }
  }

  /** @param {IncomingMessage} request @param {ServerResponse} response */
  async function feed(request, response) {
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value);
    const answer = await hub.handle(new Request(`${origin}${request.url}`, { method: request.method ?? 'GET', headers, signal: controller.signal }));
    response.writeHead(answer.status, { ...SECURITY, ...Object.fromEntries(answer.headers) });
    response.flushHeaders();
    if (!answer.body) return response.end();
    const reader = answer.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        response.write(value);
      }
    } catch {
      // The stream ended with an error (a dropped stream or a closed client).
    }
    response.end();
  }

  /** @param {IncomingMessage} request @param {ServerResponse} response */
  async function handle(request, response) {
    try {
      if (request.headers.host !== `127.0.0.1:${bound}`) return send(response, 421, { error: 'wrong-host' });
      const url = new URL(request.url ?? '/', origin);
      if (proofHandler && url.pathname.startsWith(proofHandler.prefix)) return await proofHandler.handle(request, response);
      if (url.pathname.startsWith('/api/monitor/')) return await feed(request, response);
      const file = STATIC[url.pathname];
      if (file) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'method-not-allowed' });
        response.writeHead(200, {
          ...SECURITY, 'content-type': file[1],
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
        return response.end(request.method === 'HEAD' ? undefined : await readFile(join(PAGE, file[0])));
      }
      if (request.method === 'GET' && url.pathname === '/api/harness/health') return send(response, exit === null ? 200 : 503, { ok: exit === null, bridge: exit === null ? 'running' : `exited ${exit}` });
      if (request.method === 'GET' && url.pathname === '/api/harness/state') return send(response, 200, await state());
      if (request.method === 'GET' && url.pathname === '/api/harness/boundaries') return send(response, 200, boundaries());
      if (request.method === 'GET' && url.pathname === '/api/harness/panel') {
        // Default counts per turn, from the profile: one card step for the big wheel, one page step for knob 4 (#822),
        // one volume key for the volume knob (#865), and one model or effort step for knobs 1 and 2 (#906).
        const counts = {
          wheel: profile.cards?.stepCounts ?? DEFAULT_CARD_STEP_COUNTS, 'knob-4': profile.pages?.stepCounts ?? DEFAULT_PAGE_SETTINGS.stepCounts,
          volume: profile.volume?.stepCounts ?? DEFAULT_VOLUME_SETTINGS.stepCounts,
          'knob-1': profile.model?.stepCounts ?? DEFAULT_MODEL_SETTINGS.stepCounts, 'knob-2': profile.effort?.stepCounts ?? DEFAULT_EFFORT_SETTINGS.stepCounts,
        };
        return send(response, 200, { keys: PANEL_KEYS, encoders: PANEL_ENCODERS, controls: CONTROL, counts, cards: Object.keys(CARD_STOPS) });
      }
      const area = /^\/api\/harness\/(controller|desktop|hub|profile|scenario)$/.exec(url.pathname)?.[1];
      if (area) {
        if (request.method !== 'POST') return send(response, 405, { error: 'method-not-allowed' });
        const result = await act(area, await readJson(request));
        return send(response, 200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
      }
      send(response, 404, { error: 'not-found' });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (error instanceof Refusal) return send(response, error.status, { error: error.message });
      send(response, 500, { error: 'harness-failed' });
    }
  }

  /** @type {Promise<number> | undefined} */
  let closing;
  const close = () => closing ??= (async () => {
    abort.abort();
    const code = await bridgeDone;
    hub.close();
    server.close();
    server.closeAllConnections();
    return code;
  })();

  return { url: `${origin}/`, port: bound, close, boundaries, state, harness, hub, get parts() { return parts; }, get exit() { return exit; } };
}
