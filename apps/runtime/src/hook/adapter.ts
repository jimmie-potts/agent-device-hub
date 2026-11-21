// The hook adapter (Hub #1865, design decision 1): one hook's JSON and its producer's source configuration become the
// 2.0 `lifecycle` observation that packages/event-contracts/MAPPING.md ("Lifecycle observation") describes, directly,
// with no lifecycle 1.x envelope in between. It is the runtime's copy of agent-state's `normalizeHook` and `enrichHook`
// (packages/agent-state/src/providers.ts at main 6adad7e7) and of the mapping the hook applied to their envelope, moved
// with byte-identical output, which tests/hook-golden.test.ts proves against the retained package. The retained package
// keeps its own copy for apps/hub. The source check comes from the supported-source definition (design decision 2).
// Only allowlisted metadata leaves it: no prompt, response, tool input or transcript content (#425).
import type {Identity, KnownId, LifecycleEvent, LifecycleObservation, Parent, Title} from '@jimmie-potts/event-contracts/v2/families';
import {supportedHook, supportedSource, type Client, type Provider} from '@jimmie-potts/event-contracts/v2/sources';
import type {LifecycleVersion} from './producer.js';
import {projectName, readSessionTitle} from './title.js';

/**
 * The lifecycle 1.x bound, which the earlier path applied to its envelope: 2048 bytes of JSON. That envelope was this
 * observation with an `apiVersion` member first, `"apiVersion":"1.0",` or another version of the same length, and event
 * kinds of the same length, so the observation's bound is that much less.
 */
const MAX_OBSERVATION_BYTES = 2048 - Buffer.byteLength('"apiVersion":"1.0",');
const identifier = /^[A-Za-z0-9_.-]{1,128}(?![\s\S])/;

export type EnrichOptions = {
  /** The producer's lifecycle version: 1.1 adds the title and the project, and 1.2 also the host session. */
  lifecycleVersion: LifecycleVersion;
  /** The hook process's environment, for Claude Desktop's session ID at 1.2; defaults to `process.env`. */
  environment?: unknown;
  /** The Codex home for Codex's thread names; defaults to `CODEX_HOME`, then `~/.codex`. */
  codexHome?: string;
};

type Source = {provider: Provider; client: Client; hostId: string; sourceId: string; hook: string};
type Field = {state: 'missing'} | {state: 'invalid'} | {state: 'value'; value: unknown};

/** A plain object, or null. */
function plain(value: unknown): object | null {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value : null;
  } catch {
    return null;
  }
}

/** An own enumerable data member's value, without invoking an accessor. */
function field(record: object, key: string): Field {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) return {state: 'missing'};
    return descriptor.enumerable === true && 'value' in descriptor ? {state: 'value', value: descriptor.value as unknown} : {state: 'invalid'};
  } catch {
    return {state: 'invalid'};
  }
}

function string(record: object, key: string): string | null {
  const value = field(record, key);
  return value.state === 'value' && typeof value.value === 'string' ? value.value : null;
}

/** The producer's source with the hook's name, when the supported-source definition maps that hook for that source. */
function sourceOf(configuration: unknown, hook: string): Source | null {
  const record = plain(configuration);
  if (!record) return null;
  const provider = string(record, 'provider'), client = string(record, 'client'), hostId = string(record, 'hostId'), sourceId = string(record, 'sourceId');
  if (provider === null || client === null || !supportedSource(provider, client) || !supportedHook(provider, hook)) return null;
  if (hostId === null || sourceId === null || !identifier.test(hostId) || !identifier.test(sourceId)) return null;
  return {provider: provider as Provider, client: client as Client, hostId, sourceId, hook};
}

const identityOf = (source: Source, sessionId: string): Identity =>
  ({provider: source.provider, client: source.client, hostId: source.hostId, sourceId: source.sourceId, sessionId});

const fits = (observation: LifecycleObservation): boolean => Buffer.byteLength(JSON.stringify(observation)) <= MAX_OBSERVATION_BYTES;

/**
 * The observation for one hook, without enrichment, or null when the source does not map the hook or the hook's JSON
 * does not identify a session: what lifecycle 1.0 gives. A child (`agent_id`) is its own session under its known parent,
 * with an unknown turn, since a hook's turn fields describe the parent's invocation.
 */
export function normalizeHook(raw: unknown, configuration: unknown, hook: string, observedAtMs: number): LifecycleObservation | null {
  try {
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) return null;
    const source = sourceOf(configuration, hook), record = plain(raw);
    if (!source || !record) return null;
    const sessionId = string(record, 'session_id');
    if (sessionId === null || !identifier.test(sessionId)) return null;
    const childHook = hook === 'SubagentStart' || hook === 'SubagentStop';
    const child = field(record, 'agent_id');
    let identity: Identity, parent: Parent, turn: KnownId = {status: 'unknown'};
    if (childHook || child.state !== 'missing') {
      if (child.state !== 'value' || typeof child.value !== 'string' || !identifier.test(child.value) || child.value === sessionId) return null;
      identity = identityOf(source, child.value);
      parent = {status: 'known', identity: identityOf(source, sessionId)};
    } else {
      identity = identityOf(source, sessionId);
      parent = {status: 'unknown'};
      const supplied = field(record, source.provider === 'codex' ? 'turn_id' : 'prompt_id');
      if (supplied.state !== 'missing') {
        if (supplied.state !== 'value' || typeof supplied.value !== 'string' || !identifier.test(supplied.value)) return null;
        turn = {status: 'known', id: supplied.value};
      }
    }
    let event: LifecycleEvent;
    switch (hook) {
      case 'SessionStart':
      case 'SubagentStart':
        event = {kind: 'session-started'};
        break;
      case 'UserPromptSubmit':
        event = {kind: 'turn-started'};
        break;
      case 'PermissionRequest':
        event = {kind: 'attention-approval', attention: {status: 'unknown'}};
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        // Hooks block, so the tool and its own dialog finished before this event; tool_response is never read.
        // Only a root dialog on a known turn resolves: child payloads carry no turn.
        const id = string(record, 'tool_use_id');
        if (turn.status !== 'known' || id === null || !identifier.test(id)) return null;
        event = {kind: 'attention-resolved', attention: {status: 'known', id}};
        break;
      }
      case 'Stop':
      case 'SubagentStop':
        event = {kind: 'turn-ended'};
        break;
      case 'Interrupt':
        event = {kind: 'turn-interrupted'};
        break;
      case 'SessionEnd':
        event = {kind: 'runtime-ended'};
        break;
      default:
        return null;
    }
    const observation: LifecycleObservation = {identity, turn, parent, event, observedAtMs, ordering: {status: 'unknown'}};
    return fits(observation) ? observation : null;
  } catch {
    return null;
  }
}

/**
 * Claude Desktop runs Code sessions with its own session ID in the process environment. Read nothing else, and only for
 * the exact Desktop entrypoint; an unusable value is omitted.
 */
function desktopHostSession(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) return undefined;
    const entrypoint = field(environment, 'CLAUDE_CODE_ENTRYPOINT');
    if (entrypoint.state !== 'value' || entrypoint.value !== 'claude-desktop') return undefined;
    const value = field(environment, 'CLAUDE_CODE_HOST_SESSION_ID');
    return value.state === 'value' && typeof value.value === 'string' && identifier.test(value.value) ? value.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The observation with a root's metadata, in the members' order: its title, its project and, at 1.2, its host session.
 * Enrichment never drops the observation to make room: over the bound, the title goes first, then the project, and the
 * host session last.
 */
function withMetadata(observation: LifecycleObservation, metadata: {title?: Title | undefined; project?: string | undefined; hostSessionId?: string | undefined}): LifecycleObservation {
  const result: LifecycleObservation = {
    ...observation,
    ...(metadata.title === undefined ? {} : {title: metadata.title}),
    ...(metadata.project === undefined ? {} : {project: metadata.project}),
    ...(metadata.hostSessionId === undefined ? {} : {hostSessionId: metadata.hostSessionId}),
  };
  for (const key of ['title', 'project', 'hostSessionId'] as const) if (!fits(result)) delete result[key];
  return result;
}

/**
 * The observation for one hook, enriched as the producer's lifecycle version selects, or null when the hook maps to
 * none. A child never inherits its parent's title, project or host session.
 */
export async function enrichHook(raw: unknown, configuration: unknown, hook: string, observedAtMs: number, options: EnrichOptions): Promise<LifecycleObservation | null> {
  const observation = normalizeHook(raw, configuration, hook, observedAtMs);
  // A hook never names the native assistant source (Hub #505): its definition maps no hook.
  if (observation === null || observation.parent.status === 'known' || observation.identity.provider === 'bunny') return observation;
  const record = plain(raw);
  if (!record) return observation;
  const hostSessionId = options.lifecycleVersion === '1.2' && observation.identity.provider === 'claude'
    ? desktopHostSession(Object.hasOwn(options, 'environment') ? options.environment : process.env) : undefined;
  const project = projectName(string(record, 'cwd'));
  const title = await readSessionTitle(observation.identity.provider, observation.identity.sessionId, string(record, 'transcript_path'),
    options.codexHome === undefined ? {} : {codexHome: options.codexHome});
  return withMetadata(observation, {title, project, hostSessionId});
}
