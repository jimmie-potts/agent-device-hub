import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {test} from 'node:test';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {readPrivateFile} from '../src/state.js';
import {inspectUpgradeState} from '../src/upgrade-inputs.js';
import {parseUpgradeRequest} from '../src/upgrade-paths.js';
const run = promisify(execFile);

// The composed checks run in this process against injected readers: each case is a call, not a Node process that imports
// the whole runtime (#1081). The two CLI tests below keep the real process boundary.
type Reader = (...values: never[]) => unknown;
type Readers = Record<string, Reader>;
type Helpers = {
  createRuntimeUpgradePreflight(io: Readers): (request: string, approved?: string) => Promise<unknown>;
  createRuntimeUpgradeRunningCheck(io: Readers): (request: string, plan: string, phase: string) => Promise<unknown>;
};
type Files = {canonical: (value: unknown) => string; sha256: (bytes: string | Buffer) => string};
const helpers = await import(pathToFileURL(join(process.cwd(), 'apps/runtime/bin/runtime-upgrade-preflight.mjs')).href) as Helpers;
const {canonical, sha256} = await import(pathToFileURL(join(process.cwd(), 'apps/hub/dist/install/files.js')).href) as Files;
/** What one composed case returns: the plan or result, or the refusal code, with its reader counts and observation contexts. */
type Outcome = {plan?: unknown; result?: unknown; code?: string; counters: Record<string, number>; observations: unknown[]};
const errorCode = (error: unknown) => (error instanceof Error ? error.message : String(error));
// The readers answer asynchronously, as the installed ones do, so a refusal is a rejection, never a synchronous throw.
const answer = <T>(value: T) => Promise.resolve(value);
const refuse = (message: string) => Promise.reject(new Error(message));

/**
 * Bounds one composed case as the per-case subprocess timeout did, so a hang fails in 10 s. A hang that also holds a handle
 * keeps this test process alive until the CI job's limit. The process is not forced to exit: that would orphan a CLI child
 * that a later test owns and skip its cleanup (#1081 review).
 */
async function bounded<T>(scenario: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`${scenario} did not settle within 10 s`)); }, 10_000); });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `body`, passing everything this process writes to stdout and stderr through while recording it. */
async function written<T>(body: () => Promise<T>): Promise<{value: T; text: string}> {
  const chunks: string[] = [];
  const streams = [process.stdout, process.stderr];
  const originals = streams.map(stream => stream.write.bind(stream));
  streams.forEach((stream, index) => {
    const original = originals[index] as (...values: unknown[]) => boolean;
    stream.write = (chunk: unknown, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return original(chunk, ...rest);
    };
  });
  try {
    return {value: await body(), text: chunks.join('')};
  } finally {
    streams.forEach((stream, index) => { stream.write = originals[index] as typeof stream.write; });
  }
}

/** One composed preflight case over synthetic readers that drift or refuse as `scenario` names. */
async function composedPreflight(root: string, scenario: string): Promise<Outcome> {
  const requestFile = join(root, `request-${scenario}.json`);
  const release = {kind: 'release', sourceRevision: 'a'.repeat(40), version: '0.1.0', archiveSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64)};
  const artifact = {identity: join(root, 'identity'), directory: join(root, 'releases', release.sourceRevision), archive: join(root, 'archive')};
  const request: Record<string, unknown> & {tokenFile: string; installedBaselineClosureFile: string; operation: string; execution: Record<string, unknown>} = {
    schema: 'runtime-upgrade-request/1.0', operation: scenario === 'upgrade' ? 'upgrade' : 'adoption', installationId: 'synthetic', installationRoot: root,
    tokenFile: join(root, 'existing-read-token'), admissionFile: join(root, 'provenance/admission'), installedBaselineClosureFile: join(root, 'provenance/closure'),
    qualificationRevision: release.sourceRevision, releases: {previous: artifact, target: artifact, recovery: artifact},
    formatInventoryFiles: {previous: join(root, 'p'), target: join(root, 't'), recovery: join(root, 'r'), qualification: join(root, 'q')},
    execution: {operationId: 'synthetic', backupDirectory: join(root, 'backups/synthetic'), stopTimeoutMs: 30000,
      postStart: {attempts: 5, timeoutMs: 15000, intervalMs: 500},
      startupEffects: {assessment: {path: join(root, 'provenance/effects'), sha256: 'a'.repeat(64)}, authority: {path: join(root, 'provenance/authority'), sha256: 'b'.repeat(64)}},
      adoption: scenario === 'upgrade' ? null : {draftFile: join(root, 'provenance/draft'), overrideFile: join(root, 'unit.d/anchor.conf'),
        originals: [{path: join(root, 'provenance/original'), sha256: 'c'.repeat(64)}], restoration: {path: join(root, 'provenance/restoration'), sha256: 'd'.repeat(64)}}},
  };
  if (scenario === 'unknown-field') request.observations = {passed: true};
  await writeFile(requestFile, JSON.stringify(request), {mode: 0o600});
  const owner = {service: 'bunny-runtime.service', pid: 123, startTicks: '100', options: {port: 8788, stateDir: join(root, 'state'), config: join(root, 'config'),
    edge: true, simulate: false, environment: 'production', lagLimitMs: 10000}};
  const listener = {pid: 123, inode: 'socket-1'};
  const stamp = {schema: 'runtime-build/2.0', revision: release.sourceRevision, version: '0.1.0', dirty: false, builtAt: '2026-10-09T00:00:00.000Z'};
  const source = {expected: {installationId: 'synthetic', provenanceDirectory: join(root, 'provenance'), releases: {previous: release, target: release, recovery: release}, formats: {}},
    stamps: {previous: stamp, target: stamp, recovery: stamp}, inputs: [] as unknown[],
    artifacts: {previous: {identity: release, root: artifact.directory, entries: [] as {path: string; kind: string; sha256: string}[]},
      target: {root: artifact.directory, entries: [] as {path: string; kind: string; sha256: string}[]},
      recovery: {root: artifact.directory, entries: [] as {path: string; kind: string; sha256: string}[]}}};
  const admission = {schema: 'runtime-proof-admission/1.0', admissionSha256: 'd'.repeat(64),
    coveredOwners: ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox'],
    installedBaselineClosure: {path: request.installedBaselineClosureFile, sha256: 'e'.repeat(64)}};
  const configured = ['codex-desktop', 'lifx', 'nanoleaf', 'pixoo', 'playback', 'tidbyt'];
  type Row = {name: string; apiVersion: string; state: string; healthy: boolean; reasonCode: string | null};
  const health = {schema: 'runtime-health/1.0', status: 'degraded', moduleApiVersion: MODULE_API_VERSION, startedAtMs: 1000, lagCheck: {status: 'active', limitMs: 10000},
    modules: [...['core', ...configured].map((name): Row => ({name, apiVersion: MODULE_API_VERSION, state: 'running', healthy: true, reasonCode: null})),
      {name: 'wispr', apiVersion: MODULE_API_VERSION, state: 'refused', healthy: false, reasonCode: 'not-found'} as Row].sort((a, b) => a.name.localeCompare(b.name))};
  for (const name of ['bb8', 'roborock', 'onn']) {
    if (!scenario.startsWith(`${name}-`) && scenario !== `configured-${name}`) continue;
    health.modules.push({name, apiVersion: MODULE_API_VERSION, state: scenario === `${name}-running` ? 'running' : 'refused', healthy: scenario === `${name}-healthy`,
      reasonCode: scenario === `${name}-wrong-reason` ? 'unavailable' : 'not-found'});
    if (scenario === `${name}-wrong-status`) health.status = 'ok';
    if (scenario === `configured-${name}`) configured.push(name);
  }
  const pixoo = health.modules.find(row => row.name === 'pixoo');
  if (scenario === 'configured-refusal' && pixoo !== undefined) {pixoo.state = 'refused'; pixoo.healthy = false;}
  if (scenario === 'unknown-module') health.modules.push({name: 'unknown-module', apiVersion: MODULE_API_VERSION, state: 'refused', healthy: false, reasonCode: 'not-found'});
  if (scenario === 'stopped-watchdog') health.lagCheck.status = 'stopped';
  if (scenario === 'configured-wispr') configured.push('wispr');
  const realCompanionState = scenario.startsWith('companions-real-');
  if (realCompanionState) configured.push('companions');
  await writeFile(owner.options.config, JSON.stringify({schema: 'runtime-config/1.0',
    edge: {credentials: join(root, 'credentials')},
    modules: realCompanionState ? Object.fromEntries(configured.map(name => [name, {}])) : {}}), {mode: 0o600});
  if (realCompanionState) {
    const modules = join(owner.options.stateDir, 'modules');
    await mkdir(modules, {recursive: true, mode: 0o700});
    await writeFile(join(modules, 'core.sqlite'), 'opaque synthetic core state', {mode: 0o600});
    if (scenario === 'companions-real-present-state') {
      await writeFile(join(modules, 'companions.sqlite'), 'opaque synthetic companion state', {mode: 0o600});
    } else {
      await rm(join(modules, 'companions.sqlite'), {force: true});
    }
  }
  await writeFile(request.tokenFile, 'synthetic-secret-never-public', {mode: 0o600});
  await writeFile(join(root, 'credentials'), 'synthetic credential inventory', {mode: 0o600});
  const configSha256 = sha256(await readPrivateFile(owner.options.config, 1024 * 1024));
  const credentialsSha256 = sha256(await readPrivateFile(join(root, 'credentials'), 65536));
  const state = {configSha256, configured, durableOwners: ['core', 'lifx', 'nanoleaf', 'pixoo', 'playback', 'tidbyt']};
  if (scenario.startsWith('companions-')) {
    for (const artifact of Object.values(source.artifacts)) {
      artifact.entries.push({path: 'modules/companions/package.json', kind: 'file', sha256: 'f'.repeat(64)});
    }
    state.durableOwners.push('companions'); state.durableOwners.sort();
    if (scenario !== 'companions-no-proof') admission.coveredOwners.push('companions');
    health.modules.push({name: 'companions', apiVersion: MODULE_API_VERSION, state: 'running', healthy: true, reasonCode: null});
    const row = health.modules.at(-1); assert.ok(row);
    if (scenario === 'companions-no-baseline-code') source.artifacts.previous.entries = [];
    if (scenario === 'companions-no-recovery-code') source.artifacts.recovery.entries = [];
    if (scenario === 'companions-no-target-code') source.artifacts.target.entries = [];
    if (scenario === 'companions-no-state') state.durableOwners.splice(state.durableOwners.indexOf('companions'), 1);
    if (scenario === 'companions-no-inventory') Reflect.deleteProperty(source.artifacts.target, 'entries');
    if (scenario === 'companions-missing-row') health.modules.pop();
    if (scenario === 'companions-duplicate-row') health.modules.push({...row});
    if (scenario === 'companions-stopped') row.state = 'stopped';
    if (scenario === 'companions-unhealthy') row.healthy = false;
    if (scenario === 'companions-reason') row.reasonCode = 'unavailable';
    if (scenario === 'companions-refused') {row.state = 'refused'; row.healthy = false; row.reasonCode = 'not-found';}
    if (scenario === 'companions-introduced') {
      // Distinct verified roles model an older baseline without this owner.
      source.artifacts.previous.entries = [];
      state.durableOwners.splice(state.durableOwners.indexOf('companions'), 1);
      health.modules.pop();
      const target = {...release, sourceRevision: 'd'.repeat(40), archiveSha256: 'e'.repeat(64)};
      const recovery = {...release, sourceRevision: 'f'.repeat(40), archiveSha256: '9'.repeat(64)};
      source.expected.releases.target = target; source.expected.releases.recovery = recovery;
      source.stamps.target = {...stamp, revision: target.sourceRevision};
      source.stamps.recovery = {...stamp, revision: recovery.sourceRevision};
      source.artifacts.target.root = join(root, 'target'); source.artifacts.recovery.root = join(root, 'recovery');
      const paths = request.releases as Record<string, typeof artifact>;
      paths.target = {...artifact, directory: source.artifacts.target.root, identity: join(root, 'target-identity')};
      paths.recovery = {...artifact, directory: source.artifacts.recovery.root, identity: join(root, 'recovery-identity')};
      await writeFile(requestFile, JSON.stringify(request), {mode: 0o600});
    }
  }
  if (['onn-qualified', 'onn-retained-qualified', 'onn-missing-coverage', 'onn-retained-missing-coverage', 'onn-missing-state'].includes(scenario) || scenario.startsWith('onn-bb8-')) {
    const retainedOnly = scenario.startsWith('onn-retained-') || scenario === 'onn-bb8-retained';
    if (!retainedOnly) configured.push('onn');
    if (scenario !== 'onn-missing-state') state.durableOwners.push('onn');
    if (!scenario.includes('missing-coverage') && scenario !== 'onn-bb8-no-onn-proof') admission.coveredOwners.push('onn');
    const row = health.modules.find(value => value.name === 'onn');
    assert.ok(row);
    if (!retainedOnly) {row.state = 'running'; row.healthy = true; row.reasonCode = null;}
  }
  if (scenario.startsWith('selected-bb8') || scenario.startsWith('retained-bb8') || scenario.startsWith('onn-bb8-')) {
    const retained = scenario.startsWith('retained-bb8') || scenario === 'onn-bb8-retained';
    if (!retained) configured.push('bb8');
    state.durableOwners.push('bb8');
    const refused = scenario.endsWith('-refused');
    health.modules.push({name: 'bb8', apiVersion: MODULE_API_VERSION,
      state: retained || refused ? 'refused' : 'running',
      healthy: !retained && !refused && !scenario.endsWith('-unhealthy'),
      reasonCode: retained || refused ? 'not-found' : null});
    if (!scenario.endsWith('-no-proof')) {
      if (!scenario.endsWith('-no-linux-proof')) admission.coveredOwners.push('bb8');
      if (!scenario.endsWith('-no-windows-proof')) admission.coveredOwners.push('bb8-windows');
    }
  }
  if (scenario.endsWith('-onn-absent')) {
    health.modules.push({name: 'onn', apiVersion: MODULE_API_VERSION, state: 'refused', healthy: false, reasonCode: 'not-found'});
  }
  const counters: Record<string, number> = {owner: 0, listener: 0, source: 0, admission: 0, baseline: 0, paths: 0, hooks: 0, state: 0, receipts: 0, http: 0, lock: 0, execution: 0};
  const count = (name: string) => (counters[name] = (counters[name] ?? 0) + 1);
  let afterHttp = false;
  const observations: unknown[] = [];
  const drift = (name: string, n: number) => (scenario === `${name}-drift` && n > 1) || (scenario === `late-${name}-drift` && (counters.http ?? 0) > 1);
  const io: Readers = {
    privateFile: readPrivateFile, parseRequest: parseUpgradeRequest, canonical, sha256,
    execution: () => answer(drift('execution', count('execution')) ? {...request.execution, stopTimeoutMs: 10000} : request.execution),
    lock: () => { count('lock'); return scenario === 'missing-lock' ? refuse('missing') : answer(undefined); },
    owner: () => { count('owner'); return answer(scenario === 'owner-drift' && afterHttp ? {...owner, pid: 124} : owner); },
    listener: () => { count('listener'); return answer(scenario === 'listener-drift' && afterHttp ? {...listener, inode: 'socket-2'} : listener); },
    source: () => answer(drift('source', count('source')) ? {...source, inputs: [{changed: true}]} : source),
    admission: () => answer(drift('admission', count('admission')) ? {...admission, admissionSha256: '0'.repeat(64)} : admission),
    baseline: () => answer({baselineRoot: drift('baseline', count('baseline')) ? join(root, 'changed-baseline') : artifact.directory,
      closureSha256: admission.installedBaselineClosure.sha256}),
    config: () => answer({edge: {credentials: join(root, 'credentials')}, modules: {}}),
    paths: () => answer({selection: {kind: drift('paths', count('paths')) ? 'changed' : request.operation === 'adoption' ? 'absent' : 'previous'}}),
    hooks: () => answer({closureSha256: admission.installedBaselineClosure.sha256, hooks: drift('hook', count('hooks')) ? [{changed: true}] : []}),
    state: async () => {
      const n = count('state');
      if (realCompanionState) return inspectUpgradeState(owner.options.stateDir, owner.options.config);
      if (scenario === 'request-drift' && n > 1) await writeFile(requestFile, JSON.stringify({...request, tokenFile: join(root, 'changed-token')}));
      return drift('state', n) ? {...state, durableOwners: [...state.durableOwners, 'unknown']} : state;
    },
    receipts: () => answer(drift('receipt', count('receipts')) ? [{name: 'new.json', sha256: '0'.repeat(64)}] : []),
    http: async (_observed: unknown, token: string, _expected: unknown, recheck: () => Promise<void>, context: unknown) => {
      observations.push(context);
      const n = count('http');
      if (token !== request.tokenFile) throw new Error('wrong token selection');
      await recheck();
      afterHttp = true;
      if (n > 1 && scenario === 'token-drift') await writeFile(request.tokenFile, 'changed synthetic secret');
      if (n > 1 && scenario === 'credentials-drift') await writeFile(join(root, 'credentials'), 'changed synthetic inventory');
      if (n > 1 && scenario === 'config-drift') await writeFile(owner.options.config, JSON.stringify({changed: true}));
      const result = {build: stamp, health, configSha256: state.configSha256, credentialsSha256};
      return scenario === 'health-drift' && n > 1 ? {...result, health: {...health, lagCheck: {status: 'stopped', limitMs: 10000}}} : result;
    },
  };
  const preflight = helpers.createRuntimeUpgradePreflight(io);
  try {
    let plan = await preflight(requestFile);
    if (['locked', 'wrong-plan', 'missing-lock'].includes(scenario)) {
      const approved = join(root, `approved-${scenario}.json`);
      const reviewed = plan as Record<string, unknown>;
      await writeFile(approved, JSON.stringify(scenario === 'wrong-plan' ? {...reviewed, planSha256: '0'.repeat(64)} : reviewed), {mode: 0o600});
      plan = await preflight(requestFile, approved);
    }
    return {plan, counters, observations};
  } catch (error) {
    return {code: errorCode(error), counters, observations};
  }
}

void test('composed upgrade preflight binds original observations and the exact locked plan', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-preflight-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  type Planned = {plan: {operation: string; planSha256: string}; counters: {http: number; lock: number}; observations: {operationId: string; trace: {traceparent: string}}[]};
  const inspect = (scenario: string) => bounded(scenario, composedPreflight(root, scenario));
  const first = await inspect('adoption') as Planned;
  // Neither the outcome nor anything the case writes holds the read token, as the subprocess's stdout did not.
  const shown = await written(() => inspect('adoption'));
  assert.ok(!JSON.stringify(shown.value).includes('synthetic-secret-never-public'));
  assert.ok(!shown.text.includes('synthetic-secret-never-public'));
  assert.equal((await inspect('bb8-absent') as Planned).plan.operation, 'adoption');
  assert.equal((await inspect('selected-bb8') as Planned).plan.operation, 'adoption');
  assert.equal((await inspect('retained-bb8') as Planned).plan.operation, 'adoption');
  for (const scenario of ['selected-bb8-onn-absent', 'retained-bb8-onn-absent']) {
    const mixed = await inspect(scenario) as Planned & {code?: string};
    assert.equal(mixed.code, undefined, `${scenario} preserves both qualified profiles`);
    assert.equal(mixed.plan.operation, 'adoption');
    assert.equal(mixed.counters.http, 2);
  }
  assert.equal((await inspect('roborock-absent') as Planned).plan.operation, 'adoption');
  const absentOnn = await inspect('onn-absent') as Planned & {code?: string};
  assert.equal(absentOnn.code, undefined, 'exact absent ONN health remains eligible');
  assert.equal(absentOnn.plan.operation, 'adoption');
  assert.equal(absentOnn.counters.http, 2);
  const companion = await inspect('companions-qualified') as Planned & {code?: string};
  assert.equal(companion.code, undefined, 'covered always-shipped companions uses ordinary running health');
  assert.equal(companion.counters.http, 2);
  const introduced = await inspect('companions-introduced') as Planned & {code?: string};
  assert.equal(introduced.code, undefined, 'a qualified first introduction does not fabricate current companion health/state');
  assert.equal(introduced.counters.http, 2);
  const unqualifiedCompanion = await inspect('companions-no-proof');
  assert.equal(unqualifiedCompanion.code, 'runtime-upgrade-preflight-refused');
  assert.equal(unqualifiedCompanion.counters.http, 0, 'missing companion qualification refuses before observation');
  for (const scenario of ['companions-no-baseline-code', 'companions-no-recovery-code', 'companions-no-target-code',
    'companions-no-state', 'companions-no-inventory']) {
    const missing = await inspect(scenario);
    assert.equal(missing.code, 'runtime-upgrade-preflight-refused', scenario);
    assert.equal(missing.counters.http, 0, 'unqualified companion roles refuse before authenticated observation');
  }
  for (const scenario of ['companions-missing-row', 'companions-duplicate-row', 'companions-stopped',
    'companions-unhealthy', 'companions-reason', 'companions-refused']) {
    const unsafe = await inspect(scenario);
    assert.equal(unsafe.code, 'runtime-upgrade-preflight-refused', scenario);
    assert.equal(unsafe.counters.http, 1, 'unsafe health refuses at its first observation');
  }
  for (const scenario of ['onn-qualified', 'onn-retained-qualified', 'onn-bb8-qualified', 'onn-bb8-retained']) {
    const qualified = await inspect(scenario) as Planned & {code?: string};
    assert.equal(qualified.code, undefined, scenario);
    assert.equal(qualified.plan.operation, 'adoption');
    assert.equal(qualified.counters.http, 2);
  }
  for (const scenario of ['onn-missing-coverage', 'onn-retained-missing-coverage', 'onn-missing-state', 'onn-bb8-no-onn-proof', 'onn-bb8-no-windows-proof']) {
    const missing = await inspect(scenario);
    assert.equal(missing.code, 'runtime-upgrade-preflight-refused', scenario);
    assert.equal(missing.counters.http, 0, 'missing qualification refuses before authenticated observation');
  }
  assert.equal(first.plan.operation, 'adoption'); assert.match(first.plan.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.counters.http, 2); assert.equal(first.counters.lock, 0);
  assert.equal(first.observations.length, 2);
  assert.deepEqual(first.observations[0], first.observations[1]);
  assert.equal(first.observations[0]?.operationId, 'synthetic');
  assert.match(first.observations[0]?.trace.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.ok(!JSON.stringify(first.plan).includes('traceparent'));
  const actualCompanion = await inspect('companions-real-present-state');
  assert.equal(actualCompanion.code, undefined, 'configured physical companion store passes the real inventory reader');
  const missingCompanion = await inspect('companions-real-missing-state');
  assert.equal(missingCompanion.code, 'runtime-upgrade-preflight-refused');
  assert.equal(missingCompanion.counters.http, 0, 'configured missing state refuses before authenticated observation');
  const repeated = await inspect('adoption') as Planned;
  assert.equal(first.plan.planSha256, repeated.plan.planSha256);
  assert.notEqual(first.observations[0]?.trace.traceparent, repeated.observations[0]?.trace.traceparent);
  assert.equal((await inspect('upgrade') as Planned).plan.operation, 'upgrade');
  const locked = await inspect('locked') as Planned & {code?: string};
  assert.equal(locked.code, undefined, 'the approved plan is accepted under the lock');
  assert.match(locked.plan.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(locked.counters.lock, 2);
  for (const scenario of ['unknown-field','execution-drift','late-execution-drift','owner-drift','listener-drift','source-drift','admission-drift','baseline-drift','paths-drift','hook-drift','state-drift','receipt-drift','request-drift',
    'late-source-drift','late-admission-drift','late-baseline-drift','late-paths-drift','late-hook-drift','late-state-drift','late-receipt-drift','token-drift','credentials-drift','config-drift','configured-refusal','unknown-module','configured-wispr','configured-bb8','bb8-running','bb8-healthy','bb8-wrong-reason','bb8-wrong-status','selected-bb8-no-linux-proof','selected-bb8-no-windows-proof','selected-bb8-unhealthy','selected-bb8-refused','retained-bb8-no-proof','configured-roborock','roborock-running','roborock-healthy','roborock-wrong-reason','roborock-wrong-status','configured-onn','onn-running','onn-healthy','onn-wrong-reason','onn-wrong-status','stopped-watchdog','health-drift','wrong-plan','missing-lock']) {
    await t.test(scenario + ' refuses', async () => {
      const result = await inspect(scenario);
      assert.equal(result.plan, undefined, `${scenario} returned a plan`);
      assert.equal(result.code, 'runtime-upgrade-preflight-refused');
      if (scenario === 'unknown-field') assert.equal(result.counters.owner, 0);
      if (scenario === 'missing-lock') {assert.equal(result.counters.http, 2); assert.equal(result.counters.lock, 1);}
    });
  }
});

void test('production preflight CLI rejects unknown request fields before installed observation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-preflight-cli-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const input = join(root, 'request.json');
  await writeFile(input, JSON.stringify({observations: {passed: true}}), {mode: 0o600});
  await assert.rejects(run(process.execPath, ['apps/runtime/bin/runtime-upgrade-check.mjs', 'plan', input], {cwd: process.cwd(), timeout: 10000}), (error: unknown) => {
    const value = error as {stdout: string; stderr: string};
    assert.equal(value.stdout, '');
    assert.deepEqual(JSON.parse(value.stderr), {code: 'runtime-upgrade-preflight-refused', verified: false});
    assert.ok(!value.stderr.includes(input)); return true;
  });
});

/** One post-start running check over synthetic readers that drift or refuse as `scenario` names. */
async function runningCheck(root: string, scenario: string,
  phase = ['recovery', 'reupgrade'].includes(scenario) ? scenario : 'candidate'): Promise<Outcome> {
  const requestFile = join(root, 'request'), planFile = join(root, 'plan');
  const request = {operation: 'upgrade', installationId: 'synthetic', installationRoot: root, tokenFile: join(root, 'token'), admissionFile: join(root, 'admission'),
    installedBaselineClosureFile: join(root, 'closure'), execution: {operationId: 'one', postStart: {attempts: 2, timeoutMs: 10000, intervalMs: 100}, adoption: null}};
  const options = {environment: 'production', simulate: false, edge: true, config: join(root, 'config'), stateDir: join(root, 'state'), port: 8788, lagLimitMs: 10000};
  const entry = join(root, 'current/apps/runtime/dist/src/main.js');
  const original = {service: 'bunny-runtime.service', pid: 100, startTicks: '10', startMonotonic: '20', controlGroup: '/user/runtime', executable: '/node', entry,
    cwd: join(root, 'previous'), argv: ['/node', entry, '--edge'], units: ['/service'], options};
  const owner = {...original, pid: 101, startTicks: '11', startMonotonic: '21', cwd: join(root, phase === 'recovery' ? 'previous' : 'target')};
  const identity = (revision: string) => ({sourceRevision: revision, version: '0.1.0'});
  const stamp = (revision: string) => ({schema: 'runtime-build/2.0', revision, version: '0.1.0', dirty: false, builtAt: '2026-10-09T00:00:00.000Z'});
  const revisions = {previous: 'a'.repeat(40), target: 'b'.repeat(40), recovery: 'a'.repeat(40)};
  const expected = {releases: {previous: identity(revisions.previous), target: identity(revisions.target), recovery: identity(revisions.recovery)}};
  const stamps = {previous: stamp(revisions.previous), target: stamp(revisions.target), recovery: stamp(revisions.recovery)};
  const source = {expected, stamps, inputs: [] as unknown[],
    artifacts: {previous: {root: join(root, 'previous'), identity: expected.releases.previous, entries: [] as {path: string; kind: string; sha256: string}[]},
      target: {root: join(root, 'target'), entries: [] as {path: string; kind: string; sha256: string}[]},
      recovery: {root: join(root, 'previous'), entries: [] as {path: string; kind: string; sha256: string}[]}}};
  const realCompanionState = scenario.startsWith('companions-real-');
  const configText = realCompanionState
    ? JSON.stringify({schema: 'runtime-config/1.0', edge: {credentials: join(root, 'credentials')}, modules: {companions: {}}})
    : 'config';
  const state = {configured: realCompanionState ? ['companions'] : scenario === 'configured-onn' ? ['onn'] : [],
    durableOwners: ['core'], configSha256: sha256(configText)};
  const admission = {installedBaselineClosure: {path: request.installedBaselineClosureFile, sha256: 'd'.repeat(64)},
    coveredOwners: ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox']};
  const health = {status: 'ok', moduleApiVersion: MODULE_API_VERSION, lagCheck: {status: 'active', limitMs: 10000},
    modules: [{name: 'core', state: 'running', healthy: true, reasonCode: null as string | null}]};
  if (scenario.startsWith('selected-bb8') || scenario.startsWith('retained-bb8') || scenario.startsWith('onn-bb8-')) {
    const retained = scenario.startsWith('retained-bb8') || scenario === 'onn-bb8-retained', refused = scenario.endsWith('-refused');
    state.durableOwners.push('bb8');
    if (!retained) state.configured.push('bb8');
    const healthy = !retained && !refused && !scenario.endsWith('-unhealthy');
    health.modules.push({name: 'bb8', state: retained || refused ? 'refused' : 'running', healthy,
      reasonCode: retained || refused ? 'not-found' : null});
    if (!healthy) health.status = 'degraded';
    if (!scenario.endsWith('-no-proof')) {
      if (!scenario.endsWith('-no-linux-proof')) admission.coveredOwners.push('bb8');
      if (!scenario.endsWith('-no-windows-proof')) admission.coveredOwners.push('bb8-windows');
    }
  }
  const qualifiedOnn = ['onn-qualified', 'onn-retained-qualified', 'onn-missing-coverage', 'onn-retained-missing-coverage', 'onn-missing-state'].includes(scenario) || scenario.startsWith('onn-bb8-');
  if (qualifiedOnn) {
    if (!scenario.startsWith('onn-retained-') && scenario !== 'onn-bb8-retained') state.configured.push('onn');
    if (scenario !== 'onn-missing-state') state.durableOwners.push('onn');
    if (!scenario.includes('missing-coverage') && scenario !== 'onn-bb8-no-onn-proof') admission.coveredOwners.push('onn');
  }
  const companion = scenario.startsWith('companions-');
  if (companion) {
    for (const artifact of Object.values(source.artifacts)) {
      artifact.entries.push({path: 'modules/companions/package.json', kind: 'file', sha256: 'f'.repeat(64)});
    }
    state.durableOwners.push('companions'); state.durableOwners.sort();
    if (scenario !== 'companions-no-proof') admission.coveredOwners.push('companions');
    health.modules.push({name: 'companions', state: 'running', healthy: true, reasonCode: null});
    const row = health.modules.at(-1); assert.ok(row);
    if (scenario === 'companions-no-recovery-code') source.artifacts.recovery.entries = [];
    if (scenario === 'companions-missing-row') health.modules.pop();
    if (scenario === 'companions-duplicate-row') health.modules.push({...row});
    if (scenario === 'companions-stopped') row.state = 'stopped';
    if (scenario === 'companions-unhealthy') row.healthy = false;
    if (scenario === 'companions-reason') row.reasonCode = 'unavailable';
    if (scenario === 'companions-refused') {row.state = 'refused'; row.healthy = false; row.reasonCode = 'not-found'; health.status = 'degraded';}
    if (scenario.startsWith('companions-introduced')) {
      source.artifacts.previous.entries = [];
      state.durableOwners.splice(state.durableOwners.indexOf('companions'), 1);
      revisions.recovery = 'c'.repeat(40);
      expected.releases.recovery = identity(revisions.recovery); stamps.recovery = stamp(revisions.recovery);
      source.artifacts.recovery.root = join(root, 'recovery');
      if (phase === 'recovery') owner.cwd = source.artifacts.recovery.root;
    }
  }
  const baseline = {baselineRoot: join(root, 'previous')}, hooks = {hooks: []}, paths = {protectedPaths: []};
  await writeFile(requestFile, JSON.stringify(request), {mode: 0o600});
  await writeFile(request.tokenFile, 'synthetic private token', {mode: 0o600});
  await writeFile(options.config, configText, {mode: 0o600});
  if (realCompanionState) {
    const modules = join(options.stateDir, 'modules');
    await mkdir(modules, {recursive: true, mode: 0o700});
    await writeFile(join(modules, 'core.sqlite'), 'opaque synthetic core state', {mode: 0o600});
    if (scenario === 'companions-real-present-state') {
      await writeFile(join(modules, 'companions.sqlite'), 'opaque synthetic companion state', {mode: 0o600});
    } else {
      await rm(join(modules, 'companions.sqlite'), {force: true});
    }
  }
  await writeFile(join(root, 'credentials'), 'credentials', {mode: 0o600});
  const body = {schema: 'runtime-upgrade-plan/1.0', eligibility: 'eligible-under-coordinator-admission', requestSha256: sha256(await readFile(requestFile)),
    operation: request.operation, installationId: request.installationId, execution: request.execution, owner: original, paths, baseline, hooks, state,
    source: {expected, stamps}, admission,
    privateInputs: {configSha256: sha256(configText), credentialsSha256: sha256('credentials'), readTokenSha256: sha256('synthetic private token')}};
  const plan = {...body, planSha256: scenario === 'wrong-plan-hash' ? '0'.repeat(64) : sha256(canonical(body))};
  await writeFile(planFile, JSON.stringify(plan), {mode: 0o600});
  const counters: Record<string, number> = {owner: 0, http: 0, selection: 0, lock: 0};
  const count = (name: string) => (counters[name] = (counters[name] ?? 0) + 1);
  const observations: unknown[] = [];
  if (scenario.startsWith('onn-') || scenario === 'configured-onn' || scenario.endsWith('-onn-absent')) {
    health.status = scenario === 'onn-wrong-status' ? 'ok' : 'degraded';
    health.modules.push({name: 'onn', state: scenario === 'onn-running' ? 'running' : 'refused',
      healthy: scenario === 'onn-healthy', reasonCode: scenario === 'onn-wrong-reason' ? 'unavailable' : 'not-found'});
  }
  if (qualifiedOnn) {
    const retainedOnly = scenario.startsWith('onn-retained-') || scenario === 'onn-bb8-retained';
    const row = health.modules.find(value => value.name === 'onn');
    assert.ok(row);
    if (!retainedOnly) {row.state = 'running'; row.healthy = true; row.reasonCode = null; health.status = 'ok';}
  }
  if (scenario === 'unknown-module') health.modules.push({name: 'unknown-module', state: 'refused', healthy: false, reasonCode: 'not-found'});
  const io: Readers = {
    privateFile: (path: string) => readFile(path), parseRequest: (value: unknown) => value, canonical, sha256,
    lock: () => { count('lock'); return scenario === 'missing-lock' ? refuse('no') : answer(undefined); },
    execution: () => answer(request.execution),
    source: () => answer(scenario === 'source-drift' && (counters.http ?? 0) > 1 ? {...source, inputs: [{changed: true}]} : source),
    admission: () => answer(admission), baseline: () => answer(baseline),
    hooks: () => answer(scenario === 'hook-drift' && (counters.http ?? 0) > 1 ? {hooks: [{changed: true}]} : hooks),
    state: () => {
      if (realCompanionState) return inspectUpgradeState(options.stateDir, options.config);
      if (!scenario.startsWith('companions-introduced')) return answer(state);
      const owners = [...state.durableOwners, 'companions'];
      if (scenario === 'companions-introduced-missing-state') owners.pop();
      if (scenario === 'companions-introduced-unrelated-owner') owners.push('unknown');
      if (scenario === 'companions-introduced-lost-owner') owners.splice(owners.indexOf('core'), 1);
      return answer({...state, durableOwners: owners.sort()});
    },
    config: () => answer({edge: {credentials: join(root, 'credentials')}}),
    owner: () => {
      count('owner');
      if (scenario === 'same-process') return answer(original);
      if (scenario === 'wrong-arguments') return answer({...owner, argv: [...owner.argv, '--simulate']});
      if (scenario === 'owner-drift' && (counters.http ?? 0) > 0) return answer({...owner, pid: 102});
      return answer(owner);
    },
    listener: (pid: number) => answer({pid, inode: 'one'}),
    runningPaths: (_request: unknown, _observed: unknown, _approved: unknown, selected: unknown) => {
      count('selection');
      if (scenario === 'wrong-selection' || (scenario === 'late-selection-drift' && (counters.http ?? 0) > 1)) return refuse('wrong selection');
      return answer({target: selected});
    },
    http: async (_observed: unknown, _token: unknown, _expected: unknown, recheck: () => Promise<void>, context: unknown) => {
      observations.push(context);
      count('http');
      await recheck();
      if (scenario === 'token-drift') await writeFile(request.tokenFile, 'changed');
      return {build: scenario === 'wrong-build' ? stamps.previous : phase === 'recovery' ? stamps.recovery : stamps.target,
        health: scenario === 'bad-health' ? {...health, lagCheck: {status: 'stopped'}} : health, configSha256: state.configSha256, credentialsSha256: sha256('credentials')};
    },
  };
  try {
    const result = await helpers.createRuntimeUpgradeRunningCheck(io)(requestFile, planFile, phase);
    return {result, counters, observations};
  } catch (error) {
    return {code: errorCode(error), counters, observations};
  }
}

void test('post-start observation binds the selected release and refuses drift without service effects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-running-check-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const inspect = (scenario: string) => bounded(scenario, runningCheck(root, scenario));
  type Passed = {result: {phase: string; verified: boolean; selection: {target: string}}; counters: {http: number}; observations: {operationId: string; trace: {traceparent: string}}[]};
  const passed = await inspect('good') as Passed;
  assert.equal(passed.result.phase, 'candidate'); assert.equal(passed.result.verified, true); assert.equal(passed.counters.http, 2);
  for (const scenario of ['onn-qualified', 'onn-retained-qualified', 'onn-bb8-qualified', 'onn-bb8-retained']) {
    const qualified = await inspect(scenario) as Passed & {code?: string};
    assert.equal(qualified.code, undefined, scenario);
    assert.equal(qualified.result.verified, true);
    assert.equal(qualified.counters.http, 2);
  }
  for (const scenario of ['onn-missing-coverage', 'onn-retained-missing-coverage', 'onn-missing-state', 'onn-bb8-no-onn-proof', 'onn-bb8-no-windows-proof']) {
    const missing = await inspect(scenario);
    assert.equal(missing.code, 'runtime-upgrade-running-refused', scenario);
    assert.equal(missing.counters.http, 0, 'missing qualification refuses before authenticated observation');
  }
  assert.equal(passed.observations.length, 2);
  assert.deepEqual(passed.observations[0], passed.observations[1]);
  assert.equal(passed.observations[0]?.operationId, 'one');
  assert.match(passed.observations[0]?.trace.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.ok(!JSON.stringify(passed.result).includes('traceparent'));
  const absentOnn = await inspect('onn-absent') as Passed & {code?: string};
  assert.equal(absentOnn.code, undefined, 'exact absent ONN health verifies after startup');
  assert.equal(absentOnn.result.verified, true);
  assert.equal(absentOnn.counters.http, 2);
  for (const phase of ['recovery', 'reupgrade']) {
    const observed = await inspect(phase) as Passed;
    assert.equal(observed.result.phase, phase);
    assert.equal(observed.result.selection.target, join(root, phase === 'recovery' ? 'previous' : 'target'));
  }
  for (const scenario of ['wrong-plan-hash','missing-lock','same-process','wrong-arguments','owner-drift','wrong-selection','late-selection-drift','wrong-build','bad-health','token-drift','source-drift','hook-drift','configured-onn','onn-running','onn-healthy','onn-wrong-reason','onn-wrong-status','unknown-module']) {
    await t.test(scenario + ' refuses', async () => {
      const value = await inspect(scenario);
      assert.equal(value.result, undefined, `${scenario} returned a result`);
      assert.equal(value.code, 'runtime-upgrade-running-refused');
    });
  }
});

void test('companion post-start health and coverage are enforced in every selected phase', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companions-running-check-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const phase of ['candidate', 'recovery', 'reupgrade']) {
    const qualified = await bounded(phase, runningCheck(root, 'companions-qualified', phase));
    assert.equal(qualified.code, undefined, phase);
    assert.equal((qualified.result as {verified: boolean}).verified, true);
    const actualCompanion = await bounded(phase, runningCheck(root, 'companions-real-present-state', phase));
    assert.equal(actualCompanion.code, undefined, `${phase} real configured companion store passes`);
    const missingCompanion = await bounded(phase, runningCheck(root, 'companions-real-missing-state', phase));
    assert.equal(missingCompanion.code, 'runtime-upgrade-running-refused', `${phase} real configured missing state refuses`);
    assert.equal(missingCompanion.counters.http, 0);
    const introduced = await bounded(phase, runningCheck(root, 'companions-introduced', phase));
    assert.equal(introduced.code, undefined, `${phase} accepts only the qualified first-created owner`);
    assert.equal((introduced.result as {verified: boolean}).verified, true);
    for (const drift of ['companions-introduced-missing-state', 'companions-introduced-unrelated-owner', 'companions-introduced-lost-owner']) {
      const changed = await bounded(drift, runningCheck(root, drift, phase));
      assert.equal(changed.code, 'runtime-upgrade-running-refused', `${phase} ${drift}`);
      assert.equal(changed.counters.http, 0, 'ownership drift refuses before observation');
    }
    for (const scenario of ['companions-no-proof', 'companions-no-recovery-code', 'companions-missing-row',
      'companions-duplicate-row', 'companions-stopped', 'companions-unhealthy', 'companions-reason', 'companions-refused']) {
      const refused = await bounded(scenario, runningCheck(root, scenario, phase));
      assert.equal(refused.code, 'runtime-upgrade-running-refused', `${phase} ${scenario}`);
      assert.equal(refused.result, undefined);
    }
  }
});

void test('BB8 post-start checks require both stores through candidate, recovery and re-upgrade', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bb8-running-check-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const phase of ['candidate', 'recovery', 'reupgrade']) {
    for (const scenario of ['selected-bb8', 'retained-bb8', 'selected-bb8-onn-absent', 'retained-bb8-onn-absent']) {
      await t.test(`${phase} ${scenario} preserves qualified coverage`, async () => {
        const observed = await bounded(scenario, runningCheck(root, scenario, phase));
        assert.equal(observed.code, undefined);
        const result = observed.result as {schema: string; phase: string; verified: boolean; selection: {target: string}};
        assert.equal(result.schema, 'runtime-running-check/1.0');
        assert.equal(result.phase, phase);
        assert.equal(result.verified, true);
        assert.equal(result.selection.target, join(root, phase === 'recovery' ? 'previous' : 'target'));
        assert.equal(observed.counters.http, 2);
      });
    }
    for (const scenario of ['selected-bb8-no-linux-proof', 'selected-bb8-no-windows-proof', 'retained-bb8-no-proof',
      'selected-bb8-unhealthy', 'selected-bb8-refused']) {
      await t.test(`${phase} ${scenario} refuses`, async () => {
        const observed = await bounded(scenario, runningCheck(root, scenario, phase));
        assert.equal(observed.result, undefined);
        assert.equal(observed.code, 'runtime-upgrade-running-refused');
      });
    }
  }
});

void test('running-check CLI refuses an unknown phase before reading installed state', async () => {
  await assert.rejects(run(process.execPath, ['apps/runtime/bin/runtime-upgrade-check.mjs', 'verify-running',
    '/synthetic/not-read-request', '/synthetic/not-read-plan', 'unknown'], {cwd: process.cwd(), timeout: 10000}), (error: unknown) => {
    const value = error as {stdout: string; stderr: string};
    assert.equal(value.stdout, '');
    assert.deepEqual(JSON.parse(value.stderr), {code: 'runtime-upgrade-running-refused', verified: false});
    return true;
  });
});
