// Only members of these reviewed vocabularies can appear in a browser failure summary.
const entries = [
  'art-backdrop-journey.ts', 'art-notice-journey.ts', 'art-schedule-journey.ts', 'art-selection-journey.ts',
  'art-show-journey.ts', 'art-theme.browser.ts', 'art.browser.ts', 'automation.browser.ts', 'browser.ts',
  'card-consistency.browser.ts', 'card-errors.browser.ts', 'card-watch-run.ts', 'companion-cards.browser.ts',
  'companion-session.browser.ts', 'companions.browser.ts', 'control-projections.ts', 'controls.browser.ts',
  'conversation-art.browser.ts', 'conversation-context.browser.ts', 'conversation-history.browser.ts',
  'conversation-queue.browser.ts', 'conversation-rail.browser.ts', 'conversation-steer.browser.ts',
  'conversation-upload.browser.ts', 'conversation-workspace.browser.ts', 'devices-glass.browser.ts',
  'devices-menu.browser.ts', 'failed-turn.browser.ts', 'habitat.browser.ts', 'home-glass.browser.ts',
  'home-hero.browser.ts', 'home-idle.browser.ts', 'home-layout.browser.ts', 'home-paging.browser.ts',
  'home-shapes.browser.ts', 'hub-mode.browser.ts', 'inbox-history.browser.ts', 'journey-runner.ts',
  'lifx-conversation.browser.ts', 'lighting.browser.ts', 'microduck-vendor.browser.ts', 'microduck.browser.ts',
  'music-capture.browser.ts', 'music-card.browser.ts', 'music-lighting.browser.ts', 'music-visualizer.browser.ts',
  'nanoleaf-pages.browser.ts', 'notice-clear.browser.ts', 'pixoo-card-reread.browser.ts', 'pixoo-cards.browser.ts',
  'pixoo-command-lock.browser.ts', 'pixoo-confirmation.browser.ts', 'pixoo-library.browser.ts',
  'pixoo-monitor.browser.ts', 'pixoo-pages.browser.ts', 'pixoo-player.browser.ts', 'pixoo-playlists.browser.ts',
  'pixoo-settings.browser.ts', 'pixoo-upload.browser.ts', 'playback-artwork.browser.ts',
  'reachy-vendor.browser.ts', 'reachy.browser.ts', 'read-receipts.browser.ts', 'roborock.browser.ts',
  'room-models.browser.ts', 'session-label.browser.ts', 'shell.browser.ts', 'show-conversation.browser.ts',
  'smoke.ts', 'speech.browser.ts', 'test:art-theme:browser', 'test:art:browser', 'test:dashboard:smoke',
  'test:microduck:browser', 'test:observability:browser', 'test:runtime-dashboard:smoke', 'tidbyt-card.browser.ts',
  'timeline-card.browser.ts', 'trusted.ts', 'tv.browser.ts', 'volcano.browser.ts', 'wemo.browser.ts',
  'test:roborock:browser', 'test:volcano:browser', 'test:companions:browser', 'test:wemo:browser', 'test:reachy:browser',
  'wispr.browser.ts',
] as const;

const runnerNames: ReadonlyMap<string, string> = new Map([
  ['Home shapes', 'home-shapes.browser.ts'],
  ['Music capture', 'music-capture.browser.ts'],
  ['Music card', 'music-card.browser.ts'],
  ['Music lighting', 'music-lighting.browser.ts'],
  ['Room models', 'room-models.browser.ts'],
]);

const steps = [
  'Capture Home shape screenshots', 'Capture the microphone baseline', 'Desktop apartment model',
  'Desktop apartment presence', 'Exercise read-only controls', 'Expire an overlap across a wall-clock correction',
  'Fit the longest input alias on a small phone', 'Hold a room-placement save',
  'Keep playback controls stale during disconnect', 'Load Music lighting controls', 'Load the studio model',
  'Measure input from the synthetic producer', 'Open Music on Home and Audio',
  'Open a replacement capture session', 'Open the apartment without WebGL', 'Open the fixtures without WebGL',
  'Phone apartment model', 'Phone apartment presence', 'Pinch to zoom on a phone', 'Play on NL22 panels',
  'Prepare apartment presence', 'Prepare the Home layout and its records', 'Prepare the furnished apartment',
  'Qualify capture timing after a slow sync', 'Read Music from another room page',
  'Reconnect after the lighting stream drops', 'Recover after a stale lighting read',
  'Recover from a lost Start reply', 'Recover the room placement after a lost reply', 'Refuse a microphone source',
  'Restore the apartment after restart', 'Restore the studio after restart', 'Retain the uncertain light command',
  'Retire the saved gate when input stops', 'Select the microphone input', 'Start a light from a saved preset',
  'Stop when the music source disappears', 'convert', 'fit', 'idle', 'launch Chromium', 'long', 'menus', 'modules',
  'opened', 'paging', 'picker', 'recorder', 'results', 'set up the journey', 'short', 'stale',
  'start the simulated world', 'tiles',
] as const;

// Public module IDs for the four runtime Node suites. An unregistered file has no public module ID.
export const nodeModules = {
  runtime: [
    'actions', 'apartment-content', 'apartment-model', 'apartment-publication', 'art-handoff', 'art-plans',
    'art-preparation-conflict', 'art-schedule', 'art-show', 'artwork-content-gateway', 'assistant-dispatch',
    'automation', 'automation-device-follow', 'automation-gateway', 'automation-routes',
    'automation-session-cases', 'automation-state', 'bookkeeping', 'catalog-identity', 'claude-read-plugin',
    'codex-desktop', 'codex-desktop-collector', 'codex-read-core', 'codex-read-publisher',
    'codex-receipt-launcher', 'codex-receipt-macos-launch', 'codex-receipt-observer', 'codex-receipt-proxy',
    'codex-receipt-qualification', 'coding-access', 'coding-dispatch', 'coding-worker', 'coding-worker-adapter',
    'coding-worker-process', 'coding-worker-stream', 'companion-opportunity', 'companion-part', 'companion-speech',
    'companions', 'companions-upgrade-qualification', 'config', 'container-listener', 'context', 'core',
    'core-codex-mac-hooks', 'core-native-sessions', 'core-root-starts', 'core-schemas', 'core-session-cases',
    'core-session-logic', 'core-session-progress', 'core-session-reset', 'core-session-restart',
    'core-session-retention', 'core-store', 'credentials', 'cutover-plan', 'dashboard-page', 'dashboard-trace',
    'device-history', 'diagnostics', 'edge', 'export', 'frontend-build', 'full-disk', 'gateway',
    'harness-real-work', 'harness-steps', 'health', 'history-alarm', 'history-fact-log', 'history-open',
    'history-spans', 'history-window', 'home-layout', 'hook', 'hook-golden', 'inbox-gateway', 'inbox-rule',
    'integration-artwork-faults', 'isolation', 'lag', 'lamp', 'lighting-layout', 'log', 'log-levels', 'manifest',
    'microduck-admission', 'migration-signals', 'mode', 'mode-overrides', 'mode-participants', 'mode-runtime',
    'module-probe', 'moment-refusal', 'music-capture', 'music-capture-access', 'music-capture-calibration',
    'music-capture-gateway', 'music-lighting', 'music-lighting-integration', 'music-lighting-part',
    'music-playback-access', 'nanoleaf', 'nanoleaf-full-disk', 'nanoleaf-migration', 'native-terminal',
    'notice-clear', 'notice-clear-gateway', 'operation-records', 'operations', 'owners', 'pixoo-art',
    'pixoo-migration', 'playback-layout', 'power-limits', 'power-limits-routes', 'power-schedules', 'presence-pro',
    'private-proxy', 'process', 'reachy-admission', 'read-helper', 'read-receipts', 'reference-history',
    'registration', 'remote-hooks', 'roborock', 'roborock-upgrade-profile', 'roborock-upgrade-qualification',
    'room-models', 'runtime-ownership', 'runtime-upgrade-check', 'safe-errors', 'session-label',
    'session-label-gateway', 'shared-device-control', 'sign', 'span-file', 'speech-access', 'speech-live',
    'tracing', 'tracker', 'upgrade-admission', 'upgrade-baseline', 'upgrade-files-provenance', 'upgrade-hooks',
    'upgrade-http', 'upgrade-inputs', 'upgrade-listener', 'upgrade-lock', 'upgrade-owner', 'upgrade-paths',
    'upgrade-preflight', 'upgrade-source', 'volcano-collector', 'volcano-gateway', 'volcano-upgrade-profile',
    'wemo-upgrade-profile', 'wemo-upgrade-qualification', 'wifi-proxy', 'wispr-gateway',
  ],
  scenario: [
    'catalog', 'roborock', 'runner',
  ],
  catalog: [
    'adapter', 'boundaries', 'build', 'clock', 'drain', 'follow', 'guard', 'health', 'home', 'journal', 'migrated',
    'nanoleaf-migrated', 'pixoo-command-limits', 'roborock', 'runs', 'steps', 'supervisor',
  ],
  presence: [
    'contracts', 'module', 'native', 'projection',
  ],
} as const;

const feeds = ['connecting', 'connected', 'reconnecting', 'ended'] as const;
const copies = ['loading', 'syncing', 'synced', 'unavailable'] as const;
const absent = 'not observed';
const from = (allowed: readonly string[], value: unknown): string =>
  typeof value === 'string' && allowed.includes(value) ? value : absent;

export function journeyId(value: unknown): string {
  return from(entries, typeof value === 'string' ? runnerNames.get(value) ?? value : value);
}

export function browserFields(input: {journey?: unknown; step?: unknown; condition?: unknown; feed?: unknown; copies?: unknown}) {
  return {
    journey: journeyId(input.journey), step: from(steps, input.step),
    condition: from(['feed connecting', 'feed connected', 'feed reconnecting', 'feed ended', 'copies synced'], input.condition),
    feed: from(feeds, input.feed), copies: from(copies, input.copies),
  };
}

export function boundedInt(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined;
}

export function nodeFields(input: {suite?: unknown; module?: unknown; line?: unknown; column?: unknown; caseId?: unknown; ordinal?: unknown; duration?: unknown}) {
  const suite = from(Object.keys(nodeModules), input.suite);
  const modules: readonly string[] = Object.hasOwn(nodeModules, suite) ? nodeModules[suite as keyof typeof nodeModules] : [];
  return {suite, module: from(modules, input.module), line: boundedInt(input.line, 1_000_000),
    column: boundedInt(input.column, 100_000), caseId: boundedInt(input.caseId, 1_000_000), ordinal: boundedInt(input.ordinal, 1_000_000),
    duration: boundedInt(input.duration, 86_400_000)};
}

const suites = [
  'container-host', 'release-tests', 'standalone-owners', 'test:agent-state:built',
  'test:agent-state:package:built', 'test:agent-state:python', 'test:app-verify:built',
  'test:app-verify:package:built', 'test:art:built', 'test:codex-desktop:built', 'test:companions:built',
  'test:contracts:built', 'test:dashboard', 'test:events:built', 'test:events:python',
  'test:lifecycle:built', 'test:lifecycle:package:built', 'test:lifecycle:python',
  'test:lifx-module:built', 'test:mcp:built', 'test:mcp:package:built', 'test:mcp:protocol:built',
  'test:microduck:built', 'test:music-producer:built', 'test:music-producer:native',
  'test:nanoleaf:built', 'test:observability:built', 'test:observability:package:built',
  'test:observability:pilot', 'test:observability:python', 'test:observability:query', 'test:pixoo:built',
  'test:playback:built', 'test:reachy:built', 'test:roborock-transport:built',
  'test:roborock-transport:consumer:built', 'test:roborock:built', 'test:roborock:consumer:built',
  'test:runtime-dashboard:built', 'test:sdk:built', 'test:tidbyt-module:built', 'test:tracker-audit',
  'test:verify-host', 'test:volcano:built', 'test:volcano:consumer:built', 'test:weather:built',
  'test:wemo:built', 'test:wispr-module:built', 'test:wispr:built', 'test:wispr:package:built',
  'test:workspace-audit',
];

export const suiteId = (value: unknown): string => from(suites, value);
