// Read-only composition for the established manual runtime upgrade procedure.
import {join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {canonical, readRegular, sha256} from '../../hub/dist/install/files.js';
import {createUpgradeSourceAdapter, verifyRuntimeUpgradeRelease} from './runtime-upgrade-source.mjs';
import {inspectRuntimeBaselineClosure} from './runtime-upgrade-baseline.mjs';
import {readPrivateFile, readRuntimeConfig} from '../dist/src/state.js';
import {parseUpgradeRequest, inspectUpgradePaths, inspectUpgradeExecution, inspectUpgradeRunningPaths} from '../dist/src/upgrade-paths.js';
import {bindUpgradeAdmission} from '../dist/src/upgrade-admission.js';
import {createInstalledUpgradeOwnerObserver} from '../dist/src/upgrade-owner.js';
import {createInstalledUpgradeListenerObserver} from '../dist/src/upgrade-listener.js';
import {inspectUpgradeProtectedHooks} from '../dist/src/upgrade-hooks.js';
import {inspectUpgradeState, inspectUpgradeReceipts} from '../dist/src/upgrade-inputs.js';
import {observeInstalledUpgradeHttp} from '../dist/src/upgrade-http.js';
import {requireUpgradeLock} from '../dist/src/upgrade-lock.js';
const maximum = 256 * 1024;
const refused = () => {throw new Error('runtime-upgrade-preflight-refused');};
const parse = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const knownModules = ['core', 'codex-desktop', 'lifx', 'nanoleaf', 'pixoo', 'playback', 'tidbyt', 'wispr'];

function requireHealth(health, configured, lagLimitMs) {
  if (health.moduleApiVersion !== MODULE_API_VERSION || health.lagCheck.status !== 'active'
    || health.lagCheck.limitMs !== lagLimitMs || !Array.isArray(health.modules)
    || configured.some(name => !knownModules.includes(name))
    || new Set(health.modules.map(row => row.name)).size !== health.modules.length
    || health.modules.some(row => !knownModules.includes(row.name))
    || !['core', ...configured].every(name => health.modules.some(row => row.name === name))) refused();
  let wisprException = false;
  for (const row of health.modules) {
    // #840 accepts only this intentionally absent configuration. State inspection
    // rejects undeclared retained owners, including a Wispr module state folder.
    if (row.name === 'wispr' && !configured.includes('wispr')) {
      if (row.state !== 'refused' || row.healthy !== false || row.reasonCode !== 'not-found') refused();
      wisprException = true;
    } else if ((row.name !== 'core' && !configured.includes(row.name))
      || row.state !== 'running' || row.healthy !== true || row.reasonCode !== null) refused();
  }
  if (health.status !== (wisprException ? 'degraded' : 'ok')) refused();
}

/** Internal test seam only. Requests and CLI arguments never choose these readers. */
export function createRuntimeUpgradePreflight(io) {
  const same = (a, b) => io.canonical(a) === io.canonical(b);
  return async (requestFile, approvedPlanFile) => {
    try {
      const requestBytes = await io.privateFile(requestFile, maximum);
      const request = io.parseRequest(parse(requestBytes));
      const execution = await io.execution(request);
      if (approvedPlanFile !== undefined) await io.lock(request.installationRoot);
      const owner = await io.owner();
      if (owner.service !== 'bunny-runtime.service' || owner.options.environment !== 'production'
        || owner.options.simulate || !owner.options.edge || owner.options.config === undefined) refused();
      const listener = await io.listener(owner.pid, owner.options.port);
      const original = async () => {
        if (!same(owner, await io.owner()) || !same(listener, await io.listener(owner.pid, owner.options.port))) refused();
      };
      const sourceInput = {installationId: request.installationId, provenanceDirectory: join(request.installationRoot, 'provenance'),
        releases: request.releases, qualificationRevision: request.qualificationRevision, formatInventoryFiles: request.formatInventoryFiles};
      const source = await io.source(sourceInput);
      const admission = await io.admission(request.admissionFile, source.expected);
      const baselineInput = {path: request.installedBaselineClosureFile, pin: admission.installedBaselineClosure,
        installationId: request.installationId, owner, previous: {...source.artifacts.previous, inputs: source.inputs}};
      const baseline = await io.baseline(baselineInput);
      const configBytes = await io.privateFile(owner.options.config, 1024 * 1024);
      const config = await io.config(owner.options.config);
      if (config.edge === undefined || !configBytes.equals(await io.privateFile(owner.options.config, 1024 * 1024))) refused();
      const credentialsFile = config.edge.credentials;
      const verifiedPaths = {previous: source.artifacts.previous.root, target: source.artifacts.target.root,
        recovery: source.artifacts.recovery.root, baselineRoot: baseline.baselineRoot,
        revisions: {previous: source.expected.releases.previous.sourceRevision, target: source.expected.releases.target.sourceRevision,
          recovery: source.expected.releases.recovery.sourceRevision}};
      const paths = await io.paths(request, owner, verifiedPaths, credentialsFile);
      const hookInput = {installationRoot: request.installationRoot, installationId: request.installationId, pin: admission.installedBaselineClosure};
      const hooks = await io.hooks(hookInput);
      const state = await io.state(owner.options.stateDir, owner.options.config);
      const receiptDirectory = join(request.installationRoot, 'receipts');
      const receipts = await io.receipts(receiptDirectory, request.installationId);
      const protectedBindings = async () => {
        if (!same(execution, await io.execution(request))
          || !same(source, await io.source(sourceInput)) || !same(admission, await io.admission(request.admissionFile, source.expected))
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
        requireHealth(value.health, state.configured, owner.options.lagLimitMs);
      };
      await original();
      const http = await io.http(owner, request.tokenFile, expectedBuild, original); checkHttp(http);
      await original();
      await protectedBindings();
      const finalHttp = await io.http(owner, request.tokenFile, expectedBuild, original); checkHttp(finalHttp);
      // The final HTTP request is another asynchronous drift opportunity.
      // Recompare protected files and declarations against the original frame.
      await protectedBindings();
      if (!same(http, finalHttp) || !requestBytes.equals(await io.privateFile(requestFile, maximum))
        || !configBytes.equals(await io.privateFile(owner.options.config, 1024 * 1024))
        || !credentialBytes.equals(await io.privateFile(credentialsFile, 65536))
        || !tokenBytes.equals(await io.privateFile(request.tokenFile, 65536))) refused();
      await original();
      const body = {schema: 'runtime-upgrade-plan/1.0', eligibility: 'eligible-under-coordinator-admission',
        requestSha256: io.sha256(requestBytes), operation: request.operation, installationId: request.installationId, execution,
        owner, listener, baseline, paths, hooks, state, receipts, privateInputs,
        source: {expected: source.expected, stamps: source.stamps}, admission, http};
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
      const approvedBytes = await io.privateFile(approvedPlanFile, maximum);
      const approved = parse(approvedBytes);
      const {planSha256, ...body} = approved;
      if (approved.schema !== 'runtime-upgrade-plan/1.0' || approved.eligibility !== 'eligible-under-coordinator-admission'
        || io.sha256(io.canonical(body)) !== planSha256 || io.sha256(requestBytes) !== approved.requestSha256
        || request.operation !== approved.operation || request.installationId !== approved.installationId
        || !same(request.execution, approved.execution)) fail();
      await io.lock(request.installationRoot);
      const owner = await io.owner();
      const argv = [...approved.owner.argv]; argv[1] = join(request.installationRoot, 'current/apps/runtime/dist/src/main.js');
      if (owner.service !== 'bunny-runtime.service' || owner.service !== approved.owner.service
        || owner.executable !== approved.owner.executable || owner.controlGroup !== approved.owner.controlGroup
        || !same(owner.options, approved.owner.options) || !same(owner.argv, argv)
        || owner.startTicks === approved.owner.startTicks && owner.pid === approved.owner.pid
        || owner.startMonotonic === approved.owner.startMonotonic) fail();
      const listener = await io.listener(owner.pid, owner.options.port);
      const sourceInput = {installationId: request.installationId, provenanceDirectory: join(request.installationRoot, 'provenance'),
        releases: request.releases, qualificationRevision: request.qualificationRevision, formatInventoryFiles: request.formatInventoryFiles};
      const source = await io.source(sourceInput);
      if (!same({expected: source.expected, stamps: source.stamps}, approved.source)) fail();
      const admission = await io.admission(request.admissionFile, source.expected);
      if (!same(admission, approved.admission)) fail();
      const role = phase === 'recovery' ? 'recovery' : 'target';
      const selected = source.artifacts[role].root;
      const baselineOwner = {...approved.owner, entry: join(approved.baseline.baselineRoot, 'apps/runtime/dist/src/main.js')};
      const baselineInput = {path: request.installedBaselineClosureFile, pin: admission.installedBaselineClosure,
        installationId: request.installationId, owner: baselineOwner, previous: {...source.artifacts.previous, inputs: source.inputs}};
      const hookInput = {installationRoot: request.installationRoot, installationId: request.installationId, pin: admission.installedBaselineClosure};
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
          || !same(await io.admission(request.admissionFile, source.expected), admission)
          || !same(await io.baseline(baselineInput), approved.baseline) || !same(await io.hooks(hookInput), approved.hooks)
          || !same(await io.state(owner.options.stateDir, owner.options.config), approved.state)
          || !same(await privateInputs(), approved.privateInputs)
          || !requestBytes.equals(await io.privateFile(requestFile, maximum))
          || !approvedBytes.equals(await io.privateFile(approvedPlanFile, maximum))) fail();
      };
      const expectedBuild = {revision: source.expected.releases[role].sourceRevision, version: source.expected.releases[role].version};
      const check = value => {
        if (!same(value.build, source.stamps[role]) || value.configSha256 !== approved.privateInputs.configSha256
          || value.credentialsSha256 !== approved.privateInputs.credentialsSha256) fail();
        requireHealth(value.health, approved.state.configured, owner.options.lagLimitMs);
      };
      await bindings(); await original();
      const http = await io.http(owner, request.tokenFile, expectedBuild, original); check(http);
      await bindings(); await original();
      const finalHttp = await io.http(owner, request.tokenFile, expectedBuild, original); check(finalHttp);
      await bindings(); await original();
      if (!same(http, finalHttp)) fail();
      return {schema: 'runtime-running-check/1.0', verified: true, phase, planSha256,
        operationId: request.execution.operationId, owner, listener, selection: paths, http};
    } catch {return fail();}
  };
}

const installedReaders = {
  privateFile: readPrivateFile, parseRequest: parseUpgradeRequest, canonical, sha256, execution: inspectUpgradeExecution,
  lock: requireUpgradeLock, owner: createInstalledUpgradeOwnerObserver(readRegular),
  listener: createInstalledUpgradeListenerObserver(readRegular), source: createUpgradeSourceAdapter(verifyRuntimeUpgradeRelease),
  admission: bindUpgradeAdmission, baseline: inspectRuntimeBaselineClosure, config: readRuntimeConfig, paths: inspectUpgradePaths,
  hooks: inspectUpgradeProtectedHooks, state: inspectUpgradeState,
  receipts: (path, installationId) => inspectUpgradeReceipts(path, installationId, validateInstallReceipt), http: observeInstalledUpgradeHttp,
  runningPaths: inspectUpgradeRunningPaths,
};
export const runtimeUpgradePreflight = createRuntimeUpgradePreflight(installedReaders);
export const runtimeUpgradeRunningCheck = createRuntimeUpgradeRunningCheck(installedReaders);
