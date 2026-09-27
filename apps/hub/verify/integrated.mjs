// The Hub's `integrated` scenario (Hub #495): the real `cli.js serve` with one
// agent-state owner, whose controllers are the paired Nanoleaf wall and Pixoo
// verification runs and whose feed those runs consume. The composition
// orchestrator (compose.mjs) writes the pairing credentials into this run's
// runtime directory before it reseeds `integrated`; this module turns them and
// the run's non-secret inputs into the hub's private configuration.
import {createHash, randomBytes} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The installed services' ports (docs/app-verification.md). A run never uses or targets them. */
export const INSTALLED_PORTS = Object.freeze([8788, 8765, 8787, 8791, 41230, 41231]);
export const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The pairing convention the Hub shares with the consumers' `hub-paired`
 * scenarios (codex-nanoleaf#194, divoom-app-upgrade#120). The consumers pin
 * the owner and their controller identities; the Hub's configuration must match.
 */
export const PAIRING = Object.freeze({
  ownerId: 'verify-owner',
  /** Agent-state consumers, as the dashboard and each paired run acknowledge. */
  consumers: [{id: 'dashboard', clearOnNewTurn: false}, {id: 'nanoleaf', clearOnNewTurn: true}, {id: 'pixoo', clearOnNewTurn: true}],
  /** Controller aliases on the Hub and the identities each paired controller serves. */
  controllers: {
    nanoleaf: {alias: 'wall', kind: 'nanoleaf', controllerId: 'wall-controller', deviceId: 'wall', input: 'nanoleaf-controller', preview: 'nanoleaf-preview'},
    pixoo: {alias: 'pixel', kind: 'pixoo', controllerId: 'pixoo-controller', deviceId: 'pixoo-local', input: 'pixoo-controller', preview: 'pixoo-preview'},
  },
  /** The synthetic lifecycle source the paired wall qualifies. */
  source: {provider: 'codex', client: 'cli', hostId: 'verify-host', sourceId: 'verify-source'},
  /** Credential files, 0600 in a run's runtime directory; never an input, never printed. */
  files: {
    consumer: {feed: 'hub-feed-token', controller: 'hub-controller-token'},
    hub: {feed: (/** @type {string} */ consumer) => `${consumer}-feed-token`, controller: (/** @type {string} */ consumer) => `${consumer}-controller-token`},
    /** The injection handshake between a Hub capture step and `compose inject`, in the Hub run's runtime directory. */
    inject: {request: 'compose-inject-request', state: 'compose-inject-state'},
  },
});

/** The Hub's inputs for `integrated`: loopback URLs of the paired runs, never a credential. */
export const INPUTS = {
  'nanoleaf-controller': {description: 'Controller endpoint of the paired wall run, http://127.0.0.1:<port>/ (integrated)'},
  'pixoo-controller': {description: 'Controller endpoint of the paired Pixoo run, http://127.0.0.1:<port>/ (integrated)'},
  'nanoleaf-preview': {description: 'Preview URL of the paired wall run, linked from Places (integrated)'},
  'pixoo-preview': {description: 'Preview URL of the paired Pixoo run (integrated)'},
};
export const REQUIRED = Object.keys(INPUTS);

/**
 * A run input that must be a numeric-loopback origin with a port and nothing else.
 * @param {string | undefined} value @param {string} name
 */
export function loopbackOrigin(value, name) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`input ${name} is not a URL`);
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error(`input ${name} must be http://127.0.0.1:<port>/`);
  // The paired runs are disposable; an installed service's port is never a pairing target.
  if (INSTALLED_PORTS.includes(Number(url.port))) throw new Error(`input ${name} names installed port ${url.port}; pair only with disposable runs`);
  return url.href;
}

const TOKEN = /^[A-Za-z0-9_-]{43}\n?$/;
/**
 * A pairing credential the orchestrator wrote: a private regular file owned by
 * this user holding one 43-character base64url token. Errors name the file,
 * never its content.
 * @param {string} runtimeDir @param {string} name
 */
export async function pairingToken(runtimeDir, name) {
  const path = join(runtimeDir, name);
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new Error(`pairing credential ${name} is missing; write the pairing files before reseeding integrated`);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error(`pairing credential ${name} must be a private regular file`);
  const text = await readFile(path, 'utf8');
  if (!TOKEN.test(text)) throw new Error(`pairing credential ${name} is not one 43-character token`);
  return text.trim();
}

const digest = (/** @type {string} */ token) => createHash('sha256').update(token).digest('hex');

/**
 * Seed `integrated`: run credentials, then the hub configuration without its port, all 0600 in the data directory.
 * @param {{runtimeDir: string, dataDir: string, inputs: Readonly<Record<string, string>>}} context
 */
export async function seedIntegrated({runtimeDir, dataDir, inputs}) {
  /** @type {Record<string, string>} */
  const urls = Object.fromEntries(REQUIRED.map(name => [name, loopbackOrigin(inputs[name], name)]));
  const api = randomBytes(32).toString('base64url'), reader = randomBytes(32).toString('base64url');
  /** @type {Record<string, {feed: string, controller: string}>} */
  const tokens = {};
  for (const consumer of Object.keys(PAIRING.controllers)) {
    tokens[consumer] = {feed: await pairingToken(runtimeDir, PAIRING.files.hub.feed(consumer)), controller: await pairingToken(runtimeDir, PAIRING.files.hub.controller(consumer))};
  }
  const aliases = Object.values(PAIRING.controllers).map(c => c.alias);
  const configuration = {
    directory: join(dataDir, 'h'),
    ownerId: PAIRING.ownerId,
    consumers: PAIRING.consumers,
    credentials: [
      {id: 'verify', digest: digest(api), scopes: ['read', 'control', 'ingest'], devices: aliases},
      {id: 'reader', digest: digest(reader), scopes: ['read'], devices: aliases},
      ...Object.keys(PAIRING.controllers).map(consumer => ({id: `${consumer}-feed`, digest: digest(tokens[consumer].feed), scopes: ['read', 'control'], devices: []})),
    ],
    controllers: Object.entries(PAIRING.controllers).map(([consumer, c]) => ({id: c.alias, kind: c.kind, controllerId: c.controllerId, deviceId: c.deviceId, endpoint: `${urls[c.input]}controller/v1`, token: tokens[consumer].controller})),
    browserAccess: 'trusted-loopback',
    // Places lead to the paired wall run, and no Local place to an installed service.
    placeLinks: {wall: urls['nanoleaf-preview']},
  };
  await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({name: 'integrated', integrated: true}), {mode: 0o600});
  await writeFile(join(dataDir, 'api-token'), api, {mode: 0o600});
  await writeFile(join(dataDir, 'reader-token'), reader, {mode: 0o600});
  await writeFile(join(dataDir, 'integrated.json'), JSON.stringify(configuration), {mode: 0o600});
}

/**
 * Launch the real hub CLI. Its configuration needs the port, which only the
 * launch knows: 0 on start, the recorded one on a relaunch.
 * @param {{node: string, dataDir: string, port: number}} context
 */
export async function launchIntegrated({node, dataDir, port}) {
  const configuration = JSON.parse(await readFile(join(dataDir, 'integrated.json'), 'utf8'));
  await mkdir(configuration.directory, {recursive: true, mode: 0o700});
  if (Buffer.byteLength(join(configuration.directory, 'bunny-launch.sock')) > 107) throw new Error('the hub socket path would exceed 107 bytes; use a shorter state root');
  const host = join(dataDir, 'host.json');
  await writeFile(host, JSON.stringify({...configuration, port}), {mode: 0o600});
  return {argv: [node, cli, 'serve', host]};
}

/** Whether a seeded data directory is the integrated scenario. @param {string} dataDir */
export async function isIntegrated(dataDir) {
  try {
    return JSON.parse(await readFile(join(dataDir, 'scenario.json'), 'utf8')).integrated === true;
  } catch {
    return false;
  }
}
