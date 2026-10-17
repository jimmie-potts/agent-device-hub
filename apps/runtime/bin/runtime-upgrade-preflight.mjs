// Read-only composition for the established manual runtime upgrade procedure.
import {join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {childOf, MODULE_API_VERSION, noSpans, startSpan} from '@jimmie-potts/sdk';
import {canonical, readRegular, sha256} from '../../hub/dist/install/files.js';
import {createRoutineUpgradeSourceAdapter, verifyRuntimeUpgradeRelease} from './runtime-upgrade-source.mjs';
import {inspectRuntimeBaselineClosure} from './runtime-upgrade-baseline.mjs';
import {readPrivateFile, readRuntimeConfig} from '../dist/src/state.js';
import {parseUpgradeRequest, inspectUpgradePaths, inspectUpgradeExecution, inspectUpgradeRunningPaths, inspectUpgradeRecoveryPaths} from '../dist/src/upgrade-paths.js';
import {createInstalledUpgradeOwnerObserver, createInstalledUpgradeUnitObserver} from '../dist/src/upgrade-owner.js';
import {createInstalledUpgradeListenerObserver} from '../dist/src/upgrade-listener.js';
import {inspectUpgradeProtectedHooks} from '../dist/src/upgrade-hooks.js';
import {inspectUpgradeState, inspectUpgradeReceipts} from '../dist/src/upgrade-inputs.js';
import {observeInstalledUpgradeHttp} from '../dist/src/upgrade-http.js';
import {INSTANCE_ID, LogWriter, stderrSink} from '../dist/src/log.js';
import {runtimeResource, RUNTIME_SCOPE} from '../dist/src/record.js';
import {startTracing} from '../dist/src/tracing.js';
import {requireUpgradeLock} from '../dist/src/upgrade-lock.js';
const maximum = 256 * 1024;
const refused = () => {throw new Error('runtime-upgrade-preflight-refused');};
const parse = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const knownModules = ['bb8', 'companions', 'core', 'codex-desktop', 'lifx', 'nanoleaf', 'onn', 'pixoo', 'playback', 'roborock', 'tidbyt', 'wispr', 'wemo'];

// The delivered companion registration always starts. Its fixed package path
// in a verified artifact is conservative evidence of that ownership; missing
// inventory is unknown, never a legacy exemption or dynamic module discovery.
function companionRoles(source) {
  return Object.fromEntries(['previous', 'target', 'recovery'].map(role => {
    const artifact = source.artifacts?.[role];
    if (role === 'recovery' && artifact === undefined) return [role, false];
    const entries = artifact?.entries;
    if (!Array.isArray(entries)) refused();
    const matches = entries.filter(entry => entry.path === 'modules/companions/package.json');
    if (matches.length > 1 || matches.some(entry => entry.kind !== 'file'
      || !/^[0-9a-f]{64}$/.test(entry.sha256))) refused();
    return [role, matches.length === 1];
  }));
}

function requireOwnership(state, source) {
  for (const name of ['wemo', 'onn', 'bb8', 'roborock', 'companions']) {
    if (state.configured.includes(name) && !state.durableOwners.includes(name)) refused();
  }
  // Companions always starts in artifacts shipping its package. Keep its
  // current primary owner and health explicit, without historical phase proof.
  if (companionRoles(source).previous && !state.durableOwners.includes('companions')) refused();
}

const sourceInputFor = request => ({installationId: request.installationId,
  provenanceDirectory: join(request.installationRoot, 'provenance'), releases: {...request.releases,
    ...(request.recovery === null ? {} : {recovery: request.recovery.release})}});

function stateAfterStart(state, source, role) {
  if (!companionRoles(source)[role]) return state;
  return {...state, durableOwners: [...new Set([...state.durableOwners, 'companions'])].sort()};
}

function requireHealth(health, configured, lagLimitMs, companions) {
  if (health.moduleApiVersion !== MODULE_API_VERSION || health.lagCheck.status !== 'active'
    || health.lagCheck.limitMs !== lagLimitMs || !Array.isArray(health.modules)
    || configured.some(name => !knownModules.includes(name))
    || new Set(health.modules.map(row => row.name)).size !== health.modules.length
    || health.modules.some(row => !knownModules.includes(row.name))
    || !['core', ...configured, ...(companions ? ['companions'] : [])]
      .every(name => health.modules.some(row => row.name === name))) refused();
  let absentModuleException = false;
  for (const row of health.modules) {
    // #840 qualifies absent Wispr; current-runtime qualification also covers absent
    // BB8, ONN, Roborock and Wemo. Configured ownership and retained
    // state are inspected separately before health observation.
    if (['wispr', 'bb8', 'onn', 'roborock', 'wemo'].includes(row.name) && !configured.includes(row.name)) {
      if (row.state !== 'refused' || row.healthy !== false || row.reasonCode !== 'not-found') refused();
      absentModuleException = true;
    } else if ((row.name !== 'core' && !configured.includes(row.name)
      && !(row.name === 'companions' && companions))
      || row.state !== 'running' || row.healthy !== true || row.reasonCode !== null) refused();
  }
  if (health.status !== (absentModuleException ? 'degraded' : 'ok')) refused();
}

/** Internal test seam only. Requests and CLI arguments never choose these readers. */
export function createRuntimeUpgradePreflight(io) {
  const same = (a, b) => io.canonical(a) === io.canonical(b);
  return async (requestFile, approvedPlanFile) => {
    try {
      const requestBytes = await io.privateFile(requestFile, maximum);
      const request = io.parseRequest(parse(requestBytes));
      const observationContext = {operationId: request.execution.operationId, trace: childOf(undefined)};
      const execution = await io.execution(request);
      if (approvedPlanFile !== undefined) await io.lock(request.installationRoot);
      const owner = await io.owner();
      if (owner.service !== 'bunny-runtime.service' || owner.options.environment !== 'production'
        || owner.options.simulate || !owner.options.edge || owner.options.config === undefined) refused();
      const listener = await io.listener(owner.pid, owner.options.port);
      const original = async () => {
        if (!same(owner, await io.owner()) || !same(listener, await io.listener(owner.pid, owner.options.port))) refused();
      };
      const sourceInput = sourceInputFor(request);
      const source = await io.source(sourceInput);
      const baselineInput = {path: request.installedBaselineClosure.path, pin: request.installedBaselineClosure,
        installationId: request.installationId, owner, previous: {...source.artifacts.previous, inputs: source.inputs}};
      const baseline = await io.baseline(baselineInput);
      const configBytes = await io.privateFile(owner.options.config, 1024 * 1024);
      const config = await io.config(owner.options.config);
      if (config.edge === undefined || !configBytes.equals(await io.privateFile(owner.options.config, 1024 * 1024))) refused();
      const credentialsFile = config.edge.credentials;
      const verifiedPaths = {previous: source.artifacts.previous.root, target: source.artifacts.target.root,
        ...(source.artifacts.recovery === undefined ? {} : {recovery: source.artifacts.recovery.root}), baselineRoot: baseline.baselineRoot,
        revisions: {previous: source.expected.releases.previous.sourceRevision, target: source.expected.releases.target.sourceRevision,
          ...(source.expected.releases.recovery === undefined ? {} : {recovery: source.expected.releases.recovery.sourceRevision})}};
      const paths = await io.paths(request, owner, verifiedPaths, credentialsFile);
      const hookInput = {installationRoot: request.installationRoot, installationId: request.installationId, pin: request.installedBaselineClosure};
      const hooks = await io.hooks(hookInput);
      const state = await io.state(owner.options.stateDir, owner.options.config);
      requireOwnership(state, source);
      const receiptDirectory = join(request.installationRoot, 'receipts');
      const receipts = await io.receipts(receiptDirectory, request.installationId);
      requireOwnership(state, source);
      const protectedBindings = async () => {
        if (!same(execution, await io.execution(request))
          || !same(source, await io.source(sourceInput))
          || !same(baseline, await io.baseline(baselineInput)) || !same(paths, await io.paths(request, owner, verifiedPaths, credentialsFile))
          || !same(hooks, await io.hooks(hookInput)) || !same(state, await io.state(owner.options.stateDir, owner.options.config))
          || !same(receipts, await io.receipts(receiptDirectory, request.installationId))) refused();
      };
      const credentialBytes = await io.privateFile(credentialsFile, 65536);
      const tokenBytes = await io.privateFile(request.tokenFile, 65536);
      const privateInputs = {configSha256: io.sha256(configBytes), credentialsSha256: io.sha256(credentialBytes), readTokenSha256: io.sha256(tokenBytes)};
      const expectedBuild = {revision: source.expected.releases.previous.sourceRevision, version: source.expected.releases.previous.version};
      const checkHttp = value => {
        if (!same(value.build, source.stamps.previous) || value.configSha256 !== state.configSha256
          || value.configSha256 !== privateInputs.configSha256 || value.credentialsSha256 !== privateInputs.credentialsSha256) refused();
        requireHealth(value.health, state.configured, owner.options.lagLimitMs, companionRoles(source).previous);
      };
      await original();
      const http = await io.http(owner, request.tokenFile, expectedBuild, original, observationContext); checkHttp(http);
      await original();
      await protectedBindings();
      const finalHttp = await io.http(owner, request.tokenFile, expectedBuild, original, observationContext); checkHttp(finalHttp);
      // The final HTTP request is another asynchronous drift opportunity.
      // Recompare protected files and declarations against the original frame.
      await protectedBindings();
      if (!same(http, finalHttp) || !requestBytes.equals(await io.privateFile(requestFile, maximum))
        || !configBytes.equals(await io.privateFile(owner.options.config, 1024 * 1024))
        || !credentialBytes.equals(await io.privateFile(credentialsFile, 65536))
        || !tokenBytes.equals(await io.privateFile(request.tokenFile, 65536))) refused();
      await original();
      const body = {schema: 'runtime-upgrade-plan/2.0', eligibility: 'forward-eligible',
        requestSha256: io.sha256(requestBytes), operation: request.operation, installationId: request.installationId, execution,
        owner, listener, baseline, paths, hooks, state, receipts, privateInputs,
        source: {expected: source.expected, stamps: source.stamps}, changeAssessment: request.changeAssessment, recovery: request.recovery, http};
      const plan = {...body, planSha256: io.sha256(io.canonical(body))};
      if (Buffer.byteLength(io.canonical(plan)) > maximum) refused();
      if (approvedPlanFile !== undefined) {
        const approvedBytes = await io.privateFile(approvedPlanFile, maximum);
        if (!same(parse(approvedBytes), plan)) refused();
        await io.lock(request.installationRoot);
        if (!approvedBytes.equals(await io.privateFile(approvedPlanFile, maximum))) refused();
      }
      return plan;
    } catch {return refused();}
  };
}

/** Pre-effect recovery guard; no stop, selection, startup or database access. */
export function createRuntimeUpgradeRecoveryCheck(io) {
  return async (requestFile, approvedPlanFile) => {
    try {
      const requestBytes = await io.privateFile(requestFile, maximum);
      const request = io.parseRequest(parse(requestBytes));
      const approvedBytes = await io.privateFile(approvedPlanFile, maximum);
      const approved = parse(approvedBytes);
      const {planSha256, ...body} = approved;
      if (request.recovery === null || approved.schema !== 'runtime-upgrade-plan/2.0'
        || approved.eligibility !== 'forward-eligible' || io.sha256(io.canonical(body)) !== planSha256
        || io.sha256(requestBytes) !== approved.requestSha256
        || request.operation !== approved.operation || request.installationId !== approved.installationId
        || io.canonical(request.recovery) !== io.canonical(approved.recovery)
        || io.canonical(await io.execution(request)) !== io.canonical(approved.execution)) refused();
      await io.lock(request.installationRoot);
      const same = (a, b) => io.canonical(a) === io.canonical(b);
      const sourceInput = sourceInputFor(request);
      const source = await io.source(sourceInput);
      if (!same({expected: source.expected, stamps: source.stamps}, approved.source)
        || !same(source.expected.releases.recovery, source.expected.releases.previous)) refused();
      const baselineOwner = {...approved.owner, entry: join(approved.baseline.baselineRoot, 'apps/runtime/dist/src/main.js')};
      const baselineInput = {path: request.installedBaselineClosure.path, pin: request.installedBaselineClosure,
        installationId: request.installationId, owner: baselineOwner, previous: {...source.artifacts.previous, inputs: source.inputs}};
      const hookInput = {installationRoot: request.installationRoot, installationId: request.installationId, pin: request.installedBaselineClosure};
      const config = await io.config(approved.owner.options.config);
      if (config.edge === undefined) refused();
      const selections = [source.artifacts.previous.root, source.artifacts.target.root];
      const paths = await io.recoveryPaths(request, approved, selections);
      const candidateState = stateAfterStart(approved.state, source, 'target');
      const adoption = request.execution.adoption;
      const units = [...approved.owner.units, ...(adoption === null ? [] : [adoption.overrideFile])].sort();
      const bindings = async () => {
        // Finish the long closure scans before checking the small mutable pins
        // and private inputs. A change during either final scan must refuse.
        if (!same(await io.baseline(baselineInput), approved.baseline) || !same(await io.hooks(hookInput), approved.hooks)
          || !same(await io.recoveryPaths(request, approved, selections), paths) || !same(await io.units(), units)) refused();
        const state = await io.state(approved.owner.options.stateDir, approved.owner.options.config);
        if (!(same(state, approved.state) || same(state, candidateState))
          || !same(await io.execution(request), approved.execution)) refused();
        const privateInputs = {configSha256: io.sha256(await io.privateFile(approved.owner.options.config, 1024 * 1024)),
          credentialsSha256: io.sha256(await io.privateFile(config.edge.credentials, 65536)),
          readTokenSha256: io.sha256(await io.privateFile(request.tokenFile, 65536))};
        if (!same(privateInputs, approved.privateInputs)
          || !requestBytes.equals(await io.privateFile(requestFile, maximum))
          || !approvedBytes.equals(await io.privateFile(approvedPlanFile, maximum))) refused();
        await io.lock(request.installationRoot);
      };
      await bindings();
      if (!same(await io.source(sourceInput), source)) refused();
      // Source collection is asynchronous; evidence/private bindings must still
      // match after its last await. No health assumption or service effect here.
      await bindings();
      return {schema: 'runtime-recovery-check/1.0', eligible: true, planSha256,
        release: source.expected.releases.recovery, directory: source.artifacts.recovery.root};
    } catch {throw new Error('runtime-upgrade-recovery-refused');}
  };
}

/** One read-only post-start attempt. The held operation shell supplies the
 * approved timeout and finite retries, never repeats a service/device effect. */
export function createRuntimeUpgradeRunningCheck(io) {
  const fail = () => {throw new Error('runtime-upgrade-running-refused');};
  const same = (a, b) => io.canonical(a) === io.canonical(b);
  return async (requestFile, approvedPlanFile, phase) => {
    try {
      if (!['candidate', 'recovery', 'reupgrade'].includes(phase)) fail();
      const requestBytes = await io.privateFile(requestFile, maximum);
      const request = io.parseRequest(parse(requestBytes));
      const observationContext = {operationId: request.execution.operationId, trace: childOf(undefined)};
      const approvedBytes = await io.privateFile(approvedPlanFile, maximum);
      const approved = parse(approvedBytes);
      const {planSha256, ...body} = approved;
      if (approved.schema !== 'runtime-upgrade-plan/2.0' || approved.eligibility !== 'forward-eligible'
        || io.sha256(io.canonical(body)) !== planSha256 || io.sha256(requestBytes) !== approved.requestSha256
        || request.operation !== approved.operation || request.installationId !== approved.installationId
        || !same(request.execution, approved.execution)) fail();
      if (phase === 'recovery' && request.recovery === null) fail();
      if (!same(approved.recovery, request.recovery) || !same(approved.changeAssessment, request.changeAssessment)) fail();
      await io.lock(request.installationRoot);
      const owner = await io.owner();
      const argv = [...approved.owner.argv]; argv[1] = join(request.installationRoot, 'current/apps/runtime/dist/src/main.js');
      if (owner.service !== 'bunny-runtime.service' || owner.service !== approved.owner.service
        || owner.executable !== approved.owner.executable || owner.controlGroup !== approved.owner.controlGroup
        || !same(owner.options, approved.owner.options) || !same(owner.argv, argv)
        || owner.startTicks === approved.owner.startTicks && owner.pid === approved.owner.pid
        || owner.startMonotonic === approved.owner.startMonotonic) fail();
      const listener = await io.listener(owner.pid, owner.options.port);
      const sourceInput = sourceInputFor(request);
      const source = await io.source(sourceInput);
      if (!same({expected: source.expected, stamps: source.stamps}, approved.source)) fail();
      requireOwnership(approved.state, source);
      const role = phase === 'recovery' ? 'recovery' : 'target';
      const runningState = stateAfterStart(approved.state, source, role);
      const selected = source.artifacts[role].root;
      const baselineOwner = {...approved.owner, entry: join(approved.baseline.baselineRoot, 'apps/runtime/dist/src/main.js')};
      const baselineInput = {path: request.installedBaselineClosure.path, pin: request.installedBaselineClosure,
        installationId: request.installationId, owner: baselineOwner, previous: {...source.artifacts.previous, inputs: source.inputs}};
      const hookInput = {installationRoot: request.installationRoot, installationId: request.installationId, pin: request.installedBaselineClosure};
      const config = await io.config(owner.options.config);
      if (config.edge === undefined) fail();
      const privateInputs = async () => ({configSha256: io.sha256(await io.privateFile(owner.options.config, 1024 * 1024)),
        credentialsSha256: io.sha256(await io.privateFile(config.edge.credentials, 65536)),
        readTokenSha256: io.sha256(await io.privateFile(request.tokenFile, 65536))});
      const paths = await io.runningPaths(request, owner, approved, selected);
      const original = async () => {
        if (!same(owner, await io.owner()) || !same(listener, await io.listener(owner.pid, owner.options.port))
          || !same(paths, await io.runningPaths(request, owner, approved, selected))) fail();
        await io.lock(request.installationRoot);
      };
      const bindings = async () => {
        if (!same(await io.execution(request), approved.execution) || !same(await io.source(sourceInput), source)
          || !same(await io.baseline(baselineInput), approved.baseline) || !same(await io.hooks(hookInput), approved.hooks)
          || !same(await io.state(owner.options.stateDir, owner.options.config), runningState)
          || !same(await privateInputs(), approved.privateInputs)
          || !requestBytes.equals(await io.privateFile(requestFile, maximum))
          || !approvedBytes.equals(await io.privateFile(approvedPlanFile, maximum))) fail();
      };
      const expectedBuild = {revision: source.expected.releases[role].sourceRevision, version: source.expected.releases[role].version};
      const check = value => {
        if (!same(value.build, source.stamps[role]) || value.configSha256 !== approved.privateInputs.configSha256
          || value.credentialsSha256 !== approved.privateInputs.credentialsSha256) fail();
        requireHealth(value.health, runningState.configured, owner.options.lagLimitMs, companionRoles(source)[role]);
      };
      await bindings(); await original();
      const http = await io.http(owner, request.tokenFile, expectedBuild, original, observationContext); check(http);
      await bindings(); await original();
      const finalHttp = await io.http(owner, request.tokenFile, expectedBuild, original, observationContext); check(finalHttp);
      await bindings(); await original();
      if (!same(http, finalHttp)) fail();
      return {schema: 'runtime-running-check/1.0', verified: true, phase, planSha256,
        operationId: request.execution.operationId, owner, listener, selection: paths, http};
    } catch {return fail();}
  };
}

// This operator entry owns private diagnostic output; runtime readers do not.
let diagnosticSinkGuarded = false;
async function observeUpgradeHttp(owner, tokenFile, expected, recheck, operation) {
  const resource = runtimeResource('production', INSTANCE_ID);
  const log = new LogWriter(stderrSink, 'info', {now: () => Date.now()}, resource).logger(RUNTIME_SCOPE);
  if (!diagnosticSinkGuarded) {
    diagnosticSinkGuarded = true;
    process.stderr.on('error', () => {});
  }
  const tracing = await startTracing(resource, line => { process.stderr.write(line + '\n'); }, log);
  const span = startSpan(tracing?.recorder(RUNTIME_SCOPE) ?? noSpans, 'bunny.helper.run', {
    parent: operation.trace, attributes: {'bunny.operation': 'verification', 'bunny.operation.id': operation.operationId},
  });
  try { return await observeInstalledUpgradeHttp(owner, tokenFile, expected, recheck, span.context); }
  catch (error) { span.end('error'); throw error; }
  finally {
    span.end();
    try { await tracing?.shutdown(); }
    catch { log.error('runtime.tracing.failed', {'error.type': 'Error'}); }
  }
}

const installedReaders = {
  privateFile: readPrivateFile, parseRequest: parseUpgradeRequest, canonical, sha256, execution: inspectUpgradeExecution,
  units: createInstalledUpgradeUnitObserver(readRegular),
  lock: requireUpgradeLock, owner: createInstalledUpgradeOwnerObserver(readRegular),
  listener: createInstalledUpgradeListenerObserver(readRegular), source: createRoutineUpgradeSourceAdapter(verifyRuntimeUpgradeRelease),
  baseline: inspectRuntimeBaselineClosure, config: readRuntimeConfig, paths: inspectUpgradePaths,
  hooks: inspectUpgradeProtectedHooks, state: inspectUpgradeState,
  receipts: (path, installationId) => inspectUpgradeReceipts(path, installationId, validateInstallReceipt), http: observeUpgradeHttp,
  runningPaths: inspectUpgradeRunningPaths, recoveryPaths: inspectUpgradeRecoveryPaths,
};
export const runtimeUpgradePreflight = createRuntimeUpgradePreflight(installedReaders);
export const runtimeUpgradeRunningCheck = createRuntimeUpgradeRunningCheck(installedReaders);

export const runtimeUpgradeRecoveryCheck = createRuntimeUpgradeRecoveryCheck(installedReaders);
