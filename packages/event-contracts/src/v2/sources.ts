// The one supported-source definition (Hub #1865, design decision 2). Each supported agent source is defined here once:
// its provider, its clients and the hook names it maps. The `Identity` type, the provider and client enums of the
// `session` and `lifecycle` schemas, the runtime hook adapter's source check and the `core_sessions` tool's provider
// filter derive from it, and `tests/sources.test.mjs` fails when a schema enum differs. A new source is one entry here
// and a new minor version of the families whose enums it widens: the native assistant (Hub #505) widened `session` to 3.1,
// `lifecycle` to 2.2 and the attention and turn occurrences to 2.1. The retained 1.x packages keep their own lists.
//
// Capability facts (documented support, implemented mapping, actual qualification) stay in
// docs/provider-qualification.md; this file records only what the contracts accept and the adapter maps.

const freeze = <T extends readonly string[]>(values: T): T => Object.freeze(values);

/** Every supported source by provider: the clients it reports from and the hooks the adapter maps for it. */
export const SUPPORTED_SOURCES = Object.freeze({
  codex: Object.freeze({
    clients: freeze(['cli', 'desktop', 'local'] as const),
    hooks: freeze(['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd', 'SubagentStart', 'SubagentStop'] as const),
  }),
  claude: Object.freeze({
    clients: freeze(['code'] as const),
    hooks: freeze(['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd',
      'SubagentStart', 'SubagentStop'] as const),
  }),
  // The native B.U.N.N.Y. assistant (Hub #505): an in-process source with no hooks, so the hook adapter never maps it.
  // Its one producer is the companions module (`NATIVE_SOURCE`). It is named from `session/3.1` and `lifecycle/2.2`.
  bunny: Object.freeze({
    clients: freeze(['assistant'] as const),
    hooks: freeze([] as const),
  }),
});

/**
 * The native assistant source (Hub #505): the identity every native task session has apart from its session ID, the task
 * ID, and the one message source that may report it. The core refuses the provider from any other source.
 */
export const NATIVE_SOURCE = Object.freeze({
  provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', producer: 'bunny/modules/companions',
} as const);

type Sources = typeof SUPPORTED_SOURCES;
/** A supported provider. */
export type Provider = keyof Sources;
/** A client of `P`, or of any provider. */
export type Client<P extends Provider = Provider> = Sources[P]['clients'][number];
/** A provider that reports through hooks: every provider but the native assistant (Hub #505). */
export type HookProvider = Exclude<Provider, 'bunny'>;
/** A hook the adapter maps for `P`. */
export type Hook<P extends Provider = Provider> = Sources[P]['hooks'][number];

/** Every provider, in the definition's order. */
export const PROVIDERS: readonly Provider[] = Object.freeze(Object.keys(SUPPORTED_SOURCES) as Provider[]);
/** Every client of any provider, each once, in the definition's order. */
export const CLIENTS: readonly Client[] = Object.freeze([...new Set(PROVIDERS.flatMap(provider => SUPPORTED_SOURCES[provider].clients))]);
/**
 * The providers that report through hooks, which every source was before the native one: the families before
 * `session/3.1`, `lifecycle/2.2` and the 2.1 occurrences name these and their clients only (Hub #505).
 */
export const HOOK_PROVIDERS: readonly Provider[] = Object.freeze(PROVIDERS.filter(provider => SUPPORTED_SOURCES[provider].hooks.length > 0));
/** The clients of the hook providers, each once, in the definition's order. */
export const HOOK_CLIENTS: readonly Client[] = Object.freeze([...new Set(HOOK_PROVIDERS.flatMap(provider => SUPPORTED_SOURCES[provider].clients))]);
/** Whether an identity names the native assistant source (Hub #505). */
export const nativeProvider = (provider: string): boolean => provider === NATIVE_SOURCE.provider;

const providerOf = (provider: string): Provider | undefined =>
  Object.hasOwn(SUPPORTED_SOURCES, provider) ? provider as Provider : undefined;

/** Whether `client` is a client of `provider`. Inherited names such as `constructor` are never providers. */
export function supportedSource(provider: string, client: string): boolean {
  const known = providerOf(provider);
  return known !== undefined && (SUPPORTED_SOURCES[known].clients as readonly string[]).includes(client);
}

/** Whether the adapter maps `hook` for `provider`. */
export function supportedHook(provider: string, hook: string): boolean {
  const known = providerOf(provider);
  return known !== undefined && (SUPPORTED_SOURCES[known].hooks as readonly string[]).includes(hook);
}
