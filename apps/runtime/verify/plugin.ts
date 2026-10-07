// The runtime adapter's plug-in for @jimmie-potts/app-verify (Hub #920). A run serves supervisor.js: the runtime from
// this checkout with `--simulate` and `--edge`, as its shipped entry point with no modules or with the fixture modules,
// over simulated devices the supervisor holds. Capture steps run the catalog's scenarios through the run adapter and
// attach what they observed over HTTP and the SDK. The README beside this file lists the scenarios, steps and checks.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin, type CaptureContext, type CaptureStep, type CheckOutcome, type ProbeContext} from '@jimmie-potts/app-verify';
import {SdkError, connectRemote} from '@jimmie-potts/sdk';
import {HEALTH_PATH} from '../src/index.js';
import {SCENARIOS, expect, runScenario, type Scenario} from '../tests/scenarios/catalog.js';
import {sourceOf} from '../tests/scenarios/parts.js';
import {connectRun, readGrants} from './adapter.js';
import {checkNoOutboundConnections, checkPrivateState, checkSimulatedTransports} from './boundaries.js';
import {ask, followProof} from './follow-proof.js';
import {HARNESS_PATH, type BoundaryReport} from './protocol.js';
import {RUN_SCENARIOS, START_ONLY, seedRun} from './seed.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const supervisor = fileURLToPath(new URL('./supervisor.js', import.meta.url));
const version = (JSON.parse(readFileSync(join(root, 'apps/runtime/package.json'), 'utf8')) as {version: string}).version;

/**
 * The served candidate: the built runtime, its verification run and fixtures, the SDK, the profile, the agent-state
 * owner the core runs with its lifecycle contracts (#831), and the shipped device modules (the playback module, #929,
 * LIFX, #928, and the Pixoo, #843), in a stable order.
 */
export function artifactFiles(at = root): string[] {
  const built = (dir: string, keep: (file: string) => boolean = () => true): string[] => {
    const path = join(at, dir);
    if (!existsSync(path)) return [];
    return readdirSync(path, {recursive: true}).map(String).filter(file => file.endsWith('.js') && keep(file)).sort().map(file => `${dir}/${file}`);
  };
  return [
    ...built('apps/runtime/dist/src'), ...built('apps/runtime/dist/verify', file => !file.startsWith('tests/')),
    ...built('apps/runtime/dist/tests/fixtures'), ...built('apps/runtime/dist/tests/scenarios', file => !file.endsWith('.test.js')),
    ...built('packages/sdk/dist/src'), ...built('packages/event-contracts/dist'),
    // MCP on the gateway (Hub #835): the reused MCP package and the device contracts it validates with.
    ...built('packages/mcp/dist'), ...built('packages/contracts/dist'),
    ...built('packages/agent-state/dist'), ...built('packages/lifecycle-contracts/dist'), ...built('modules/playback/dist/src'), ...built('modules/lifx/dist/src'),
    ...built('modules/tidbyt/dist/src'),
    // The Pixoo module, with its render worker and media child process, which the runtime loads by file.
    ...built('modules/pixoo/dist/src'),
    ...built('modules/nanoleaf/dist/src'),
    // The diagnostic contract's pure entry point, with the catalog and schema it reads, which every record goes through (Hub #903).
    ...built('packages/observability/dist', file => file !== 'node.js'),
    ...['packages/observability/dist/catalog.json', 'packages/observability/dist/record.schema.json'].filter(file => existsSync(join(at, file))),
    // The host adapter that records the runtime's spans (Hub #949), which the package ships as source.
    ...(existsSync(join(at, 'packages/observability/runtime')) ? readdirSync(join(at, 'packages/observability/runtime')) : [])
      .filter(file => file.endsWith('.mjs')).sort().map(file => `packages/observability/runtime/${file}`),
  ];
}

export const BUILD_SOURCES = [
  ':(glob)apps/runtime/src/**', ':(glob)apps/runtime/verify/*.ts', ':(glob)apps/runtime/tests/fixtures/**', ':(glob)apps/runtime/tests/scenarios/**',
  ':(glob)packages/sdk/src/**', ':(glob)packages/app-verify/src/**', ':(glob)packages/event-contracts/src/**', ':(glob)packages/observability/src/**',
  ':(glob)packages/observability/runtime/**',
  ':(glob)packages/agent-state/src/**', ':(glob)packages/lifecycle-contracts/src/**', ':(glob)packages/mcp/src/**', ':(glob)packages/contracts/src/**',
  ':(glob)modules/playback/src/**', ':(glob)modules/lifx/src/**', ':(glob)modules/tidbyt/src/**', ':(glob)modules/pixoo/src/**', ':(glob)modules/nanoleaf/src/**',
];
export const BUILD_OUTPUTS = [
  'apps/runtime/dist/src/main.js', 'apps/runtime/dist/verify/supervisor.js', 'apps/runtime/dist/verify/child.js',
  'apps/runtime/dist/tests/scenarios/catalog.js', 'packages/sdk/dist/src/index.js', 'packages/app-verify/dist/index.js',
  'packages/event-contracts/dist/v2/index.js', 'packages/observability/dist/index.js', 'packages/observability/dist/validator.js',
  'packages/agent-state/dist/index.js', 'packages/lifecycle-contracts/dist/v1.2.js', 'packages/mcp/dist/index.js', 'packages/contracts/dist/index.js',
  'modules/playback/dist/src/index.js', 'modules/lifx/dist/src/index.js', 'modules/tidbyt/dist/src/index.js', 'modules/pixoo/dist/src/index.js',
  'modules/nanoleaf/dist/src/index.js',
];

/** The newest tracked source must be older than the oldest build output the run serves. */
export async function buildCurrent(at = root): Promise<CheckOutcome> {
  const sources = execFileSync('git', ['-C', at, 'ls-files', '-z', '--', ...BUILD_SOURCES], {encoding: 'utf8'}).split('\0').filter(file => file !== '');
  if (sources.length === 0) return {outcome: 'failed', reason: 'no build sources matched; the check cannot vouch for the build'};
  let newest = 0, newestFile = '';
  for (const file of sources) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return {outcome: 'failed', reason: `${file} is missing or unreadable; restore the source and run npm run build`};
    if (time > newest) [newest, newestFile] = [time, file];
  }
  let oldest = Number.POSITIVE_INFINITY;
  for (const file of BUILD_OUTPUTS) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return {outcome: 'failed', reason: `${file} is missing; run npm run build`};
    oldest = Math.min(oldest, time);
  }
  return newest <= oldest ? {outcome: 'passed'} : {outcome: 'failed', reason: `${newestFile} is newer than the build; run npm run build`};
}

/**
 * Refuses, before the core acts, an operation that would reseed a running run into a boundary negative control:
 * `scenario <run-id> <control>` and `handoff <run-id> --reset <control>`. The reseed would fail its boundary check and
 * stop the run; start the control on its own instead. The arguments are read as the core's parser reads them: a `--flag`
 * takes the next argument as its value, and the rest are positionals in order.
 */
export function startOnlyRefusal(argv: readonly string[]): {operation: string; error: string; detail: string} | undefined {
  const [operation = 'help', ...rest] = argv;
  if (operation !== 'scenario' && operation !== 'handoff') return undefined;
  const positional: string[] = [];
  const resets: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? '';
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) continue;
    index += 1;
    if (argument === '--reset') resets.push(value);
  }
  const target = (operation === 'scenario' ? positional.slice(1) : resets).find(name => START_ONLY.includes(name));
  if (target === undefined) return undefined;
  return {
    operation, error: 'start-only-scenario',
    detail: `${target} is a boundary negative control: its start fails a boundary check by design, so reseeding a running run into it would stop the run. Start it on its own with npm run -s verify:runtime -- start --scenario ${target}.`,
  };
}

/** The run's harness endpoint, from the ready line. */
function harnessOf(t: ProbeContext): string {
  const harness = t.endpoints.harness;
  if (harness === undefined) throw new Error('the run announced no harness endpoint');
  return harness;
}

async function boundaries(t: ProbeContext): Promise<BoundaryReport> {
  const response = await fetch(new URL(`${HARNESS_PATH}/boundaries`, harnessOf(t)), {signal: t.signal});
  if (!response.ok) throw new Error(`the harness answered ${response.status}`);
  return await response.json() as BoundaryReport;
}

const CHECKS: readonly [string, (report: BoundaryReport) => CheckOutcome][] = [
  ['simulated-transports', checkSimulatedTransports], ['no-outbound-connections', checkNoOutboundConnections], ['private-state', checkPrivateState],
];

/** Opens the runtime's own health document, at a step's start and again at its end, so the screenshot shows it then. */
async function showHealth(t: CaptureContext): Promise<void> {
  const page = t.page as {goto(url: string): Promise<unknown>};
  await page.goto(new URL(HEALTH_PATH, t.url).href);
}

/** A step's body between two loads of the health page: the screenshot after it shows health as the step left it. */
const onHealth = (body: (t: CaptureContext) => Promise<void>) => async (t: CaptureContext): Promise<void> => {
  await showHealth(t);
  try {
    await body(t);
  } finally {
    await showHealth(t);
  }
};

/** The runtime's origin, where remote parts reach its edge: the run's URL names its health page. */
const originOf = (t: CaptureContext): string => new URL(t.url).origin;

async function boundariesHold(t: CaptureContext): Promise<void> {
  await t.expect('the run stayed inside its boundaries: simulated transports, no outbound connection, its own state', async () => {
    const report = await boundaries(t);
    for (const [, check] of CHECKS) {
      const outcome = check(report);
      if (outcome.outcome !== 'passed') throw new Error(outcome.reason);
    }
  });
}

/** Runs one scenario through the run adapter, attaches its result and expects every step to pass. */
async function judge(t: CaptureContext, scenario: Scenario): Promise<void> {
  const run = await connectRun({url: t.url, harness: harnessOf(t), dataDir: t.dataDir, seed: scenario.seed});
  let result;
  try {
    result = await runScenario(scenario, run);
  } finally {
    await run.close();
  }
  await t.attach('scenario-result.json', JSON.stringify({synthetic: true, physical: false, ...result, problems: run.problems()}, null, 2));
  await t.expect(`the scenario ${scenario.id} passed every step`, () => {
    if (result.outcome !== 'passed') {
      const failed = result.steps.at(-1);
      throw new Error(`${failed?.name ?? 'no step'}: ${failed?.detail ?? ''}`);
    }
  });
  await t.expect('every message the parts saw followed profile 2.0, and no part reported an error', () => {
    if (run.problems().length > 0) throw new Error(run.problems().join('; '));
  });
  await boundariesHold(t);
}

const scenarioSteps: Record<string, CaptureStep> = Object.fromEntries(SCENARIOS.map(scenario => [`scenario-${scenario.id}`, {
  description: `Runs the catalog scenario ${scenario.id} through the run adapter on a freshly seeded run`,
  scenario: scenario.id,
  fresh: true,
  timeoutMs: 120_000,
  run: onHealth(t => judge(t, scenario)),
} satisfies CaptureStep]));

export default definePlugin({
  app: 'runtime',
  repository: 'jimmie-potts/agent-device-hub',
  command: 'npm run -s verify:runtime --',
  root,
  defaultScenario: 'fixtures',
  scenarios: Object.fromEntries(Object.entries(RUN_SCENARIOS).map(([name, {description}]) => [name, {
    description,
    seed: ({dataDir}: {dataDir: string}) => seedRun(dataDir, name),
  }])),
  build: {version, artifact: {files: artifactFiles()}},
  prerequisites: {
    inspect: async () => {
      const build = await buildCurrent();
      return [{
        id: 'app-build', phase: 'launch', status: build.outcome === 'passed' ? 'present' : 'missing',
        reason: build.outcome === 'passed' ? 'build-current' : 'build-missing-or-stale', ...(build.outcome === 'passed' ? {} : {next: 'Run npm run build from the checkout.'}),
      }];
    },
  },
  launch: ({node, dataDir, port, endpointPorts}) => ({
    argv: [node, supervisor, '--data', dataDir, '--port', String(port), '--harness-port', String(endpointPorts.harness ?? 0)],
  }),
  readiness: {
    line: line => {
      try {
        const value = JSON.parse(line) as {event?: unknown; url?: unknown; endpoints?: unknown};
        if (value.event !== 'runtime.ready' || typeof value.url !== 'string') return undefined;
        return {url: value.url, endpoints: value.endpoints as Record<string, string>};
      } catch {
        return undefined;
      }
    },
    probe: async ({url, signal}) => {
      const response = await fetch(new URL(HEALTH_PATH, url), {signal});
      return response.ok ? {ok: true} : {ok: false, reason: `health answered ${response.status}`};
    },
    timeoutMs: 30_000,
    failureCause: tail => /^runtime-start-failed: [a-z0-9-]+$/m.exec(tail)?.[0],
  },
  components: [
    {id: 'runtime', kind: 'actual', note: 'the runtime from this checkout through its own entry (runMain), with --simulate, --edge, --config, --environment test and the run\'s state directory'},
    {id: 'gateway', kind: 'actual', note: 'the runtime\'s gateway on its listener: the SDK edge, /api/v2, MCP, module pages and browser sign-in; each part has a run-generated credential in the run\'s configuration'},
    {id: 'fixture-modules', kind: 'simulated', note: 'the core, with stand-in parts for history and the inbox until #782 and #923, the fixture lamp, chime and sign, the shipped playback, LIFX and Tidbyt modules, and a harness module that reports what the bus publishes'},
    {id: 'devices', kind: 'simulated', note: 'SimulatedLamps, SimulatedChime, SimulatedSigns, SimulatedSpeakers, SimulatedLifx and the Tidbyt module\'s SimulatedCloud in the supervisor, reached over the child\'s IPC channel; they outlive a runtime crash'},
    {id: 'parts', kind: 'simulated', note: 'the scenario\'s hook, operator, panel and reader, remote parts of the capture step'},
  ],
  checks: [
    {id: 'build-current', doctor: true, run: () => buildCurrent()},
    ...CHECKS.map(([id, check]) => ({id, doctor: true, run: async (t: ProbeContext) => check(await boundaries(t))})),
  ],
  captureSteps: {
    'edge-grants': {
      description: 'A remote part with the run\'s grant connects and syncs the core\'s sessions; one without a grant is unauthenticated',
      scenario: 'fixtures',
      fresh: true,
      run: onHealth(async t => {
        const grants = await readGrants(t.dataDir);
        const source = sourceOf('reader');
        const observed: Record<string, unknown> = {synthetic: true};
        await t.expect('a remote part with the run\'s reader grant syncs the core\'s sessions', async () => {
          const remote = await connectRemote({url: originOf(t), source, token: grants.get(source) ?? ''});
          try {
            const synced = await remote.sync(['session', 'inbox-item'], () => {}, {timeoutMs: 5000});
            if (synced.status !== 'synced') throw new Error(`the sync was ${synced.error.error.code}`);
            observed.synced = {families: ['session', 'inbox-item'], revision: synced.message.data.revision, members: synced.message.data.members.length};
            await synced.copy.close();
          } finally {
            await remote.close();
          }
        });
        await t.expect('a remote part without a grant is unauthenticated', async () => {
          const refused = await connectRemote({url: originOf(t), source, token: randomBytes(32).toString('base64url')}).then(
            async remote => { await remote.close(); return 'connected'; },
            (error: unknown) => error instanceof SdkError ? error.body.error.code : 'failed',
          );
          observed.withoutGrant = refused;
          if (refused !== 'unauthenticated') throw new Error(`it was ${refused}`);
        });
        await t.attach('edge-grants.json', JSON.stringify(observed, null, 2));
        await boundariesHold(t);
      }),
    },
    ...scenarioSteps,
    'follow-one-request': {
      description: 'Follows one request through the run\'s journal records and spans in four cases (a success, a refusal, an uncertain effect, a replayed outcome), then one whose runtime was killed, one never sent and one over its limits',
      scenario: 'fixtures',
      fresh: true,
      timeoutMs: 120_000,
      run: onHealth(async t => {
        await followProof(t, harnessOf(t));
        await boundariesHold(t);
      }),
    },
    'control-follow-fails': {
      description: 'Negative control, not a catalog scenario: expects the run to find a request that was never sent, so it must fail',
      scenario: 'fixtures',
      fresh: true,
      run: onHealth(async t => {
        const followed = await ask(harnessOf(t), 'request=never-sent');
        await t.expect('the run found a request that was never sent', () => followed.result === 'found');
      }),
    },
    'control-scenario-fails': {
      description: 'Negative control, not a catalog scenario: expects lamp-1 on though nothing switched it, so it must fail',
      scenario: 'fixtures',
      fresh: true,
      run: onHealth(async t => {
        const seed = {modules: ['core', 'lamp', 'chime'], follows: [['session'], ['lamp']]} as const;
        const run = await connectRun({url: t.url, harness: harnessOf(t), dataDir: t.dataDir, seed});
        try {
          const result = await runScenario({id: 'control-scenario-fails', title: 'negative control', seed, steps: [
            expect('lamp-1 is on', h => h.devices().lamp.power['lamp-1'] === 'on' || `lamp-1 is ${String(h.devices().lamp.power['lamp-1'])}`, 1000),
          ]}, run);
          await t.expect('the scenario passed', () => result.outcome === 'passed');
        } finally {
          await run.close();
        }
      }),
    },
  },
});
