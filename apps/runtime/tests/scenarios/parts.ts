// What every execution adapter of the scenario catalog shares (Hub #846, #920): the parts' sources, the reader's
// copies, the validator every message a harness sees must pass, and how a request's result reads as an answer.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SimulatedMarker} from '@jimmie-potts/codex-desktop';
import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerLifxFamilies} from '@jimmie-potts/lifx';
import {nanoleafSchemas} from '@jimmie-potts/nanoleaf';
import {pixooOwnSchemas} from '@jimmie-potts/pixoo';
import type {SimulatedSpeakers} from '@jimmie-potts/playback';
import type {CommandDraft, Participant, RequestResult, SyncChange, SyncedCopy} from '@jimmie-potts/sdk';
import {producerCredentialId, producerSource} from '../../src/hook/index.js';
import {CONFIG_SCHEMA, CREDENTIALS_SCHEMA, REQUEST_HEADER, SESSION_COOKIE, tokenDigest} from '../../src/index.js';
import {historySchemas} from '../fixtures/core.js';
import {lampSchemas} from '../fixtures/lamp.js';
import {SYNTHETIC_TOKEN, signSchemas} from '../fixtures/sign.js';
import {
  GRANTS, PRODUCER, ROLES, TOKEN_PREFIX, type Follow, type GatewayAnswer, type GatewayCall, type HookPayload, type HookRun, type ReaderView, type Role, type Seed,
  type Simulation,
} from './catalog.js';

/** A part's source: `bunny/parts/<role>`, never a module's or the core's. */
export const sourceOf = (role: Role): string => `bunny/parts/${role}`;

/** Every fixture family's payload schema, and the Pixoo's and the Nanoleaf module's own, that the catalog's messages use, by `dataschema`. */
export const SCENARIO_SCHEMAS: Readonly<Record<string, object>> = {...lampSchemas, ...signSchemas, ...historySchemas, ...pixooOwnSchemas, ...nanoleafSchemas};

/** Profile 2.0 with the core and device families, and every module and fixture family the catalog's messages use. */
export function scenarioValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  for (const [dataschema, schema] of Object.entries(SCENARIO_SCHEMAS)) validator.register(dataschema, schema);
  registerLifxFamilies(validator);
  return validator;
}

/** A run-generated token for each part, with the synthetic prefix that every token scan looks for (Hub #835). */
export const partTokens = (): Record<Role, string> =>
  Object.fromEntries(ROLES.map(role => [role, `${TOKEN_PREFIX}_${randomBytes(24).toString('base64url')}`])) as Record<Role, string>;
/** The producer's run-generated token (Hub #926): in the Hub's form, 43 base64url characters, with the synthetic prefix. */
export const producerToken = (): string => `${TOKEN_PREFIX}_${randomBytes(20).toString('base64url').slice(0, 42 - TOKEN_PREFIX.length)}`;

async function writePrivate(file: string, text: string): Promise<void> {
  await writeFile(file, text, {mode: 0o600});
  await chmod(file, 0o600);
}

/**
 * Writes a seed's configuration as the cutover's installer would (Hub #919, #935): in `dir`, a private configuration
 * file with each configured module's section, and one private token file per module holding the synthetic token,
 * which the module's section names as `secrets.token`. Its `edge` section (Hub #835) names a private credentials file
 * with each part's grant (`GRANTS`) under its token's digest, and lets a trusted loopback page sign a browser in, with
 * the launcher off.
 * Returns the configuration file's path for `--config`.
 */
export async function writeConfiguration(dir: string, {modules: config = {}, sections = {}, tokens, producer}: {
  modules?: Seed['config']; sections?: Readonly<Record<string, object>>; tokens: Readonly<Record<Role, string>>;
  /** The agent hooks' producer token (Hub #926), granted `ingest` under its converted credential's ID and source. */
  producer?: string;
}): Promise<string> {
  const secrets = join(dir, 'secrets');
  for (const folder of [dir, secrets]) {
    await mkdir(folder, {recursive: true, mode: 0o700});
    await chmod(folder, 0o700);
  }
  // `sections` are complete already, such as the shipped modules' simulated sections (Hub #929).
  const modules: Record<string, object> = {...sections};
  for (const [name, section] of Object.entries(config)) {
    const token = join(secrets, `${name}-token`);
    await writePrivate(token, `${SYNTHETIC_TOKEN}\n`);
    modules[name] = {...section, secrets: {token}};
  }
  const credentials = join(dir, 'edge-credentials.json');
  const listed = [
    ...ROLES.map(role => ({id: role, source: sourceOf(role), digest: tokenDigest(tokens[role]), scopes: [...GRANTS[role].scopes]})),
    ...producer === undefined ? [] : [{id: producerCredentialId(PRODUCER), source: producerSource(PRODUCER), digest: tokenDigest(producer), scopes: ['ingest']}],
  ];
  await writePrivate(credentials, `${JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: listed}, null, 2)}\n`);
  const file = join(dir, 'runtime-config.json');
  // A run's state directory lies too deep for the launcher's socket; the scenarios sign a browser in from a trusted page,
  // and call MCP, which is on.
  await writePrivate(file, `${JSON.stringify({schema: CONFIG_SCHEMA, modules, edge: {credentials, browserAccess: 'trusted-loopback', launcher: false, mcp: true}}, null, 2)}\n`);
  return file;
}

/**
 * Writes the agent hooks' producer file (Hub #926) as the Hub's setup wrote it, unchanged 1.x with lifecycle 1.2, naming
 * the runtime's port: owner-only, in an owner-only folder `producer` under `dir`. Returns its path, which the hook
 * script takes as its argument.
 */
export async function writeProducer(dir: string, port: number, token: string): Promise<string> {
  const folder = join(dir, 'producer');
  await mkdir(folder, {recursive: true, mode: 0o700});
  await chmod(folder, 0o700);
  const file = join(folder, 'producer.json');
  await writePrivate(file, `${JSON.stringify({lifecycleVersion: '1.2', enabled: true, qualified: true, source: PRODUCER, endpoint: `http://127.0.0.1:${port}/api/monitor/v1/events`, token})}\n`);
  return file;
}

/** The 2.0 hook script (Hub #926), from the built scenarios in `dist/tests/scenarios/`. */
const HOOK_SCRIPT = fileURLToPath(new URL('../../../bin/monitor-hook.mjs', import.meta.url));
/**
 * The hook's environment: the harness's own, without what a real client's hook would find in it, so a run inside an
 * agent session reads nothing of that session's.
 */
const HOOK_ENVIRONMENT: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CLAUDE_CODE_') && name !== 'CODEX_HOME'));

/** Runs the hook script once, as a client's hook command does: `node monitor-hook.mjs <producer>` with `payload` on stdin. */
export async function runHookScript(producer: string, payload: HookPayload): Promise<HookRun> {
  const started = performance.now();
  const child = spawn(process.execPath, [HOOK_SCRIPT, producer], {stdio: ['pipe', 'pipe', 'pipe'], env: HOOK_ENVIRONMENT});
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(payload));
  const [code, signal] = await once(child, 'exit') as [number | null, string | null];
  return {code, signal, output, elapsedMs: performance.now() - started};
}

/** Makes the simulated Codex Desktop marker do what a scenario asks (Hub #926), in either harness. */
export function simulateMarker(marker: SimulatedMarker, simulation: Extract<Simulation, {device: 'codex-desktop'}>): void {
  switch (simulation.action) {
    case 'list':
      marker.list(simulation.sessions);
      return;
    case 'unusable':
      marker.unusable();
      return;
    case 'stall':
      marker.stall();
      return;
    case 'answer':
      marker.answer();
      return;
  }
}

/** Makes the playback module's simulated speakers do what a scenario asks (Hub #929), in either harness. */
export function simulatePlayback(speakers: SimulatedSpeakers, {speaker, action, title}: Extract<Simulation, {device: 'playback'}>): void {
  switch (action) {
    case 'play':
      speakers.play(speaker, title === undefined ? undefined : {title});
      return;
    case 'pause':
      speakers.pause(speaker);
      return;
    case 'stop':
      speakers.stop(speaker);
      return;
    case 'other-input':
      speakers.otherInput(speaker);
      return;
    case 'silent':
      speakers.silent(speaker);
      return;
    case 'slow':
      speakers.slow(speaker);
      return;
    case 'answer':
      speakers.answer(speaker);
      return;
    case 'refuse-next':
      speakers.nextCommand(speaker, 'refuse');
      return;
    case 'hang-next':
      speakers.nextCommand(speaker, 'hang');
      return;
  }
}

/**
 * The gateway as the scenarios call it (Hub #835), shared by every harness: a part with its token, a browser with the
 * session a trusted loopback page opened, which this client opens on its first browser call, a stranger with a
 * made-up token, or a caller with neither. A call from another site carries that site's Origin and fetch metadata.
 */
export class GatewayClient {
  readonly #origin: () => string;
  readonly #tokens: Readonly<Record<Role, string>>;
  readonly #producer: string;
  #cookie: string | undefined;

  constructor(origin: () => string, tokens: Readonly<Record<Role, string>>, producer: string) {
    this.#origin = origin;
    this.#tokens = tokens;
    this.#producer = producer;
  }

  async call({as, method, path, body, headers = {}, origin}: GatewayCall): Promise<GatewayAnswer> {
    const own = this.#origin();
    const sent: Record<string, string> = {...headers};
    if (body !== undefined) sent['content-type'] = 'application/json';
    if (as === 'browser') {
      sent.cookie = `${SESSION_COOKIE}=${await this.#session()}`;
      sent['sec-fetch-site'] = 'same-origin';
      if (method !== 'GET') {
        sent.origin = own;
        sent[REQUEST_HEADER] = '1';
      }
    } else if (as === 'stranger') {
      sent.authorization = `Bearer ${TOKEN_PREFIX}_stranger_${randomBytes(12).toString('hex')}`;
    } else if (as === 'producer') {
      sent.authorization = `Bearer ${this.#producer}`;
    } else if (as !== 'anonymous') {
      sent.authorization = `Bearer ${this.#tokens[as]}`;
    }
    if (origin === 'other') {
      sent.origin = 'http://pages.invalid';
      sent['sec-fetch-site'] = 'cross-site';
    }
    const response = await fetch(new URL(path, own), {method, headers: sent, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const answered: Record<string, string> = {};
    response.headers.forEach((value, name) => { answered[name.toLowerCase()] = value; });
    return {status: response.status, headers: answered, text: await response.text()};
  }

  /** The browser's session, which a same-origin page opens once by trusted loopback sign-in. */
  async #session(): Promise<string> {
    if (this.#cookie !== undefined) return this.#cookie;
    const own = this.#origin();
    const response = await fetch(new URL('/api/v2/browser/session', own), {
      method: 'POST', body: '{}',
      headers: {'content-type': 'application/json', origin: own, 'sec-fetch-site': 'same-origin', [REQUEST_HEADER]: '1'},
    });
    const cookie = /^bunny-session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
    await response.body?.cancel();
    if (response.status !== 200 || cookie === undefined) throw new Error(`the browser could not sign in: ${response.status}`);
    this.#cookie = cookie;
    return cookie;
  }

  /** Forgets the browser's session, as the runtime's restart ends it. */
  forget(): void {
    this.#cookie = undefined;
  }
}

/** A request's answer as the catalog reads it: `accepted`, or the refusal's or uncertain result's error code. */
export const answerOf = (result: RequestResult): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;

/**
 * The gateway call that sends `command` through the core's dispatcher as `role` (#782): `POST /api/v2/commands/<family>`
 * with its target and payload, named by its key `bunny.cmd.<family>.<target>`.
 */
export function actionCall(role: Role, {key, draft}: {key: string; draft: CommandDraft<object>}, requestId: string): GatewayCall {
  const [, , family, target] = key.split('.');
  return {as: role, method: 'POST', path: `/api/v2/commands/${family ?? ''}`, body: {target, data: draft.data, requestId}};
}

/** An action's answer as the catalog reads it: `accepted`, or the error body's code. */
export function actionAnswerOf(answer: GatewayAnswer): string {
  if (answer.status === 200) return 'accepted';
  try {
    return String((JSON.parse(answer.text) as {error?: {code?: unknown}}).error?.code);
  } catch {
    return `answered ${answer.status}`;
  }
}

export const describe = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

type Copy = SyncedCopy<Record<string, unknown>>;
/** One copy the reader keeps: its families, and the owner it names, if any. */
type Group = {families: readonly string[]; owner?: string};
const groupOf = (follow: Follow): Group => 'families' in follow ? follow : {families: follow};
/** A group as a problem names it: its families, and its owner when it names one. */
const named = ({families, owner}: Group): string => `${families.join(',')}${owner === undefined ? '' : ` from ${owner}`}`;

/** The reader's copies, one per owner, how often each synced, every occurrence and outcome it heard and its gap notices. */
export class Reader implements ReaderView {
  readonly groups: readonly Group[];
  copies: (Copy | undefined)[] = [];
  readonly counts: number[];
  readonly messages: Message[] = [];
  gapNotices = 0;

  constructor(follows: Seed['follows']) {
    this.groups = follows.map(groupOf);
    this.counts = follows.map(() => 0);
  }

  families(): readonly string[] {
    return [...new Set(this.groups.flatMap(group => group.families))];
  }

  /**
   * The current states of `family`, at any version of it, such as `device/2.0` and `device/2.1` (Hub #975), in the copies
   * that hold it, or only in the copy from `owner` when one is named.
   */
  states<T>(family: string, owner?: string): Message<T>[] {
    return this.#holding(family, owner).flatMap(index => this.copies[index]?.states() ?? [])
      .filter(state => state.dataschema.startsWith(`${SCHEMA_BASE}${family}/`)) as Message<T>[];
  }

  syncs(family: string, owner?: string): number {
    const [index] = this.#holding(family, owner);
    return index === undefined ? 0 : this.counts[index] ?? 0;
  }

  /** The indexes of the copies that hold `family`, from `owner` when one is named. */
  #holding(family: string, owner: string | undefined): number[] {
    return this.groups.flatMap((group, index) => group.families.includes(family) && (owner === undefined || group.owner === owner) ? [index] : []);
  }

  heard(): readonly Message[] {
    return this.messages;
  }

  gaps(): number {
    return this.gapNotices;
  }
}

/** Where a harness sends what it saw: each message to check against profile 2.0, and each problem. */
export type Observer = {check: (message: unknown, where: string) => void; problem: (text: string) => void};

/**
 * The reader hears every occurrence and outcome on `participant`, and keeps a copy of each owner's families, synced
 * from the owner by name when the seed names one.
 */
export async function follow(participant: Participant, reader: Reader, follows: Seed['follows'], observer: Observer): Promise<void> {
  await participant.subscribe('bunny.event.*.*', message => {
    observer.check(message, 'a message the reader heard');
    reader.messages.push(message);
  }, {onOverflow: () => { reader.gapNotices += 1; }});
  for (const [index, group] of follows.map(groupOf).entries()) {
    const {families, owner} = group;
    const result = await participant.sync(families, change => { changed(reader, index, change, group, observer); }, {timeoutMs: 5000, ...owner === undefined ? {} : {owner}});
    if (result.status === 'rejected') observer.problem(`the reader could not sync ${named(group)}: ${result.error.error.code}`);
    else reader.copies[index] = result.copy;
  }
}

function changed(reader: Reader, index: number, change: SyncChange<Record<string, unknown>>, group: Group, observer: Observer): void {
  switch (change.type) {
    case 'updated':
      observer.check(change.message, 'a synced state');
      return;
    case 'removed':
      return;
    case 'synced':
      observer.check(change.message, 'sync.completed');
      reader.counts[index] = (reader.counts[index] ?? 0) + 1;
      return;
    case 'failed':
      observer.problem(`the reader's copy of ${named(group)} stopped: ${change.error.error.code}`);
      return;
  }
}
